/**
 * DHUN — /api/history
 * GET  → show history stack
 * POST /history/back → pop history (go back)
 */

if (!global._dhunUserHistory) global._dhunUserHistory = {};

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
  if (!global._dhunUserHistory[userId]) {
    global._dhunUserHistory[userId] = [];
  }
  const history = global._dhunUserHistory[userId];

  if (req.method === 'GET') return res.status(200).json(history);

  if (req.method === 'POST') {
    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch { return res.status(400).json({ error: 'Invalid JSON' }); }
    }

    // POST /api/history/back — pop history
    if (req.query.action === 'back') {
      const prev = history.pop() || null;
      return res.status(200).json({ previous: prev, history });
    }

    // Push to history with N-M-01 validation
    if (body && body.song_id !== undefined) {
      const songId = parseInt(body.song_id, 10);
      if (isNaN(songId) || songId <= 0 || songId > 10000000) {
        return res.status(400).json({ error: 'Valid positive integer song_id required' });
      }

      history.push({ song_id: songId, playedAt: Date.now() });
      if (history.length > 50) history.shift();
    }
    return res.status(200).json(history);
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
