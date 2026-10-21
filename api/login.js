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
  const allowedOrigin = process.env.ALLOWED_ORIGIN || 'http://localhost:3000';
  res.setHeader('Access-Control-Allow-Origin', allowedOrigin);

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

  /*
   * TODO: Replace this block with a real credential check against your DB.
   * Example: look up the user by email, compare bcrypt hash, return 401 on mismatch.
   *
   * For now this endpoint returns 501 to make clear it is not yet implemented,
   * rather than silently accepting any credentials.
   */
  return res.status(501).json({
    success: false,
    error: 'Authentication via this serverless endpoint is not yet configured. ' +
           'Please use the primary C server at /api/login.'
  });
};
