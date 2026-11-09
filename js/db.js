/**
 * js/db.js — IndexedDB Storage Engine (DhunUserDB v2)
 * Dhun Music Management System [T2-04]
 */

const DHUN_DB_NAME = (typeof CONFIG !== 'undefined' && CONFIG.DB_NAME) ? CONFIG.DB_NAME : 'DhunUserDB';
const DHUN_DB_VERSION = (typeof CONFIG !== 'undefined' && CONFIG.DB_VERSION) ? CONFIG.DB_VERSION : 2;

class DhunDB {
    constructor() {
        this.db = null;
        this._memoryStores = new Map();
        this._fallbackMigrationPromise = null;
        this._initPromise = this._open();
    }

    _open() {
        return new Promise((resolve, reject) => {
            if (typeof window === 'undefined' || !window.indexedDB) {
                console.warn('[DhunDB] IndexedDB unavailable; using localStorage when available');
                resolve(null);
                return;
            }

            let request;
            try {
                request = window.indexedDB.open(DHUN_DB_NAME, DHUN_DB_VERSION);
            } catch (error) {
                console.warn('[DhunDB] IndexedDB open failed; using localStorage when available:', error);
                resolve(null);
                return;
            }

            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains('users')) {
                    db.createObjectStore('users', { keyPath: 'id' });
                }
                if (!db.objectStoreNames.contains('playlists')) {
                    const plStore = db.createObjectStore('playlists', { keyPath: 'id' });
                    plStore.createIndex('userId', 'userId', { unique: false });
                }
                if (!db.objectStoreNames.contains('likes')) {
                    const likeStore = db.createObjectStore('likes', { keyPath: 'key' });
                    likeStore.createIndex('userId', 'userId', { unique: false });
                }
                if (!db.objectStoreNames.contains('stats')) {
                    db.createObjectStore('stats', { keyPath: 'id' });
                }
            };

            request.onsuccess = async (event) => {
                this.db = event.target.result;
                try {
                    // Wait for legacy data to migrate before callers read from the database.
                    await this._migrateFromLocalStorage();
                } catch (e) {
                    console.warn('[DhunDB] Migration warning:', e);
                }
                resolve(this.db);
            };

            request.onerror = (event) => {
                console.error('[DhunDB] Open error:', event.target.error);
                resolve(null);
            };
        });
    }

    _keyPath(storeName) {
        return { users: 'id', playlists: 'id', likes: 'key', stats: 'id' }[storeName] || 'id';
    }

    _fallbackStore(storeName) {
        if (!this._memoryStores.has(storeName)) {
            const records = new Map();
            try {
                const raw = localStorage.getItem(`${DHUN_DB_NAME}:${storeName}`);
                const values = raw ? JSON.parse(raw) : [];
                if (Array.isArray(values)) {
                    for (const value of values) {
                        if (value && value[this._keyPath(storeName)] !== undefined) {
                            records.set(value[this._keyPath(storeName)], value);
                        }
                    }
                }
            } catch (e) {}
            this._memoryStores.set(storeName, records);
        }
        return this._memoryStores.get(storeName);
    }

    _persistFallbackStore(storeName) {
        try {
            const records = [...this._fallbackStore(storeName).values()];
            localStorage.setItem(`${DHUN_DB_NAME}:${storeName}`, JSON.stringify(records));
            return true;
        } catch (e) {
            return false;
        }
    }

    async _ready() {
        if (!this.db) {
            await this._initPromise;
            if (!this.db) {
                // Preserve legacy likes and playlists even when IndexedDB is blocked.
                if (!this._fallbackMigrationPromise) {
                    this._fallbackMigrationPromise = this._migrateFromLocalStorage();
                }
                await this._fallbackMigrationPromise;
            }
        }
        return this.db;
    }

    async _putMigratedRecord(storeName, record) {
        if (this.db) return this.put(storeName, record);
        const key = record && record[this._keyPath(storeName)];
        if (key === undefined || key === null) return null;
        this._fallbackStore(storeName).set(key, record);
        if (!this._persistFallbackStore(storeName)) {
            throw new Error(`Could not persist migrated ${storeName} data`);
        }
        return key;
    }

    async _migrateFromLocalStorage() {
        try {
            // Fix N-M-05: Migrate legacy liked songs with type and range validation
            const legacyLikes = localStorage.getItem('vibe_likes');
            if (legacyLikes) {
                const parsed = JSON.parse(legacyLikes);
                if (Array.isArray(parsed)) {
                    for (const id of parsed) {
                        const numId = Number(id);
                        if (Number.isSafeInteger(numId) && numId > 0 && numId < 100000000) {
                            await this._putMigratedRecord('likes', { key: `guest_${numId}`, userId: 'guest', songId: numId });
                        }
                    }
                    // Avoid re-importing stale data after a later unlike or playlist edit.
                    localStorage.removeItem('vibe_likes');
                }
            }

            // Fix N-M-05: Migrate legacy playlists with schema validation
            const legacyPlaylists = localStorage.getItem('vibe_playlists');
            if (legacyPlaylists) {
                const parsed = JSON.parse(legacyPlaylists);
                if (Array.isArray(parsed)) {
                    for (const [index, pl] of parsed.entries()) {
                        if (pl && typeof pl === 'object' && typeof pl.name === 'string') {
                            const validSongs = Array.isArray(pl.songs)
                                ? pl.songs.map(Number).filter(s => Number.isSafeInteger(s) && s > 0)
                                : [];
                            const oldId = Number(pl.id);
                            await this._putMigratedRecord('playlists', {
                                id: Number.isSafeInteger(oldId) && oldId > 0 ? oldId : Date.now() + index,
                                name: String(pl.name).slice(0, 100),
                                songs: validSongs,
                                userId: 'guest'
                            });
                        }
                    }
                    localStorage.removeItem('vibe_playlists');
                }
            }
        } catch (e) {
            console.debug('[DhunDB] No localStorage data needed migration');
        }
    }

    async get(storeName, key) {
        const db = await this._ready();
        if (!db) return this._fallbackStore(storeName).get(key) ?? null;
        return new Promise((resolve, reject) => {
            const tx = db.transaction(storeName, 'readonly');
            const store = tx.objectStore(storeName);
            const req = store.get(key);
            req.onsuccess = () => resolve(req.result || null);
            req.onerror = () => reject(req.error);
        });
    }

    async getAll(storeName) {
        const db = await this._ready();
        if (!db) return [...this._fallbackStore(storeName).values()];
        return new Promise((resolve, reject) => {
            const tx = db.transaction(storeName, 'readonly');
            const store = tx.objectStore(storeName);
            const req = store.getAll();
            req.onsuccess = () => resolve(req.result || []);
            req.onerror = () => reject(req.error);
        });
    }

    async put(storeName, val) {
        const db = await this._ready();
        if (!db) {
            if (!val || typeof val !== 'object') return null;
            const key = val[this._keyPath(storeName)];
            if (key === undefined || key === null) return null;
            this._fallbackStore(storeName).set(key, val);
            this._persistFallbackStore(storeName);
            return key;
        }
        return new Promise((resolve, reject) => {
            const tx = db.transaction(storeName, 'readwrite');
            const store = tx.objectStore(storeName);
            const req = store.put(val);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    }

    async delete(storeName, key) {
        const db = await this._ready();
        if (!db) {
            const removed = this._fallbackStore(storeName).delete(key);
            if (removed) this._persistFallbackStore(storeName);
            return removed;
        }
        return new Promise((resolve, reject) => {
            const tx = db.transaction(storeName, 'readwrite');
            const store = tx.objectStore(storeName);
            const req = store.delete(key);
            req.onsuccess = () => resolve(true);
            req.onerror = () => reject(req.error);
        });
    }

    async getByIndex(storeName, indexName, value) {
        const db = await this._ready();
        if (!db) return [...this._fallbackStore(storeName).values()].filter(record => record[indexName] === value);
        return new Promise((resolve, reject) => {
            const tx = db.transaction(storeName, 'readonly');
            const store = tx.objectStore(storeName);
            const index = store.index(indexName);
            const req = index.getAll(value);
            req.onsuccess = () => resolve(req.result || []);
            req.onerror = () => reject(req.error);
        });
    }
}

const db = new DhunDB();

if (typeof window !== 'undefined') {
    window.DhunDB = DhunDB;
    window.db = db;
    window.dhunDB = db;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { DhunDB, db };
}

