/**
 * DHUN — /api/songs/[id]
 * GET    /api/songs/:id       → get one song
 * PUT    /api/songs/:id/play  → increment plays
 * PUT    /api/songs/:id/like  → toggle like
 * DELETE /api/songs/:id       → delete song (requires authorization)
 */

const { loadStore, saveStore, setCORS, getCallerIdentity, getUserSongLikes } = require('../_store');

module.exports = async (req, res) => {
  setCORS(req, res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { id, action } = req.query;
  const songId = Number(id);
  if (!Number.isSafeInteger(songId) || songId <= 0) {
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
    const { songIds } = getUserSongLikes(req, store);
    const liked = songIds.some(id => String(id) === String(songId));
    return res.status(200).json({ ...songs[idx], liked: liked ? 1 : 0 });
  }

  // PUT /api/songs/:id/play — increment play count (Finding 02: Authorization check)
  if (req.method === 'PUT' && action === 'play') {
    const identity = getCallerIdentity(req);
    if (!identity.authenticated) {
      return res.status(401).json({ error: 'Unauthorized: Sign in required to record play' });
    }
    const currentPlayCount = Number(songs[idx].play_count);
    songs[idx].play_count = Math.min(
      (Number.isSafeInteger(currentPlayCount) && currentPlayCount >= 0 ? currentPlayCount : 0) + 1,
      100000000
    );
    saveStore(store);
    const { songIds } = getUserSongLikes(req, store);
    const liked = songIds.some(id => String(id) === String(songId));
    return res.status(200).json({ ...songs[idx], liked: liked ? 1 : 0 });
  }

  // PUT /api/songs/:id/like — toggle like (Finding 02: Authorization check)
  if (req.method === 'PUT' && action === 'like') {
    const identity = getCallerIdentity(req);
    if (!identity.authenticated) {
      return res.status(401).json({ error: 'Unauthorized: Sign in required to like songs' });
    }
    const { songIds } = getUserSongLikes(req, store);
    const likedIndex = songIds.findIndex(id => String(id) === String(songId));
    if (likedIndex === -1) songIds.push(songId);
    else songIds.splice(likedIndex, 1);
    saveStore(store);
    return res.status(200).json({ ...songs[idx], liked: likedIndex === -1 ? 1 : 0 });
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
