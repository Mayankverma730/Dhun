/**
 * DHUN — /api/playlists/[id]
 * Shared persistent user playlist operations
 * GET    /api/playlists/:id/songs  → get songs in playlist
 * POST   /api/playlists/:id/songs  → add song to playlist
 * DELETE /api/playlists/:id        → delete playlist
 * DELETE /api/playlists/:id/songs  → remove song from playlist
 */

const { loadStore, saveStore, setCORS, getUserPlaylistBucket, parsePositiveId } = require('../_store');

module.exports = async (req, res) => {
  setCORS(req, res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { id } = req.query;
  const plId = parsePositiveId(id);
  if (plId === null) {
    return res.status(400).json({ error: 'Valid positive integer playlist ID required' });
  }

  const store = loadStore();
  if (!store.userPlaylists) store.userPlaylists = {};

  const { playlists } = getUserPlaylistBucket(req, store);
  const idx = playlists.findIndex(p => p.id === plId);

  if (idx === -1) {
    return res.status(404).json({ error: 'Playlist not found' });
  }

  const playlist = playlists[idx];

  // GET /api/playlists/:id
  if (req.method === 'GET') {
    if (req.query.action === 'listSongs') {
      // The rewrite marks the /songs suffix; resolve stored IDs to records the client can play.
      const catalog = new Map((store.songs || []).map(song => [String(song.id), song]));
      const songs = Array.isArray(playlist.songs) ? playlist.songs : [];
      return res.status(200).json(songs.map(song =>
        song && typeof song === 'object' ? song : catalog.get(String(song))
      ).filter(Boolean));
    }
    return res.status(200).json(playlist);
  }

  // POST /api/playlists/:id/songs
  if (req.method === 'POST') {
    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch { return res.status(400).json({ error: 'Invalid JSON' }); }
    }
    let songId = body && (body.song_id ?? body.songId);
    if (typeof songId === 'string') songId = songId.trim();
    const validSongId = (typeof songId === 'number' && Number.isSafeInteger(songId) && songId > 0) ||
      (typeof songId === 'string' && songId.length > 0 && songId.length <= 128 &&
        (!/^\d+$/.test(songId) || (Number.isSafeInteger(Number(songId)) && Number(songId) > 0)));
    if (!validSongId) {
      return res.status(400).json({ error: 'song_id required' });
    }

    if (!Array.isArray(playlist.songs)) playlist.songs = [];
    if (!playlist.songs.some(id => String(id) === String(songId))) {
      playlist.songs.push(songId);
      playlist.song_count = playlist.songs.length;
    }
    saveStore(store);
    return res.status(200).json(playlist);
  }

  // DELETE /api/playlists/:id
  if (req.method === 'DELETE' && !req.query.action) {
    const [removed] = playlists.splice(idx, 1);
    saveStore(store);
    return res.status(200).json(removed);
  }

  // DELETE /api/playlists/:id/songs?sid=...
  if (req.method === 'DELETE' && req.query.action === 'removeSong') {
    const sid = req.query.sid;
    if (!sid) {
      return res.status(400).json({ error: 'sid required to remove song' });
    }
    const songs = Array.isArray(playlist.songs) ? playlist.songs : [];
    playlist.songs = songs.filter(s => String(s) !== String(sid));
    playlist.song_count = playlist.songs.length;
    saveStore(store);
    return res.status(200).json(playlist);
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
