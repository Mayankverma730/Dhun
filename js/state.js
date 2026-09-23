/**
 * js/state.js — Central Reactive State Store
 * Dhun Music Management System [T2-03]
 */

class AppStore {
    constructor(initialState = {}) {
        this._state = {
            currentSong: null,
            isPlaying: false,
            queue: [],
            history: [],
            playlists: [],
            likedSongIds: new Set(),
            user: null,
            jamRoom: null,
            theme: 'dark',
            volume: 0.85,
            ...initialState
        };
        this._listeners = new Map();
    }

    getState(key) {
        if (!key) return { ...this._state };
        return this._state[key];
    }

    setState(key, value) {
        const prev = this._state[key];
        if (prev === value) return;

        this._state[key] = value;
        this._notify(key, value, prev);
    }

    patchState(patchObj) {
        if (!patchObj || typeof patchObj !== 'object') return;
        Object.entries(patchObj).forEach(([k, v]) => {
            this.setState(k, v);
        });
    }

    subscribe(key, callback) {
        if (!this._listeners.has(key)) {
            this._listeners.set(key, new Set());
        }
        this._listeners.get(key).add(callback);

        // Return unsubscribe function
        return () => {
            const set = this._listeners.get(key);
            if (set) {
                set.delete(callback);
                if (set.size === 0) this._listeners.delete(key);
            }
        };
    }

    _notify(key, newVal, oldVal) {
        const listeners = this._listeners.get(key);
        if (listeners) {
            listeners.forEach(cb => {
                try {
                    cb(newVal, oldVal);
                } catch (err) {
                    console.error(`[AppStore] Error in listener for "${key}":`, err);
                }
            });
        }

        // Global wildcard subscribers
        const allListeners = this._listeners.get('*');
        if (allListeners) {
            allListeners.forEach(cb => {
                try {
                    cb(key, newVal, oldVal);
                } catch (err) {
                    console.error('[AppStore] Error in global listener:', err);
                }
            });
        }
    }
}

const store = new AppStore();

if (typeof window !== 'undefined') {
    window.AppStore = AppStore;
    window.store = store;
    window.appStore = store;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { AppStore, store };
}

