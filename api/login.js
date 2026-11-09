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
const { loadStore, saveStore, verifyPasswordHash, setCORS } = require('./_store');

// In-memory rate limiter per IP / email to prevent brute-force attacks
const loginAttempts = new Map();

function isThrottled(key) {
  const now = Date.now();
  const record = loginAttempts.get(key);
  if (!record) return false;
  if (now > record.resetAt) {
    loginAttempts.delete(key);
    return false;
  }
  return record.count >= 5;
}

function recordAttempt(key, success) {
  const now = Date.now();
  if (success) {
    loginAttempts.delete(key);
    return;
  }
  const record = loginAttempts.get(key) || { count: 0, resetAt: now + 5 * 60 * 1000 };
  record.count++;
  loginAttempts.set(key, record);
}

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

module.exports = (req, res) => {
  setCORS(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' });

  const { email, password } = req.body || {};

  if (!email || !password) {
    return res.status(400).json({ success: false, error: 'Email and password are required' });
  }

  const cleanEmail = String(email).trim().toLowerCase();
  if (!isValidEmail(cleanEmail)) {
    return res.status(400).json({ success: false, error: 'Invalid email address format' });
  }

  const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'ip';
  const throttleKey = `${clientIp}_${cleanEmail}`;

  if (isThrottled(throttleKey)) {
    return res.status(429).json({ success: false, error: 'Too many failed login attempts. Please try again in 5 minutes.' });
  }

  const store = loadStore();
  const user = store.users.find(u => u.email === cleanEmail);

  if (!user) {
    recordAttempt(throttleKey, false);
    return res.status(401).json({ success: false, error: 'Invalid email or password' });
  }

  const isValid = verifyPasswordHash(password, user.salt, user.passwordHash);
  if (!isValid) {
    recordAttempt(throttleKey, false);
    return res.status(401).json({ success: false, error: 'Invalid email or password' });
  }

  recordAttempt(throttleKey, true);

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

  saveStore(store);

  return res.status(200).json({
    success: true,
    status: 'ok',
    token,
    user: store.sessions[token].user
  });
};
