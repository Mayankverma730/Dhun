/**
 * DHUN — /api/charts
 * GET /api/charts         → top songs by play_count
 * GET /api/charts/rating  → top songs by rating
 *
 * Finding 12: Reads from shared persistent store.
 */

// Change note: await shared reads and use the same store for caller-specific likes.
const { loadStore, setCORS, getUserSongLikes, withStoreLock } = require('./_store');

module.exports = withStoreLock(async (req, res) => {
  setCORS(req, res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const store = await loadStore();
  const songs = [...(store.songs || [])];
  const { songIds } = getUserSongLikes(req, store);
  const likedIds = new Set(songIds.map(String));
  const { sort } = req.query || {};

  if (sort === 'rating') {
    songs.sort((a, b) => (b.rating || 0) - (a.rating || 0));
  } else {
    songs.sort((a, b) => (b.play_count || 0) - (a.play_count || 0));
  }

  // Like state belongs to the caller, so never return the legacy shared flag.
  return res.status(200).json(songs.slice(0, 10).map(song => ({
    ...song,
    liked: likedIds.has(String(song.id)) ? 1 : 0
  })));
});
