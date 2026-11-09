/**
 * DHUN — /api/history
 * GET  → show history stack
 * POST /history/back → pop history (go back)
 *
 * Findings 11 & 12: Uses persistent store and isolates anonymous guest history.
 */

const { loadStore, saveStore, setCORS, getCallerIdentity } = require('./_store');

module.exports = async (req, res) => {
  setCORS(req, res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const identity = getCallerIdentity(req);
  const userId = identity.authenticated ? identity.user.id : (identity.guestId || 'guest_default');

  const store = loadStore();
  if (!store.histories) store.histories = {};
  if (!store.histories[userId]) store.histories[userId] = [];
  const history = store.histories[userId];

  if (req.method === 'GET') return res.status(200).json(history);

  if (req.method === 'POST') {
    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch { return res.status(400).json({ error: 'Invalid JSON' }); }
    }

    // POST /api/history/back — pop history
    if (req.query.action === 'back') {
      const prev = history.pop() || null;
      saveStore(store);
      return res.status(200).json({ previous: prev, history });
    }

    // Push to history with validation
    if (body && body.song_id !== undefined) {
      const songId = parseInt(body.song_id, 10);
      if (isNaN(songId) || songId <= 0 || songId > 10000000) {
        return res.status(400).json({ error: 'Valid positive integer song_id required' });
      }

      history.push({ song_id: songId, playedAt: Date.now() });
      if (history.length > 50) history.shift();
      saveStore(store);
    }
    return res.status(200).json(history);
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
