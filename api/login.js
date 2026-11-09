/**
 * api/login.js — Serverless Auth Endpoint for Dhun on Vercel
 *
 * Fixes Finding 01:
 * - Checks credentials against real registered accounts in the store.
 * - Compares password hash with constant-time equality check.
 * - Applies login rate limiting / throttling.
 * - Issues expiring session token.
 */

const crypto = require('crypto');
// Change note: shared throttling and a store lock keep login safe across serverless instances.
const { loadStore, saveStore, hashPassword, verifyPasswordHash, setCORS, withStoreLock, consumeRateLimit, clearRateLimit } = require('./_store');

function isValidEmail(email) {
  if (typeof email !== 'string') return false;
  const trimmed = email.trim();
  if (trimmed.length < 3 || trimmed.length > 120) return false;
  const at = trimmed.indexOf('@');
  if (at <= 0) return false;
  const dot = trimmed.indexOf('.', at + 1);
  if (dot <= at + 1 || dot >= trimmed.length - 1) return false;
  return true;
}

module.exports = withStoreLock(async (req, res) => {
  setCORS(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' });

  const { email, password } = req.body || {};

  if (!email || typeof password !== 'string' || password.length > 1024) {
    return res.status(400).json({ success: false, error: 'Email and password are required' });
  }

  const cleanEmail = String(email).trim().toLowerCase();
  if (!isValidEmail(cleanEmail)) {
    return res.status(400).json({ success: false, error: 'Invalid email address format' });
  }

  const clientIp = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'ip').split(',')[0].trim();
  const throttleKey = `${clientIp}_${cleanEmail}`;

  const rateLimit = await consumeRateLimit(`login:${throttleKey}`, 5, 5 * 60 * 1000);
  if (!rateLimit.allowed) {
    return res.status(429).json({ success: false, error: 'Too many failed login attempts. Please try again in 5 minutes.' });
  }

  const store = await loadStore();
  const user = store.users.find(account => account && account.email === cleanEmail);

  if (!user) {
    return res.status(401).json({ success: false, error: 'Invalid email or password' });
  }

  // Existing records may predate the iteration marker; accept both known formats once.
  const candidates = Number.isSafeInteger(user.passwordIterations) ? [user.passwordIterations] : [10000, 100000];
  let matchedIterations = 0;
  for (const rounds of candidates) {
    if (verifyPasswordHash(password, user.salt, user.passwordHash, rounds)) {
      matchedIterations = rounds;
      break;
    }
  }
  if (!matchedIterations) {
    return res.status(401).json({ success: false, error: 'Invalid email or password' });
  }

  // Upgrade older password hashes on successful login so all future checks use the stronger cost.
  if (matchedIterations < 100000) {
    user.salt = crypto.randomBytes(16).toString('hex');
    user.passwordHash = hashPassword(password, user.salt);
  }
  user.passwordIterations = 100000;

  await clearRateLimit(`login:${throttleKey}`);

  // Issue 7-day expiring session token
  const token = 'sess_' + crypto.randomBytes(24).toString('hex');
  store.sessions[token] = {
    token,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      provider: user.provider || 'email',
      avatarColor: user.avatarColor || '#829779'
    },
    expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000
  };

  await saveStore(store);

  return res.status(200).json({
    success: true,
    status: 'ok',
    token,
    user: store.sessions[token].user
  });
});
