/**
 * DHUN — /api/queue
 * GET    → show queue
 * POST   → enqueue song
 * DELETE → dequeue (play next)
 */

if (!global._dhunUserQueue) global._dhunUserQueue = {};

function getUserId(req) {
  const auth = req.headers.authorization || '';
  if (auth.startsWith('Bearer ')) {
    const token = auth.slice(7).trim();
    if (token) return token.slice(0, 64);
  }
  const guest = req.headers['x-user-id'] || 'guest';
  return String(guest).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64) || 'guest';
}

function setCORS(req, res) {
  const origin = req.headers.origin;
  const allowed = process.env.ALLOWED_ORIGIN || 'http://localhost:3000';
  if (origin && (origin === allowed || allowed === '*')) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  } else {
    res.setHeader('Access-Control-Allow-Origin', allowed);
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-User-Id');
  res.setHeader('Content-Type', 'application/json');
}

module.exports = async (req, res) => {
  setCORS(req, res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Fix N-C-02: User isolation prevents multi-tenant data leaks and crosstalk
  const userId = getUserId(req);
  if (!global._dhunUserQueue[userId]) {
    global._dhunUserQueue[userId] = [];
  }
  const queue = global._dhunUserQueue[userId];

  if (req.method === 'GET') return res.status(200).json(queue);

  if (req.method === 'POST') {
    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch { return res.status(400).json({ error: 'Invalid JSON' }); }
    }
    if (!body || body.song_id === undefined) return res.status(400).json({ error: 'song_id required' });

    const songId = parseInt(body.song_id, 10);
    if (isNaN(songId) || songId <= 0 || songId > 10000000) {
      return res.status(400).json({ error: 'Valid positive integer song_id required' });
    }

    // Fix N-M-02: Bound queue length to 200 items to prevent memory exhaustion DoS
    if (queue.length >= 200) {
      return res.status(400).json({ error: 'Queue full: maximum 200 items allowed' });
    }

    queue.push({ song_id: songId, addedAt: Date.now() });
    return res.status(200).json(queue);
  }

  if (req.method === 'DELETE') {
    if (req.query.action === 'clear') {
      queue.length = 0;
      return res.status(200).json({ cleared: true, queue });
    }
    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch { /* ignore */ }
    }
    const removeId = parseInt(req.query.song_id || (body && body.song_id), 10);
    if (!isNaN(removeId) && removeId > 0) {
      const idx = queue.findIndex(item => item.song_id === removeId);
      const removed = idx !== -1 ? queue.splice(idx, 1)[0] : null;
      return res.status(200).json({ removed, queue });
    }
    const next = queue.shift() || null;
    return res.status(200).json({ dequeued: next, queue });
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
