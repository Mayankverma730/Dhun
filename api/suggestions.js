/**
 * api/suggestions.js — Serverless YouTube Query Suggestion Proxy
 * Fetches suggestions from Google server-side, eliminating browser CORS restrictions.
 */

function isAllowedOrigin(origin) {
  if (!origin) return false;
  const allowed = process.env.ALLOWED_ORIGIN;
  if (allowed === '*' || origin === allowed) return true;
  if (/^https?:\/\/localhost(:\d+)?$/.test(origin) || /^https?:\/\/127\.0\.0\.1(:\d+)?$/.test(origin)) return true;
  if (/^https:\/\/[a-zA-Z0-9-]+\.vercel\.app$/.test(origin)) return true;
  return false;
}

function setCORS(req, res) {
  const origin = req.headers.origin;
  if (origin && isAllowedOrigin(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  } else if (!origin) {
    res.setHeader('Access-Control-Allow-Origin', '*');
  } else {
    const defaultOrigin = process.env.ALLOWED_ORIGIN || 'https://dhun-vk85.vercel.app';
    res.setHeader('Access-Control-Allow-Origin', defaultOrigin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-user-id');
  res.setHeader('Content-Type', 'application/json');
}

module.exports = async (req, res) => {
  setCORS(req, res);

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const rawQuery = req.query.q || '';
  // Sanitize and limit query length with international Unicode support
  const query = String(rawQuery).replace(/[^\p{L}\p{M}\p{N}\s\-']/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);

  if (!query || query.length < 2) {
    return res.status(200).json([]);
  }

  try {
    const url = `https://suggestqueries.google.com/complete/search?client=firefox&ds=yt&q=${encodeURIComponent(query)}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    let response;
    try {
      response = await fetch(url, { signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) return res.status(200).json([]);
    const data = await response.json();
    const suggestions = Array.isArray(data[1]) ? data[1].slice(0, 7) : [];
    return res.status(200).json(suggestions);
  } catch (err) {
    return res.status(200).json([]);
  }
};
