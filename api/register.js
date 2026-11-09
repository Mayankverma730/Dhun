/**
 * api/register.js — Server-side Account Registration Endpoint for Dhun
 * Fixes Finding 03: Moves account creation to a server-backed identity service.
 */

const crypto = require('crypto');
// Change note: registration is serialized so concurrent requests cannot create duplicate accounts.
const { loadStore, saveStore, hashPassword, setCORS, withStoreLock } = require('./_store');

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

  const { email, password, name } = req.body || {};

  if (!email || !password) {
    return res.status(400).json({ success: false, error: 'Email and password are required' });
  }

  const cleanEmail = String(email).trim().toLowerCase();
  if (!isValidEmail(cleanEmail)) {
    return res.status(400).json({ success: false, error: 'Invalid email address format' });
  }

  if (typeof password !== 'string' || password.length < 6 || password.length > 1024) {
    return res.status(400).json({ success: false, error: 'Password must be 6 to 1024 characters' });
  }

  const store = await loadStore();

  const existing = store.users.find(account => account && account.email === cleanEmail);
  if (existing) {
    return res.status(409).json({ success: false, error: 'An account with this email already exists' });
  }

  const salt = crypto.randomBytes(16).toString('hex');
  const passwordHash = hashPassword(password, salt);
  const userId = 'usr_' + crypto.randomBytes(8).toString('hex');
  const userName = (typeof name === 'string' && name.trim() ? name.trim() : cleanEmail.split('@')[0]).slice(0, 100);

  const newUser = {
    id: userId,
    email: cleanEmail,
    name: userName,
    salt,
    passwordHash,
    passwordIterations: 100000,
    provider: 'email',
    avatarColor: '#829779',
    createdAt: Date.now()
  };

  store.users.push(newUser);

  // Issue session token
  const token = 'sess_' + crypto.randomBytes(24).toString('hex');
  store.sessions[token] = {
    token,
    user: { id: newUser.id, email: newUser.email, name: newUser.name, provider: 'email', avatarColor: '#829779' },
    expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000 // 7 days
  };

  await saveStore(store);

  return res.status(201).json({
    success: true,
    status: 'ok',
    token,
    user: store.sessions[token].user
  });
});

