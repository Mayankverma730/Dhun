/**
 * js/db.js — IndexedDB Storage Engine (DhunUserDB v2)
 * Dhun Music Management System [T2-04]
 */

const DHUN_DB_NAME = (typeof CONFIG !== 'undefined' && CONFIG.DB_NAME) ? CONFIG.DB_NAME : 'DhunUserDB';
const DHUN_DB_VERSION = (typeof CONFIG !== 'undefined' && CONFIG.DB_VERSION) ? CONFIG.DB_VERSION : 2;

class DhunDB {
    constructor() {
        this.db = null;
        this._initPromise = this._open();
    }

    _open() {
        return new Promise((resolve, reject) => {
            if (!window.indexedDB) {
                console.warn('[DhunDB] IndexedDB not available, fallback to in-memory/localStorage');
                resolve(null);
                return;
            }

            const request = indexedDB.open(DHUN_DB_NAME, DHUN_DB_VERSION);

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

            request.onsuccess = (event) => {
                this.db = event.target.result;
                this._migrateFromLocalStorage().catch(e => console.warn('[DhunDB] Migration warning:', e));
                resolve(this.db);
            };

            request.onerror = (event) => {
                console.error('[DhunDB] Open error:', event.target.error);
                reject(event.target.error);
            };
        });
    }

    async _ready() {
        if (!this.db) {
            await this._initPromise;
        }
        return this.db;
    }

    async _migrateFromLocalStorage() {
        try {
            // Migrate legacy liked songs
            const legacyLikes = localStorage.getItem('vibe_likes');
            if (legacyLikes) {
                const parsed = JSON.parse(legacyLikes);
                if (Array.isArray(parsed)) {
                    for (const id of parsed) {
                        await this.put('likes', { key: `guest_${id}`, userId: 'guest', songId: id });
                    }
                }
            }

            // Migrate legacy playlists
            const legacyPlaylists = localStorage.getItem('vibe_playlists');
            if (legacyPlaylists) {
                const parsed = JSON.parse(legacyPlaylists);
                if (Array.isArray(parsed)) {
                    for (const pl of parsed) {
                        await this.put('playlists', { ...pl, userId: pl.userId || 'guest' });
                    }
                }
            }
        } catch (e) {
            console.debug('[DhunDB] No localStorage data needed migration');
        }
    }

    async get(storeName, key) {
        const db = await this._ready();
        if (!db) return null;
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
        if (!db) return [];
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
        if (!db) return null;
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
        if (!db) return false;
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
        if (!db) return [];
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

