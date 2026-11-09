/**
 * DHUN — /api/songs/[id]
 * GET    /api/songs/:id       → get one song
 * PUT    /api/songs/:id/play  → increment plays
 * PUT    /api/songs/:id/like  → toggle like
 * DELETE /api/songs/:id       → delete song (requires authorization)
 */

const { loadStore, saveStore, setCORS, getCallerIdentity } = require('../_store');

module.exports = async (req, res) => {
  setCORS(req, res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { id, action } = req.query;
  const songId = parseInt(id, 10);
  if (isNaN(songId) || songId <= 0) {
    return res.status(400).json({ error: 'Valid positive integer song ID required' });
  }

  const store = loadStore();
  const songs = store.songs;
  const idx = songs.findIndex(s => s.id === songId);

  if (idx === -1) {
    return res.status(404).json({ error: 'Song not found' });
  }

  // GET /api/songs/:id
  if (req.method === 'GET') {
    return res.status(200).json(songs[idx]);
  }

  // PUT /api/songs/:id/play — increment play count (Finding 02: Authorization check)
  if (req.method === 'PUT' && action === 'play') {
    const identity = getCallerIdentity(req);
    if (!identity.authenticated) {
      return res.status(401).json({ error: 'Unauthorized: Sign in required to record play' });
    }
    songs[idx].play_count = Math.min((songs[idx].play_count || 0) + 1, 100000000);
    saveStore(store);
    return res.status(200).json(songs[idx]);
  }

  // PUT /api/songs/:id/like — toggle like (Finding 02: Authorization check)
  if (req.method === 'PUT' && action === 'like') {
    const identity = getCallerIdentity(req);
    if (!identity.authenticated) {
      return res.status(401).json({ error: 'Unauthorized: Sign in required to like songs' });
    }
    songs[idx].liked = songs[idx].liked ? 0 : 1;
    saveStore(store);
    return res.status(200).json(songs[idx]);
  }

  // DELETE /api/songs/:id (Finding 02: Authorization check)
  if (req.method === 'DELETE') {
    const identity = getCallerIdentity(req);
    if (!identity.authenticated) {
      return res.status(401).json({ error: 'Unauthorized: Sign in required to delete songs' });
    }

    const [removed] = songs.splice(idx, 1);
    saveStore(store);
    return res.status(200).json(removed);
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
