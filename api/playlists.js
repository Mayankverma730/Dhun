/**
 * DHUN — /api/playlists
 * GET  /api/playlists        → list all playlists
 * POST /api/playlists        → create playlist
 */

if (!global._dhunPlaylists) {
  global._dhunPlaylists = [];
  global._dhunPlaylistNextId = 1;
}

function setCORS(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json');
}

module.exports = async (req, res) => {
  setCORS(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const playlists = global._dhunPlaylists;

  if (req.method === 'GET') {
    return res.status(200).json(playlists);
  }

  if (req.method === 'POST') {
    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch { return res.status(400).json({ error: 'Invalid JSON' }); }
    }
    if (!body || !body.name) return res.status(400).json({ error: 'name required' });

    const pl = {
      id: global._dhunPlaylistNextId++,
      name: String(body.name).substring(0, 200),
      songs: [],
      song_count: 0,
      createdAt: Date.now()
    };
    playlists.push(pl);
    return res.status(201).json(pl);
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
