/**
 * DHUN — /api/songs/[id]
 * GET    /api/songs/:id       → get one song
 * PUT    /api/songs/:id/play  → increment plays
 * PUT    /api/songs/:id/like  → toggle like
 * DELETE /api/songs/:id       → delete song
 */

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
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json');
}

module.exports = async (req, res) => {
  setCORS(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { id, action } = req.query;
  const songId = parseInt(id);
  const songs = global._dhunSongs;
  const idx = songs.findIndex(s => s.id === songId);

  if (isNaN(songId) || idx === -1) {
    return res.status(404).json({ error: 'Song not found' });
  }

  // GET /api/songs/:id
  if (req.method === 'GET') {
    return res.status(200).json(songs[idx]);
  }

  // PUT /api/songs/:id/play — increment play count
  if (req.method === 'PUT' && action === 'play') {
    songs[idx].play_count = (songs[idx].play_count || 0) + 1;
    return res.status(200).json(songs[idx]);
  }

  // PUT /api/songs/:id/like — toggle like
  if (req.method === 'PUT' && action === 'like') {
    songs[idx].liked = songs[idx].liked ? 0 : 1;
    return res.status(200).json(songs[idx]);
  }

  // DELETE /api/songs/:id
  if (req.method === 'DELETE') {
    const [removed] = songs.splice(idx, 1);
    return res.status(200).json(removed);
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
