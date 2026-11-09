/**
 * DHUN — /api/playlists/[id]
 * Shared persistent user playlist operations
 * GET    /api/playlists/:id/songs  → get songs in playlist
 * POST   /api/playlists/:id/songs  → add song to playlist
 * DELETE /api/playlists/:id        → delete playlist
 * DELETE /api/playlists/:id/songs  → remove song from playlist
 */

const { loadStore, saveStore, setCORS } = require('../_store');

function getUserId(req) {
  const auth = req.headers.authorization || '';
  if (auth.startsWith('Bearer ')) {
    const token = auth.slice(7).trim();
    if (token && token.length >= 8) return token.slice(0, 64);
  }
  const clientHeader = req.headers['x-user-id'];
  if (clientHeader && typeof clientHeader === 'string' && clientHeader.startsWith('guest_')) {
    return clientHeader.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
  }
  return 'guest';
}

module.exports = async (req, res) => {
  setCORS(req, res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { id } = req.query;
  const plId = parseInt(id, 10);
  if (isNaN(plId) || plId <= 0) {
    return res.status(400).json({ error: 'Valid positive integer playlist ID required' });
  }

  const store = loadStore();
  if (!store.userPlaylists) store.userPlaylists = {};

  const userId = getUserId(req);
  if (!store.userPlaylists[userId]) {
    store.userPlaylists[userId] = [];
  }
  const playlists = store.userPlaylists[userId];
  const idx = playlists.findIndex(p => p.id === plId);

  if (idx === -1) {
    return res.status(404).json({ error: 'Playlist not found' });
  }

  const playlist = playlists[idx];

  // GET /api/playlists/:id
  if (req.method === 'GET') {
    return res.status(200).json(playlist);
  }

  // POST /api/playlists/:id/songs
  if (req.method === 'POST') {
    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch { return res.status(400).json({ error: 'Invalid JSON' }); }
    }
    const songId = body && (body.song_id || body.songId);
    if (!songId) {
      return res.status(400).json({ error: 'song_id required' });
    }

    if (!playlist.songs) playlist.songs = [];
    if (!playlist.songs.includes(songId)) {
      playlist.songs.push(songId);
      playlist.song_count = playlist.songs.length;
    }
    saveStore(store);
    return res.status(200).json(playlist);
  }

  // DELETE /api/playlists/:id
  if (req.method === 'DELETE' && !req.query.action) {
    const [removed] = playlists.splice(idx, 1);
    saveStore(store);
    return res.status(200).json(removed);
  }

  // DELETE /api/playlists/:id/songs?sid=...
  if (req.method === 'DELETE' && req.query.action === 'removeSong') {
    const sid = req.query.sid;
    if (!sid) {
      return res.status(400).json({ error: 'sid required to remove song' });
    }
    if (playlist.songs) {
      playlist.songs = playlist.songs.filter(s => String(s) !== String(sid));
      playlist.song_count = playlist.songs.length;
    }
    saveStore(store);
    return res.status(200).json(playlist);
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
