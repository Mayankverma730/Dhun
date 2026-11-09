/**
 * DHUN — /api/playlists
 * Shared persistent user playlists
 * GET  /api/playlists        → list all playlists
 * POST /api/playlists        → create playlist
 */

// Change note: playlist IDs and edits are protected from concurrent lost updates.
const { loadStore, saveStore, setCORS, getUserPlaylistBucket, withStoreLock } = require('./_store');

module.exports = withStoreLock(async (req, res) => {
  setCORS(req, res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const store = await loadStore();
  if (!store.nextPlaylistId) store.nextPlaylistId = 1;
  const { playlists, migrated } = getUserPlaylistBucket(req, store);
  if (migrated) await saveStore(store);

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
    await saveStore(store);

    return res.status(201).json(pl);
  }

  return res.status(405).json({ error: 'Method not allowed' });
});
