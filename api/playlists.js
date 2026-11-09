/**
 * DHUN — /api/playlists
 * Shared persistent user playlists
 * GET  /api/playlists        → list all playlists
 * POST /api/playlists        → create playlist
 */

const { loadStore, saveStore, setCORS } = require('./_store');

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

  const store = loadStore();
  if (!store.userPlaylists) store.userPlaylists = {};
  if (!store.nextPlaylistId) store.nextPlaylistId = 1;

  const userId = getUserId(req);
  if (!store.userPlaylists[userId]) {
    store.userPlaylists[userId] = [];
  }
  const playlists = store.userPlaylists[userId];

  if (req.method === 'GET') {
    return res.status(200).json(playlists);
  }

  if (req.method === 'POST') {
    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch { return res.status(400).json({ error: 'Invalid JSON' }); }
    }
    if (!body || !body.name || typeof body.name !== 'string') {
      return res.status(400).json({ error: 'Valid playlist name required' });
    }

    if (playlists.length >= 50) {
      return res.status(400).json({ error: 'Playlist limit reached (max 50 playlists)' });
    }

    const pl = {
      id: store.nextPlaylistId++,
      name: String(body.name).trim().substring(0, 100),
      songs: [],
      song_count: 0,
      createdAt: Date.now()
    };
    playlists.push(pl);
    saveStore(store);

    return res.status(201).json(pl);
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
