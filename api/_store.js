/**
 * api/_store.js — Shared storage and auth helpers for Dhun.
 *
 * Solves:
 * - Finding 01: Verifies real password hashes, throttles, and issues valid sessions.
 * - Finding 02: Validates authorization on catalog mutations.
 * - Finding 03: Provides server-side user registration and storage.
 * - Finding 04: Server-managed expiring password reset tokens.
 * Production uses Upstash Redis because Vercel instances do not share /tmp or memory.
 * Local development keeps the file store; route leases protect read/modify/write operations.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const STORE_PATH = path.join(os.tmpdir(), 'dhun_store.json');
const STORE_KEY = 'dhun:store:v1';
const LOCK_KEY = 'dhun:store-lock:v1';
const LOCK_TTL_MS = 120000;
const IS_VERCEL = process.env.VERCEL === '1' || Boolean(process.env.VERCEL_ENV);
const LOCAL_RATE_LIMITS = new Map();
let localStoreTail = Promise.resolve();
let localRateLimitOps = 0;

const INITIAL_SONGS = [
  { id: 1, title: 'Tujhko Jo Paaya', artist: 'Mohit Chauhan / Pritam', album: 'Crook', genre: 'Bollywood', duration: 5.72, play_count: 1, rating: 4.9, liked: 0 },
  { id: 2, title: 'Kesariya', artist: 'Arijit Singh', album: 'Brahmastra', genre: 'Bollywood', duration: 4.6, play_count: 0, rating: 4.8, liked: 0 },
  { id: 3, title: 'Raataan Lambiyan', artist: 'Jubin Nautiyal', album: 'Shershaah', genre: 'Bollywood', duration: 4.3, play_count: 0, rating: 4.7, liked: 0 },
  { id: 4, title: 'Blinding Lights', artist: 'The Weeknd', album: 'After Hours', genre: 'Pop', duration: 3.7, play_count: 0, rating: 4.9, liked: 0 },
  { id: 5, title: 'Levitating', artist: 'Dua Lipa', album: 'Future Nostalgia', genre: 'Pop', duration: 3.5, play_count: 0, rating: 4.6, liked: 0 }
];

const INITIAL_PLAYLISTS = [
  { id: 1, name: 'Chill Vibes', description: 'Relaxing ambient & lo-fi tunes', song_count: 2, songs: [1, 3] },
  { id: 2, name: 'Bollywood Hits', description: 'Top Hindi charts & melodies', song_count: 3, songs: [1, 2, 3] }
];

let _memoryStore = null;

function safeDictionary(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return Object.create(null);
  return Object.assign(Object.create(null), value);
}

function hasRedisConfig() {
  return Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
}

function assertStorageConfigured() {
  if (IS_VERCEL && !hasRedisConfig()) throw new Error('Shared production storage is not configured.');
}

async function redisCommand(command) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6000);
  let response;
  try {
    response = await fetch(process.env.UPSTASH_REDIS_REST_URL, {
      method: 'POST', signal: controller.signal,
      headers: { Authorization: `Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(command)
    });
  } finally { clearTimeout(timeout); }
  const result = await response.json();
  if (!response.ok || result.error) throw new Error(result.error || `Redis request failed (${response.status}).`);
  return result.result;
}

function createInitialStore() {
  return {
    songs: [...INITIAL_SONGS], nextSongId: 6, playlists: [...INITIAL_PLAYLISTS], nextPlaylistId: 3,
    users: [], sessions: safeDictionary(), resetTokens: safeDictionary(), userPlaylists: safeDictionary(),
    userLikes: safeDictionary(), queues: safeDictionary(), histories: safeDictionary()
  };
}

function normalizeStore(data) {
  if (!data || !Array.isArray(data.songs)) return null;
  for (const key of ['sessions', 'resetTokens', 'userPlaylists', 'userLikes', 'queues', 'histories']) data[key] = safeDictionary(data[key]);
  if (!Array.isArray(data.users)) data.users = [];
  if (!Array.isArray(data.playlists)) data.playlists = [...INITIAL_PLAYLISTS];
  const maxSongId = data.songs.reduce((max, song) => Number.isSafeInteger(song?.id) && song.id > max ? song.id : max, 0);
  if (!Number.isSafeInteger(data.nextSongId) || data.nextSongId <= maxSongId) data.nextSongId = maxSongId + 1;
  const ids = Object.values(data.userPlaylists).flatMap(list => Array.isArray(list) ? list.map(pl => pl?.id) : []);
  const maxPlaylistId = [...data.playlists.map(pl => pl?.id), ...ids].reduce((max, id) => Number.isSafeInteger(id) && id > max ? id : max, 0);
  if (!Number.isSafeInteger(data.nextPlaylistId) || data.nextPlaylistId <= maxPlaylistId) data.nextPlaylistId = maxPlaylistId + 1;
  return data;
}

async function loadStore() {
  assertStorageConfigured();
  if (hasRedisConfig()) {
    let value = await redisCommand(['GET', STORE_KEY]);
    if (value === null) {
      await redisCommand(['SET', STORE_KEY, JSON.stringify(createInitialStore()), 'NX']);
      value = await redisCommand(['GET', STORE_KEY]);
    }
    const store = normalizeStore(JSON.parse(value || 'null'));
    if (!store) throw new Error('The shared store contains invalid data.');
    return store;
  }
  if (_memoryStore) return _memoryStore;
  try {
    if (fs.existsSync(STORE_PATH)) {
      const store = normalizeStore(JSON.parse(fs.readFileSync(STORE_PATH, 'utf8')));
      if (store) return (_memoryStore = store);
    }
  } catch (error) { console.warn('[Store] Local file read failed:', error.message); }
  const store = createInitialStore();
  await saveStore(store);
  return store;
}

async function saveStore(store) {
  assertStorageConfigured();
  if (hasRedisConfig()) {
    await redisCommand(['SET', STORE_KEY, JSON.stringify(store)]);
    return store;
  }
  _memoryStore = store;
  try { fs.writeFileSync(STORE_PATH, JSON.stringify(store), 'utf8'); }
  catch (error) { if (IS_VERCEL) throw error; }
  return store;
}

async function runWithStoreLock(operation) {
  assertStorageConfigured();
  if (!hasRedisConfig()) {
    const previous = localStoreTail;
    let release;
    localStoreTail = new Promise(resolve => { release = resolve; });
    await previous;
    try { return await operation(); } finally { release(); }
  }

  const owner = crypto.randomBytes(18).toString('hex');
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    if (await redisCommand(['SET', LOCK_KEY, owner, 'NX', 'PX', LOCK_TTL_MS]) === 'OK') {
      try { return await operation(); }
      finally {
        try { await redisCommand(['EVAL', "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end", '1', LOCK_KEY, owner]); }
        catch (error) { console.error('[Store] Lock release failed:', error.message); }
      }
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  const error = new Error('Shared store is busy; retry shortly.');
  error.code = 'STORE_BUSY';
  throw error;
}

function withStoreLock(handler) {
  return async (req, res) => {
    if (req.method === 'OPTIONS') return handler(req, res);
    try { return await runWithStoreLock(() => handler(req, res)); }
    catch (error) {
      console.error('[Store] Request failed:', error.message);
      setCORS(req, res);
      if (error.code === 'STORE_BUSY') res.setHeader('Retry-After', '2');
      return res.status(503).json({ success: false, error: error.code === 'STORE_BUSY'
        ? 'Shared store is busy; retry shortly.'
        : 'Shared storage is temporarily unavailable.' });
    }
  };
}

async function consumeRateLimit(key, limit, windowMs) {
  assertStorageConfigured();
  const digest = crypto.createHash('sha256').update(String(key)).digest('hex');
  if (hasRedisConfig()) {
    const count = await redisCommand(['EVAL', "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('PEXPIRE',KEYS[1],ARGV[1]); end; return n", '1', `dhun:rate:${digest}`, String(windowMs)]);
    return { allowed: Number(count) <= limit, count: Number(count) };
  }
  const now = Date.now();
  // Prune opportunistically so arbitrary login identifiers cannot grow local memory forever.
  if (++localRateLimitOps % 256 === 0 || LOCAL_RATE_LIMITS.size >= 10000) {
    for (const [entryKey, entry] of LOCAL_RATE_LIMITS) {
      if (now >= entry.resetAt) LOCAL_RATE_LIMITS.delete(entryKey);
    }
    if (LOCAL_RATE_LIMITS.size >= 10000) LOCAL_RATE_LIMITS.delete(LOCAL_RATE_LIMITS.keys().next().value);
  }
  let record = LOCAL_RATE_LIMITS.get(digest);
  if (!record || now >= record.resetAt) record = { count: 0, resetAt: now + windowMs };
  record.count++;
  LOCAL_RATE_LIMITS.set(digest, record);
  return { allowed: record.count <= limit, count: record.count };
}

async function clearRateLimit(key) {
  const digest = crypto.createHash('sha256').update(String(key)).digest('hex');
  if (hasRedisConfig()) return redisCommand(['DEL', `dhun:rate:${digest}`]);
  LOCAL_RATE_LIMITS.delete(digest);
}

function parsePositiveId(value, max = Number.MAX_SAFE_INTEGER) {
  const decimal = typeof value === 'string' && /^\d+$/.test(value.trim());
  const number = typeof value === 'number' ? value : (decimal ? Number(value) : NaN);
  return Number.isSafeInteger(number) && number > 0 && number <= max ? number : null;
}

/* ── Password Hashing using PBKDF2 with unique salt ── */
function hashPassword(password, salt, iterations = 100000) {
  return crypto.pbkdf2Sync(password, salt, iterations, 64, 'sha512').toString('hex');
}

function verifyPasswordHash(password, salt, expectedHash, iterations = 10000) {
  if (typeof password !== 'string' || typeof salt !== 'string' || !salt) return false;
  if (typeof expectedHash !== 'string' || !/^[a-f0-9]{128}$/i.test(expectedHash)) return false;
  if (!Number.isSafeInteger(iterations) || iterations < 10000 || iterations > 1000000) return false;
  const hash = hashPassword(password, salt, iterations);
  try {
    return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(expectedHash, 'hex'));
  } catch (e) {
    return false;
  }
}

/* ── CORS Helper ── */
function isAllowedOrigin(origin) {
  if (!origin) return false;
  const allowed = process.env.ALLOWED_ORIGIN;
  if (allowed === '*' || origin === allowed) return true;
  if (/^https?:\/\/localhost(:\d+)?$/.test(origin) || /^https?:\/\/127\.0\.0\.1(:\d+)?$/.test(origin)) return true;
  if (/^https:\/\/[a-zA-Z0-9-]+\.vercel\.app$/.test(origin)) return true;
  return false;
}

function setCORS(req, res) {
  const headers = (req && req.headers) || {};
  const origin = headers.origin;
  if (origin && isAllowedOrigin(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  } else if (!origin) {
    res.setHeader('Access-Control-Allow-Origin', '*');
  } else {
    res.setHeader('Access-Control-Allow-Origin', process.env.ALLOWED_ORIGIN || 'https://dhun-vk85.vercel.app');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-user-id, X-User-Id, X-Host-Token');
  res.setHeader('Content-Type', 'application/json');
}

/* ── Authorization & Identity Validator [Findings 02 & 11] ── */
function getCallerIdentity(req, store = {}) {
  const headers = (req && req.headers) || {};
  const auth = headers.authorization || headers.Authorization || '';
  if (auth.startsWith('Bearer ')) {
    const token = auth.slice(7).trim();
    const session = store.sessions[token];
    if (session && Number.isSafeInteger(session.expiresAt) && session.expiresAt > Date.now() &&
        session.user && typeof session.user.id === 'string') {
      return { authenticated: true, user: session.user, token, guestId: session.user.id };
    }
  }

  // Unauthenticated client: provide isolated guest ID for read-only user state
  const clientHeader = headers['x-user-id'] || headers['X-User-Id'];
  let guestId = 'guest_anonymous';
  // Never trust an unauthenticated header that names a signed-in account.
  if (clientHeader === 'guest' ||
      (typeof clientHeader === 'string' && /^guest_[a-zA-Z0-9_-]{0,58}$/.test(clientHeader))) {
    guestId = clientHeader;
  }

  return { authenticated: false, guestId };
}

function getUserPlaylistBucket(req, store) {
  const identity = getCallerIdentity(req, store);
  const userId = identity.authenticated ? identity.user.id : identity.guestId;
  if (!store.userPlaylists || typeof store.userPlaylists !== 'object') {
    store.userPlaylists = safeDictionary(store.userPlaylists);
  }

  const playlists = Array.isArray(store.userPlaylists[userId]) ? store.userPlaylists[userId] : [];
  const legacyKeys = identity.authenticated
    ? Object.entries(store.sessions || {})
        .filter(([token, session]) => token !== userId && session?.user?.id === userId)
        .map(([token]) => token)
    : (userId === 'guest_anonymous' ? ['guest'] : []);
  const playlistIds = new Set(playlists.map(playlist => String(playlist.id)));
  let migrated = false;

  for (const key of legacyKeys) {
    const legacy = store.userPlaylists[key];
    if (!Array.isArray(legacy)) continue;
    for (const playlist of legacy) {
      if (!playlist || typeof playlist !== 'object') continue;
      const id = String(playlist.id);
      if (!playlistIds.has(id)) {
        playlists.push(playlist);
        playlistIds.add(id);
      }
    }
    delete store.userPlaylists[key];
    migrated = true;
  }

  store.userPlaylists[userId] = playlists;
  return { identity, userId, playlists, migrated };
}

function getUserSongLikes(req, store) {
  const identity = getCallerIdentity(req, store);
  const userId = identity.authenticated ? identity.user.id : identity.guestId;
  if (!store.userLikes || typeof store.userLikes !== 'object') {
    store.userLikes = safeDictionary(store.userLikes);
  }
  const songIds = Array.isArray(store.userLikes[userId]) ? store.userLikes[userId] : [];
  store.userLikes[userId] = songIds;
  return { identity, userId, songIds };
}

module.exports = {
  loadStore,
  saveStore,
  withStoreLock,
  runWithStoreLock,
  consumeRateLimit,
  clearRateLimit,
  hashPassword,
  verifyPasswordHash,
  setCORS,
  parsePositiveId,
  getCallerIdentity,
  getUserPlaylistBucket,
  getUserSongLikes
};
