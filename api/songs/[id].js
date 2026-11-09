/**
 * DHUN — /api/songs/[id]
 * GET    /api/songs/:id       → get one song
 * PUT    /api/songs/:id/play  → increment plays
 * PUT    /api/songs/:id/like  → toggle like
 * DELETE /api/songs/:id       → delete song (requires authorization)
 */

// Change note: play, like, and delete operations now use validated identities and atomic saves.
const { loadStore, saveStore, setCORS, getCallerIdentity, getUserSongLikes, parsePositiveId, withStoreLock } = require('../_store');

module.exports = withStoreLock(async (req, res) => {
  setCORS(req, res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { id, action } = req.query;
  const songId = parsePositiveId(id);
  if (songId === null) {
    return res.status(400).json({ error: 'Valid positive integer song ID required' });
  }

  const store = await loadStore();
  const songs = store.songs;
  const idx = songs.findIndex(s => s.id === songId);

  if (idx === -1) {
    return res.status(404).json({ error: 'Song not found' });
  }

  // GET /api/songs/:id
  if (req.method === 'GET') {
    const { songIds } = getUserSongLikes(req, store);
    const liked = songIds.some(id => String(id) === String(songId));
    return res.status(200).json({ ...songs[idx], liked: liked ? 1 : 0 });
  }

  // PUT /api/songs/:id/play — increment play count (Finding 02: Authorization check)
  if (req.method === 'PUT' && action === 'play') {
    const identity = getCallerIdentity(req, store);
    if (!identity.authenticated) {
      return res.status(401).json({ error: 'Unauthorized: Sign in required to record play' });
    }
    const currentPlayCount = Number(songs[idx].play_count);
    songs[idx].play_count = Math.min(
      (Number.isSafeInteger(currentPlayCount) && currentPlayCount >= 0 ? currentPlayCount : 0) + 1,
      100000000
    );
    const userId = identity.user.id;
    if (!store.histories || typeof store.histories !== 'object' || Array.isArray(store.histories)) {
      store.histories = Object.create(null);
    }
    if (!Array.isArray(store.histories[userId])) store.histories[userId] = [];
    store.histories[userId].push({ song_id: songId, playedAt: Date.now() });
    if (store.histories[userId].length > 50) store.histories[userId].shift();
    await saveStore(store);
    const { songIds } = getUserSongLikes(req, store);
    const liked = songIds.some(id => String(id) === String(songId));
    return res.status(200).json({ ...songs[idx], liked: liked ? 1 : 0 });
  }

  // PUT /api/songs/:id/like — toggle like (Finding 02: Authorization check)
  if (req.method === 'PUT' && action === 'like') {
    const identity = getCallerIdentity(req, store);
    if (!identity.authenticated) {
      return res.status(401).json({ error: 'Unauthorized: Sign in required to like songs' });
    }
    const { songIds } = getUserSongLikes(req, store);
    const likedIndex = songIds.findIndex(id => String(id) === String(songId));
    if (likedIndex === -1) songIds.push(songId);
    else songIds.splice(likedIndex, 1);
    await saveStore(store);
    return res.status(200).json({ ...songs[idx], liked: likedIndex === -1 ? 1 : 0 });
  }

  // DELETE /api/songs/:id (Finding 02: Authorization check)
  if (req.method === 'DELETE') {
    const identity = getCallerIdentity(req, store);
    if (!identity.authenticated) {
      return res.status(401).json({ error: 'Unauthorized: Sign in required to delete songs' });
    }

    const [removed] = songs.splice(idx, 1);
    for (const playlists of Object.values(store.userPlaylists || {})) {
      if (!Array.isArray(playlists)) continue;
      for (const playlist of playlists) {
        if (!Array.isArray(playlist?.songs)) continue;
        playlist.songs = playlist.songs.filter(id => String(id) !== String(songId));
        playlist.song_count = playlist.songs.length;
      }
    }
    for (const playlist of store.playlists || []) {
      if (!Array.isArray(playlist?.songs)) continue;
      playlist.songs = playlist.songs.filter(id => String(id) !== String(songId));
      playlist.song_count = playlist.songs.length;
    }
    for (const [userId, queue] of Object.entries(store.queues || {})) {
      if (Array.isArray(queue)) {
        store.queues[userId] = queue.filter(item => Number(item?.song_id) !== songId);
      }
    }
    for (const [userId, likes] of Object.entries(store.userLikes || {})) {
      if (Array.isArray(likes)) {
        store.userLikes[userId] = likes.filter(id => String(id) !== String(songId));
      }
    }
    await saveStore(store);
    return res.status(200).json(removed);
  }

  return res.status(405).json({ error: 'Method not allowed' });
});
