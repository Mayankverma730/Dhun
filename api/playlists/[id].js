/**
 * DHUN — /api/playlists/[id]
 * GET    /api/playlists/:id/songs  → get songs in playlist
 * POST   /api/playlists/:id/songs  → add song to playlist
 * DELETE /api/playlists/:id        → delete playlist
 * DELETE /api/playlists/:id/songs  → remove song from playlist (via body or query sid)
 */

if (!global._dhunUserPlaylists) {
  global._dhunUserPlaylists = {};
  global._dhunPlaylistNextId = 1;
}

function getUserId(req) {
  const auth = req.headers.authorization || '';
  if (auth.startsWith('Bearer ')) {
    const token = auth.slice(7).trim();
    if (token) return token.slice(0, 64);
  }
  const guest = req.headers['x-user-id'] || 'guest';
  return String(guest).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64) || 'guest';
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

  const { id } = req.query;
  const plId = parseInt(id, 10);
  if (isNaN(plId) || plId <= 0) {
    return res.status(400).json({ error: 'Valid positive integer playlist ID required' });
  }

  const userId = getUserId(req);
  if (!global._dhunUserPlaylists[userId]) {
    global._dhunUserPlaylists[userId] = [];
  }
  const playlists = global._dhunUserPlaylists[userId];
  const idx = playlists.findIndex(p => p.id === plId);

  if (idx === -1) {
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
    const songId = parseInt(body && body.song_id, 10);
    if (isNaN(songId) || songId <= 0 || songId > 10000000) {
      return res.status(400).json({ error: 'Valid positive integer song_id required' });
    }

    if (!playlists[idx].songs) playlists[idx].songs = [];

    // Bound playlist size to prevent memory exhaustion
    if (playlists[idx].songs.length >= 500) {
      return res.status(400).json({ error: 'Playlist full (max 500 songs)' });
    }

    if (!playlists[idx].songs.find(s => s.id === songId)) {
      playlists[idx].songs.push({ id: songId, addedAt: Date.now() });
      playlists[idx].song_count = playlists[idx].songs.length;
    }
    return res.status(200).json(playlists[idx]);
  }

  // DELETE /api/playlists/:id (or remove song if sid/song_id specified)
  if (req.method === 'DELETE') {
    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch { /* ignore parse error if no body */ }
    }
    const removeSongId = parseInt((body && body.song_id) || req.query.sid, 10);

    if (!isNaN(removeSongId) && removeSongId > 0) {
      // Remove specific song from playlist
      if (playlists[idx].songs) {
        playlists[idx].songs = playlists[idx].songs.filter(s => s.id !== removeSongId);
        playlists[idx].song_count = playlists[idx].songs.length;
      }
      return res.status(200).json(playlists[idx]);
    }

    // Delete entire playlist
    const [removed] = playlists.splice(idx, 1);
    return res.status(200).json(removed);
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
