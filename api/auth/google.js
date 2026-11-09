/**
 * api/auth/google.js — Secure Google OAuth 2.0 Serverless Authentication Handler
 *
 * Implements server-side Google token verification and client config delivery.
 * Google Client Secret is strictly kept on the server and never exposed to the client.
 */

const crypto = require('crypto');
const { loadStore, saveStore } = require('../_store');

function loadEnv() {
  if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) return;
  try {
    if (typeof process.loadEnvFile === 'function') {
      process.loadEnvFile();
      return;
    }
  } catch (e) {}
  try {
    const fs = require('fs');
    const path = require('path');
    const envPath = path.resolve(process.cwd(), '.env');
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, 'utf8');
      content.split(/\r?\n/).forEach(line => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) return;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx > 0) {
          const key = trimmed.slice(0, eqIdx).trim();
          let val = trimmed.slice(eqIdx + 1).trim();
          if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
            val = val.slice(1, -1);
          }
          if (!process.env[key]) process.env[key] = val;
        }
      });
    }
  } catch (e) {}
}

loadEnv();

function isAllowedOrigin(origin) {
  if (!origin) return false;
  const allowed = process.env.ALLOWED_ORIGIN;
  if (allowed === '*' || origin === allowed) return true;
  if (/^https?:\/\/localhost(:\d+)?$/.test(origin) || /^https?:\/\/127\.0\.0\.1(:\d+)?$/.test(origin)) return true;
  if (/^https:\/\/[a-zA-Z0-9-]+\.vercel\.app$/.test(origin)) return true;
  if (/^https:\/\/[a-zA-Z0-9-]+\.github\.io$/.test(origin)) return true;
  return false;
}

module.exports = async (req, res) => {
  const origin = req.headers.origin;
  if (origin && isAllowedOrigin(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  } else {
    res.setHeader('Access-Control-Allow-Origin', process.env.ALLOWED_ORIGIN || '*');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Vary', 'Origin');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  // GET: Public Google OAuth Client ID for frontend initialization (Secret NEVER returned)
  if (req.method === 'GET') {
    const clientId = process.env.GOOGLE_CLIENT_ID || '193302703008-0ph67s6q60gt2tp72j704981fon32qm0.apps.googleusercontent.com';
    return res.status(200).json({
      success: true,
      configured: Boolean(clientId),
      clientId: clientId
    });
  }

  // POST: Verify Google token / credentials server-side
  if (req.method === 'POST') {
    const body = req.body || {};
    const { credential, code, redirectUri } = body;

    const configuredClientId = process.env.GOOGLE_CLIENT_ID || '193302703008-0ph67s6q60gt2tp72j704981fon32qm0.apps.googleusercontent.com';
    const configuredClientSecret = process.env.GOOGLE_CLIENT_SECRET;

    // 1. Google Identity Services ID Token (JWT) verification
    if (credential) {
      try {
        const verifyUrl = `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`;
        const gRes = await fetch(verifyUrl);
        if (!gRes.ok) {
          const errText = await gRes.text().catch(() => '');
          return res.status(401).json({ success: false, error: 'Invalid Google ID token', details: errText });
        }
        const info = await gRes.json();

        // Verify audience matches our Client ID if configured
        if (configuredClientId && info.aud !== configuredClientId && info.azp !== configuredClientId) {
          return res.status(401).json({ success: false, error: 'Google token audience mismatch' });
        }

        // Finding 13: Strictly enforce email_verified check
        if (info.email_verified !== true && info.email_verified !== 'true') {
          return res.status(401).json({ success: false, error: 'Google email is not verified' });
        }

        const email = (info.email || '').toLowerCase().trim();
        if (!email) {
          return res.status(400).json({ success: false, error: 'No email returned in Google token' });
        }

        const sessionToken = 'sess_' + crypto.randomBytes(16).toString('hex');
        const userId = 'usr_g_' + crypto.createHash('sha256').update(info.sub || email).digest('hex').slice(0, 16);

        // Finding 13: Register user and session in persistent store so protected APIs accept the token
        const store = loadStore();
        if (!store.sessions) store.sessions = {};
        if (!store.users) store.users = [];

        let user = store.users.find(u => u.email === email);
        if (!user) {
          user = {
            id: userId,
            email: email,
            name: info.name || email.split('@')[0],
            avatar: info.picture || '',
            provider: 'google',
            googleSub: info.sub,
            avatarColor: '#4285F4',
            createdAt: Date.now()
          };
          store.users.push(user);
        } else {
          user.googleSub = info.sub;
          user.provider = 'google';
        }

        store.sessions[sessionToken] = {
          user: { id: user.id, email: user.email, name: user.name },
          createdAt: Date.now(),
          expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000 // 7 days
        };
        saveStore(store);

        return res.status(200).json({
          success: true,
          status: 'ok',
          token: sessionToken,
          user: {
            id: userId,
            email: email,
            name: user.name,
            avatar: info.picture || '',
            provider: 'google',
            googleSub: info.sub,
            avatarColor: '#4285F4'
          }
        });
      } catch (err) {
        return res.status(500).json({ success: false, error: 'Failed to verify Google credential', message: err.message });
      }
    }

    // 2. Authorization Code exchange (if using server-side auth code flow)
    if (code) {
      if (!configuredClientId || !configuredClientSecret) {
        return res.status(500).json({ success: false, error: 'Server missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET' });
      }
      try {
        const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            code: code,
            client_id: configuredClientId,
            client_secret: configuredClientSecret,
            redirect_uri: redirectUri || 'postmessage',
            grant_type: 'authorization_code'
          }).toString()
        });

        if (!tokenRes.ok) {
          const errData = await tokenRes.json().catch(() => ({}));
          return res.status(401).json({ success: false, error: 'Google token exchange failed', details: errData });
        }

        const tokens = await tokenRes.json();
        const userinfoRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
          headers: { Authorization: `Bearer ${tokens.access_token}` }
        });

        if (!userinfoRes.ok) {
          return res.status(401).json({ success: false, error: 'Failed to fetch user info from Google' });
        }

        const profile = await userinfoRes.json();
        if (profile.email_verified !== true && profile.email_verified !== 'true') {
          return res.status(401).json({ success: false, error: 'Google email is not verified' });
        }
        const email = (profile.email || '').toLowerCase().trim();
        const sessionToken = 'sess_' + crypto.randomBytes(16).toString('hex');
        const userId = 'usr_g_' + crypto.createHash('sha256').update(profile.sub || email).digest('hex').slice(0, 16);

        const store = loadStore();
        if (!store.sessions) store.sessions = {};
        if (!store.users) store.users = [];

        let user = store.users.find(u => u.email === email);
        if (!user) {
          user = {
            id: userId,
            email: email,
            name: profile.name || email.split('@')[0],
            avatar: profile.picture || '',
            provider: 'google',
            googleSub: profile.sub,
            avatarColor: '#4285F4',
            createdAt: Date.now()
          };
          store.users.push(user);
        } else {
          user.googleSub = profile.sub;
          user.provider = 'google';
        }

        store.sessions[sessionToken] = {
          user: { id: user.id, email: user.email, name: user.name },
          createdAt: Date.now(),
          expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000 // 7 days
        };
        saveStore(store);

        return res.status(200).json({
          success: true,
          status: 'ok',
          token: sessionToken,
          user: {
            id: userId,
            email: email,
            name: user.name,
            avatar: profile.picture || '',
            provider: 'google',
            googleSub: profile.sub,
            avatarColor: '#4285F4'
          }
        });
      } catch (err) {
        return res.status(500).json({ success: false, error: 'OAuth code exchange exception', message: err.message });
      }
    }

    return res.status(400).json({ success: false, error: 'Missing credential or code in request body' });
  }

  return res.status(405).json({ success: false, error: 'Method not allowed' });
};

