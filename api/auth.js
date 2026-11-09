/**
 * api/auth.js — Consolidated Authentication Serverless Function for Dhun
 * Handles:
 * - /api/register
 * - /api/login
 * - /api/logout
 * - /api/forgot-password
 * - /api/reset-password
 * - /api/auth/google
 * - /api/auth/google/config
 *
 * Consolidates auth endpoints into 1 function so the project stays at 10 functions,
 * well within Vercel Hobby plan limit (12 standalone functions).
 */

const crypto = require('crypto');
const {
  loadStore,
  saveStore,
  hashPassword,
  verifyPasswordHash,
  setCORS,
  withStoreLock,
  consumeRateLimit,
  clearRateLimit
} = require('./_store');

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

/* ── 1. Register Handler ────────────────────────────────────────────── */
async function registerHandler(req, res) {
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
  if (!store.users) store.users = [];
  if (!store.sessions) store.sessions = {};

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
}

/* ── 2. Login Handler ───────────────────────────────────────────────── */
async function loginHandler(req, res) {
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
  if (!store.users) store.users = [];
  if (!store.sessions) store.sessions = {};

  const user = store.users.find(account => account && account.email === cleanEmail);
  if (!user || !user.salt || !user.passwordHash) {
    return res.status(401).json({ success: false, error: 'Invalid email or password' });
  }

  const candidates = Number.isSafeInteger(user.passwordIterations) ? [user.passwordIterations] : [100000, 10000];
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

  if (matchedIterations < 100000) {
    user.salt = crypto.randomBytes(16).toString('hex');
    user.passwordHash = hashPassword(password, user.salt);
  }
  user.passwordIterations = 100000;

  await clearRateLimit(`login:${throttleKey}`);

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
}

/* ── 3. Logout Handler ──────────────────────────────────────────────── */
async function logoutHandler(req, res) {
  setCORS(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' });

  const authorization = req.headers.authorization || req.headers.Authorization || '';
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
  if (token) {
    const store = await loadStore();
    if (store.sessions && store.sessions[token]) {
      delete store.sessions[token];
      await saveStore(store);
    }
  }
  return res.status(200).json({ success: true, message: 'Logged out successfully' });
}

/* ── 4. Forgot Password Handler ─────────────────────────────────────── */
async function forgotHandler(req, res) {
  setCORS(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' });

  const { email } = req.body || {};
  if (!email || typeof email !== 'string') {
    return res.status(400).json({ success: false, error: 'Email is required' });
  }

  const cleanEmail = email.trim().toLowerCase();
  const store = await loadStore();
  if (!store.resetTokens) store.resetTokens = {};

  const now = Date.now();
  for (const [k, v] of Object.entries(store.resetTokens)) {
    if (!v || v.expiresAt < now || v.used) delete store.resetTokens[k];
  }

  const user = (store.users || []).find(u => u.email === cleanEmail);
  if (user) {
    const rawToken = 'rst_' + crypto.randomBytes(24).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

    store.resetTokens[tokenHash] = {
      email: cleanEmail,
      rawToken: rawToken,
      expiresAt: now + 15 * 60 * 1000,
      used: false
    };

    const { RESEND_API_KEY, RESET_EMAIL_FROM, APP_URL } = process.env;
    if (RESEND_API_KEY && RESET_EMAIL_FROM && APP_URL) {
      try {
        const resetUrl = `${APP_URL}#reset-token=${rawToken}`;
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: RESET_EMAIL_FROM,
            to: [cleanEmail],
            subject: 'Reset your Dhun password',
            text: `Use this link to reset your password. It expires in 15 minutes:\n\n${resetUrl}`
          }),
          signal: AbortSignal.timeout(8000)
        });
      } catch (err) {
        console.warn('[Password reset] Email dispatch error:', err.message);
      }
    }

    await saveStore(store);
  }

  return res.status(200).json({
    success: true,
    message: 'If an account exists with this email address, password reset instructions have been dispatched.'
  });
}

/* ── 5. Reset Password Handler ──────────────────────────────────────── */
async function resetHandler(req, res) {
  setCORS(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' });

  const { token, newPassword } = req.body || {};
  if (!token || typeof token !== 'string') {
    return res.status(400).json({ success: false, error: 'Reset token is required' });
  }
  if (!newPassword || typeof newPassword !== 'string' || newPassword.length < 8) {
    return res.status(400).json({ success: false, error: 'New password must be at least 8 characters long' });
  }

  const tokenHash = crypto.createHash('sha256').update(token.trim()).digest('hex');
  const store = await loadStore();
  if (!store.resetTokens) store.resetTokens = {};

  const record = store.resetTokens[tokenHash];
  const now = Date.now();
  if (!record || record.used || record.expiresAt < now) {
    return res.status(400).json({ success: false, error: 'Invalid or expired password reset token' });
  }

  const user = (store.users || []).find(u => u.email === record.email);
  if (!user) {
    return res.status(404).json({ success: false, error: 'Account not found' });
  }

  const newSalt = crypto.randomBytes(16).toString('hex');
  user.salt = newSalt;
  user.passwordHash = hashPassword(newPassword, newSalt);
  user.passwordIterations = 100000;

  if (store.sessions) {
    for (const [sToken, session] of Object.entries(store.sessions)) {
      if (session.userId === user.id) delete store.sessions[sToken];
    }
  }

  record.used = true;
  await saveStore(store);

  return res.status(200).json({
    success: true,
    message: 'Password has been reset successfully. Please log in with your new password.'
  });
}

/* ── 6. Google OAuth Handlers ───────────────────────────────────────── */
async function googleConfigHandler(req, res) {
  setCORS(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  const clientId = process.env.GOOGLE_CLIENT_ID || '';
  return res.status(200).json({ clientId, configured: !!clientId });
}

async function googleHandler(req, res) {
  setCORS(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' });

  const { credential } = req.body || {};
  if (!credential || typeof credential !== 'string') {
    return res.status(400).json({ success: false, error: 'Missing Google credential' });
  }

  try {
    const parts = credential.split('.');
    if (parts.length !== 3) throw new Error('Malformed token');
    const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8'));
    if (!payload.sub || !payload.email) throw new Error('Missing sub or email in Google payload');

    const cleanEmail = payload.email.trim().toLowerCase();
    const displayName = payload.name || cleanEmail.split('@')[0];
    const store = await loadStore();
    if (!store.users) store.users = [];
    if (!store.sessions) store.sessions = {};

    let user = store.users.find(u => u.email === cleanEmail);
    if (!user) {
      user = {
        id: 'usr_g_' + payload.sub.slice(0, 12),
        email: cleanEmail,
        name: displayName,
        googleId: payload.sub,
        createdAt: Date.now()
      };
      store.users.push(user);
    }

    const sessionToken = 'sess_g_' + crypto.randomBytes(24).toString('hex');
    store.sessions[sessionToken] = {
      token: sessionToken,
      user: { id: user.id, email: cleanEmail, name: displayName, picture: payload.picture },
      expiresAt: Date.now() + (7 * 24 * 60 * 60 * 1000)
    };

    await saveStore(store);

    return res.status(200).json({
      success: true,
      token: sessionToken,
      user: store.sessions[sessionToken].user
    });
  } catch (err) {
    return res.status(401).json({ success: false, error: 'Google authentication failed: ' + err.message });
  }
}

/* ── Main Router Function ────────────────────────────────────────────── */
module.exports = async function authRouter(req, res) {
  setCORS(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  const url = req.url || '';
  const action = (req.query && req.query.action) ||
    (url.includes('google/config') ? 'google-config' :
    url.includes('google') ? 'google' :
    url.includes('register') ? 'register' :
    url.includes('logout') ? 'logout' :
    url.includes('forgot-password') ? 'forgot-password' :
    url.includes('reset-password') ? 'reset-password' :
    url.includes('login') ? 'login' : '');

  switch (action) {
    case 'register':
      return registerHandler(req, res);
    case 'login':
      return loginHandler(req, res);
    case 'logout':
      return logoutHandler(req, res);
    case 'forgot-password':
      return forgotHandler(req, res);
    case 'reset-password':
      return resetHandler(req, res);
    case 'google-config':
      return googleConfigHandler(req, res);
    case 'google':
      return googleHandler(req, res);
    default:
      return res.status(400).json({ success: false, error: 'Unknown auth action: ' + action });
  }
};

module.exports.register = registerHandler;
module.exports.login = loginHandler;
module.exports.logout = logoutHandler;
module.exports.forgot = forgotHandler;
module.exports.reset = resetHandler;
module.exports.google = googleHandler;
module.exports.googleConfig = googleConfigHandler;
