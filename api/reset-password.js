/**
 * api/reset-password.js — Server-side Password Reset Finalization Endpoint
 * Fixes Finding 04: Validates one-time token, updates password hash, invalidates sessions.
 */

const crypto = require('crypto');
// Change note: reset tokens are consumed once under the same lock as the password update.
const { loadStore, saveStore, hashPassword, setCORS, withStoreLock, consumeRateLimit } = require('./_store');

module.exports = withStoreLock(async (req, res) => {
  setCORS(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' });

  const { token } = req.body || {};
  const newPassword = req.body?.newPassword ?? req.body?.password;

  if (typeof token !== 'string' || !token || typeof newPassword !== 'string') {
    return res.status(400).json({ success: false, error: 'Reset token and new password are required' });
  }

  if (newPassword.length < 6 || newPassword.length > 1024) {
    return res.status(400).json({ success: false, error: 'Password must be 6 to 1024 characters' });
  }

  const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
  if (!(await consumeRateLimit(`reset:${ip}`, 10, 10 * 60 * 1000)).allowed) {
    return res.status(429).json({ success: false, error: 'Too many reset attempts. Please try again later.' });
  }

  const tokenHash = crypto.createHash('sha256').update(token.trim()).digest('hex');
  const store = await loadStore();
  const resetRecord = store.resetTokens[tokenHash];

  if (!resetRecord || resetRecord.used || !Number.isSafeInteger(resetRecord.expiresAt) || Date.now() > resetRecord.expiresAt) {
    return res.status(400).json({ success: false, error: 'Invalid or expired password reset token' });
  }

  const user = store.users.find(account => account && account.email === resetRecord.email);
  if (!user) {
    return res.status(404).json({ success: false, error: 'User account not found' });
  }

  // Update password with fresh salt
  const salt = crypto.randomBytes(16).toString('hex');
  user.salt = salt;
  user.passwordHash = hashPassword(newPassword, salt);
  user.passwordIterations = 100000;
  delete store.resetTokens[tokenHash]; // A consumed token should no longer remain in persistent storage.

  // Invalidate all prior sessions for this user for security
  for (const sToken in store.sessions) {
    if (store.sessions[sToken]?.user?.email === user.email) {
      delete store.sessions[sToken];
    }
  }

  await saveStore(store);

  return res.status(200).json({
    success: true,
    message: 'Password successfully updated. Please sign in with your new password.',
    // The token holder can sync the browser's local account copy after server validation.
    email: user.email
  });
});

