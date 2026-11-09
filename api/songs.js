/**
 * ══════════════════════════════════════════════════════════════════
 *   DHUN — Vercel Serverless API  /api/songs
 *   Shared persistent store with authorization & validation
 *   GET  /api/songs          → list all songs
 *   POST /api/songs          → add song (requires authorization)
 *   GET  /api/songs?q=       → search by title/artist
 * ══════════════════════════════════════════════════════════════════
 */

const { loadStore, saveStore, setCORS, getCallerIdentity } = require('./_store');

module.exports = async (req, res) => {
  setCORS(req, res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const store = loadStore();
  const songs = store.songs;

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
    // Finding 02: Authorization check for catalog mutations
    const identity = getCallerIdentity(req);
    if (!identity.authenticated) {
      return res.status(401).json({ error: 'Unauthorized: Sign in required to add songs to library' });
    }

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

    // Duplicate check
    const isDuplicate = songs.some(s =>
      s.title.toLowerCase() === title.toLowerCase() &&
      s.artist.toLowerCase() === artist.toLowerCase()
    );
    if (isDuplicate) {
      return res.status(409).json({ error: 'A song with this title and artist already exists' });
    }

    let duration = parseFloat(body.duration);
    if (isNaN(duration) || duration <= 0 || duration > 600) {
      duration = 3.5;
    }

    let rating = parseFloat(body.rating);
    if (isNaN(rating) || rating < 0 || rating > 5.0) {
      rating = 4.0;
    }

    const song = {
      id: store.nextSongId++,
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
    saveStore(store);

    return res.status(201).json(song);
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
