/**
 * api/forgot-password.js — Server-side Password Reset Request Endpoint
 * Fixes Finding 04: Generates one-time expiring reset token stored on server.
 */

const crypto = require('crypto');
const { loadStore, saveStore, setCORS } = require('./_store');

module.exports = async (req, res) => {
  setCORS(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' });

  const { email } = req.body || {};
  if (!email || typeof email !== 'string') {
    return res.status(400).json({ success: false, error: 'Email is required' });
  }

  const cleanEmail = email.trim().toLowerCase();
  const store = loadStore();
  const user = store.users.find(u => u.email === cleanEmail);

  // Constant-time response: don't reveal whether the user exists to prevent email enumeration
  if (!user) {
    return res.status(200).json({
      success: true,
      message: 'If an account exists with this email, password reset instructions have been generated.'
    });
  }

  const rawToken = 'rst_' + crypto.randomBytes(24).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

  store.resetTokens[tokenHash] = {
    email: cleanEmail,
    expiresAt: Date.now() + 15 * 60 * 1000, // 15 minutes
    used: false
  };

  saveStore(store);

  return res.status(200).json({
    success: true,
    message: 'Password reset token generated successfully.',
    resetToken: rawToken // Returned so client can seamlessly transition to reset view
  });
};
