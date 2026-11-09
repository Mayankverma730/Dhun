/**
 * DHUN — /api/history
 * GET  → show history stack
 * POST /history/back → pop history (go back)
 *
 * Findings 11 & 12: Uses persistent store and isolates anonymous guest history.
 */

// Change note: pass the loaded session store to identity checks and serialize updates.
const { loadStore, saveStore, setCORS, getCallerIdentity, parsePositiveId, withStoreLock } = require('./_store');

module.exports = withStoreLock(async (req, res) => {
  setCORS(req, res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const store = await loadStore();
  const identity = getCallerIdentity(req, store);
  const userId = identity.authenticated ? identity.user.id : identity.guestId;
  if (!store.histories || typeof store.histories !== 'object' || Array.isArray(store.histories)) {
    store.histories = Object.create(null);
  }
  if (!Array.isArray(store.histories[userId])) store.histories[userId] = [];
  const history = store.histories[userId];

  if (req.method === 'GET') return res.status(200).json(history);

  if (req.method === 'POST') {
    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch { return res.status(400).json({ error: 'Invalid JSON' }); }
    }

    // POST /api/history/back — pop history
    if (req.query.action === 'back') {
      // The top entry is the song currently playing; skip it before choosing the previous one.
      if (history.length) history.pop();
      let previous = null;
      while (history.length && !previous) {
        const entry = history.pop();
        if (entry && entry.song_id !== undefined) {
          previous = (store.songs || []).find(song => song && String(song.id) === String(entry.song_id)) || null;
        }
      }
      await saveStore(store);
      return res.status(200).json(previous || {});
    }

    // Push to history with validation
    if (body && body.song_id !== undefined) {
      const songId = parsePositiveId(body.song_id, 10000000);
      if (songId === null) {
        return res.status(400).json({ error: 'Valid positive integer song_id required' });
      }

      history.push({ song_id: songId, playedAt: Date.now() });
      if (history.length > 50) history.shift();
      await saveStore(store);
    }
    return res.status(200).json(history);
  }

  return res.status(405).json({ error: 'Method not allowed' });
});
