/**
 * DHUN — /api/queue
 * GET    → show queue
 * POST   → enqueue song
 * DELETE → dequeue (play next)
 */

if (!global._dhunQueue) global._dhunQueue = [];

function setCORS(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json');
}

module.exports = async (req, res) => {
  setCORS(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET') return res.status(200).json(global._dhunQueue);

  if (req.method === 'POST') {
    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { return res.status(400).json({ error: 'Invalid JSON' }); } }
    if (!body || !body.song_id) return res.status(400).json({ error: 'song_id required' });
    global._dhunQueue.push({ song_id: parseInt(body.song_id) });
    return res.status(200).json(global._dhunQueue);
  }

  if (req.method === 'DELETE') {
    const next = global._dhunQueue.shift() || null;
    return res.status(200).json({ dequeued: next, queue: global._dhunQueue });
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
