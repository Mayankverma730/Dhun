/**
 * DHUN — /api/playlists
 * Shared persistent user playlists
 * GET  /api/playlists        → list all playlists
 * POST /api/playlists        → create playlist
 */

const { loadStore, saveStore, setCORS, getUserPlaylistBucket } = require('./_store');

module.exports = async (req, res) => {
  setCORS(req, res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const store = loadStore();
  if (!store.nextPlaylistId) store.nextPlaylistId = 1;
  const { playlists } = getUserPlaylistBucket(req, store);

  if (req.method === 'GET') {
    return res.status(200).json(playlists);
  }

  if (req.method === 'POST') {
    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch { return res.status(400).json({ error: 'Invalid JSON' }); }
    }
    if (!body || typeof body.name !== 'string' || !body.name.trim()) {
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
