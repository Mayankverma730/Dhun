/**
 * DHUN — /api/charts
 * GET /api/charts         → top songs by play_count
 * GET /api/charts/rating  → top songs by rating
 */

if (!global._dhunSongs) {
  global._dhunSongs = [
    { id: 1, title: 'Tujhko Jo Paaya', artist: 'Mohit Chauhan / Pritam', album: 'Crook', genre: 'Bollywood', duration: 5.72, play_count: 1, rating: 4.9, liked: 0 },
    { id: 2, title: 'Kesariya', artist: 'Arijit Singh', album: 'Brahmastra', genre: 'Bollywood', duration: 4.6, play_count: 0, rating: 4.8, liked: 0 },
    { id: 3, title: 'Raataan Lambiyan', artist: 'Jubin Nautiyal', album: 'Shershaah', genre: 'Bollywood', duration: 4.3, play_count: 0, rating: 4.7, liked: 0 },
    { id: 4, title: 'Blinding Lights', artist: 'The Weeknd', album: 'After Hours', genre: 'Pop', duration: 3.7, play_count: 0, rating: 4.9, liked: 0 },
    { id: 5, title: 'Levitating', artist: 'Dua Lipa', album: 'Future Nostalgia', genre: 'Pop', duration: 3.5, play_count: 0, rating: 4.6, liked: 0 }
  ];
}

function setCORS(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json');
}

module.exports = async (req, res) => {
  setCORS(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { sort } = req.query;
  const songs = [...global._dhunSongs];

  if (sort === 'rating') {
    songs.sort((a, b) => (b.rating || 0) - (a.rating || 0));
  } else {
    songs.sort((a, b) => (b.play_count || 0) - (a.play_count || 0));
  }

  return res.status(200).json(songs.slice(0, 10));
};
