/**
 * ══════════════════════════════════════════════════════════════════
 *   DHUN — Vercel Serverless API  /api/songs
 *   In-memory song store (per cold-start) with full CRUD
 *   GET  /api/songs          → list all songs
 *   POST /api/songs          → add song
 *   GET  /api/songs?q=       → search by title/artist
 * ══════════════════════════════════════════════════════════════════
 */

// Shared in-memory store (per Vercel instance / warm lambda)
if (!global._dhunSongs) {
  global._dhunSongs = [
    { id: 1, title: 'Tujhko Jo Paaya', artist: 'Mohit Chauhan / Pritam', album: 'Crook', genre: 'Bollywood', duration: 5.72, play_count: 1, rating: 4.9, liked: 0 },
    { id: 2, title: 'Kesariya', artist: 'Arijit Singh', album: 'Brahmastra', genre: 'Bollywood', duration: 4.6, play_count: 0, rating: 4.8, liked: 0 },
    { id: 3, title: 'Raataan Lambiyan', artist: 'Jubin Nautiyal', album: 'Shershaah', genre: 'Bollywood', duration: 4.3, play_count: 0, rating: 4.7, liked: 0 },
    { id: 4, title: 'Blinding Lights', artist: 'The Weeknd', album: 'After Hours', genre: 'Pop', duration: 3.7, play_count: 0, rating: 4.9, liked: 0 },
    { id: 5, title: 'Levitating', artist: 'Dua Lipa', album: 'Future Nostalgia', genre: 'Pop', duration: 3.5, play_count: 0, rating: 4.6, liked: 0 }
  ];
  global._dhunNextId = 6;
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

  const songs = global._dhunSongs;

  if (req.method === 'GET') {
    const q = (req.query.q || '').toLowerCase().trim();
    if (q) {
      const results = songs.filter(s =>
        s.title.toLowerCase().includes(q) ||
        s.artist.toLowerCase().includes(q) ||
        (s.album || '').toLowerCase().includes(q) ||
        (s.genre || '').toLowerCase().includes(q)
      );
      return res.status(200).json(results);
    }
    return res.status(200).json(songs);
  }

  if (req.method === 'POST') {
    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch { return res.status(400).json({ error: 'Invalid JSON' }); }
    }
    if (!body || !body.title || typeof body.title !== 'string') {
      return res.status(400).json({ error: 'title required' });
    }

    const title = String(body.title).trim().substring(0, 200);
    const artist = String(body.artist || 'Unknown').trim().substring(0, 100);

    if (songs.length >= 1000) {
      return res.status(400).json({ error: 'Song store limit reached (max 1000 songs)' });
    }

    // Fix N-M-03: Duplicate check matching C server behavior
    const isDuplicate = songs.some(s =>
      s.title.toLowerCase() === title.toLowerCase() &&
      s.artist.toLowerCase() === artist.toLowerCase()
    );
    if (isDuplicate) {
      return res.status(409).json({ error: 'A song with this title and artist already exists' });
    }

    // Fix N-L-02: Range validation for duration and rating
    let duration = parseFloat(body.duration);
    if (isNaN(duration) || duration <= 0 || duration > 600) {
      duration = 3.5;
    }

    let rating = parseFloat(body.rating);
    if (isNaN(rating) || rating < 0 || rating > 5.0) {
      rating = 4.0;
    }

    const song = {
      id: global._dhunNextId++,
      title,
      artist,
      album: String(body.album || '').trim().substring(0, 100),
      genre: String(body.genre || '').trim().substring(0, 50),
      duration,
      play_count: 0,
      rating,
      liked: 0
    };
    songs.push(song);
    return res.status(201).json(song);
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
