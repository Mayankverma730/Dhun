/**
 * api/reset-password.js — Server-side Password Reset Finalization Endpoint
 * Fixes Finding 04: Validates one-time token, updates password hash, invalidates sessions.
 */

const crypto = require('crypto');
const { loadStore, saveStore, hashPassword, setCORS } = require('./_store');

module.exports = async (req, res) => {
  setCORS(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' });

  const { token, newPassword } = req.body || {};

  if (!token || !newPassword) {
    return res.status(400).json({ success: false, error: 'Reset token and new password are required' });
  }

  if (typeof newPassword !== 'string' || newPassword.length < 6) {
    return res.status(400).json({ success: false, error: 'Password must be at least 6 characters' });
  }

  const tokenHash = crypto.createHash('sha256').update(String(token).trim()).digest('hex');
  const store = loadStore();
  const resetRecord = store.resetTokens[tokenHash];

  if (!resetRecord) {
    return res.status(400).json({ success: false, error: 'Invalid or expired password reset token' });
  }

  if (resetRecord.used) {
    return res.status(400).json({ success: false, error: 'This password reset token has already been used' });
  }

  if (Date.now() > resetRecord.expiresAt) {
    return res.status(400).json({ success: false, error: 'This password reset token has expired' });
  }

  const user = store.users.find(u => u.email === resetRecord.email);
  if (!user) {
    return res.status(404).json({ success: false, error: 'User account not found' });
  }

  // Update password with fresh salt
  const salt = crypto.randomBytes(16).toString('hex');
  user.salt = salt;
  user.passwordHash = hashPassword(newPassword, salt);
  resetRecord.used = true;

  // Invalidate all prior sessions for this user for security
  for (const sToken in store.sessions) {
    if (store.sessions[sToken].user && store.sessions[sToken].user.email === user.email) {
      delete store.sessions[sToken];
    }
  }

  saveStore(store);

  return res.status(200).json({
    success: true,
    message: 'Password successfully updated. Please sign in with your new password.'
  });
};

