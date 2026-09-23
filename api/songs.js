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

function setCORS(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  res.setHeader('Content-Type', 'application/json');
}

module.exports = async (req, res) => {
  setCORS(res);
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
    if (!body || !body.title) return res.status(400).json({ error: 'title required' });

    const song = {
      id: global._dhunNextId++,
      title: String(body.title).substring(0, 200),
      artist: String(body.artist || 'Unknown').substring(0, 100),
      album: String(body.album || '').substring(0, 100),
      genre: String(body.genre || '').substring(0, 50),
      duration: parseFloat(body.duration) || 3.5,
      play_count: 0,
      rating: parseFloat(body.rating) || 4.0,
      liked: 0
    };
    songs.push(song);
    return res.status(201).json(song);
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
