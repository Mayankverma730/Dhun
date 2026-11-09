/**
 * DHUN — /api/charts
 * GET /api/charts         → top songs by play_count
 * GET /api/charts/rating  → top songs by rating
 *
 * Finding 12: Reads from shared persistent store.
 */

const { loadStore, setCORS } = require('./_store');

module.exports = async (req, res) => {
  setCORS(req, res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const store = loadStore();
  const songs = [...(store.songs || [])];
  const { sort } = req.query || {};

  if (sort === 'rating') {
    songs.sort((a, b) => (b.rating || 0) - (a.rating || 0));
  } else {
    songs.sort((a, b) => (b.play_count || 0) - (a.play_count || 0));
  }

  return res.status(200).json(songs.slice(0, 10));
};
