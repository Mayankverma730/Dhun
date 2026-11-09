/**
 * DHUN — /api/queue
 * GET    → show queue
 * POST   → enqueue song
 * DELETE → dequeue (play next)
 *
 * Findings 11 & 12: Uses persistent store and isolates anonymous guest queues.
 */

const { loadStore, saveStore, setCORS, getCallerIdentity, parsePositiveId } = require('./_store');

function resolveQueue(store, queue) {
  return queue.map(item => {
    if (!item || !Number.isSafeInteger(item.song_id)) return null;
    const song = (store.songs || []).find(candidate => candidate && Number(candidate.id) === item.song_id);
    return song ? { ...song, addedAt: item.addedAt } : null;
  }).filter(Boolean);
}

module.exports = async (req, res) => {
  setCORS(req, res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const identity = getCallerIdentity(req);
  const userId = identity.authenticated ? identity.user.id : (identity.guestId || 'guest_default');

  const store = loadStore();
  if (!store.queues || typeof store.queues !== 'object' || Array.isArray(store.queues)) {
    store.queues = Object.create(null);
  }
  if (!Array.isArray(store.queues[userId])) store.queues[userId] = [];
  const queue = store.queues[userId];

  if (req.method === 'GET') return res.status(200).json(resolveQueue(store, queue));

  if (req.method === 'POST') {
    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch { return res.status(400).json({ error: 'Invalid JSON' }); }
    }
    if (!body || body.song_id === undefined) return res.status(400).json({ error: 'song_id required' });

    const songId = parsePositiveId(body.song_id, 10000000);
    if (songId === null) {
      return res.status(400).json({ error: 'Valid positive integer song_id required' });
    }

    if (queue.length >= 200) {
      return res.status(400).json({ error: 'Queue full: maximum 200 items allowed' });
    }
    // Avoid persisting queue entries that cannot resolve to a catalog song.
    if (!(store.songs || []).some(song => song && Number(song.id) === songId)) {
      return res.status(404).json({ error: 'Song not found' });
    }

    queue.push({ song_id: songId, addedAt: Date.now() });
    saveStore(store);
    return res.status(200).json(resolveQueue(store, queue));
  }

  if (req.method === 'DELETE') {
    if (req.query.action === 'clear') {
      queue.length = 0;
      saveStore(store);
      return res.status(200).json({ cleared: true, queue: [] });
    }
    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch { return res.status(400).json({ error: 'Invalid JSON' }); }
    }
    if (body !== undefined && body !== null && (typeof body !== 'object' || Array.isArray(body))) {
      return res.status(400).json({ error: 'Expected a JSON object' });
    }
    const hasRemoveId = req.query.song_id !== undefined || (body && body.song_id !== undefined);
    if (hasRemoveId) {
      const removeId = parsePositiveId(req.query.song_id !== undefined ? req.query.song_id : body.song_id);
      if (removeId === null) {
        return res.status(400).json({ error: 'Valid positive integer song_id required' });
      }
      const idx = queue.findIndex(item => item && item.song_id === removeId);
      const removed = idx !== -1 ? queue.splice(idx, 1)[0] : null;
      saveStore(store);
      return res.status(200).json({
        removed: removed ? resolveQueue(store, [removed])[0] || null : null,
        queue: resolveQueue(store, queue)
      });
    }
    const next = queue.shift() || null;
    saveStore(store);
    // Match the C backend: DELETE returns the song that should play next.
    return res.status(200).json(next ? resolveQueue(store, [next])[0] || {} : {});
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
