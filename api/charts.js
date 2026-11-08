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

function isAllowedOrigin(origin) {
  if (!origin) return false;
  const allowed = process.env.ALLOWED_ORIGIN;
  if (allowed === '*' || origin === allowed) return true;
  if (/^https?:\/\/localhost(:\d+)?$/.test(origin) || /^https?:\/\/127\.0\.0\.1(:\d+)?$/.test(origin)) return true;
  if (/^https:\/\/[a-zA-Z0-9-]+\.vercel\.app$/.test(origin)) return true;
  return false;
}

function setCORS(req, res) {
  const origin = req.headers.origin;
  if (origin && isAllowedOrigin(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  } else if (!origin) {
    res.setHeader('Access-Control-Allow-Origin', '*');
  } else {
    const defaultOrigin = process.env.ALLOWED_ORIGIN || 'https://dhun-vk85.vercel.app';
    res.setHeader('Access-Control-Allow-Origin', defaultOrigin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-user-id');
  res.setHeader('Content-Type', 'application/json');
}

module.exports = async (req, res) => {
  setCORS(req, res);
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
