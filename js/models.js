/**
 * js/models.js — Data Models and Schema Validation
 * Dhun Music Management System [T2-02, T2-03, T3-16]
 */

class SongModel {
    constructor(data = {}) {
        this.id = Number(data.id) || Date.now();
        this.title = String(data.title || 'Untitled Track').trim().slice(0, 100);
        this.artist = String(data.artist || 'Unknown Artist').trim().slice(0, 80);
        this.album = String(data.album || 'Unknown Album').trim().slice(0, 80);
        this.genre = String(data.genre || 'Other').trim().slice(0, 50);
        const duration = Number(data.duration);
        this.duration = Number.isFinite(duration) && duration >= 0 ? duration : 0;
        const playCount = Number(data.play_count ?? data.plays ?? 0);
        this.play_count = Number.isFinite(playCount) && playCount >= 0 ? Math.floor(playCount) : 0;
        // Keep a valid zero rating instead of replacing it with the default.
        const rating = data.rating === undefined || data.rating === null || data.rating === '' ? 4.5 : Number(data.rating);
        this.rating = Number.isFinite(rating) ? Math.min(5, Math.max(0, rating)) : 4.5;
        this.liked = data.liked === true || data.liked === 1 || (typeof data.liked === 'string' && /^(true|1)$/i.test(data.liked));
        this.url = String(data.url || data.audioUrl || '');
        this.cover = data.cover || data.thumbnail || data.artwork || 'album1.jpg';
        this.source = data.source || (this.url.includes('youtube') ? 'youtube' : 'local');
        // Extended metadata [T3-16]
        this.year = data.year || null;
        this.label = data.label || null;
        this.composer = data.composer || null;
        this.mood = data.mood || null;
        this.audioQuality = data.audioQuality || 'standard';
    }

    toJSON() {
        return {
            id: this.id,
            title: this.title,
            artist: this.artist,
            album: this.album,
            genre: this.genre,
            duration: this.duration,
            play_count: this.play_count,
            rating: this.rating,
            liked: this.liked ? 1 : 0,
            url: this.url,
            cover: this.cover,
            source: this.source,
            year: this.year,
            label: this.label,
            composer: this.composer,
            mood: this.mood,
            audioQuality: this.audioQuality
        };
    }
}

class UserModel {
    constructor(data = {}) {
        this.id = String(data.id || ('usr_' + Math.random().toString(36).substring(2, 9)));
        this.name = String(data.name || 'Dhun Listener').trim().slice(0, 60);
        this.email = String(data.email || '').trim().toLowerCase();
        this.avatar = data.avatar || '';
        this.isGuest = Boolean(data.isGuest);
        this.createdAt = data.createdAt || new Date().toISOString();
        this.lastLogin = data.lastLogin || new Date().toISOString();
    }

    toJSON() {
        return {
            id: this.id,
            name: this.name,
            email: this.email,
            avatar: this.avatar,
            isGuest: this.isGuest,
            createdAt: this.createdAt,
            lastLogin: this.lastLogin
        };
    }
}

class PlaylistModel {
    constructor(data = {}) {
        this.id = Number(data.id) || Date.now();
        this.name = String(data.name || 'New Playlist').trim().slice(0, 80);
        this.userId = String(data.userId || 'guest');
        // Playlists may store either full song records or just catalog IDs.
        this.songs = Array.isArray(data.songs)
            ? data.songs.map(song => song && typeof song === 'object' ? new SongModel(song) : song)
            : [];
        this.createdAt = data.createdAt || new Date().toISOString();
    }

    toJSON() {
        return {
            id: this.id,
            name: this.name,
            userId: this.userId,
            songs: this.songs.map(s => (s.toJSON ? s.toJSON() : s)),
            createdAt: this.createdAt
        };
    }
}

if (typeof window !== 'undefined') {
    window.SongModel = SongModel;
    window.UserModel = UserModel;
    window.PlaylistModel = PlaylistModel;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { SongModel, UserModel, PlaylistModel };
}
