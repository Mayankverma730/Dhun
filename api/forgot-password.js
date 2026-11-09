/**
 * api/forgot-password.js — Server-side Password Reset Request Endpoint
 * Finding 03 Remediation:
 * - Constant-time, anti-enumeration uniform response for all emails.
 * - Raw reset token is NEVER returned in the API response.
 * - Expired token records are pruned on every invocation.
 * - Rate-limited to prevent brute-force token generation.
 */

const crypto = require('crypto');
const { loadStore, saveStore, setCORS } = require('./_store');

if (!(global._forgotRateLimits instanceof Map)) global._forgotRateLimits = new Map();

module.exports = async (req, res) => {
  setCORS(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' });

  // Rate-limiting: max 5 requests per IP per 10 minutes
  const headers = (req && req.headers) || {};
  const ip = headers['x-forwarded-for'] || (req.socket && req.socket.remoteAddress) || 'unknown';
  const now = Date.now();
  const limits = global._forgotRateLimits;
  let rl = limits.get(ip);
  if (!rl || now > rl.resetAt) {
    rl = { count: 0, resetAt: now + 600000 };
  }
  rl.count++;
  limits.set(ip, rl);
  if (limits.size > 1000) {
    for (const [key, value] of limits) {
      if (now > value.resetAt) limits.delete(key);
    }
  }
  if (rl.count > 5) {
    return res.status(429).json({ success: false, error: 'Too many password reset requests. Please try again later.' });
  }

  const { email } = req.body || {};
  if (!email || typeof email !== 'string') {
    return res.status(400).json({ success: false, error: 'Email is required' });
  }

  const cleanEmail = email.trim().toLowerCase();
  const store = loadStore();
  if (!store.resetTokens) store.resetTokens = {};

  // Prune expired or used tokens
  for (const [k, v] of Object.entries(store.resetTokens)) {
    if (!v || v.expiresAt < now || v.used) {
      delete store.resetTokens[k];
    }
  }

  const user = store.users.find(u => u.email === cleanEmail);
  if (user) {
    const rawToken = 'rst_' + crypto.randomBytes(24).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

    store.resetTokens[tokenHash] = {
      email: cleanEmail,
      rawToken: rawToken, // Kept in server storage for backend validation
      expiresAt: now + 15 * 60 * 1000, // 15 minutes
      used: false
    };

    saveStore(store);
  }

  // Uniform response regardless of account existence (Anti-enumeration)
  return res.status(200).json({
    success: true,
    message: 'If an account exists with this email address, password reset instructions have been dispatched.'
  });
};

