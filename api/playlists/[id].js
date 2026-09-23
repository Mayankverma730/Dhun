/**
 * DHUN — /api/playlists/[id]
 * GET    /api/playlists/:id/songs  → get songs in playlist
 * POST   /api/playlists/:id/songs  → add song to playlist
 * DELETE /api/playlists/:id        → delete playlist
 * DELETE /api/playlists/:id/songs/:sid → remove song from playlist
 */

if (!global._dhunPlaylists) {
  global._dhunPlaylists = [];
  global._dhunPlaylistNextId = 1;
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

  const { id } = req.query;
  const plId = parseInt(id);
  const playlists = global._dhunPlaylists;
  const idx = playlists.findIndex(p => p.id === plId);

  if (isNaN(plId) || idx === -1) {
    return res.status(404).json({ error: 'Playlist not found' });
  }

  // GET /api/playlists/:id/songs
  if (req.method === 'GET') {
    return res.status(200).json(playlists[idx].songs || []);
  }

  // POST /api/playlists/:id/songs — add song
  if (req.method === 'POST') {
    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch { return res.status(400).json({ error: 'Invalid JSON' }); }
    }
    const songId = parseInt(body && body.song_id);
    if (!songId) return res.status(400).json({ error: 'song_id required' });

    if (!playlists[idx].songs) playlists[idx].songs = [];
    if (!playlists[idx].songs.find(s => s.id === songId)) {
      playlists[idx].songs.push({ id: songId });
      playlists[idx].song_count = playlists[idx].songs.length;
    }
    return res.status(200).json(playlists[idx]);
  }

  // DELETE /api/playlists/:id
  if (req.method === 'DELETE') {
    const [removed] = playlists.splice(idx, 1);
    return res.status(200).json(removed);
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
