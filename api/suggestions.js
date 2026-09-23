/**
 * api/suggestions.js — Serverless YouTube Query Suggestion Proxy
 * Fetches suggestions from Google server-side, eliminating browser CORS restrictions.
 */

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const query = req.query.q || '';
  if (!query || query.trim().length < 2) {
    return res.status(200).json([]);
  }

  try {
    const url = `https://suggestqueries.google.com/complete/search?client=firefox&ds=yt&q=${encodeURIComponent(query.trim())}`;
    const response = await fetch(url);
    if (!response.ok) return res.status(200).json([]);
    const data = await response.json();
    const suggestions = Array.isArray(data[1]) ? data[1].slice(0, 7) : [];
    return res.status(200).json(suggestions);
  } catch (err) {
    return res.status(200).json([]);
  }
};
