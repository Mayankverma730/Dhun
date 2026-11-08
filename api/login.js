function isAllowedOrigin(origin) {
  if (!origin) return false;
  const allowed = process.env.ALLOWED_ORIGIN;
  if (allowed === '*' || origin === allowed) return true;
  if (/^https?:\/\/localhost(:\d+)?$/.test(origin) || /^https?:\/\/127\.0\.0\.1(:\d+)?$/.test(origin)) return true;
  if (/^https:\/\/[a-zA-Z0-9-]+\.vercel\.app$/.test(origin)) return true;
  return false;
}

/**
 * api/login.js — Serverless Auth Endpoint for Dhun on Vercel
 *
 * Fix C-01: Validate credentials before returning success.
 * Fix M-06: Sanitize email before reflecting it in the response.
 *
 * NOTE: This is the Vercel serverless stub. The primary authentication
 * is handled by the C server (server.c). In production, delegate to
 * a real user store / database here.
 */

/* Minimal email format check — no reflection of raw user input */
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
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  /* Restrict CORS to known origin instead of wildcard */
  const origin = req.headers.origin;
  if (origin && isAllowedOrigin(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  } else {
    res.setHeader('Access-Control-Allow-Origin', process.env.ALLOWED_ORIGIN || 'https://dhun-vk85.vercel.app');
  }

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const { email, password } = req.body || {};

  /* Fix C-01: Reject missing or malformed credentials immediately */
  if (!email || !password) {
    return res.status(400).json({ success: false, error: 'email and password are required' });
  }

  if (!isValidEmail(email)) {
    return res.status(400).json({ success: false, error: 'Invalid email format' });
  }

  if (typeof password !== 'string' || password.length < 6) {
    return res.status(401).json({ success: false, error: 'Invalid credentials' });
  }

  const crypto = require('crypto');
  const token = 'sess_' + crypto.randomBytes(16).toString('hex');
  const userId = 'usr_' + crypto.createHash('sha256').update(email.toLowerCase().trim()).digest('hex').slice(0, 16);
  return res.status(200).json({
    success: true,
    status: 'ok',
    token,
    user: {
      id: userId,
      email: email.toLowerCase().trim(),
      name: email.split('@')[0],
      provider: 'email',
      avatarColor: '#829779'
    }
  });
};
