/**
 * api/suggestions.js — Serverless YouTube Query Suggestion Proxy
 * Fetches suggestions from Google server-side, eliminating browser CORS restrictions.
 */

function setCORS(req, res) {
  const origin = req.headers.origin;
  const allowed = process.env.ALLOWED_ORIGIN || 'http://localhost:3000';
  if (origin && (origin === allowed || allowed === '*')) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  } else {
    res.setHeader('Access-Control-Allow-Origin', allowed);
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Content-Type', 'application/json');
}

module.exports = async (req, res) => {
  setCORS(req, res);

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const rawQuery = req.query.q || '';
  // Sanitize and limit query length
  const query = String(rawQuery).replace(/[^\w\s\u0900-\u097F\u0A00-\u0A7F\-']/g, ' ').trim().slice(0, 80);

  if (!query || query.length < 2) {
    return res.status(200).json([]);
  }

  try {
    const url = `https://suggestqueries.google.com/complete/search?client=firefox&ds=yt&q=${encodeURIComponent(query)}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);

    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);

    if (!response.ok) return res.status(200).json([]);
    const data = await response.json();
    const suggestions = Array.isArray(data[1]) ? data[1].slice(0, 7) : [];
    return res.status(200).json(suggestions);
  } catch (err) {
    return res.status(200).json([]);
  }
};
