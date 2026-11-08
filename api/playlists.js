/**
 * DHUN — /api/playlists
 * GET  /api/playlists        → list all playlists
 * POST /api/playlists        → create playlist
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

  // Fix N-C-02: User isolation prevents multi-tenant data leaks
  const userId = getUserId(req);
  if (!global._dhunUserPlaylists[userId]) {
    global._dhunUserPlaylists[userId] = [];
  }
  const playlists = global._dhunUserPlaylists[userId];

  if (req.method === 'GET') {
    return res.status(200).json(playlists);
  }

  if (req.method === 'POST') {
    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch { return res.status(400).json({ error: 'Invalid JSON' }); }
    }
    if (!body || !body.name || typeof body.name !== 'string') {
      return res.status(400).json({ error: 'Valid playlist name required' });
    }

    if (playlists.length >= 50) {
      return res.status(400).json({ error: 'Playlist limit reached (max 50 playlists)' });
    }

    const pl = {
      id: global._dhunPlaylistNextId++,
      name: String(body.name).trim().substring(0, 100),
      songs: [],
      song_count: 0,
      createdAt: Date.now()
    };
    playlists.push(pl);
    return res.status(201).json(pl);
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
