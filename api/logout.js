/** Revoke the bearer session when the user signs out. */
const { loadStore, saveStore, setCORS, withStoreLock } = require('./_store');

module.exports = withStoreLock(async (req, res) => {
  setCORS(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' });

  const authorization = req.headers.authorization || '';
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
  if (token) {
    const store = await loadStore();
    if (store.sessions[token]) {
      delete store.sessions[token];
      await saveStore(store);
    }
  }
  return res.status(200).json({ success: true });
});
