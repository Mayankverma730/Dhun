/**
 * DHUN — /api/history
 * GET  → show history stack
 * POST /history/back → pop history (go back)
 */

if (!global._dhunHistory) global._dhunHistory = [];

function setCORS(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json');
}

module.exports = async (req, res) => {
  setCORS(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET') return res.status(200).json(global._dhunHistory);

  if (req.method === 'POST') {
    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { return res.status(400).json({ error: 'Invalid JSON' }); } }

    // POST /api/history/back — pop history
    if (req.query.action === 'back') {
      const prev = global._dhunHistory.pop() || null;
      return res.status(200).json({ previous: prev, history: global._dhunHistory });
    }

    // Push to history
    if (body && body.song_id) {
      global._dhunHistory.push({ song_id: parseInt(body.song_id), playedAt: Date.now() });
      if (global._dhunHistory.length > 50) global._dhunHistory.shift();
    }
    return res.status(200).json(global._dhunHistory);
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
