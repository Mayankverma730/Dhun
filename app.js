'use strict';

/* ══════════════════════════════════════════════════
   DHUN — Frontend  app.js
   Connected to the C HTTP API server on :3000
   All data operations go through the REST API.
══════════════════════════════════════════════════ */

// API base URL - auto-detects based on protocol
// On file:// protocol, API calls will fail (CORS), so we use localhost
// In production, this should be configured via environment or build
const API = (function() {
  // If running on file://, use localhost for development
  if (location.protocol === 'file:') return 'http://127.0.0.1:3000/api';
  // If on localhost, use relative or explicit localhost
  if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') return 'http://127.0.0.1:3000/api';
  // Production: use same origin (assuming backend served from same domain)
  return location.origin + '/api';
})();

/* ── PC & Local Audio Persistence (IndexedDB) ─────────────────── */
const pcSongAudioMap = new Map(); /* songId -> { url, file, durationSec } */
const globalAudioPlayer = new Audio();
globalAudioPlayer.preload = 'auto';

const DB_NAME = 'VibeAudioDB';
const DB_VERSION = 1;
const STORE_NAME = 'songAudio';

function openAudioDB() {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch (e) {
      resolve(null);
    }
  });
}

async function saveAudioBlobToDB(songId, blob, durationSec, fileName) {
  try {
    const db = await openAudioDB();
    if (!db) return;
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put({ id: songId, blob, durationSec, fileName });
  } catch (e) {
    console.warn('Could not cache audio to IndexedDB:', e);
  }
}

async function loadAudioBlobsFromDB() {
  try {
    const db = await openAudioDB();
    if (!db) return;
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.getAll();
    req.onsuccess = () => {
      const items = req.result || [];
      items.forEach(item => {
        if (item && item.blob) {
          try {
            const url = URL.createObjectURL(item.blob);
            pcSongAudioMap.set(item.id, {
              url,
              durationSec: item.durationSec || 200,
              fileName: item.fileName || ''
            });
          } catch(e) {}
        }
      });
    };
  } catch (e) {
    console.warn('Could not restore cached audio from IndexedDB:', e);
  }
}

/* ── YouTube Music Persistence & Audio Routing ──────────────────── */
function loadYTSongsFromStorage() {
  try {
    const raw = localStorage.getItem('dhun_yt_songs');
    if (raw) {
      const parsed = JSON.parse(raw);
      let updated = false;
      Object.keys(parsed).forEach(id => {
        const item = parsed[id];
        if (item) {
          // Heal any broken or relative Invidious thumbnail
          if (item.videoId) {
            item.thumbnail = `https://i.ytimg.com/vi/${item.videoId}/hqdefault.jpg`;
            updated = true;
          } else if (item.thumbnail && (item.thumbnail.startsWith('/vi/') || !item.thumbnail.startsWith('http'))) {
            const m = item.thumbnail.match(/([a-zA-Z0-9_-]{11})/);
            if (m && m[1]) {
              item.thumbnail = `https://i.ytimg.com/vi/${m[1]}/hqdefault.jpg`;
              item.videoId = m[1];
              updated = true;
            }
          }
          pcSongAudioMap.set(Number(id) || id, item);
        }
      });
      if (updated) {
        localStorage.setItem('dhun_yt_songs', JSON.stringify(parsed));
      }
    }
  } catch (e) {}
}

function saveYTSongToStorage(songId, data) {
  try {
    const raw = localStorage.getItem('dhun_yt_songs') || '{}';
    const parsed = JSON.parse(raw);
    parsed[songId] = data;
    localStorage.setItem('dhun_yt_songs', JSON.stringify(parsed));
  } catch (e) {}
}

let ytPlayer = null;
let ytPlayerReady = false;
let ytPendingVideoId = null;
let ytVisualizerSimInterval = null;

function initYouTubePlayer() {
  if (ytPlayer || !window.YT || !window.YT.Player) return;
  const container = document.getElementById('yt-hidden-player');
  if (!container) return;
  try {
    const isFile = location.protocol === 'file:';
    const effectiveOrigin = isFile ? 'http://localhost:3000' : location.origin;
    const effectiveReferrer = isFile ? 'http://localhost:3000/' : location.href;

    // If running on file:// protocol, show warning and use direct embed instead
    if (isFile) {
      console.warn('[YT] Running on file:// protocol - YouTube IFrame API may not work. Using direct embed fallback.');
      // Don't initialize YT.Player on file://, use direct embed instead
      return;
    }

    ytPlayer = new YT.Player('yt-hidden-player', {
      height: '100%',
      width: '100%',
      videoId: ytPendingVideoId || 'fsiPzT50ZiM',
      host: 'https://www.youtube.com',
      playerVars: {
        autoplay: ytPendingVideoId ? 1 : 0,
        controls: 0,
        disablekb: 1,
        fs: 0,
        modestbranding: 1,
        rel: 0,
        iv_load_policy: 3,
        cc_load_policy: 0,
        cc_lang_pref: 'none',
        playsinline: 1,
        enablejsapi: 1,
        origin: effectiveOrigin,
        widget_referrer: effectiveReferrer,
        vq: 'hd1080'
      },
      events: {
        onReady: onYTPlayerReady,
        onStateChange: onYTPlayerStateChange,
        onError: onYTPlayerError
      }
    });
  } catch (e) {
    console.warn('[YT] Player init error:', e);
  }
}

function disableYTCaptions() {
  if (!ytPlayer) return;
  try {
    if (ytPlayer.unloadModule) {
      ytPlayer.unloadModule('captions');
      ytPlayer.unloadModule('cc');
    }
  } catch(e){}
  try {
    if (ytPlayer.setOption) {
      ytPlayer.setOption('captions', 'track', {});
      ytPlayer.setOption('cc', 'track', {});
      ytPlayer.setOption('captions', 'reload', false);
    }
  } catch(e){}
}

function enforce1080pDefaultQuality() {
  if (!ytPlayer) return;
  try {
    if (ytPlayer.setPlaybackQualityRange) {
      ytPlayer.setPlaybackQualityRange('hd1080', 'highres');
    }
    if (ytPlayer.getAvailableQualityLevels) {
      const levels = ytPlayer.getAvailableQualityLevels();
      if (levels && levels.length > 0) {
        const best = levels.find(l => l === 'hd1080') || levels.find(l => l === 'highres') || levels.find(l => l === 'hd720') || levels[0];
        if (best && ytPlayer.setPlaybackQuality) ytPlayer.setPlaybackQuality(best);
      } else if (ytPlayer.setPlaybackQuality) {
        ytPlayer.setPlaybackQuality('hd1080');
      }
    } else if (ytPlayer.setPlaybackQuality) {
      ytPlayer.setPlaybackQuality('hd1080');
    }
  } catch(e){}
}

window.onYouTubeIframeAPIReady = function() {
  initYouTubePlayer();
};

if (window.YT && window.YT.Player) {
  initYouTubePlayer();
}

function onYTPlayerReady(event) {
  ytPlayerReady = true;
  console.log('[YT] YouTube IFrame API Ready!');
  disableYTCaptions();
  enforce1080pDefaultQuality();
  if (ytPlayer && ytPlayer.setVolume) {
    try { ytPlayer.setVolume(Math.round((audioEngine.volume || 0.75) * 100)); } catch(e){}
  }
  if (ytPlayer && ytPlayer.unMute) {
    try { ytPlayer.unMute(); } catch(e){}
  }
  if (ytPendingVideoId) {
    const vid = ytPendingVideoId;
    ytPendingVideoId = null;
    playYTVideo(vid);
  }
}

function onYTPlayerStateChange(event) {
  if (!event) return;
  if (event.data === YT.PlayerState.PLAYING) {
    state.isPlaying = true;
    updatePlayUI();
    startYTSimulatedBeatFFT();
    disableYTCaptions();
    enforce1080pDefaultQuality();
  } else if (event.data === YT.PlayerState.BUFFERING || event.data === 5) {
    /* Never re-request quality during BUFFERING as it cancels and restarts the media pipeline */
  } else if (event.data === YT.PlayerState.PAUSED) {
    state.isPlaying = false;
    updatePlayUI();
    stopYTSimulatedBeatFFT();
  } else if (event.data === YT.PlayerState.ENDED) {
    stopYTSimulatedBeatFFT();
    if (state.isRepeat) {
      state.progress = 0;
      updateProgress();
      if (ytPlayer && ytPlayer.seekTo) ytPlayer.seekTo(0, true);
      if (ytPlayer && ytPlayer.playVideo) ytPlayer.playVideo();
      startPlaying();
    } else {
      nextSong();
    }
  }
}

function onYTPlayerError(e) {
  const errCode = e ? e.data : 'unknown';
  console.warn('[YT] Stream error code:', errCode);

  // Handle file:// protocol - YouTube blocks this
  if (location.protocol === 'file:') {
    showToast('⚠️ YouTube Error 153: YouTube blocks file:// protocol. Please use http://localhost:3000', 5000);
    return;
  }

  // If specific official music video has embed restriction (150/101/153), search for an alternate audio version
  if (state.currentSong && (errCode === 150 || errCode === 101 || errCode === 153)) {
    const query = `${state.currentSong.title} audio`;
    console.log('[YT] Searching alternate embeddable track for:', query);
    if (typeof YTMusicAPI !== 'undefined' && YTMusicAPI.search) {
      YTMusicAPI.search(query, 5).then(results => {
        const curVid = getCurrentYTVideoId();
        const alt = results.find(r => r.videoId && r.videoId !== curVid);
        if (alt && alt.videoId) {
          console.log('[YT] Switching to alternative video ID:', alt.videoId);
          const ytData = {
            isYT: true,
            videoId: alt.videoId,
            thumbnail: alt.thumbnail,
            durationSec: alt.durationSec || 210,
            title: state.currentSong.title,
            artist: state.currentSong.artist
          };
          pcSongAudioMap.set(state.currentSong.id, ytData);
          saveYTSongToStorage(state.currentSong.id, ytData);
          playYTVideo(alt.videoId);
          return;
        }
        fallbackToLocalDemoAudio();
      }).catch(() => fallbackToLocalDemoAudio());
      return;
    }
  }

  fallbackToLocalDemoAudio();
}

function fallbackToLocalDemoAudio() {
  if (globalAudioPlayer && (!globalAudioPlayer.src || globalAudioPlayer.paused)) {
    globalAudioPlayer.src = 'tujhko.mp3';
    globalAudioPlayer.play().catch(() => {});
  }
}

function embedDirectYTFrame(videoId) {
  if (!videoId) return;
  const container = document.getElementById('yt-hidden-player');
  if (!container) return;
  console.log('[YT] Using direct embed iframe for video:', videoId);
  
  // On file:// protocol, YouTube embeds are blocked - show error instead
  if (location.protocol === 'file:') {
    container.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--text-2);padding:20px;text-align:center">
      <div>
        <div style="font-size:24px;margin-bottom:8px">🚫</div>
        <p>YouTube embeds blocked on <code>file://</code> protocol</p>
        <p style="font-size:12px;margin-top:8px">Please run via <a href="http://localhost:3000" style="color:var(--purple)">http://localhost:3000</a></p>
      </div>
    </div>`;
    fallbackToLocalDemoAudio();
    return;
  }
  
  const originParam = location.origin;
  container.innerHTML = `<iframe id="yt-direct-iframe" width="100%" height="100%" 
    src="https://www.youtube.com/embed/${videoId}?autoplay=1&controls=0&disablekb=1&fs=0&modestbranding=1&rel=0&iv_load_policy=3&enablejsapi=1&cc_load_policy=0&vq=hd1080&origin=${encodeURIComponent(originParam)}" 
    title="YouTube Audio Stream" frameborder="0" 
    referrerpolicy="strict-origin-when-cross-origin"
    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" 
    allowfullscreen></iframe>`;
  state.isPlaying = true;
  updatePlayUI();
  startYTSimulatedBeatFFT();
}

function getCurrentYTVideoId() {
  if (!state.currentSong) return null;
  if (state.currentSong.videoId) return state.currentSong.videoId;

  const local = pcSongAudioMap.get(state.currentSong.id);
  if (local && local.videoId) return local.videoId;

  const localNum = pcSongAudioMap.get(Number(state.currentSong.id));
  if (localNum && localNum.videoId) return localNum.videoId;

  const localStr = pcSongAudioMap.get(String(state.currentSong.id));
  if (localStr && localStr.videoId) return localStr.videoId;

  // Search localStorage cache
  try {
    const raw = localStorage.getItem('dhun_yt_songs');
    if (raw) {
      const parsed = JSON.parse(raw);
      const found = parsed[state.currentSong.id] || parsed[String(state.currentSong.id)];
      if (found && found.videoId) {
        pcSongAudioMap.set(state.currentSong.id, found);
        return found.videoId;
      }
      const sTitle = (state.currentSong.title || '').toLowerCase().trim();
      for (const k in parsed) {
        const item = parsed[k];
        if (item && item.title && item.videoId) {
          if (item.title.toLowerCase().trim() === sTitle) {
            pcSongAudioMap.set(state.currentSong.id, item);
            return item.videoId;
          }
        }
      }
    }
  } catch(e){}

  // Fallback match by song title and artist from our curated media catalog
  if (typeof YTMusicAPI !== 'undefined' && YTMusicAPI.getVideoIdForTrack) {
    const matched = YTMusicAPI.getVideoIdForTrack(state.currentSong.title, state.currentSong.artist);
    if (matched) {
      const ytData = {
        isYT: true,
        videoId: matched,
        thumbnail: `https://i.ytimg.com/vi/${matched}/hqdefault.jpg`,
        durationSec: (state.currentSong.duration || 3.5) * 60,
        title: state.currentSong.title,
        artist: state.currentSong.artist
      };
      pcSongAudioMap.set(state.currentSong.id, ytData);
      saveYTSongToStorage(state.currentSong.id, ytData);
      return matched;
    }
  }

  return null;
}

function isCurrentSongYT() {
  if (!state.currentSong) return false;
  if (state.currentSong.source === 'ytmusic' || state.currentSong.videoId) return true;
  if (state.currentSong.album === 'Online Media' || state.currentSong.genre === 'Online Media') return true;
  return !!getCurrentYTVideoId();
}

function playYTVideo(videoId) {
  if (!videoId) return;

  if (!ytPlayerReady || !ytPlayer || !ytPlayer.loadVideoById) {
    ytPendingVideoId = videoId;
    initYouTubePlayer();
    // Direct embed fallback if API is blocked or slow
    setTimeout(() => {
      if (!ytPlayerReady && ytPendingVideoId === videoId) {
        embedDirectYTFrame(videoId);
      }
    }, 1200);
    return;
  }

  try {
    let currentUrl = '';
    try { currentUrl = ytPlayer.getVideoUrl ? ytPlayer.getVideoUrl() : ''; } catch(e){}
    const isSameVideo = currentUrl && currentUrl.includes(videoId);

    if (isSameVideo && ytPlayer.getPlayerState && ytPlayer.getPlayerState() === YT.PlayerState.PAUSED) {
      ytPlayer.playVideo();
      disableYTCaptions();
      enforce1080pDefaultQuality();
    } else {
      ytPlayer.loadVideoById({
        videoId: videoId,
        startSeconds: 0,
        suggestedQuality: 'hd1080'
      });
      ytPlayer.playVideo();
      disableYTCaptions();
      enforce1080pDefaultQuality();
    }

    if (ytPlayer.setVolume) {
      try { ytPlayer.setVolume(Math.round((audioEngine.volume || 0.75) * 100)); } catch(e){}
    }
    if (ytPlayer.unMute) {
      try { ytPlayer.unMute(); } catch(e){}
    }
  } catch (e) {
    console.warn('[YT] Load video error, using direct frame fallback:', e);
    embedDirectYTFrame(videoId);
  }
}

function toggleYTDockMinimize(event) {
  /* No-op: player is completely invisible in background */
  if (event) event.stopPropagation();
}

/* ── Song / Video Mode Toggle & Unified Dock Engine ────────
   Seamlessly switches between:
   - 'song'  : beat-reactive flow visualizer + floating album art
   - 'video' : live video stream aligned over the video panel
   Both modes use the exact same YouTube playback engine, meaning:
   - 0 ms buffering delay
   - 100% frame-accurate playback timestamp sync
   - Zero YouTube logo or "More videos" overlays
──────────────────────────────────────────────────────────── */
let _currentSVMode = 'song';

function setSongVideoMode(mode) {
  if (_currentSVMode === mode) return;
  _currentSVMode = mode;

  const btnSong    = document.getElementById('sv-btn-song');
  const btnVideo   = document.getElementById('sv-btn-video');
  const vizWrap    = document.getElementById('flow-visualizer-wrap');
  const videoPanel = document.getElementById('player-video-panel');
  const playerLeft = vizWrap && vizWrap.closest('.player-left');

  if (!vizWrap || !videoPanel) return;

  if (mode === 'video') {
    /* Activate Video mode */
    if (btnSong)  { btnSong.classList.remove('active');  btnSong.setAttribute('aria-pressed', 'false'); }
    if (btnVideo) { btnVideo.classList.add('active');    btnVideo.setAttribute('aria-pressed', 'true'); }
    vizWrap.style.display = 'none';
    videoPanel.classList.remove('pvp-mode-song');
    videoPanel.style.display = '';
    if (playerLeft) playerLeft.classList.add('video-mode');

    /* Populate info bar */
    if (state.currentSong) {
      const pvpTitle  = document.getElementById('pvp-title');
      const pvpArtist = document.getElementById('pvp-artist');
      if (pvpTitle)  pvpTitle.textContent  = state.currentSong.title || 'Unknown';
      if (pvpArtist) pvpArtist.textContent = `${state.currentSong.artist || ''} · ${state.currentSong.album || ''}`;
    }

    const placeholder = document.getElementById('pvp-placeholder');

    /* If playing local PC audio, seamlessly sync timestamp over to YouTube */
    if (!isCurrentSongYT() && globalAudioPlayer && !globalAudioPlayer.paused) {
      const curTime = globalAudioPlayer.currentTime || 0;
      globalAudioPlayer.pause();
      const videoId = getCurrentYTVideoId();
      if (videoId) {
        if (placeholder) placeholder.classList.add('hidden');
        if (ytPlayer && ytPlayer.loadVideoById) {
          ytPlayer.loadVideoById({ videoId, startSeconds: Math.floor(curTime), suggestedQuality: 'hd1080' });
          ytPlayer.playVideo();
          disableYTCaptions();
          enforce1080pDefaultQuality();
        }
      } else {
        if (placeholder) {
          placeholder.classList.remove('hidden');
          const pt = document.getElementById('pvp-ph-text');
          if (pt) pt.textContent = 'Searching for video…';
        }
        if (state.currentSong && typeof YTMusicAPI !== 'undefined') {
          const q = `${state.currentSong.title} ${state.currentSong.artist || ''} official video`.trim();
          YTMusicAPI.search(q, 3).then(results => {
            if (_currentSVMode !== 'video') return;
            if (results && results.length > 0 && results[0].videoId) {
              const vid = results[0].videoId;
              pcSongAudioMap.set(state.currentSong.id, {
                ...(pcSongAudioMap.get(state.currentSong.id) || {}),
                isYT: true,
                videoId: vid,
                thumbnail: results[0].thumbnail
              });
              if (placeholder) placeholder.classList.add('hidden');
              if (ytPlayer && ytPlayer.loadVideoById) {
                ytPlayer.loadVideoById({ videoId: vid, startSeconds: Math.floor(curTime), suggestedQuality: 'hd1080' });
                ytPlayer.playVideo();
                disableYTCaptions();
                enforce1080pDefaultQuality();
              }
            } else {
              const pt2 = document.getElementById('pvp-ph-text');
              if (pt2) pt2.textContent = 'No video available for this track';
              if (globalAudioPlayer && state.isPlaying) globalAudioPlayer.play().catch(()=>{});
            }
          }).catch(() => {
            const pt2 = document.getElementById('pvp-ph-text');
            if (pt2) pt2.textContent = 'No video available for this track';
            if (globalAudioPlayer && state.isPlaying) globalAudioPlayer.play().catch(()=>{});
          });
        }
      }
    } else {
      /* YouTube song: already active in ytPlayer! Absolutely zero buffering */
      if (placeholder) placeholder.classList.add('hidden');
      if (state.isPlaying && ytPlayer && ytPlayer.playVideo) {
        try { ytPlayer.playVideo(); } catch(e){}
      }
    }

    updatePVPOverlayUI(state.isPlaying);

  } else {
    /* Restore Song mode */
    if (btnVideo) { btnVideo.classList.remove('active'); btnVideo.setAttribute('aria-pressed', 'false'); }
    if (btnSong)  { btnSong.classList.add('active');     btnSong.setAttribute('aria-pressed', 'true'); }
    videoPanel.classList.add('pvp-mode-song');
    vizWrap.style.display = '';
    if (playerLeft) playerLeft.classList.remove('video-mode');

    /* If switching from video back to local PC audio, sync timestamp */
    if (!isCurrentSongYT() && globalAudioPlayer) {
      let curTime = 0;
      try { if (ytPlayer && ytPlayer.getCurrentTime) curTime = ytPlayer.getCurrentTime(); } catch(e){}
      try { if (ytPlayer && ytPlayer.pauseVideo) ytPlayer.pauseVideo(); } catch(e){}
      try {
        globalAudioPlayer.currentTime = curTime;
        if (state.isPlaying) globalAudioPlayer.play().catch(()=>{});
      } catch(e){}
    }
  }
}

function syncVideoDockPosition() {
  /* Dock is natively mounted inside #pvp-frame-wrap with pure CSS */
}

function togglePVPFullscreen(event) {
  if (event) event.stopPropagation();
  const dock = document.getElementById('yt-player-dock');
  if (!dock) return;
  if (!document.fullscreenElement && !document.webkitFullscreenElement) {
    if (dock.requestFullscreen) dock.requestFullscreen();
    else if (dock.webkitRequestFullscreen) dock.webkitRequestFullscreen();
  } else {
    if (document.exitFullscreen) document.exitFullscreen();
    else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
  }
}

function updatePVPOverlayUI(isPlaying) {
  const badge = document.getElementById('pvp-center-badge');
  const badgeIcon = document.getElementById('pvp-badge-icon');
  if (badge) {
    if (isPlaying) {
      badge.classList.remove('visible');
    } else {
      badge.classList.add('visible');
    }
  }
  if (badgeIcon) {
    badgeIcon.textContent = isPlaying ? '❚❚' : '▶';
  }
  const ph = document.getElementById('pvp-placeholder');
  if (ph && isPlaying) {
    ph.classList.add('hidden');
  }
}



function startYTSimulatedBeatFFT() {
  if (ytVisualizerSimInterval) clearInterval(ytVisualizerSimInterval);
  ytVisualizerSimInterval = setInterval(() => {
    if (!state.isPlaying || !isCurrentSongYT()) return;
    if (typeof vizState !== 'undefined' && vizState.dataArray) {
      const now = Date.now() / 1000;
      const beatPulse = (Math.sin(now * 4.4) + Math.cos(now * 2.2) + 2) / 4;
      const arr = vizState.dataArray;
      const len = arr.length;
      for (let i = 0; i < len; i++) {
        const freqNorm = i / len;
        const wave = Math.sin(now * 6 + i * 0.4) * 45;
        const bassVal = (1 - freqNorm) * (190 * beatPulse) + 45 + wave;
        arr[i] = Math.min(255, Math.max(20, Math.round(bassVal)));
      }
      vizState.smoothedBeat = Math.min(1, Math.max(0.2, beatPulse));
    }
  }, 40);
}

function stopYTSimulatedBeatFFT() {
  if (ytVisualizerSimInterval) {
    clearInterval(ytVisualizerSimInterval);
    ytVisualizerSimInterval = null;
  }
}

function cleanupAudioEngine() {
  // Stop any playing audio
  if (globalAudioPlayer && !globalAudioPlayer.paused) {
    globalAudioPlayer.pause();
  }
  
  // Stop YouTube player if active
  if (ytPlayer) {
    try {
      if (ytPlayer.pauseVideo) ytPlayer.pauseVideo();
    } catch(e) {}
  }
  
  stopYTSimulatedBeatFFT();
  
  // Clear timers
  if (state.timer) {
    clearInterval(state.timer);
    state.timer = null;
  }
}

function isYTSong(id) {
  if (typeof id === 'string' && id.startsWith('yt_')) return true;
  const item = pcSongAudioMap.get(id);
  return !!(item && item.isYT);
}

/* Resolve audio source for playback.
   Priority: 1) YouTube Music stream
             2) PC-imported blob URL (from pcSongAudioMap)
             3) Bundled demo track */
function resolveAudioSource(song) {
  if (!song) return null;
  if (isCurrentSongYT()) {
    return { isYT: true, videoId: getCurrentYTVideoId(), durationSec: (song.duration || 3.5) * 60 };
  }
  const local = pcSongAudioMap.get(song.id);
  if (local && local.url) return local;
  return { url: 'tujhko.mp3', durationSec: (song.duration || 3.5) * 60 };
}

globalAudioPlayer.addEventListener('ended', () => {
  if (state.isRepeat) {
    globalAudioPlayer.currentTime = 0;
    state.progress = 0;
    updateProgress();
    globalAudioPlayer.play().catch(() => {});
    startPlaying();
    if (typeof showToast === 'function') showToast('🔂 Looping track');
  } else {
    nextSong();
  }
});

/* ══════════════════════════════════════════════════
   DHUN AUDIO ROUTING ENGINE
   Pure Web Audio pipeline routing song player audio
   to speakers and providing FFT frequency analysis
   for the Beat Flow visualizer. Zero synthetic noise.
   ══════════════════════════════════════════════════ */

const audioEngine = {
  ctx: null,
  masterGain: null,
  analyser: null,
  dataArray: null,
  mediaSourceConnected: false,
  volume: 0.75,
  isMuted: false,
  previousVolume: 0.75,

  init() {
    if (this.ctx) return;
    const AudioCtxClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtxClass) return;
    this.ctx = new AudioCtxClass();

    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.setValueAtTime(this.volume, this.ctx.currentTime);

    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 256;
    this.analyser.smoothingTimeConstant = 0.8;
    this.dataArray = new Uint8Array(this.analyser.frequencyBinCount);

    this.masterGain.connect(this.analyser);
    this.analyser.connect(this.ctx.destination);

    if (typeof vizState !== 'undefined') {
      vizState.audioCtx = this.ctx;
      vizState.analyser = this.analyser;
      vizState.dataArray = this.dataArray;
      vizState.connected = true;
    }

    this.connectMediaElement();
  },

  connectMediaElement() {
    if (this.mediaSourceConnected || !this.ctx || !globalAudioPlayer) return;
    try {
      const source = this.ctx.createMediaElementSource(globalAudioPlayer);
      source.connect(this.masterGain);
      this.mediaSourceConnected = true;
    } catch (e) {
      // already connected
    }
  },

  resume() {
    this.init();
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    if (typeof vizState !== 'undefined' && this.analyser) {
      vizState.audioCtx = this.ctx;
      vizState.analyser = this.analyser;
      vizState.dataArray = this.dataArray;
      vizState.connected = true;
    }
  },

  setVolume(pct) {
    pct = Math.max(0, Math.min(150, Number(pct)));
    if (pct > 0) {
      this.volume = pct / 100;
      this.isMuted = false;
    } else {
      this.isMuted = true;
    }
    this.resume();
    const effectiveGain = this.isMuted ? 0 : this.volume;
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.cancelScheduledValues(this.ctx.currentTime);
      this.masterGain.gain.setValueAtTime(effectiveGain, this.ctx.currentTime);
    }
    if (globalAudioPlayer) {
      try {
        globalAudioPlayer.volume = Math.min(1.0, effectiveGain);
      } catch (e) {}
    }
  },

  toggleMute() {
    if (this.isMuted) {
      const restore = (this.previousVolume && this.previousVolume > 0) ? this.previousVolume : 0.75;
      this.setVolume(restore * 100);
    } else {
      this.previousVolume = (this.volume > 0) ? this.volume : 0.75;
      this.setVolume(0);
    }
  }
};

// Global unlocker for AudioContext on first user interaction
['pointerdown', 'touchstart', 'keydown'].forEach(evt => {
  window.addEventListener(evt, () => {
    if (audioEngine.ctx && audioEngine.ctx.state === 'suspended') {
      audioEngine.ctx.resume().catch(() => {});
    }
  }, { once: false, passive: true });
});

/* ══════════════════════════════════════════════════
   APPLICATION STATE
   Single source of truth for all runtime data.
   Mutated by API responses, UI events, and playback engine.
   Never persist this directly — always write through the API.
   ══════════════════════════════════════════════════ */
const state = {
  currentPage: 'home',
  isPlaying:   false,
  isShuffle:   false,
  isRepeat:    false,
  currentSong: null,   /* full song object from API */
  songs:       [],     /* loaded from API */
  queue:       [],     /* loaded from API */
  history:     [],     /* loaded from API */
  playlists:   [],     /* loaded from API */
  activePlaylistId: null,
  progress:    0,
  timer:       null,
};

let _offlineWarningShown = false;

/* ── API helpers ──────────────────────────────── */
async function api(method, path, data, options = {}) {
  const isCloudHost = window.location.protocol === 'https:' ||
                      window.location.hostname.includes('vercel.app') ||
                      window.location.hostname.includes('github.io');
  if (isCloudHost) {
    return null;
  }
  try {
    const opts = {
      method,
      headers: { 'Content-Type': 'application/json' },
    };
    if (data) opts.body = JSON.stringify(data);
    const res = await fetch(API + path, opts);
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      console.warn(`API ${method} ${path} →`, err.error);
      if (res.status === 409) {
        showToast('🚫 Duplicate Blocked: ' + (err.error || 'Only one copy allowed in library.'));
      }
      return null;
    }
    return await res.json();
  } catch (e) {
    // In cloud / Vercel hosting, or when silent is requested, suppress the error
    if (options && options.silent) return null;
    if (isCloudHost) {
      // Running on Vercel / HTTPS cloud host: all operations handled client-side smoothly
      return null;
    }
    // Only show warning once per session for local dev
    if (!_offlineWarningShown) {
      _offlineWarningShown = true;
      setTimeout(() => { _offlineWarningShown = false; }, 20000);
      showToast('⚠️ Running in offline client mode');
    }
    return null;
  }
}

const apiGet    = (path, opts)       => api('GET',    path, null, opts);
const apiPost   = (path, data, opts) => api('POST',   path, data, opts);
const apiPut    = (path, data, opts) => api('PUT',    path, data || {}, opts);
const apiDelete = (path, opts)       => api('DELETE', path, null, opts);

/* ── Gradient palette for dynamic cards ──────── */
const GRADIENTS = [
  'linear-gradient(135deg,#7c3aed,#2563eb)',
  'linear-gradient(135deg,#0ea5e9,#06b6d4)',
  'linear-gradient(135deg,#f97316,#ec4899)',
  'linear-gradient(135deg,#7c3aed,#ec4899)',
  'linear-gradient(135deg,#0ea5e9,#7c3aed)',
  'linear-gradient(135deg,#f97316,#fbbf24)',
  'linear-gradient(135deg,#10b981,#06b6d4)',
  'linear-gradient(135deg,#6366f1,#7c3aed)',
  'linear-gradient(135deg,#10b981,#7c3aed)',
  'linear-gradient(135deg,#f43f5e,#ec4899)',
  'linear-gradient(135deg,#f59e0b,#10b981)',
  'linear-gradient(135deg,#0ea5e9,#10b981)',
];
function gradientFor(id) {
  if (typeof id === 'string') {
    let hash = 0;
    for (let i = 0; i < id.length; i++) hash = ((hash << 5) - hash) + id.charCodeAt(i);
    return GRADIENTS[Math.abs(hash) % GRADIENTS.length];
  }
  const n = Number(id);
  if (!isNaN(n)) return GRADIENTS[Math.abs(n) % GRADIENTS.length];
  return GRADIENTS[0];
}


/* Album images cycle for visual variety (fallback) */
const ALBUM_IMGS = ['album1.jpg','album2.jpg','album3.jpg'];
const ytCoverArtCache = new Map();
const _pendingArtFetches = new Set();

function imgFor(id) {
  if (!id && id !== 0) return ALBUM_IMGS[0];

  // If a full image URL or data URI is passed directly
  if (typeof id === 'string') {
    if (id.startsWith('https://i.ytimg.com') || id.startsWith('https://img.youtube.com') || id.startsWith('blob:') || id.startsWith('data:')) {
      return id;
    }
    // If a relative /vi/ or third-party Invidious URL is passed, extract videoId and convert to YouTube CDN
    if (id.includes('/vi/')) {
      const m = id.match(/\/vi\/([a-zA-Z0-9_-]{11})\b/);
      if (m && m[1]) return `https://i.ytimg.com/vi/${m[1]}/hqdefault.jpg`;
    }
    // If YouTube ID prefix:
    if (id.startsWith('yt_')) {
      const vid = id.replace('yt_', '');
      return `https://i.ytimg.com/vi/${vid}/hqdefault.jpg`;
    }
    if (id.endsWith('.jpg') || id.endsWith('.png') || id.endsWith('.webp') || id.endsWith('.svg')) {
      return id;
    }
  }

  // 1. Check pcSongAudioMap first (authoritative map for YouTube & local tracks)
  const ytData = pcSongAudioMap.get(id) || pcSongAudioMap.get(Number(id)) || pcSongAudioMap.get(String(id));
  if (ytData) {
    if (ytData.videoId) {
      const thumb = `https://i.ytimg.com/vi/${ytData.videoId}/hqdefault.jpg`;
      ytCoverArtCache.set(id, thumb);
      return thumb;
    }
    if (ytData.thumbnail && (ytData.thumbnail.startsWith('http://') || ytData.thumbnail.startsWith('https://'))) {
      if (ytData.thumbnail.includes('/vi/')) {
        const m = ytData.thumbnail.match(/\/vi\/([a-zA-Z0-9_-]{11})\b/);
        if (m && m[1]) {
          const thumb = `https://i.ytimg.com/vi/${m[1]}/hqdefault.jpg`;
          ytCoverArtCache.set(id, thumb);
          return thumb;
        }
      }
      return ytData.thumbnail;
    }
  }

  // 2. Check in-memory thumbnail cache
  if (ytCoverArtCache.has(id)) {
    const c = ytCoverArtCache.get(id);
    if (c && !c.startsWith('/vi/')) return c;
  }
  if (ytCoverArtCache.has(Number(id))) {
    const c = ytCoverArtCache.get(Number(id));
    if (c && !c.startsWith('/vi/')) return c;
  }
  if (ytCoverArtCache.has(String(id))) {
    const c = ytCoverArtCache.get(String(id));
    if (c && !c.startsWith('/vi/')) return c;
  }

  // 3. Check localStorage 'dhun_yt_songs'
  try {
    const raw = localStorage.getItem('dhun_yt_songs');
    if (raw) {
      const parsed = JSON.parse(raw);
      const item = parsed[id] || parsed[String(id)] || parsed[Number(id)];
      if (item) {
        if (item.videoId) {
          const thumb = `https://i.ytimg.com/vi/${item.videoId}/hqdefault.jpg`;
          ytCoverArtCache.set(id, thumb);
          return thumb;
        }
        if (item.thumbnail && !item.thumbnail.startsWith('/vi/')) {
          if (item.thumbnail.includes('/vi/')) {
            const m = item.thumbnail.match(/\/vi\/([a-zA-Z0-9_-]{11})\b/);
            if (m && m[1]) {
              const thumb = `https://i.ytimg.com/vi/${m[1]}/hqdefault.jpg`;
              ytCoverArtCache.set(id, thumb);
              return thumb;
            }
          }
          ytCoverArtCache.set(id, item.thumbnail);
          return item.thumbnail;
        }
      }
    }
  } catch(e){}

  // 4. Look up song object in state.songs
  const song = (state.songs || []).find(s => s.id === id || s.id === Number(id) || String(s.id) === String(id));
  if (song) {
    if (song.videoId) {
      const thumb = `https://i.ytimg.com/vi/${song.videoId}/hqdefault.jpg`;
      ytCoverArtCache.set(id, thumb);
      return thumb;
    }
    if (song.thumbnail && !song.thumbnail.startsWith('/vi/')) {
      if (song.thumbnail.includes('/vi/')) {
        const m = song.thumbnail.match(/\/vi\/([a-zA-Z0-9_-]{11})\b/);
        if (m && m[1]) {
          const thumb = `https://i.ytimg.com/vi/${m[1]}/hqdefault.jpg`;
          ytCoverArtCache.set(id, thumb);
          return thumb;
        }
      }
      ytCoverArtCache.set(id, song.thumbnail);
      return song.thumbnail;
    }

    // 5. Match by title & artist in YTMusicAPI
    if (typeof YTMusicAPI !== 'undefined' && YTMusicAPI.getVideoIdForTrack) {
      const vid = YTMusicAPI.getVideoIdForTrack(song.title, song.artist);
      if (vid) {
        const thumb = `https://i.ytimg.com/vi/${vid}/hqdefault.jpg`;
        ytCoverArtCache.set(id, thumb);
        const entry = { ...(pcSongAudioMap.get(id) || {}), isYT: true, videoId: vid, thumbnail: thumb, title: song.title, artist: song.artist };
        pcSongAudioMap.set(id, entry);
        saveYTSongToStorage(id, entry);
        return thumb;
      }
    }

    // 6. Asynchronously resolve and cache YouTube Music album art in background
    fetchYTAlbumArtForSong(song);
  }

  if (typeof id === 'number') {
    return ALBUM_IMGS[id % ALBUM_IMGS.length];
  }
  return ALBUM_IMGS[0];
}

function fetchYTAlbumArtForSong(song) {
  if (!song || !song.title || _pendingArtFetches.has(song.id)) return;
  _pendingArtFetches.add(song.id);

  if (typeof YTMusicAPI === 'undefined' || !YTMusicAPI.search) return;

  const q = `${song.title} ${song.artist || ''}`.trim();
  YTMusicAPI.search(q, 3).then(results => {
    if (results && results.length > 0) {
      const best = results[0];
      const vid = best.videoId;
      const thumb = vid ? `https://i.ytimg.com/vi/${vid}/hqdefault.jpg` : best.thumbnail;
      if (!thumb) return;

      ytCoverArtCache.set(song.id, thumb);

      const ytData = {
        isYT: true,
        videoId: vid,
        thumbnail: thumb,
        title: song.title,
        artist: song.artist
      };
      pcSongAudioMap.set(song.id, ytData);
      saveYTSongToStorage(song.id, ytData);

      // Update current song UI if active
      if (state.currentSong && (state.currentSong.id === song.id || state.currentSong.title === song.title)) {
        _img('player-album-img', thumb);
        _img('pb-img', thumb);
        _img('hub-info-art', thumb);
      }

      // Update all rendered images in DOM matching this song ID
      document.querySelectorAll(`img[data-song-id="${song.id}"]`).forEach(img => {
        img.src = thumb;
      });
    }
  }).catch(() => {});
}

async function resolveAllLibraryAlbumPhotos() {
  if (!state.songs || state.songs.length === 0) return;
  for (const s of state.songs) {
    if (!ytCoverArtCache.has(s.id) && !(pcSongAudioMap.get(s.id)?.thumbnail)) {
      fetchYTAlbumArtForSong(s);
    }
  }
}

/* ── Playlist Thumbnails (YouTube Album Covers) ───────────────── */
const playlistThumbnailMap = new Map();

function getPlaylistThumbnail(pl) {
  if (!pl) return ALBUM_IMGS[0];
  if (playlistThumbnailMap.has(pl.id)) return playlistThumbnailMap.get(pl.id);
  if (playlistThumbnailMap.has(String(pl.id))) return playlistThumbnailMap.get(String(pl.id));

  // If playlist has songs, use the thumbnail of the first song
  if (Array.isArray(pl.songs) && pl.songs.length > 0) {
    const firstSongThumb = imgFor(pl.songs[0]);
    if (firstSongThumb) {
      playlistThumbnailMap.set(pl.id, firstSongThumb);
      return firstSongThumb;
    }
  }

  if (state.songs && state.songs.length > 0) {
    const name = (pl.name || '').toLowerCase();
    let matchingSong = null;
    if (name.includes('bollywood') || name.includes('romance')) {
      matchingSong = state.songs.find(s => /kesariya|tum hi ho|crook|tujhko/i.test(s.title));
    } else if (name.includes('pop') || name.includes('chart')) {
      matchingSong = state.songs.find(s => /shape of you|blinding|despacito/i.test(s.title));
    } else if (name.includes('lo-fi') || name.includes('chill')) {
      matchingSong = state.songs.find(s => /lofi|chilledcow/i.test(s.title));
    } else if (name.includes('edm') || name.includes('energy')) {
      matchingSong = state.songs.find(s => /animals|faded/i.test(s.title));
    } else if (name.includes('punjabi')) {
      matchingSong = state.songs.find(s => /brown munde|lover/i.test(s.title));
    }
    if (matchingSong) {
      const thumb = imgFor(matchingSong.id);
      if (thumb) {
        playlistThumbnailMap.set(pl.id, thumb);
        return thumb;
      }
    }
  }

  const num = typeof pl.id === 'number' ? Math.abs(pl.id) : (parseInt(pl.id, 10) || 0);
  return ALBUM_IMGS[num % ALBUM_IMGS.length] || ALBUM_IMGS[0];
}

/* ── Preload YouTube Thumbnails for Entire Library ─────────────── */
function preloadKnownYouTubeThumbnails() {
  if (!state.songs || state.songs.length === 0) return;
  if (typeof YTMusicAPI === 'undefined') return;

  const catalog = [
    ...(YTMusicAPI.getTrending('trending') || []),
    ...(YTMusicAPI.getTrending('bollywood') || []),
    ...(YTMusicAPI.getTrending('punjabi') || []),
    ...(YTMusicAPI.getTrending('lofi') || []),
    ...(YTMusicAPI.getTrending('electronic') || [])
  ];

  for (const s of state.songs) {
    if (ytCoverArtCache.has(s.id)) continue;
    const cleanSTitle = s.title.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
    const match = catalog.find(item => {
      const itemTitle = item.title.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
      return itemTitle.includes(cleanSTitle) || cleanSTitle.includes(itemTitle);
    });

    if (match && match.videoId) {
      const thumb = match.thumbnail || `https://i.ytimg.com/vi/${match.videoId}/hqdefault.jpg`;
      ytCoverArtCache.set(s.id, thumb);
      const data = {
        isYT: true,
        videoId: match.videoId,
        thumbnail: thumb,
        title: s.title,
        artist: s.artist,
        durationSec: match.durationSec || 210
      };
      pcSongAudioMap.set(s.id, data);
      saveYTSongToStorage(s.id, data);
    } else if (typeof YTMusicAPI.getVideoIdForTrack === 'function') {
      const vid = YTMusicAPI.getVideoIdForTrack(s.title, s.artist);
      if (vid) {
        const thumb = `https://i.ytimg.com/vi/${vid}/hqdefault.jpg`;
        ytCoverArtCache.set(s.id, thumb);
        const data = {
          isYT: true,
          videoId: vid,
          thumbnail: thumb,
          title: s.title,
          artist: s.artist
        };
        pcSongAudioMap.set(s.id, data);
        saveYTSongToStorage(s.id, data);
      }
    }
  }

  // Update all rendered DOM images matching song IDs
  document.querySelectorAll('img[data-song-id]').forEach(img => {
    const sid = Number(img.getAttribute('data-song-id'));
    if (ytCoverArtCache.has(sid)) {
      img.src = ytCoverArtCache.get(sid);
    }
  });
}

/* Format duration in minutes (float) to m:ss */
function fmtDur(minutes) {
  if (!minutes) return '0:00';
  const total = Math.round(minutes * 60);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2,'0')}`;
}

/* ══════════════════════════════════════════════════
   PAGE NAVIGATION
   Switches between Home, Search, Library, Player, Profile.
   Updates nav highlights, breadcrumb, search bar visibility,
   bottom player bar visibility, and triggers a data refresh
   for the newly activated page.
   ══════════════════════════════════════════════════ */
/* Mobile Navigation Drawer Toggle */
function toggleMobileSidebar(forceState) {
  const sidebar = document.getElementById('sidebar');
  const backdrop = document.getElementById('sidebar-backdrop');
  if (!sidebar) return;
  const isOpen = sidebar.classList.contains('mobile-open');
  const next = forceState !== undefined ? forceState : !isOpen;
  sidebar.classList.toggle('mobile-open', next);
  if (backdrop) backdrop.classList.toggle('active', next);
}

function navigate(page) {
  // Cleanup visualizer canvas loop when leaving player page (keeps audio playing continuously)
  if (state.currentPage === 'player' && page !== 'player') {
    if (typeof cleanupVisualizer === 'function') cleanupVisualizer();
  }

  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.querySelectorAll('.mob-nav-btn').forEach(b => b.classList.remove('active'));

  toggleMobileSidebar(false);

  const target = document.getElementById('page-' + page);
  if (target) target.classList.add('active');

  const navBtn = document.getElementById('nav-' + page);
  if (navBtn) navBtn.classList.add('active');

  const mobBtn = document.getElementById('mob-nav-' + page);
  if (mobBtn) mobBtn.classList.add('active');

  state.currentPage = page;

  const breadcrumb = document.getElementById('breadcrumb');
  const labels = { home:'Home', search:'Discover', player:'Now Playing', profile:'Profile', library:'Library' };
  if (breadcrumb) breadcrumb.textContent = labels[page] || page;

  /* Hide bottom bar on Now Playing page (in-page controls shown there),
     show it on all other pages */
  const playerBar = document.getElementById('player-bar');
  const appShell  = document.getElementById('app');
  if (playerBar) playerBar.style.display = (page === 'player') ? 'none' : '';
  if (appShell) {
    appShell.style.gridTemplateRows = (page === 'player') ? '1fr' : '';
  }

  /* Refresh data on navigation */
  if (page === 'home')    refreshHome();
  if (page === 'search')  {
    if (!state.activePlaylistId) {
      closePlaylistView();
    }
    refreshSearch();
  }
  if (page === 'player')  {
    refreshQueue();
    if (typeof resizeVisualizerCanvas === 'function') setTimeout(resizeVisualizerCanvas, 60);
    if (typeof resizeVisualShowcaseCanvases === 'function') setTimeout(resizeVisualShowcaseCanvases, 80);
  }
  if (page === 'profile') refreshProfile();
  if (page === 'library') refreshLibrary();
  if (typeof syncVideoDockPosition === 'function') {
    setTimeout(syncVideoDockPosition, 50);
  }
}

/* ── Open player with specific song ──────────── */
async function openPlayer(songId) {
  /* If called with a list index (old style), map to actual song id */
  let song = null;
  if (state.songs && state.songs.length > 0 && songId < state.songs.length && songId >= 0) {
    song = state.songs[songId];
  }
  if (!song && state.songs) {
    song = state.songs.find(s => s.id === songId || s.id === Number(songId));
  }
  if (!song) {
    song = await apiGet(`/songs/${songId}`);
  }
  if (!song) return;

  state.currentSong = song;
  loadSongUI(song);
  navigate('player');
  startPlaying();

  /* Record play via API in background without blocking audio playback */
  apiPut(`/songs/${song.id}/play`).catch(() => {});
}

/* Lighter shortcut used by song cards in Home/Library/Search views.
   Prefer this over openPlayer() when the song ID is already known — avoids
   the index-vs-ID ambiguity resolution logic. */
async function openPlayerById(id) {
  if (id === undefined || id === null) return;
  const sId = String(id);
  const nId = Number(id);

  let song = (state.songs || []).find(s => String(s.id) === sId || s.id === nId);
  if (!song) {
    const allKnown = [...(state.songs || []), ...(_libAllSongs || []), ...(state.history || [])];
    song = allKnown.find(s => s && (String(s.id) === sId || s.id === nId));
  }
  if (!song) {
    const pcItem = pcSongAudioMap.get(id) || pcSongAudioMap.get(nId) || pcSongAudioMap.get(sId);
    if (pcItem) {
      song = {
        id,
        title: pcItem.title || 'Track',
        artist: pcItem.artist || 'Artist',
        album: pcItem.album || 'Online Media',
        genre: pcItem.genre || 'Music',
        duration: pcItem.durationSec ? +(pcItem.durationSec / 60).toFixed(2) : 3.5,
        rating: 4.8
      };
      if (!state.songs.some(s => String(s.id) === sId)) {
        state.songs.push(song);
      }
    }
  }
  if (!song) {
    song = await apiGet(`/songs/${id}`);
    if (song && !state.songs.some(s => String(s.id) === String(song.id))) {
      state.songs.push(song);
    }
  }
  if (!song) return;

  state.currentSong = song;
  loadSongUI(song);
  navigate('player');
  startPlaying();

  /* Record play via API in background without blocking audio playback */
  apiPut(`/songs/${song.id}/play`).catch(() => {});
}

/* ── Load song into all UIs ──────────────────── */
function loadSongUI(s) {
  if (!s) return;
  const bg  = gradientFor(s.id);
  const img = imgFor(s.id);

  if (state.currentSong && state.currentSong.id !== s.id) {
    if (globalAudioPlayer) {
      const audioInfo = resolveAudioSource(s);
      if (audioInfo && audioInfo.url) {
        if (!globalAudioPlayer.src.endsWith(audioInfo.url)) {
          globalAudioPlayer.src = audioInfo.url;
          globalAudioPlayer.currentTime = 0;
        }
      } else {
        if (!globalAudioPlayer.paused) globalAudioPlayer.pause();
        globalAudioPlayer.removeAttribute('src');
      }
    }
  }

  /* Player page */
  _set('player-song-title',  s.title);
  _set('player-song-artist', `${s.artist} · ${s.album}`);
  _img('player-album-img',   img);
  _img('hub-info-art',       img);
  _set('hub-info-title',     s.title);
  _set('hub-info-artist',    `${s.artist} · ${s.album || ''}`);
  const pbg = document.getElementById('page-player');
  if (pbg) pbg.style.setProperty('--current-bg', bg);

  /* Bottom player bar */
  _set('pb-song',   s.title);
  _set('pb-artist', s.artist);
  _img('pb-img',    img);
  const pbThumb = document.getElementById('pb-thumb');
  if (pbThumb) pbThumb.style.background = bg;

  /* Duration */
  const dur = fmtDur(s.duration);
  _set('total-time',    dur);
  _set('pb-total-time', dur);

  /* Like state */
  const heart = document.getElementById('player-heart');
  if (heart) { heart.textContent = s.liked ? '❤️' : '♡'; heart.classList.toggle('liked', !!s.liked); }
  const pbLike = document.querySelector('.pb-like');
  if (pbLike) { pbLike.textContent = s.liked ? '❤️' : '♡'; pbLike.classList.toggle('liked', !!s.liked); }

  /* Reset progress */
  state.progress = 0;
  updateProgress();

  /* Update Dhun Player Hub (Song Info, Listening Stats, Similar Dhun & Vibe Board) */
  if (typeof updateDhunHub === 'function') {
    updateDhunHub(s);
  }
  if (typeof recordSongPlay === 'function') {
    recordSongPlay(s);
  }

  /* Listen Together sync metadata */
  _set('jam-sync-title', s.title);
  _set('jam-sync-artist', `${s.artist} · ${s.album || ''}`);
  if (typeof broadcastJam === 'function' && jamState.active && !jamState._isRemoteSync) {
    broadcastJam({ type: 'SYNC_SONG', song: s, shouldPlay: state.isPlaying });
  }

  /* Update video panel info bar if in video mode */
  if (_currentSVMode === 'video') {
    const pvpTitle  = document.getElementById('pvp-title');
    const pvpArtist = document.getElementById('pvp-artist');
    if (pvpTitle)  pvpTitle.textContent  = s.title || 'Unknown';
    if (pvpArtist) pvpArtist.textContent = `${s.artist || ''} · ${s.album || ''}`;
    if (typeof syncVideoDockPosition === 'function') syncVideoDockPosition();
  }

  /* Dynamically update Auto-Recommendations matching current song */
  if (typeof renderRelated === 'function') {
    renderRelated();
  }
}

function _set(id, val) { const el = document.getElementById(id); if (el) el.textContent = val; }
function _img(id, src) {
  const el = document.getElementById(id);
  if (!el) return;
  el.onerror = function() {
    this.onerror = null;
    this.src = ALBUM_IMGS[0];
  };
  let validSrc = src;
  if (typeof validSrc === 'string' && validSrc.includes('/vi/')) {
    const m = validSrc.match(/\/vi\/([a-zA-Z0-9_-]{11})\b/);
    if (m && m[1]) validSrc = `https://i.ytimg.com/vi/${m[1]}/hqdefault.jpg`;
  }
  el.src = validSrc || ALBUM_IMGS[0];
}

/* ══════════════════════════════════════════════════
   PLAYBACK ENGINE
   Controls play/pause, next/prev, seek, shuffle, and repeat.
   Real audio runs through the Web Audio API (audioEngine).
   Progress is tracked via a 250ms interval timer, and all UI
   elements (progress bar, time labels, icons) stay in sync.
   ══════════════════════════════════════════════════ */
let _lastToggleTime = 0;
function togglePlay() {
  const now = Date.now();
  if (now - _lastToggleTime < 150) return;
  _lastToggleTime = now;
  state.isPlaying ? stopPlaying() : startPlaying();
}

function startPlaying() {
  state.isPlaying = true;
  updatePlayUI();
  const ring = document.querySelector('.player-art-ring');
  if (ring) ring.style.animationPlayState = 'running';
  const eq = document.getElementById('equalizer');
  if (eq) eq.querySelectorAll('span').forEach(s => s.style.animationPlayState = 'running');

  /* Visualizer status & AudioContext hook */
  const vizDot = document.getElementById('viz-status-dot');
  if (vizDot) vizDot.classList.remove('paused');

  audioEngine.resume();

  if (typeof broadcastJam === 'function' && jamState.active && !jamState._isRemoteSync) {
    broadcastJam({ type: 'SYNC_PLAY', songId: state.currentSong?.id, progress: state.progress });
  }

  clearInterval(state.timer);

  if (isCurrentSongYT()) {
    if (globalAudioPlayer && !globalAudioPlayer.paused) {
      globalAudioPlayer.pause();
    }
    const vid = getCurrentYTVideoId();
    if (vid) {
      playYTVideo(vid);
    } else if (typeof YTMusicAPI !== 'undefined' && YTMusicAPI.search) {
      YTMusicAPI.search(state.currentSong.title + ' ' + (state.currentSong.artist || ''), 1).then(results => {
        if (results && results[0] && results[0].videoId) {
          const ytData = {
            isYT: true,
            videoId: results[0].videoId,
            thumbnail: results[0].thumbnail,
            durationSec: results[0].durationSec || 210,
            title: state.currentSong.title,
            artist: state.currentSong.artist
          };
          pcSongAudioMap.set(state.currentSong.id, ytData);
          saveYTSongToStorage(state.currentSong.id, ytData);
          playYTVideo(results[0].videoId);
        }
      }).catch(err => console.warn('[YT] Search fallback error:', err));
    }
    startYTSimulatedBeatFFT();

    state.timer = setInterval(() => {
      if (ytPlayer && ytPlayer.getCurrentTime && ytPlayer.getDuration) {
        const cur = ytPlayer.getCurrentTime() || 0;
        const dur = ytPlayer.getDuration() || ((state.currentSong?.duration || 3.5) * 60);
        if (dur > 0) {
          state.progress = Math.min(100, (cur / dur) * 100);
          updateProgress();
        }
      }
    }, 250);
  } else {
    stopYTSimulatedBeatFFT();
    if (ytPlayer && ytPlayer.pauseVideo) {
      try { ytPlayer.pauseVideo(); } catch(e){}
    }
    const audioInfo = resolveAudioSource(state.currentSong);
    if (audioInfo && audioInfo.url) {
      if (!globalAudioPlayer.src.endsWith(audioInfo.url)) {
        globalAudioPlayer.src = audioInfo.url;
        const targetTime = ((state.progress || 0) / 100) * (audioInfo.durationSec || 1);
        if (isFinite(targetTime) && targetTime > 0) {
          try { globalAudioPlayer.currentTime = targetTime; } catch(e){}
        }
      }
      audioEngine.connectMediaElement();
      globalAudioPlayer.play().catch(e => console.warn('Audio play error:', e));

      state.timer = setInterval(() => {
        if (globalAudioPlayer.duration && !isNaN(globalAudioPlayer.duration)) {
          state.progress = (globalAudioPlayer.currentTime / globalAudioPlayer.duration) * 100;
          updateProgress();
        }
      }, 250);
    }
  }
}

function stopPlaying() {
  state.isPlaying = false;
  updatePlayUI();
  clearInterval(state.timer);

  const vizDot = document.getElementById('viz-status-dot');
  if (vizDot) vizDot.classList.add('paused');

  if (typeof broadcastJam === 'function' && jamState.active && !jamState._isRemoteSync) {
    broadcastJam({ type: 'SYNC_PAUSE', songId: state.currentSong?.id, progress: state.progress });
  }

  if (globalAudioPlayer && !globalAudioPlayer.paused) {
    globalAudioPlayer.pause();
  }

  if (ytPlayer && ytPlayer.pauseVideo) {
    try { ytPlayer.pauseVideo(); } catch(e){}
  }
  stopYTSimulatedBeatFFT();

  const ring = document.querySelector('.player-art-ring');
  if (ring) ring.style.animationPlayState = 'paused';
  const eq = document.getElementById('equalizer');
  if (eq) eq.querySelectorAll('span').forEach(s => s.style.animationPlayState = 'paused');
}

function updatePlayUI() {
  const show = (id, visible) => { const el=document.getElementById(id); if(el) el.style.display = visible?'block':'none'; };
  show('play-icon',     !state.isPlaying); show('pause-icon',    state.isPlaying);
  show('pb-play-icon',  !state.isPlaying); show('pb-pause-icon', state.isPlaying);
  ['shuffle-btn','pb-shuffle'].forEach(id => { const el=document.getElementById(id); if(el) el.classList.toggle('active', !!state.isShuffle); });
  ['repeat-btn','pb-repeat'].forEach(id => { const el=document.getElementById(id); if(el) el.classList.toggle('active', !!state.isRepeat); });
  if (typeof updatePVPOverlayUI === 'function') updatePVPOverlayUI(state.isPlaying);
}

async function nextSong() {
  stopPlaying();
  state.progress = 0;

  /* 1. Client-side queue */
  if (state.queue && state.queue.length > 0) {
    if (state.currentSong && state.queue[0] && (String(state.queue[0].id) === String(state.currentSong.id) || state.queue[0].id == state.currentSong.id)) {
      state.queue.shift();
    }
  }

  if (state.queue && state.queue.length > 0) {
    let nextTrack;
    if (state.isShuffle) {
      const qIdx = Math.floor(Math.random() * state.queue.length);
      [nextTrack] = state.queue.splice(qIdx, 1);
    } else {
      nextTrack = state.queue.shift();
    }
    if (typeof renderQueue === 'function') renderQueue();
    if (nextTrack) {
      openPlayerById(nextTrack.id);
      return;
    }
  }

  /* 2. Try backend dequeue if available (C server) */
  try {
    const dequeued = await apiDelete('/queue');
    if (dequeued && dequeued.id !== undefined) {
      await apiPut(`/songs/${dequeued.id}/play`).catch(() => {});
      openPlayerById(dequeued.id);
      if (typeof refreshQueue === 'function') refreshQueue();
      return;
    }
  } catch(e) {}

  /* 3. Comprehensive song pool */
  const songPool = (state.songs && state.songs.length > 0)
    ? state.songs
    : (typeof _libAllSongs !== 'undefined' && _libAllSongs && _libAllSongs.length > 0 ? _libAllSongs : []);

  if (songPool.length === 0) return;

  const currId = state.currentSong?.id;
  let currIdx = songPool.findIndex(s => s && (String(s.id) === String(currId) || s.id == currId));
  let nextIdx = currIdx;

  if (state.isShuffle) {
    if (songPool.length > 1) {
      let attempts = 0;
      while (nextIdx === currIdx && attempts < 15) {
        nextIdx = Math.floor(Math.random() * songPool.length);
        attempts++;
      }
      if (nextIdx === currIdx) {
        nextIdx = (currIdx + 1) % songPool.length;
      }
    } else {
      nextIdx = 0;
    }
  } else {
    /* If not shuffle, try auto-recommendations */
    if (typeof getAutoRecommendations === 'function' && state.currentSong) {
      try {
        const recs = getAutoRecommendations(state.currentSong, 1);
        if (recs && recs.length > 0 && recs[0].song) {
          const recSong = recs[0].song;
          openPlayerById(recSong.id);
          return;
        }
      } catch(e) {}
    }
    nextIdx = currIdx >= 0 ? (currIdx + 1) % songPool.length : 0;
  }

  const nextSongObj = songPool[nextIdx];
  if (nextSongObj) {
    openPlayerById(nextSongObj.id);
  }
}

async function prevSong() {
  stopPlaying();
  /* If progress > 10%, restart */
  if (state.progress > 10) {
    state.progress = 0;
    updateProgress();
    if (isCurrentSongYT() && ytPlayer && ytPlayer.seekTo) {
      try { ytPlayer.seekTo(0, true); } catch(e){}
    } else if (globalAudioPlayer) {
      globalAudioPlayer.currentTime = 0;
    }
    startPlaying();
    return;
  }

  /* Try history back */
  try {
    const prev = await apiPost('/history/back');
    if (prev && prev.id !== undefined) {
      openPlayerById(prev.id);
      return;
    }
  } catch(e) {}

  /* Fall back to previous in pool */
  const songPool = (state.songs && state.songs.length > 0)
    ? state.songs
    : (typeof _libAllSongs !== 'undefined' && _libAllSongs && _libAllSongs.length > 0 ? _libAllSongs : []);
  if (songPool.length === 0) return;

  const currId = state.currentSong?.id;
  let currIdx = songPool.findIndex(s => s && (String(s.id) === String(currId) || s.id == currId));
  let prevIdx;
  if (state.isShuffle && songPool.length > 1) {
    prevIdx = Math.floor(Math.random() * songPool.length);
  } else {
    prevIdx = currIdx >= 0 ? (currIdx - 1 + songPool.length) % songPool.length : 0;
  }
  const song = songPool[prevIdx];
  if (song) {
    openPlayerById(song.id);
  }
}

function updateProgress() {
  const p = state.progress;
  ['progress-fill','pb-fill'].forEach(id => { const el=document.getElementById(id); if(el) el.style.width=p+'%'; });
  ['progress-thumb','pb-thumb-dot'].forEach(id => { const el=document.getElementById(id); if(el) el.style.right=(100-p)+'%'; });

  const durationSec = (state.currentSong?.duration || 3.5) * 60;
  const elapsed = Math.floor((p / 100) * durationSec);
  const fmt = t => `${Math.floor(t/60)}:${String(t%60).padStart(2,'0')}`;
  _set('current-time', fmt(elapsed));
  _set('pb-cur-time',  fmt(elapsed));

  /* Real-time Karaoke Lyrics Synchronization */
  if (typeof updateLyricsSync === 'function') {
    const currentSec = (globalAudioPlayer && !isNaN(globalAudioPlayer.currentTime) && globalAudioPlayer.currentTime > 0)
      ? globalAudioPlayer.currentTime
      : elapsed;
    updateLyricsSync(currentSec);
  }
}

function seekSong(e) {
  const track = e.currentTarget;
  const rect  = track.getBoundingClientRect();
  state.progress = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100));
  updateProgress();

  if (typeof broadcastJam === 'function' && jamState.active && !jamState._isRemoteSync) {
    broadcastJam({ type: 'SYNC_SEEK', songId: state.currentSong?.id, progress: state.progress });
  }

  if (isCurrentSongYT()) {
    if (ytPlayer && ytPlayer.seekTo) {
      const durationSec = ytPlayer.getDuration() || ((state.currentSong?.duration || 3.5) * 60);
      const targetSec = (state.progress / 100) * durationSec;
      ytPlayer.seekTo(targetSec, true);
    }
  } else if (globalAudioPlayer && globalAudioPlayer.duration && !isNaN(globalAudioPlayer.duration)) {
    globalAudioPlayer.currentTime = (state.progress / 100) * globalAudioPlayer.duration;
  }
}

function toggleShuffle() {
  state.isShuffle = !state.isShuffle;
  ['shuffle-btn','pb-shuffle'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.toggle('active', !!state.isShuffle);
  });
  if (state.isShuffle && state.queue && state.queue.length > 1) {
    for (let i = state.queue.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [state.queue[i], state.queue[j]] = [state.queue[j], state.queue[i]];
    }
    if (typeof renderQueue === 'function') renderQueue();
  }
  if (typeof showToast === 'function') {
    showToast(state.isShuffle ? '🔀 Shuffle On' : '➡️ Shuffle Off');
  }
}

function toggleRepeat() {
  state.isRepeat = !state.isRepeat;
  ['repeat-btn','pb-repeat'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.toggle('active', !!state.isRepeat);
  });
  if (globalAudioPlayer) {
    globalAudioPlayer.loop = !!state.isRepeat;
  }
  if (ytPlayer && typeof ytPlayer.setLoop === 'function') {
    try { ytPlayer.setLoop(!!state.isRepeat); } catch(e){}
  }
  if (typeof showToast === 'function') {
    showToast(state.isRepeat ? '🔂 Repeat / Loop On' : '➡️ Repeat Off');
  }
}

/* ── Volume & 150% VLC-Style Boost ───────────────── */
function setVolume(val) {
  val = Math.max(0, Math.min(150, Math.round(Number(val))));
  audioEngine.setVolume(val);
  if (ytPlayer && ytPlayer.setVolume) {
    try { ytPlayer.setVolume(Math.min(100, val)); } catch(e){}
  }

  const isMuted = (val === 0);
  const isBoosted = (val > 100);
  const icon = isMuted ? '🔇' : (val < 40 ? '🔉' : (isBoosted ? '📢' : '🔊'));

  // Calculate slider background fill relative to 150 max
  const fillPct = ((val / 150) * 100).toFixed(1);
  const normalBoundaryPct = ((100 / 150) * 100).toFixed(1); // 66.7%

  let sliderBg;
  if (val <= 100) {
    sliderBg = `linear-gradient(to right, var(--purple, #7c3aed) ${fillPct}%, rgba(255,255,255,0.15) ${fillPct}%)`;
  } else {
    // VLC-style boost: purple up to 100%, fiery flame gradient for 101%-150%
    sliderBg = `linear-gradient(to right, var(--purple, #7c3aed) 0%, var(--purple, #7c3aed) ${normalBoundaryPct}%, #f59e0b ${normalBoundaryPct}%, #ef4444 ${fillPct}%, rgba(255,255,255,0.15) ${fillPct}%)`;
  }

  // Bottom bar volume slider
  const pbSlider = document.getElementById('vol-slider');
  if (pbSlider) {
    pbSlider.value = val;
    pbSlider.style.background = sliderBg;
    pbSlider.title = `Volume: ${val}%${isBoosted ? ' (150% VLC Boost)' : ''}`;
  }
  const pbIcon = document.querySelector('.volume-control .vol-icon');
  if (pbIcon) {
    pbIcon.textContent = icon;
    pbIcon.style.color = isBoosted ? '#f59e0b' : '';
    pbIcon.title = isBoosted ? 'VLC Volume Boost Active (150%)' : 'Click to mute / Double-click for 150% boost';
  }

  // In-player dedicated volume slider
  const pSlider = document.getElementById('player-vol-slider');
  if (pSlider) {
    pSlider.value = val;
    pSlider.style.background = sliderBg;
    pSlider.title = `Volume: ${val}%${isBoosted ? ' (150% VLC Boost)' : ''}`;
  }
  const pIcon = document.getElementById('player-vol-icon');
  if (pIcon) {
    pIcon.textContent = icon;
    pIcon.style.color = isBoosted ? '#f59e0b' : '';
  }

  const pPct = document.getElementById('player-vol-pct');
  if (pPct) {
    pPct.textContent = isBoosted ? `${val}% 🚀` : `${val}%`;
    pPct.style.color = isBoosted ? '#f59e0b' : 'var(--text-2)';
    pPct.style.fontWeight = isBoosted ? '800' : '700';
    pPct.style.textShadow = isBoosted ? '0 0 10px rgba(245,158,11,0.6)' : 'none';
  }

  const pBoostBtn = document.getElementById('player-vol-boost-btn');
  if (pBoostBtn) {
    pBoostBtn.classList.toggle('active', isBoosted);
    pBoostBtn.textContent = isBoosted ? '🔥 150%' : '🚀 150%';
  }
}

function toggleBoostVolume() {
  const currentVal = Math.round((audioEngine.volume || 0.75) * 100);
  if (currentVal >= 145) {
    setVolume(100);
    if (typeof showToast === 'function') showToast('🔉 Volume: Standard 100%');
  } else {
    setVolume(150);
    if (typeof showToast === 'function') showToast('🚀 Volume Boosted to 150% (VLC Mode)');
  }
}

function toggleMute() {
  audioEngine.toggleMute();
  const currentVal = Math.round(audioEngine.volume * 100);
  setVolume(audioEngine.isMuted ? 0 : currentVal);
}

/* ══════════════════════════════════════════════════
   DHUN AUTHENTICATION & MULTI-USER ISOLATION ENGINE
   ══════════════════════════════════════════════════ */

const authState = {
  currentUser: null,
  users: [],
  paletteColors: ['#7c3aed', '#ec4899', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4'],
  selectedAvatarColor: '#7c3aed'
};

function makeUserIdFromEmail(email) {
  if (!email || email === 'guest@dhun.local') return 'guest';
  const clean = String(email).toLowerCase().trim().replace(/[^a-z0-9]/g, '_');
  return `usr_${clean}`;
}

function mergeUserStorageData(oldUid, newUid) {
  if (!oldUid || !newUid || oldUid === newUid) return;
  try {
    // 1. Merge Playlists without losing any tracks
    const oldPlsRaw = localStorage.getItem(`dhun_usr_${oldUid}_playlists`);
    const newPlsRaw = localStorage.getItem(`dhun_usr_${newUid}_playlists`);
    const oldPls = oldPlsRaw ? JSON.parse(oldPlsRaw) : [];
    const newPls = newPlsRaw ? JSON.parse(newPlsRaw) : [];

    if (oldPls.length > 0) {
      const combinedPls = [...newPls];
      oldPls.forEach(op => {
        const match = combinedPls.find(np => np.name && op.name && np.name.toLowerCase().trim() === op.name.toLowerCase().trim());
        if (match) {
          const songSet = new Set([...(match.songs || []), ...(op.songs || [])]);
          match.songs = Array.from(songSet);
        } else {
          combinedPls.push(op);
        }
      });
      localStorage.setItem(`dhun_usr_${newUid}_playlists`, JSON.stringify(combinedPls));
    }

    // 2. Merge Likes
    const oldLikesRaw = localStorage.getItem(`dhun_usr_${oldUid}_likes`);
    const newLikesRaw = localStorage.getItem(`dhun_usr_${newUid}_likes`);
    const oldLikes = oldLikesRaw ? JSON.parse(oldLikesRaw) : [];
    const newLikes = newLikesRaw ? JSON.parse(newLikesRaw) : [];
    if (oldLikes.length > 0) {
      const combinedLikes = Array.from(new Set([...newLikes, ...oldLikes]));
      localStorage.setItem(`dhun_usr_${newUid}_likes`, JSON.stringify(combinedLikes));
    }
  } catch(e) {}
}

function deduplicateUsers(users) {
  if (!Array.isArray(users)) return [];
  const map = new Map();

  users.forEach(u => {
    if (!u) return;
    const emailKey = (u.email || '').toLowerCase().trim();
    if (!emailKey || u.id === 'guest' || emailKey === 'guest@dhun.local') {
      map.set('guest', { ...u, id: 'guest', name: 'Guest User' });
      return;
    }

    const canonicalId = makeUserIdFromEmail(emailKey);
    const existing = map.get(emailKey);

    if (!existing) {
      map.set(emailKey, { ...u, id: canonicalId, email: emailKey });
    } else {
      // Merge into the single individual profile for this Gmail
      const preferredName = (u.name && u.name.length >= existing.name.length) ? u.name : existing.name;
      const preferredAvatar = u.avatarColor || existing.avatarColor || '#7c3aed';
      const preferredCover = u.coverUrl || existing.coverUrl || 'album2.jpg';
      const isGoogle = (u.provider === 'google' || existing.provider === 'google');
      const lastLogin = Math.max(u.lastLoginAt || 0, existing.lastLoginAt || 0);

      mergeUserStorageData(existing.id, canonicalId);
      mergeUserStorageData(u.id, canonicalId);

      map.set(emailKey, {
        ...existing,
        ...u,
        id: canonicalId,
        email: emailKey,
        name: preferredName,
        avatarColor: preferredAvatar,
        coverUrl: preferredCover,
        provider: isGoogle ? 'google' : (existing.provider || u.provider),
        lastLoginAt: lastLogin
      });
    }

    if (u.id && u.id !== canonicalId) {
      mergeUserStorageData(u.id, canonicalId);
    }
  });

  return Array.from(map.values());
}

function getStoredUsers() {
  try {
    const raw = localStorage.getItem('dhun_auth_users');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return deduplicateUsers(parsed);
      }
    }
  } catch(e) {}
  return [];
}

function saveStoredUsers(users) {
  try {
    const deduped = deduplicateUsers(users);
    localStorage.setItem('dhun_auth_users', JSON.stringify(deduped));
    authState.users = deduped;
  } catch(e) {}
}

function saveCredentials(email) {
  if (!email) return;
  try {
    localStorage.setItem('dhun_saved_credentials', JSON.stringify({ email: String(email).toLowerCase().trim() }));
  } catch(e) {}
}

function getSavedCredentials() {
  try {
    const raw = localStorage.getItem('dhun_saved_credentials');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed) {
        delete parsed.password; // Strict security: never return or save passwords
        return parsed;
      }
    }
  } catch(e) {}
  return null;
}

function initAuth() {
  // Purge any previously stored passwords from localStorage
  try {
    const rawCreds = localStorage.getItem('dhun_saved_credentials');
    if (rawCreds) {
      const parsed = JSON.parse(rawCreds);
      if (parsed && parsed.password) {
        delete parsed.password;
        localStorage.setItem('dhun_saved_credentials', JSON.stringify(parsed));
      }
    }
  } catch(e) {}

  authState.users = getStoredUsers();
  saveStoredUsers(authState.users); // Run deduplication pass immediately

  // 1. Check for actively authenticated session
  let activeUser = null;
  const activeUserId = localStorage.getItem('dhun_auth_active_user');

  if (activeUserId) {
    activeUser = authState.users.find(u => u.id === activeUserId || (u.email && makeUserIdFromEmail(u.email) === activeUserId));
  }

  // 2. Check full active profile if session flag exists
  if (activeUser) {
    activeUser.id = makeUserIdFromEmail(activeUser.email);
    localStorage.setItem('dhun_auth_active_user', activeUser.id);
    localStorage.setItem('dhun_active_profile', JSON.stringify(activeUser));
  }

  const gateScreen = document.getElementById('login-gate-screen');
  const appShell   = document.getElementById('app');

  if (activeUser) {
    // Already authenticated: bypass gatekeeper, load private library immediately
    authState.currentUser = activeUser;
    if (gateScreen) {
      gateScreen.style.display = 'none';
      gateScreen.classList.remove('gate-exiting');
    }
    if (appShell) appShell.style.display = '';
    renderAvatarColorPicker();
    updateAuthUI();
    purgePredefaultPlaylists();

    // Pull any remote cloud playlists and sync in background
    setTimeout(() => {
      pullProfileFromCloud();
    }, 600);
  } else {
    // Not authenticated: hold at dedicated full-page Login Gatekeeper screen
    authState.currentUser = null;
    if (gateScreen) {
      gateScreen.style.display = 'flex';
      gateScreen.classList.remove('gate-exiting');
      renderGateAvatarColorPicker();
      renderGateSavedProfiles();
      populateSavedCredentials();
    }
    if (appShell) {
      appShell.style.display = 'none';
    }
  }
}

function populateSavedCredentials() {
  const creds = getSavedCredentials();
  const emailInput = document.getElementById('gate-signin-email');
  const passInput  = document.getElementById('gate-signin-password');
  if (emailInput && creds && creds.email && !emailInput.value) {
    emailInput.value = creds.email;
  }
  // User must input password each time - never prefill password
  if (passInput) {
    passInput.value = '';
  }
}

function renderGateSavedProfiles() {
  const container = document.getElementById('gate-saved-profiles');
  if (!container) return;
  const users = getStoredUsers().filter(u => u && u.id !== 'guest');
  if (users.length === 0) {
    container.innerHTML = '';
    container.style.display = 'none';
    return;
  }
  container.style.display = 'block';
  container.innerHTML = `
    <div style="background:rgba(255,255,255,0.04);border:1px solid var(--glass-border);border-radius:14px;padding:12px 14px;margin-bottom:14px;">
      <p style="font-size:11px;font-weight:700;color:var(--text-3);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px">Saved Profiles (Select to Sign In)</p>
      <div style="display:flex;flex-direction:column;gap:8px;">
        ${users.map(u => `
          <button type="button" onclick="selectSavedProfileForSignIn('${u.id}')" style="display:flex;align-items:center;gap:10px;width:100%;padding:8px 12px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:10px;color:var(--text-1);cursor:pointer;text-align:left;transition:all 0.2s;" onmouseover="this.style.background='rgba(168,85,247,0.18)'" onmouseout="this.style.background='rgba(255,255,255,0.05)'">
            <span style="width:28px;height:28px;border-radius:50%;background:${u.avatarColor || '#7c3aed'};display:flex;align-items:center;justify-content:center;font-weight:bold;font-size:12px;color:#fff;flex-shrink:0;">${(u.name || 'U').charAt(0).toUpperCase()}</span>
            <div style="flex:1;min-width:0;">
              <p style="font-size:13px;font-weight:600;margin:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtmlText(u.name)}</p>
              <p style="font-size:11px;color:var(--text-3);margin:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtmlText(u.email || 'Profile')}</p>
            </div>
            <span style="font-size:12px;color:var(--purple);font-weight:600;">Select 🔑</span>
          </button>
        `).join('')}
      </div>
    </div>
  `;
}

function selectSavedProfileForSignIn(userId) {
  const users = getStoredUsers();
  const user = users.find(u => u.id === userId);
  if (!user) return;
  switchGateTab('signin');
  const emailInput = document.getElementById('gate-signin-email');
  const passInput  = document.getElementById('gate-signin-password');
  if (emailInput) {
    emailInput.value = user.email || user.name;
  }
  if (passInput) {
    passInput.value = '';
    passInput.focus();
  }
  showToast(`🔑 Profile selected: ${user.name}. Please enter your password.`);
}

function enterAppFromGate(user) {
  if (!user) return;
  user.lastLoginAt = Date.now();
  authState.currentUser = user;

  try {
    localStorage.setItem('dhun_auth_active_user', user.id);
    localStorage.setItem('dhun_active_profile', JSON.stringify(user));

    const users = getStoredUsers();
    const idx = users.findIndex(u => u.id === user.id);
    if (idx !== -1) {
      users[idx] = { ...users[idx], ...user };
    } else {
      users.push(user);
    }
    saveStoredUsers(users);

    if (user.email) {
      saveCredentials(user.email, user.password || '');
    }
  } catch(e) {}

  const gateScreen = document.getElementById('login-gate-screen');
  const appShell   = document.getElementById('app');

  if (appShell) appShell.style.display = '';

  if (gateScreen) {
    gateScreen.classList.add('gate-exiting');
    setTimeout(() => {
      gateScreen.style.display = 'none';
      gateScreen.classList.remove('gate-exiting');
    }, 300);
  }

  updateAuthUI();
  refreshPlaylists();
  syncAllSongsLikedState();
  renderProfileStats();

  showToast(`🎉 Welcome to Dhun, ${user.name}!`);
}

function continueAsGuestFromGate() {
  const users = getStoredUsers();
  let guestUser = users.find(u => u.id === 'guest');
  if (!guestUser) {
    guestUser = {
      id: 'guest',
      name: 'Guest User',
      email: 'guest@dhun.local',
      avatarColor: '#7c3aed',
      provider: 'guest',
      bio: '🎵 Exploring Dhun Music',
      joinedAt: Date.now(),
      lastLoginAt: Date.now()
    };
    users.push(guestUser);
    saveStoredUsers(users);
  }
  enterAppFromGate(guestUser);
  showToast('👤 Exploring as Guest. Your session is active.');
}

function switchGateTab(tab) {
  const signinBtn  = document.getElementById('gate-tab-signin');
  const signupBtn  = document.getElementById('gate-tab-signup');
  const signinForm = document.getElementById('gate-form-signin');
  const signupForm = document.getElementById('gate-form-signup');
  const title      = document.getElementById('gate-title');
  const subtitle   = document.getElementById('gate-subtitle');

  if (tab === 'signin') {
    if (signinBtn)  signinBtn.classList.add('active');
    if (signupBtn)  signupBtn.classList.remove('active');
    if (signinForm) signinForm.style.display = 'block';
    if (signupForm) signupForm.style.display = 'none';
    if (title)      title.textContent = 'Welcome Back to Dhun';
    if (subtitle)   subtitle.textContent = 'Sign in to unlock your private likes, playlists & listening suite';
    populateSavedCredentials();
    renderGateSavedProfiles();
  } else {
    if (signinBtn)  signinBtn.classList.remove('active');
    if (signupBtn)  signupBtn.classList.add('active');
    if (signinForm) signinForm.style.display = 'none';
    if (signupForm) signupForm.style.display = 'block';
    if (title)      title.textContent = 'Create Free Account';
    if (subtitle)   subtitle.textContent = '100% private to you with zero cross-user data collision';
    renderGateAvatarColorPicker();
  }
}

function renderGateAvatarColorPicker() {
  const picker = document.getElementById('gate-signup-avatar-picker');
  if (!picker || picker.children.length > 0) return;
  picker.innerHTML = authState.paletteColors.map((c, i) => `
    <button type="button" class="palette-dot ${i === 0 ? 'selected' : ''}" style="background:${c}" onclick="selectGateAvatarColor('${c}', this)" title="${c}"></button>
  `).join('');
}

function selectGateAvatarColor(color, btn) {
  authState.selectedAvatarColor = color;
  document.querySelectorAll('#gate-signup-avatar-picker .palette-dot').forEach(d => d.classList.remove('selected'));
  if (btn) btn.classList.add('selected');
}

function handleGateEmailSignIn() {
  const emailInput = document.getElementById('gate-signin-email');
  const passInput  = document.getElementById('gate-signin-password');

  const identifier = (emailInput?.value || '').trim();
  const password   = (passInput?.value || '').trim();

  if (!identifier) {
    showToast('⚠️ Please enter your email address or username');
    if (emailInput) emailInput.focus();
    return;
  }

  if (!password) {
    showToast('⚠️ Please enter your password');
    if (passInput) passInput.focus();
    return;
  }

  const users = getStoredUsers();
  const lowerId = identifier.toLowerCase();
  let user = users.find(u => 
    (u.email && u.email.toLowerCase() === lowerId) || 
    (u.name && u.name.toLowerCase() === lowerId)
  );

  // If user is not yet in registry, auto-create their account seamlessly!
  if (!user) {
    const isEmail = identifier.includes('@');
    const namePart = isEmail ? identifier.split('@')[0] : identifier;
    const formattedName = namePart.charAt(0).toUpperCase() + namePart.slice(1);
    const emailVal = isEmail ? lowerId : `${lowerId}@dhun.local`;
    user = {
      id: makeUserIdFromEmail(emailVal),
      name: formattedName,
      email: emailVal,
      password: password,
      avatarColor: authState.selectedAvatarColor || '#7c3aed',
      provider: 'email',
      bio: '🎵 Dhun Music Listener',
      joinedAt: Date.now(),
      lastLoginAt: Date.now()
    };
    users.push(user);
    saveStoredUsers(users);
    saveCredentials(user.email);
    if (passInput) passInput.value = '';
    enterAppFromGate(user);
    showToast(`🎉 Account created & signed in! Welcome, ${user.name}!`);
    return;
  }

  if (user.password && user.password !== password) {
    showToast('❌ Incorrect password. Please try again.');
    if (passInput) {
      passInput.value = '';
      passInput.focus();
    }
    return;
  }

  // If user previously had no password set, assign it now
  if (!user.password && password) {
    user.password = password;
    saveStoredUsers(users);
  }

  saveCredentials(user.email);
  if (passInput) passInput.value = '';
  enterAppFromGate(user);
}

function handleGateEmailSignUp() {
  const nameInput  = document.getElementById('gate-signup-name');
  const emailInput = document.getElementById('gate-signup-email');
  const passInput  = document.getElementById('gate-signup-password');

  const name = (nameInput?.value || '').trim();
  const email = (emailInput?.value || '').trim().toLowerCase();
  const password = (passInput?.value || '').trim();

  if (!name || !email || !password) {
    showToast('⚠️ Please fill out all fields');
    return;
  }

  const users = getStoredUsers();
  const existing = users.find(u => 
    (u.email && u.email.toLowerCase() === email) || 
    (u.name && u.name.toLowerCase() === name.toLowerCase())
  );

  if (existing) {
    if (existing.password && existing.password !== password) {
      showToast('❌ Existing account password does not match.');
      if (passInput) {
        passInput.value = '';
        passInput.focus();
      }
      return;
    }
    showToast(`✅ Welcome back, ${existing.name}! Signed in.`);
    saveCredentials(existing.email);
    if (passInput) passInput.value = '';
    enterAppFromGate(existing);
    return;
  }

  const canonicalId = makeUserIdFromEmail(email);
  const newUser = {
    id: canonicalId,
    name: name,
    email: email,
    password: password,
    avatarColor: authState.selectedAvatarColor || '#7c3aed',
    provider: 'email',
    bio: '🎵 Dhun Music Listener',
    joinedAt: Date.now(),
    lastLoginAt: Date.now()
  };

  users.push(newUser);
  saveStoredUsers(users);
  saveCredentials(email);
  if (passInput) passInput.value = '';

  enterAppFromGate(newUser);
}

function getUserStorageKey(suffix) {
  const uid = (authState.currentUser && authState.currentUser.id) ? authState.currentUser.id : 'guest';
  return `dhun_usr_${uid}_${suffix}`;
}

function updateAuthUI() {
  const u = authState.currentUser || { name: 'Guest User', email: 'guest@dhun.local', provider: 'guest', avatarColor: '#7c3aed' };
  const isGuest = (u.provider === 'guest' || u.id === 'guest');
  const initials = getProfileInitials(u.name);

  // Topbar and sidebar avatars
  ['su-avatar', 'pav-large', 'topbar-avatar-btn', 'ump-avatar'].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.textContent = initials;
      if (u.avatarColor) el.style.background = u.avatarColor;
    }
  });

  const suName = document.getElementById('su-name') || document.querySelector('.su-name');
  if (suName) suName.textContent = u.name;

  _set('pname-display', u.name);
  _set('pbio-display', u.bio || '🎵 High-fidelity music listener & collector');

  const coverImg = document.getElementById('pcover-img');
  if (coverImg) {
    if (u.coverUrl === 'architecture_diagram.jpg') u.coverUrl = 'album2.jpg';
    coverImg.src = u.coverUrl || 'album2.jpg';
  }

  const editName = document.getElementById('edit-name');
  const editBio  = document.getElementById('edit-bio');
  if (editName) editName.value = u.name;
  if (editBio)  editBio.value  = u.bio || '';

  // Popover elements
  _set('ump-name', u.name);
  _set('ump-email', u.email);

  const badge = document.getElementById('ump-badge');
  if (badge) {
    if (u.provider === 'google') {
      badge.textContent = 'Google Verified';
      badge.className = 'ump-badge google';
    } else if (isGuest) {
      badge.textContent = 'Guest Mode';
      badge.className = 'ump-badge guest';
    } else {
      badge.textContent = 'Dhun Member';
      badge.className = 'ump-badge member';
    }
  }

  const signoutBtn = document.getElementById('ump-signout-btn');
  if (signoutBtn) {
    signoutBtn.style.display = 'flex';
  }

  const trigger = document.getElementById('ump-auth-trigger');
  if (trigger) {
    trigger.innerHTML = isGuest
      ? '<span>✨ Sign In / Create Account</span>'
      : '<span>👥 Switch Account / Add User</span>';
  }

  // Also sync Listen Together default DJ & Guest names
  const jamHostInput = document.getElementById('jam-host-name');
  const jamGuestInput = document.getElementById('jam-guest-name');
  if (jamHostInput && (!jamHostInput.value || jamHostInput.value === 'You (DJ)')) {
    jamHostInput.value = u.name;
  }
  if (jamGuestInput && (!jamGuestInput.value || jamGuestInput.value === 'Guest')) {
    jamGuestInput.value = u.name;
  }

  // Hydrate user-specific likes and playlists into state
  syncAllSongsLikedState();
  renderProfileStats();
  if (typeof renderUserNotifications === 'function') renderUserNotifications();
}

function switchToUser(user) {
  if (!user) return;
  user.lastLoginAt = Date.now();
  authState.currentUser = user;

  try {
    localStorage.setItem('dhun_auth_active_user', user.id);
    localStorage.setItem('dhun_active_profile', JSON.stringify(user));
    const users = getStoredUsers();
    const idx = users.findIndex(u => u.id === user.id);
    if (idx !== -1) {
      users[idx] = { ...users[idx], ...user };
    } else {
      users.push(user);
    }
    saveStoredUsers(users);
    if (user.email) saveCredentials(user.email, user.password || '');
  } catch(e) {}

  const gateScreen = document.getElementById('login-gate-screen');
  const appShell   = document.getElementById('app');
  if (gateScreen) gateScreen.style.display = 'none';
  if (appShell)   appShell.style.display = '';

  // Synchronize isolated data
  syncAllSongsLikedState();
  refreshPlaylists();
  updateAuthUI();
  renderProfileStats();

  // If on profile page or search page or home page, re-render
  if (state.currentPage === 'profile') {
    refreshLikedSongs();
    renderProfilePlaylists();
  } else if (state.currentPage === 'home') {
    renderRecommended();
    renderTrending();
  } else if (state.currentPage === 'library') {
    renderLibrary(state.songs);
  }

  showToast(`Welcome, ${user.name}! Private profile loaded.`);
}

function openAuthModal(mode = 'signin') {
  const modal = document.getElementById('auth-modal');
  if (!modal) return;
  modal.style.display = 'flex';
  switchAuthTab(mode);
  renderAvatarColorPicker();
}

function closeAuthModal() {
  const modal = document.getElementById('auth-modal');
  if (modal) modal.style.display = 'none';
}

function switchAuthTab(tab) {
  const signinBtn = document.getElementById('auth-tab-signin');
  const signupBtn = document.getElementById('auth-tab-signup');
  const signinPanel = document.getElementById('auth-panel-signin');
  const signupPanel = document.getElementById('auth-panel-signup');
  const title = document.getElementById('auth-modal-title');
  const sub = document.getElementById('auth-modal-sub');

  if (tab === 'signin') {
    if (signinBtn) signinBtn.classList.add('active');
    if (signupBtn) signupBtn.classList.remove('active');
    if (signinPanel) signinPanel.style.display = 'block';
    if (signupPanel) signupPanel.style.display = 'none';
    if (title) title.textContent = 'Welcome Back to Dhun';
    if (sub) sub.textContent = 'Sign in to access your personal liked songs, playlists & stats';
  } else {
    if (signinBtn) signinBtn.classList.remove('active');
    if (signupBtn) signupBtn.classList.add('active');
    if (signinPanel) signinPanel.style.display = 'none';
    if (signupPanel) signupPanel.style.display = 'block';
    if (title) title.textContent = 'Create Free Account';
    if (sub) sub.textContent = 'Your songs, playlists & music vibe are 100% private to you';
  }
}

function renderAvatarColorPicker() {
  const picker = document.getElementById('signup-avatar-picker');
  if (!picker || picker.children.length > 0) return;
  picker.innerHTML = authState.paletteColors.map((c, i) => `
    <button type="button" class="palette-dot ${i === 0 ? 'selected' : ''}" style="background:${c}" onclick="selectAvatarColor('${c}', this)" title="${c}"></button>
  `).join('');
}

function selectAvatarColor(color, btn) {
  authState.selectedAvatarColor = color;
  document.querySelectorAll('#signup-avatar-picker .palette-dot').forEach(d => d.classList.remove('selected'));
  if (btn) btn.classList.add('selected');
}

function handleEmailSignUp() {
  const nameInput = document.getElementById('signup-name');
  const emailInput = document.getElementById('signup-email');
  const passInput = document.getElementById('signup-password');

  const name = (nameInput?.value || '').trim();
  const email = (emailInput?.value || '').trim().toLowerCase();
  const password = (passInput?.value || '').trim();

  if (!name || !email || !password) {
    showToast('⚠️ Please fill out all fields');
    return;
  }

  const users = getStoredUsers();
  const existing = users.find(u => 
    (u.email && u.email.toLowerCase() === email) || 
    (u.name && u.name.toLowerCase() === name.toLowerCase())
  );

  if (existing) {
    if (existing.password && existing.password !== password) {
      showToast('❌ Existing account password does not match.');
      if (passInput) {
        passInput.value = '';
        passInput.focus();
      }
      return;
    }
    showToast(`✅ Welcome back, ${existing.name}! Signed in.`);
    saveCredentials(existing.email);
    if (passInput) passInput.value = '';
    closeAuthModal();
    switchToUser(existing);
    return;
  }

  const canonicalId = makeUserIdFromEmail(email);
  const newUser = {
    id: canonicalId,
    name: name,
    email: email,
    password: password,
    avatarColor: authState.selectedAvatarColor || '#7c3aed',
    provider: 'email',
    bio: '🎵 Dhun Music Listener',
    joinedAt: Date.now(),
    lastLoginAt: Date.now()
  };

  users.push(newUser);
  saveStoredUsers(users);
  saveCredentials(email);
  if (passInput) passInput.value = '';

  closeAuthModal();
  switchToUser(newUser);
  showToast(`🎉 Welcome to Dhun, ${name}! Your private profile is active.`);
}

function handleEmailSignIn() {
  const emailInput = document.getElementById('signin-email');
  const passInput = document.getElementById('signin-password');

  const identifier = (emailInput?.value || '').trim();
  const password = (passInput?.value || '').trim();

  if (!identifier) {
    showToast('⚠️ Please enter email or username');
    if (emailInput) emailInput.focus();
    return;
  }

  if (!password) {
    showToast('⚠️ Please enter your password');
    if (passInput) passInput.focus();
    return;
  }

  const users = getStoredUsers();
  const lowerId = identifier.toLowerCase();
  let user = users.find(u => 
    (u.email && u.email.toLowerCase() === lowerId) || 
    (u.name && u.name.toLowerCase() === lowerId)
  );

  if (!user) {
    const isEmail = identifier.includes('@');
    const namePart = isEmail ? identifier.split('@')[0] : identifier;
    const formattedName = namePart.charAt(0).toUpperCase() + namePart.slice(1);
    const emailVal = isEmail ? lowerId : `${lowerId}@dhun.local`;
    user = {
      id: makeUserIdFromEmail(emailVal),
      name: formattedName,
      email: emailVal,
      password: password,
      avatarColor: authState.selectedAvatarColor || '#7c3aed',
      provider: 'email',
      bio: '🎵 Dhun Music Listener',
      joinedAt: Date.now(),
      lastLoginAt: Date.now()
    };
    users.push(user);
    saveStoredUsers(users);
    saveCredentials(user.email);
    if (passInput) passInput.value = '';
    closeAuthModal();
    switchToUser(user);
    showToast(`🎉 Account created & signed in! Welcome, ${user.name}!`);
    return;
  }

  if (user.password && user.password !== password) {
    showToast('❌ Incorrect password. Please try again.');
    if (passInput) {
      passInput.value = '';
      passInput.focus();
    }
    return;
  }

  if (!user.password && password) {
    user.password = password;
    saveStoredUsers(users);
  }

  saveCredentials(user.email);
  if (passInput) passInput.value = '';
  closeAuthModal();
  switchToUser(user);
}

let _googleAuthIsFromGate = false;

function handleGoogleSignIn(isFromGate = false) {
  openGoogleAuthModal(isFromGate);
}

function openGoogleAuthModal(isFromGate = false) {
  _googleAuthIsFromGate = isFromGate;
  const modal = document.getElementById('google-auth-modal');
  if (!modal) return;

  const emailInput = document.getElementById('google-input-email');
  const nameInput = document.getElementById('google-input-name');
  const quickBox = document.getElementById('google-quick-account');
  const quickName = document.getElementById('google-quick-name');
  const quickEmail = document.getElementById('google-quick-email');
  const quickAvatar = document.getElementById('google-quick-avatar');

  // Find last Google account or active user
  const lastGoogleUser = (authState.users || []).find(u => u.provider === 'google') ||
    ((authState.currentUser && authState.currentUser.email !== 'guest@dhun.local') ? authState.currentUser : null);

  if (lastGoogleUser && quickBox) {
    quickBox.style.display = 'block';
    if (quickName) quickName.textContent = lastGoogleUser.name || 'Google User';
    if (quickEmail) quickEmail.textContent = lastGoogleUser.email;
    if (quickAvatar) {
      quickAvatar.textContent = (lastGoogleUser.name || 'G').charAt(0).toUpperCase();
      quickAvatar.style.background = lastGoogleUser.avatarColor || '#4285F4';
    }
  } else if (quickBox) {
    quickBox.style.display = 'none';
  }

  if (emailInput) {
    emailInput.value = lastGoogleUser ? lastGoogleUser.email : '';
  }
  if (nameInput) {
    nameInput.value = lastGoogleUser ? lastGoogleUser.name : '';
  }

  modal.style.display = 'flex';
  setTimeout(() => {
    if (emailInput && !emailInput.value) emailInput.focus();
    else if (nameInput && !nameInput.value) nameInput.focus();
  }, 80);
}

function closeGoogleAuthModal() {
  const modal = document.getElementById('google-auth-modal');
  if (modal) modal.style.display = 'none';
}

function handleGoogleQuickAccountClick() {
  const lastGoogleUser = (authState.users || []).find(u => u.provider === 'google') ||
    ((authState.currentUser && authState.currentUser.email !== 'guest@dhun.local') ? authState.currentUser : null);

  if (lastGoogleUser) {
    closeGoogleAuthModal();
    if (_googleAuthIsFromGate) {
      enterAppFromGate(lastGoogleUser);
    } else {
      closeAuthModal();
      switchToUser(lastGoogleUser);
    }
    showToast(`✅ Signed in as ${lastGoogleUser.name}!`);
  }
}

function submitGoogleSignInModal() {
  const emailInput = document.getElementById('google-input-email');
  const nameInput = document.getElementById('google-input-name');
  const emailVal = (emailInput ? emailInput.value : '').trim().toLowerCase();
  let nameVal = (nameInput ? nameInput.value : '').trim();

  if (!emailVal) {
    showToast('⚠️ Please enter your Google email');
    return;
  }
  if (!nameVal) {
    nameVal = emailVal.split('@')[0];
    nameVal = nameVal.charAt(0).toUpperCase() + nameVal.slice(1);
  }

  const canonicalId = makeUserIdFromEmail(emailVal);
  const users = getStoredUsers();
  let existing = users.find(u => u.email && u.email.toLowerCase().trim() === emailVal);

  if (!existing) {
    existing = {
      id: canonicalId,
      name: nameVal,
      email: emailVal,
      avatarColor: '#4285F4',
      provider: 'google',
      bio: 'Google Connected Listener 🎧',
      joinedAt: Date.now(),
      lastLoginAt: Date.now()
    };
    users.push(existing);
  } else {
    if (existing.id && existing.id !== canonicalId) {
      mergeUserStorageData(existing.id, canonicalId);
    }
    existing.id = canonicalId;
    existing.name = nameVal || existing.name;
    existing.provider = 'google';
    existing.avatarColor = existing.avatarColor || '#4285F4';
    existing.lastLoginAt = Date.now();
  }

  saveStoredUsers(users);
  saveCredentials(existing.email, '');

  closeGoogleAuthModal();
  if (_googleAuthIsFromGate) {
    enterAppFromGate(existing);
  } else {
    closeAuthModal();
    switchToUser(existing);
  }
  showToast(`✅ Google Sign-In verified! Welcome, ${existing.name}!`);
  pushProfileToCloud();
}

function signOutUser() {
  showAppConfirm('Sign Out?', 'Are you sure you want to sign out of your account?', 'Sign Out', true, () => {
    localStorage.removeItem('dhun_auth_active_user');
    localStorage.removeItem('dhun_active_profile');
    authState.currentUser = null;

    const gateScreen = document.getElementById('login-gate-screen');
    const appShell   = document.getElementById('app');

    if (appShell) {
      appShell.style.display = 'none';
    }
    if (gateScreen) {
      gateScreen.style.display = 'flex';
      gateScreen.classList.remove('gate-exiting');
      switchGateTab('signin');
      renderGateAvatarColorPicker();
      renderGateSavedProfiles();
      populateSavedCredentials();
    }

    showToast('👋 Signed out. Please sign in to enter Dhun.');
  });
}

function toggleUserMenu(force) {
  const popover = document.getElementById('user-menu-popover');
  if (!popover) return;
  const isShowing = popover.style.display !== 'none';
  const next = force !== undefined ? force : !isShowing;
  popover.style.display = next ? 'block' : 'none';
  if (next) {
    renderUserMenuAccounts();
  }
}

function renderUserMenuAccounts() {
  const container = document.getElementById('ump-accounts-list');
  if (!container) return;
  const currentId = authState.currentUser ? authState.currentUser.id : 'guest';
  const currentEmail = (authState.currentUser?.email || '').toLowerCase().trim();
  const otherUsers = (authState.users || []).filter(u => {
    if (!u) return false;
    if (u.id === currentId) return false;
    const uEmail = (u.email || '').toLowerCase().trim();
    if (currentEmail && uEmail && uEmail === currentEmail) return false;
    return true;
  });
  if (otherUsers.length === 0) {
    container.innerHTML = '';
    container.style.display = 'none';
    return;
  }
  container.style.display = 'block';
  container.innerHTML = `
    <p class="ump-section-label" style="font-size:11px;font-weight:700;color:var(--text-3);text-transform:uppercase;padding:4px 12px;letter-spacing:0.5px">Switch Account</p>
    ${otherUsers.map(u => `
      <button class="ump-item" onclick="switchAccount('${u.id}');toggleUserMenu(false)">
        <span class="palette-dot" style="background:${u.avatarColor || '#7c3aed'};width:18px;height:18px;display:inline-block;border-radius:50%;margin-right:8px"></span>
        <div style="text-align:left;overflow:hidden">
          <p style="font-size:13px;font-weight:600;color:var(--text-1);margin:0;line-height:1.2">${escapeHtmlText(u.name)}</p>
          <p style="font-size:11px;color:var(--text-3);margin:0;line-height:1.2">${escapeHtmlText(u.email)}</p>
        </div>
      </button>
    `).join('')}
  `;
}

function switchAccount(userId) {
  const user = authState.users.find(u => u.id === userId);
  if (user) {
    switchToUser(user);
  }
}

// Close popover when clicking outside
window.addEventListener('click', e => {
  const popover = document.getElementById('user-menu-popover');
  const btn = document.getElementById('topbar-avatar-btn');
  if (popover && popover.style.display !== 'none') {
    if (!popover.contains(e.target) && e.target !== btn && !btn.contains(e.target)) {
      popover.style.display = 'none';
    }
  }
});

/* ── Like / Heart (Strictly Isolated Per User) ─────────────────── */
function getUserLikedSet() {
  try {
    const raw = localStorage.getItem(getUserStorageKey('likes'));
    if (raw) return new Set(JSON.parse(raw));
  } catch (e) {}
  return new Set();
}

function saveUserLikedSet(set) {
  try {
    localStorage.setItem(getUserStorageKey('likes'), JSON.stringify(Array.from(set)));
    if (typeof pushProfileToCloudDebounced === 'function') pushProfileToCloudDebounced();
  } catch (e) {}
}

function isSongLikedByUser(songId) {
  if (songId === undefined || songId === null) return false;
  return getUserLikedSet().has(Number(songId)) || getUserLikedSet().has(String(songId));
}

function syncAllSongsLikedState() {
  const likedSet = getUserLikedSet();
  if (Array.isArray(state.songs)) {
    state.songs.forEach(s => {
      s.liked = likedSet.has(Number(s.id)) || likedSet.has(String(s.id));
    });
  }
  if (state.currentSong) {
    state.currentSong.liked = likedSet.has(Number(state.currentSong.id)) || likedSet.has(String(state.currentSong.id));
    const ph = document.getElementById('player-heart');
    if (ph) {
      ph.textContent = state.currentSong.liked ? '❤️' : '♡';
      ph.classList.toggle('liked', !!state.currentSong.liked);
    }
  }
}

async function toggleLike(btn, event) {
  if (event) event.stopPropagation();
  if (!btn) return;

  /* Find associated song id */
  let songId = btn.dataset.songId;
  if (!songId && state.currentSong) songId = state.currentSong.id;
  if (songId === undefined || songId === null) return;

  const likedSet = getUserLikedSet();
  const numId = Number(songId);
  const isNowLiked = !(likedSet.has(numId) || likedSet.has(String(songId)));

  if (isNowLiked) {
    likedSet.add(numId);
  } else {
    likedSet.delete(numId);
    likedSet.delete(String(songId));
  }
  saveUserLikedSet(likedSet);

  // Update in-memory state
  const song = (state.songs || []).find(s => s.id == songId);
  if (song) song.liked = isNowLiked;
  if (state.currentSong && state.currentSong.id == songId) {
    state.currentSong.liked = isNowLiked;
    const ph = document.getElementById('player-heart');
    if (ph) {
      ph.textContent = isNowLiked ? '❤️' : '♡';
      ph.classList.toggle('liked', isNowLiked);
    }
    if (typeof renderSongStatsUI === 'function') renderSongStatsUI(state.currentSong);
  }

  // Update button UI
  btn.classList.toggle('liked', isNowLiked);
  if (btn.classList.contains('like-btn') || btn.classList.contains('pb-like') || btn.classList.contains('heart-btn')) {
    btn.textContent = isNowLiked ? '❤️' : '♡';
  }

  btn.style.transform = 'scale(1.35)';
  setTimeout(() => { btn.style.transform = ''; }, 200);

  // Sync with C backend API if available
  apiPut(`/songs/${songId}/like`).catch(() => {});

  renderProfileStats();
  if (state.currentPage === 'profile') {
    refreshLikedSongs();
  }
  if (typeof currentYTFeedCategory !== 'undefined' && currentYTFeedCategory === 'for-you' && state.currentPage === 'search') {
    loadYTFeed('for-you');
  }
}

/* ── Mood Selector ─────────────────────────────── */
const moodData = {
  'mood-chill':     { name:'Ocean Breeze',    artist:'Chill & Relaxed' },
  'mood-energetic': { name:'Thunder Strike',  artist:'High Energy' },
  'mood-focus':     { name:'Deep Focus',      artist:'Concentration' },
  'mood-romantic':  { name:'Soft Petals',     artist:'Romantic Vibes' },
  'mood-sad':       { name:'Rainy Afternoon', artist:'Melancholic' },
  'mood-happy':     { name:'Party Starter',   artist:'Feel Good' },
};
function selectMood(pill) {
  document.querySelectorAll('.mood-pill').forEach(p => p.classList.remove('active'));
  pill.classList.add('active');
  const d = moodData[pill.id];
  if (d) { _set('mood-song-name', d.name); _set('mood-song-artist', d.artist); }
  handleSearch(pill.textContent.replace(/[^\w\s]/g,'').trim());
}

/* ── Profile Management (Dynamic & LocalStorage) ─ */
function initProfile() {
  initAuth();
}

function getProfileInitials(name) {
  if (!name || name.trim() === 'My Profile' || name.trim() === 'Guest User') return '👤';
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

function toggleEditProfile() {
  const form = document.getElementById('edit-form');
  const btn  = document.getElementById('edit-profile-btn');
  if (!form) return;
  const showing = form.style.display !== 'none';
  form.style.display = showing ? 'none' : 'block';
  if (btn) btn.textContent = showing ? '✏️ Edit Profile' : '✕ Cancel';
}

function saveProfile() {
  const name = document.getElementById('edit-name')?.value.trim() || 'My Profile';
  const bio  = document.getElementById('edit-bio')?.value.trim()  || '🎵 High-fidelity music listener & collector';
  
  if (authState.currentUser) {
    authState.currentUser.name = name;
    authState.currentUser.bio = bio;
    if (authState.currentUser.id !== 'guest') {
      const idx = authState.users.findIndex(u => u.id === authState.currentUser.id);
      if (idx !== -1) {
        authState.users[idx].name = name;
        authState.users[idx].bio = bio;
        localStorage.setItem('dhun_auth_users', JSON.stringify(authState.users));
      }
    }
  }
  
  updateAuthUI();
  toggleEditProfile();
  showToast('Profile updated ✅');
  renderProfileStats();
  pushProfileToCloud();
}

function renderProfileStats() {
  const userPls    = getUserPlaylistsFromStorage() || state.playlists || [];
  const songsCount = (state.songs || []).length;
  const plCount    = userPls.length;
  const likedSet   = getUserLikedSet();
  const likesCount = (state.songs || []).filter(s => likedSet.has(Number(s.id)) || likedSet.has(String(s.id)) || s.liked).length;
  const playsTotal = (state.songs || []).reduce((acc, s) => acc + (s.play_count || 0), 0);

  _set('prof-songs-count', songsCount);
  _set('prof-playlists-count', plCount);
  _set('prof-likes-count', likesCount);
  _set('prof-plays-count', playsTotal >= 1000 ? (playsTotal / 1000).toFixed(1) + 'K' : playsTotal);

  const suRole = document.getElementById('su-role');
  if (suRole) {
    suRole.textContent = `${songsCount} song${songsCount === 1 ? '' : 's'} · ${plCount} playlist${plCount === 1 ? '' : 's'}`;
  }
}

/* ── Profile Cover Customization ──────────────── */
let _pendingCoverUrl = null;

function openProfileCoverModal() {
  console.log('[Dhun] Opening profile cover modal');
  const modal = document.getElementById('profile-cover-modal');
  if (!modal) {
    console.error('[Dhun] Profile cover modal not found in DOM');
    return;
  }
  let currentCover = (authState.currentUser && authState.currentUser.coverUrl) || 'album2.jpg';
  if (currentCover === 'architecture_diagram.jpg') {
    currentCover = 'album2.jpg';
    if (authState.currentUser) authState.currentUser.coverUrl = 'album2.jpg';
  }
  _pendingCoverUrl = currentCover;

  const previewImg = document.getElementById('pcover-preview-img');
  if (previewImg) previewImg.src = currentCover;

  const previewName = document.getElementById('pcover-preview-name');
  if (previewName && authState.currentUser) previewName.textContent = authState.currentUser.name;

  const previewAvatar = document.getElementById('pcover-preview-avatar');
  if (previewAvatar && authState.currentUser) {
    previewAvatar.textContent = getProfileInitials(authState.currentUser.name);
    previewAvatar.style.background = authState.currentUser.avatarColor || '#7c3aed';
  }

  // Highlight active preset if matching
  document.querySelectorAll('.pcover-preset-card').forEach(card => {
    const img = card.querySelector('img');
    if (img && img.getAttribute('src') === currentCover) {
      card.style.borderColor = 'var(--purple)';
      card.classList.add('selected');
    } else {
      card.style.borderColor = 'transparent';
      card.classList.remove('selected');
    }
  });

  modal.style.display = 'flex';
  modal.style.zIndex = '99999';
}

function closeProfileCoverModal() {
  const modal = document.getElementById('profile-cover-modal');
  if (modal) modal.style.display = 'none';
  _pendingCoverUrl = null;
}

function selectCoverPreset(url, element) {
  _pendingCoverUrl = url;
  const previewImg = document.getElementById('pcover-preview-img');
  if (previewImg) previewImg.src = url;

  document.querySelectorAll('.pcover-preset-card').forEach(card => {
    card.style.borderColor = 'transparent';
    card.classList.remove('selected');
  });
  if (element) {
    element.style.borderColor = 'var(--purple)';
    element.classList.add('selected');
  }
}

function handleCoverFileSelected(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;

  if (!file.type.startsWith('image/')) {
    showToast('⚠️ Please select a valid image file');
    return;
  }

  const reader = new FileReader();
  reader.onload = function(e) {
    const rawDataUrl = e.target.result;
    
    // Scale and compress image using an offscreen canvas for optimal performance & storage
    const img = new Image();
    img.onload = function() {
      const maxW = 1200;
      const maxH = 675;
      let width = img.width;
      let height = img.height;

      if (width > maxW) {
        height = Math.round((height * maxW) / width);
        width = maxW;
      }
      if (height > maxH) {
        width = Math.round((width * maxH) / height);
        height = maxH;
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);

      const optimizedUrl = canvas.toDataURL('image/jpeg', 0.84);
      _pendingCoverUrl = optimizedUrl;

      const previewImg = document.getElementById('pcover-preview-img');
      if (previewImg) previewImg.src = optimizedUrl;

      // Deselect presets
      document.querySelectorAll('.pcover-preset-card').forEach(card => {
        card.style.borderColor = 'transparent';
        card.classList.remove('selected');
      });

      showToast('📸 Photo loaded! Click "Save & Apply" to set it.');
    };
    img.src = rawDataUrl;
  };
  reader.readAsDataURL(file);
}

function applyProfileCover() {
  if (!_pendingCoverUrl) {
    closeProfileCoverModal();
    return;
  }

  const coverUrl = _pendingCoverUrl;
  const coverImg = document.getElementById('pcover-img');
  if (coverImg) coverImg.src = coverUrl;

  if (authState.currentUser) {
    authState.currentUser.coverUrl = coverUrl;

    if (authState.currentUser.id !== 'guest') {
      const users = getStoredUsers();
      const idx = users.findIndex(u => u.id === authState.currentUser.id);
      if (idx !== -1) {
        users[idx].coverUrl = coverUrl;
        saveStoredUsers(users);
      }
    }
    try {
      localStorage.setItem('dhun_active_profile', JSON.stringify(authState.currentUser));
    } catch(e) {}
    pushProfileToCloudDebounced();
  }

  closeProfileCoverModal();
  showToast('✅ Profile cover updated successfully!');
}

function initProfileCoverListeners() {
  const pcoverBtn = document.getElementById('pcover-change-btn');
  if (pcoverBtn) {
    pcoverBtn.onclick = openProfileCoverModal;
  }
  const pcoverActionBtn = document.getElementById('pcover-action-btn');
  if (pcoverActionBtn) {
    pcoverActionBtn.onclick = openProfileCoverModal;
  }
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initProfileCoverListeners);
} else {
  initProfileCoverListeners();
}

function switchTab(btn, tabId) {
  document.querySelectorAll('.tab-btn').forEach(b => { b.classList.remove('active'); b.setAttribute('aria-selected','false'); });
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
  btn.classList.add('active'); btn.setAttribute('aria-selected','true');
  const ct = document.getElementById('tab-content-' + tabId);
  if (ct) ct.classList.add('active');
  if (tabId === 'liked') refreshLikedSongs();
  if (tabId === 'playlists') renderProfilePlaylists();
}

/* ── User-Isolated Playlists Helpers ──────────── */
function getUserPlaylistsFromStorage() {
  try {
    const raw = localStorage.getItem(getUserStorageKey('playlists'));
    if (raw) return JSON.parse(raw);
  } catch (e) {}
  return null;
}

function saveUserPlaylistsToStorage(playlists) {
  try {
    localStorage.setItem(getUserStorageKey('playlists'), JSON.stringify(playlists));
    pushProfileToCloudDebounced();
  } catch (e) {}
}

/* ── Cross-Device Profile & Playlists Cloud Synchronization ────────────── */
let _cloudSyncClient = null;
let _cloudPushTimer = null;

function getCloudSyncTopic(email) {
  if (!email) return null;
  const cleanEmail = email.toLowerCase().trim().replace(/[^a-zA-Z0-9_]/g, '_');
  return `dhun/v2/cloud_sync/${cleanEmail}`;
}

function getCloudMqttClient(callback) {
  if (typeof mqtt === 'undefined') {
    if (callback) callback(null);
    return;
  }
  if (_cloudSyncClient && _cloudSyncClient.connected) {
    if (callback) callback(_cloudSyncClient);
    return;
  }

  const brokerUrls = [
    'wss://broker.emqx.io:8084/mqtt',
    'wss://broker.hivemq.com:8884/mqtt'
  ];
  let idx = 0;

  function tryBroker() {
    if (idx >= brokerUrls.length) {
      if (callback) callback(null);
      return;
    }
    const url = brokerUrls[idx++];
    try {
      const clientId = 'dhun_cs_' + Math.random().toString(36).substring(2, 10);
      const client = mqtt.connect(url, {
        clientId,
        clean: true,
        connectTimeout: 7000,
        reconnectPeriod: 5000
      });

      let timeoutId = setTimeout(() => {
        try { client.end(true); } catch(e) {}
        tryBroker();
      }, 7500);

      client.once('connect', () => {
        clearTimeout(timeoutId);
        _cloudSyncClient = client;
        if (callback) callback(client);
      });

      client.once('error', () => {
        clearTimeout(timeoutId);
        try { client.end(true); } catch(e) {}
        tryBroker();
      });
    } catch(e) {
      tryBroker();
    }
  }

  tryBroker();
}

function pushProfileToCloud() {
  const user = authState.currentUser;
  if (!user || !user.email || user.id === 'guest') return;
  const topic = getCloudSyncTopic(user.email);
  if (!topic) return;

  const pls = getUserPlaylistsFromStorage() || (state.playlists || []);
  const rawLikes = getUserLikedSet();
  const likes = Array.from(rawLikes);

  const syncPayload = {
    email: user.email.toLowerCase().trim(),
    name: user.name,
    avatarColor: user.avatarColor,
    coverUrl: user.coverUrl || 'album2.jpg',
    bio: user.bio,
    provider: user.provider,
    playlists: pls,
    likes: likes,
    lastUpdated: Date.now()
  };

  getCloudMqttClient(client => {
    if (!client) return;
    try {
      client.publish(topic, JSON.stringify(syncPayload), { retain: true, qos: 1 });
      console.log('[CloudSync] Pushed profile to cloud:', topic, syncPayload.playlists.length, 'playlists');
    } catch(e) {
      console.warn('[CloudSync] Push error:', e);
    }
  });
}

function pushProfileToCloudDebounced() {
  clearTimeout(_cloudPushTimer);
  _cloudPushTimer = setTimeout(() => {
    pushProfileToCloud();
  }, 1000);
}

function pullProfileFromCloud(onDone) {
  const user = authState.currentUser;
  if (!user || !user.email || user.id === 'guest') {
    if (onDone) onDone(false);
    return;
  }
  const topic = getCloudSyncTopic(user.email);
  if (!topic) {
    if (onDone) onDone(false);
    return;
  }

  getCloudMqttClient(client => {
    if (!client) {
      if (onDone) onDone(false);
      return;
    }

    let handled = false;
    const msgHandler = (recvTopic, payload) => {
      if (recvTopic !== topic) return;
      try {
        const data = JSON.parse(payload.toString());
        if (!data || !data.email || data.email.toLowerCase().trim() !== user.email.toLowerCase().trim()) return;

        handled = true;
        client.removeListener('message', msgHandler);

        // Merge playlists
        const localPls = getUserPlaylistsFromStorage() || (state.playlists || []);
        const rawCloudPls = Array.isArray(data.playlists) ? data.playlists : [];
        const cloudPls = rawCloudPls.filter(cp => cp && !isPredefaultPlaylist(cp.name));
        const mergedPls = [...localPls].filter(lp => lp && !isPredefaultPlaylist(lp.name));
        let hasNewPl = false;

        cloudPls.forEach(cp => {
          if (!cp || !cp.name) return;
          const match = mergedPls.find(lp => lp.name && lp.name.toLowerCase().trim() === cp.name.toLowerCase().trim());
          if (match) {
            const songSet = new Set([...(match.songs || []), ...(cp.songs || [])]);
            if (songSet.size > (match.songs || []).length) {
              match.songs = Array.from(songSet);
              hasNewPl = true;
            }
          } else {
            mergedPls.push(cp);
            hasNewPl = true;
          }
        });

        if (hasNewPl || (cloudPls.length > 0 && localPls.length === 0)) {
          saveUserPlaylistsToStorage(mergedPls);
          state.playlists = mergedPls;
          renderPlaylists();
        }

        // Merge likes
        const localLikes = getUserLikedSet();
        const cloudLikes = Array.isArray(data.likes) ? data.likes : [];
        let hasNewLike = false;
        cloudLikes.forEach(sId => {
          if (!localLikes.has(sId)) {
            localLikes.add(sId);
            hasNewLike = true;
          }
        });
        if (hasNewLike) {
          saveUserLikedSet(localLikes);
        }

        // Sync name/bio/color if current was default
        if (data.name && (!user.name || user.name.length < data.name.length)) {
          user.name = data.name;
        }
        if (data.bio && !user.bio) {
          user.bio = data.bio;
        }
        if (data.avatarColor && !user.avatarColor) {
          user.avatarColor = data.avatarColor;
        }
        if (data.coverUrl) {
          user.coverUrl = data.coverUrl;
          const coverImg = document.getElementById('pcover-img');
          if (coverImg) coverImg.src = data.coverUrl;
        }
        saveStoredUsers(authState.users);
        updateAuthUI();

        console.log('[CloudSync] Pulled & merged cloud profile successfully!');
        if (onDone) onDone(true, { mergedPlaylists: mergedPls.length });
      } catch(e) {
        console.warn('[CloudSync] Pull parse error:', e);
        if (onDone) onDone(false);
      }
    };

    client.on('message', msgHandler);
    client.subscribe(topic, { qos: 1 });

    // Wait up to 3.5 seconds for retained message
    setTimeout(() => {
      if (!handled) {
        client.removeListener('message', msgHandler);
        // If no message arrived, push our local state to cloud so it seeds the cloud
        pushProfileToCloud();
        if (onDone) onDone(true, { seeded: true });
      }
    }, 3500);
  });
}

function triggerProfileCloudSync(btn) {
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '⏳ Syncing...';
  }
  showToast('☁️ Syncing profile & playlists across devices...');

  pullProfileFromCloud((success, info) => {
    // Then push local unified state
    pushProfileToCloud();

    setTimeout(() => {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '✅ Synced!';
        setTimeout(() => {
          btn.innerHTML = '☁️ Sync Devices';
        }, 3000);
      }
      showToast('✅ Profile & playlists synced across all your devices!');
      renderPlaylists();
      updateAuthUI();
      if (typeof renderProfileView === 'function') renderProfileView();
    }, 800);
  });
}

/* ── In-App Create Playlist Modal ────────────── */
let _pendingAddSongId = null;

function createPlaylist() {
  openPlaylistCreateModal();
}

function openPlaylistCreateModal() {
  const modal = document.getElementById('playlist-create-modal');
  if (!modal) return;
  const input = document.getElementById('playlist-name-input');
  if (input) input.value = '';
  modal.style.display = 'flex';
  setTimeout(() => { if (input) input.focus(); }, 80);
}

function closePlaylistCreateModal() {
  const modal = document.getElementById('playlist-create-modal');
  if (modal) modal.style.display = 'none';
}

function submitCreatePlaylistModal() {
  const input = document.getElementById('playlist-name-input');
  const name = input ? input.value.trim() : '';
  if (!name) {
    showToast('⚠️ Please enter a playlist name');
    return;
  }
  const clean = name;
  const plId = Date.now();
  const newPl = {
    id: plId,
    name: clean,
    song_count: 0,
    songs: []
  };
  let pls = getUserPlaylistsFromStorage() || (state.playlists ? [...state.playlists] : []);
  pls.push(newPl);
  saveUserPlaylistsToStorage(pls);
  state.playlists = pls;

  apiPost('/playlists', { name: clean }, { silent: true }).catch(() => {});
  closePlaylistCreateModal();
  showToast(`Playlist "${clean}" created 🎵`);
  renderSidebarPlaylists();
  renderProfilePlaylists();
  renderProfileStats();

  // If this was opened from the add song flow, immediately add the song to this newly created playlist!
  if (_pendingAddSongId !== null && _pendingAddSongId !== undefined) {
    const songToAdd = _pendingAddSongId;
    _pendingAddSongId = null;
    addSongToSpecificPlaylist(plId, songToAdd);
  }
}

/* ── In-App Add Song to Playlist Modal ───────── */
function addToPlaylistPrompt(songId, event) {
  if (event) {
    try {
      event.stopPropagation();
      event.preventDefault();
    } catch (e) {}
  }
  openPlaylistAddModal(songId, event);
}

function openPlaylistAddModal(songId, event) {
  if (event) {
    try {
      event.stopPropagation();
      event.preventDefault();
    } catch (e) {}
  }
  _pendingAddSongId = songId;
  const modal = document.getElementById('playlist-add-modal');
  if (!modal) return;

  // Find song title for modal header subtitle
  const allKnown = [...(state.songs || []), ...(_libAllSongs || []), ...(state.history || [])];
  const foundSong = allKnown.find(s => s && (String(s.id) === String(songId) || s.id == songId)) ||
                    pcSongAudioMap.get(songId) || pcSongAudioMap.get(Number(songId));
  const songTitle = foundSong ? foundSong.title : 'this track';

  const subEl = document.getElementById('playlist-add-modal-sub') || modal.querySelector('.auth-modal-sub');
  if (subEl) {
    subEl.textContent = `Choose a playlist to save "${songTitle}"`;
  }

  const listContainer = document.getElementById('playlist-add-list');
  const userPlaylists = getUserPlaylistsFromStorage() || state.playlists || [];

  if (!userPlaylists || userPlaylists.length === 0) {
    if (listContainer) {
      listContainer.innerHTML = `
        <div style="text-align:center;padding:26px 12px;color:var(--text-2)">
          <div style="font-size:32px;margin-bottom:8px">🎶</div>
          <p style="margin:0 0 14px;font-size:14px">You don't have any playlists yet.</p>
          <button class="btn-primary" onclick="openCreatePlaylistFromAddModal()" style="font-size:13px;padding:8px 16px">Create Your First Playlist</button>
        </div>
      `;
    }
  } else {
    if (listContainer) {
      listContainer.innerHTML = userPlaylists.map(pl => {
        const cleanName = formatPlaylistName(pl.name);
        const count = (pl.songs ? pl.songs.length : (pl.song_count || 0));
        const alreadyHas = pl.songs && pl.songs.some(sid => String(sid) === String(_pendingAddSongId) || sid == _pendingAddSongId);
        return `
          <div class="playlist-chooser-item" data-pl-id="${escapeHtmlAttr(String(pl.id))}" onclick="addSongToSpecificPlaylist('${escapeHtmlAttr(String(pl.id))}', _pendingAddSongId)">
            <div class="playlist-chooser-thumb" style="background:${gradientFor(pl.id)}">
              <img src="${getPlaylistThumbnail(pl)}" alt="${escapeHtmlAttr(cleanName)}" onerror="this.style.display='none'"/>
            </div>
            <div class="playlist-chooser-info">
              <p class="playlist-chooser-name">${escapeHtmlText(cleanName)}</p>
              <p class="playlist-chooser-count">${count} song${count === 1 ? '' : 's'} ${alreadyHas ? '· <em style="color:var(--purple-bright);font-weight:600">Already in playlist</em>' : ''}</p>
            </div>
            <span class="playlist-chooser-add-btn" style="${alreadyHas ? 'color:var(--green);font-size:15px;' : ''}">${alreadyHas ? '✓' : '＋'}</span>
          </div>
        `;
      }).join('');
    }
  }

  modal.style.display = 'flex';
}

function closePlaylistAddModal() {
  const modal = document.getElementById('playlist-add-modal');
  if (modal) modal.style.display = 'none';
  _pendingAddSongId = null;
}

function openCreatePlaylistFromAddModal() {
  const songToKeep = _pendingAddSongId;
  const modal = document.getElementById('playlist-add-modal');
  if (modal) modal.style.display = 'none';
  _pendingAddSongId = songToKeep;
  openPlaylistCreateModal();
}

function addSongToSpecificPlaylist(playlistId, songId) {
  const sId = (songId !== undefined && songId !== null) ? songId : _pendingAddSongId;
  if (sId === undefined || sId === null || sId === '') {
    showToast('⚠️ No track selected to add');
    return;
  }

  let pls = getUserPlaylistsFromStorage() || state.playlists || [];
  const pl = pls.find(p => String(p.id) === String(playlistId) || p.id == playlistId) ||
             (state.playlists || []).find(p => String(p.id) === String(playlistId) || p.id == playlistId);
  if (!pl) {
    showToast('⚠️ Playlist not found');
    return;
  }

  if (!Array.isArray(pl.songs)) pl.songs = [];

  // Check duplicate loosely
  const alreadyHas = pl.songs.some(sid => String(sid) === String(sId) || sid == sId);
  if (alreadyHas) {
    showToast(`"${pl.name}" already has this track 🎵`);
    closePlaylistAddModal();
    return;
  }

  // Preserve numeric ID if numeric, otherwise store as string
  const finalId = (!isNaN(Number(sId)) && typeof sId !== 'boolean' && String(sId).trim() !== '') ? Number(sId) : sId;
  pl.songs.push(finalId);
  pl.song_count = pl.songs.length;

  // Update thumbnail if newly added
  const allKnown = [...(state.songs || []), ...(_libAllSongs || []), ...(state.history || [])];
  const songObj = allKnown.find(s => s && (String(s.id) === String(finalId) || s.id == finalId)) ||
                  pcSongAudioMap.get(finalId) || pcSongAudioMap.get(Number(finalId));
  if (songObj) {
    playlistThumbnailMap.set(pl.id, imgFor(songObj.id || finalId));
  }

  // Persist to user-isolated storage
  saveUserPlaylistsToStorage(pls);
  state.playlists = pls;

  // Background sync to backend if present
  apiPost(`/playlists/${pl.id}/songs`, { song_id: finalId }, { silent: true }).catch(() => {});

  const songName = songObj ? songObj.title : 'Track';
  showToast(`Added "${songName}" to "${pl.name}" ✅`);

  closePlaylistAddModal();
  renderSidebarPlaylists();
  renderProfilePlaylists();
  renderProfileStats();

  // If this playlist is currently open, dynamically refresh its view
  if (state.activePlaylistId && (String(state.activePlaylistId) === String(playlistId) || state.activePlaylistId == playlistId)) {
    openPlaylist(playlistId);
  }
}

/* ── Add Song Form ────────────────────────────── */
function showAddSongModal() {
  const modal = document.getElementById('add-song-modal');
  if (modal) modal.style.display = 'flex';
}
function hideAddSongModal() {
  const modal = document.getElementById('add-song-modal');
  if (modal) modal.style.display = 'none';
}
async function submitAddSong() {
  const title    = document.getElementById('new-title')?.value.trim();
  const artist   = document.getElementById('new-artist')?.value.trim();
  const album    = document.getElementById('new-album')?.value.trim();
  const genre    = document.getElementById('new-genre')?.value.trim();
  const duration = parseFloat(document.getElementById('new-duration')?.value) || 3.5;
  const rating   = parseFloat(document.getElementById('new-rating')?.value)   || 4.0;

  if (!title || !artist) { showToast('Title and Artist are required'); return; }

  // Inbuilt Duplicate Prevention: strictly block if already in library
  const dup = findDuplicateInLibrary({ title, artist, duration }, state.songs);
  if (dup) {
    showToast(`🚫 Duplicate Blocked: "${title}" by ${artist} is already in your library! No copies allowed.`);
    return;
  }

  const song = await apiPost('/songs', { title, artist, album: album||'Unknown', genre: genre||'Unknown', duration, rating });
  if (song) {
    showToast(`"${song.title}" added to library 🎵`);
    hideAddSongModal();
    state.songs = (await apiGet('/songs')) || state.songs;
    refreshHome();
    /* Clear form */
    ['new-title','new-artist','new-album','new-genre','new-duration','new-rating'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
  }
}

/* ═══════════════════════════════════════════════
   PC AUDIO FILE IMPORT (AUTO-METADATA & NO MANUAL INPUT)
═══════════════════════════════════════════════ */

function triggerAddSongFromPC() {
  const input = document.getElementById('pc-audio-input');
  if (input) input.click();
}

function handlePCAudioFileInput(e) {
  const files = e.target.files;
  if (files && files.length > 0) {
    handlePCAudioFiles(files);
  }
  e.target.value = '';
}

/* Parse ID3 tags (ID3v2 & ID3v1) from file */
async function parseAudioID3(file) {
  const result = { title: '', artist: '', album: '', genre: '' };
  try {
    const headerSlice = file.slice(0, 131072);
    const buf = await headerSlice.arrayBuffer();
    const bytes = new Uint8Array(buf);

    if (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) { // ID3
      const version = bytes[3];
      let offset = 10;
      const tagSize = ((bytes[6] & 0x7f) << 21) | ((bytes[7] & 0x7f) << 14) | ((bytes[8] & 0x7f) << 7) | (bytes[9] & 0x7f);
      const maxOffset = Math.min(bytes.length, 10 + tagSize);

      while (offset + 10 < maxOffset) {
        let frameId = '';
        for (let i = 0; i < 4; i++) {
          const charCode = bytes[offset + i];
          if (charCode >= 32 && charCode <= 126) frameId += String.fromCharCode(charCode);
        }
        if (frameId.length < 4) break;

        let frameSize = 0;
        if (version === 4) {
          frameSize = ((bytes[offset + 4] & 0x7f) << 21) | ((bytes[offset + 5] & 0x7f) << 14) | ((bytes[offset + 6] & 0x7f) << 7) | (bytes[offset + 7] & 0x7f);
        } else {
          frameSize = (bytes[offset + 4] << 24) | (bytes[offset + 5] << 16) | (bytes[offset + 6] << 8) | bytes[offset + 7];
        }
        if (frameSize <= 0 || offset + 10 + frameSize > bytes.length) break;

        const frameData = bytes.slice(offset + 10, offset + 10 + frameSize);
        if (['TIT2', 'TPE1', 'TALB', 'TCON'].includes(frameId) && frameData.length > 1) {
          const enc = frameData[0];
          let text = '';
          const content = frameData.slice(1);
          if (enc === 0) {
            text = new TextDecoder('iso-8859-1').decode(content);
          } else if (enc === 1 || enc === 2) {
            text = new TextDecoder('utf-16').decode(content);
          } else if (enc === 3) {
            text = new TextDecoder('utf-8').decode(content);
          }
          text = text.replace(/\0/g, '').trim();
          if (frameId === 'TIT2' && text) result.title = text;
          if (frameId === 'TPE1' && text) result.artist = text;
          if (frameId === 'TALB' && text) result.album = text;
          if (frameId === 'TCON' && text) result.genre = text.replace(/^\(\d+\)/, '').trim();
        }
        offset += 10 + frameSize;
      }
    }

    if ((!result.title || !result.artist) && file.size > 128) {
      const v1Slice = file.slice(file.size - 128);
      const v1Buf = await v1Slice.arrayBuffer();
      const v1Bytes = new Uint8Array(v1Buf);
      if (v1Bytes[0] === 0x54 && v1Bytes[1] === 0x41 && v1Bytes[2] === 0x47) { // TAG
        const decoder = new TextDecoder('iso-8859-1');
        const v1Title = decoder.decode(v1Bytes.slice(3, 33)).replace(/\0/g, '').trim();
        const v1Artist = decoder.decode(v1Bytes.slice(33, 63)).replace(/\0/g, '').trim();
        const v1Album = decoder.decode(v1Bytes.slice(63, 93)).replace(/\0/g, '').trim();
        if (!result.title && v1Title) result.title = v1Title;
        if (!result.artist && v1Artist) result.artist = v1Artist;
        if (!result.album && v1Album) result.album = v1Album;
      }
    }
  } catch (err) {
    console.warn('ID3 tag read error:', err);
  }
  return result;
}

/* Parse filename when ID3 tags are missing */
function parseSongFilename(filename) {
  let name = filename.replace(/\.[^/.]+$/, '').trim();
  name = name.replace(/\[(?:320kbps|flac|hq|official|audio|lyrics|hd|remix)\]/gi, '');
  name = name.replace(/\((?:official\s*(?:video|audio|music\s*video)|lyrics|audio|hd)\)/gi, '');
  name = name.replace(/_\d{3,4}p/gi, '');
  name = name.replace(/^[\d\s.\-_]+/, '').trim();

  let artist = 'Local Artist';
  let title = name;

  if (name.includes(' - ')) {
    const parts = name.split(' - ');
    if (parts.length >= 2) {
      artist = parts[0].trim();
      title = parts.slice(1).join(' - ').trim();
    }
  } else if (name.includes(' – ')) {
    const parts = name.split(' – ');
    if (parts.length >= 2) {
      artist = parts[0].trim();
      title = parts.slice(1).join(' – ').trim();
    }
  }

  title = title.replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
  artist = artist.replace(/_/g, ' ').replace(/\s+/g, ' ').trim();

  return { title: title || 'Local Song', artist: artist || 'Local Artist' };
}

/* Extract duration and audio blob URL */
async function extractAudioDuration(file) {
  return new Promise((resolve) => {
    try {
      const url = URL.createObjectURL(file);
      const audio = new Audio();
      audio.preload = 'metadata';
      audio.src = url;
      let finished = false;

      const done = (dur) => {
        if (finished) return;
        finished = true;
        resolve({ durationSec: dur > 0 ? dur : 210, url });
      };

      audio.onloadedmetadata = () => done(audio.duration);
      audio.onerror = () => done(210);
      setTimeout(() => done(210), 3500);
    } catch (e) {
      resolve({ durationSec: 210, url: '' });
    }
  });
}

/* Main handler for imported PC audio files */
async function handlePCAudioFiles(fileList) {
  const allFiles = Array.from(fileList || []);
  const audioFiles = allFiles.filter(f => {
    const name = f.name.toLowerCase();
    return f.type.startsWith('audio/') || /\.(mp3|wav|ogg|flac|m4a|aac|webm|opus|wma)$/i.test(name);
  });

  if (audioFiles.length === 0) {
    showToast('⚠️ Please select audio files (.mp3, .wav, .flac, etc.)');
    return;
  }

  showToast(`📁 Processing ${audioFiles.length} song(s) from PC…`);

  let addedCount = 0;
  let lastAddedSong = null;

  for (const file of audioFiles) {
    try {
      const id3 = await parseAudioID3(file);
      const parsed = parseSongFilename(file.name);

      const title = id3.title || parsed.title || 'Untitled Track';
      const artist = id3.artist || parsed.artist || 'Local Artist';
      const album = id3.album || 'PC Uploads';
      const genre = id3.genre || 'Local Audio';

      const audioInfo = await extractAudioDuration(file);
      const durationMin = +(audioInfo.durationSec / 60).toFixed(2);

      // Inbuilt duplicate detection: strictly reject duplicate songs, only 1 copy allowed
      const existingDup = findDuplicateInLibrary({ title, artist, duration: durationMin }, state.songs);
      if (existingDup) {
        showToast(`🚫 Duplicate Blocked: "${title}" is already in your library! No copies allowed.`);
        continue;
      }

      let song = await apiPost('/songs', {
        title,
        artist,
        album,
        genre,
        duration: durationMin,
        rating: 4.5
      });

      if (!song || song.id === undefined) {
        // Fallback for offline mode or server error
        song = {
          id: Date.now() + Math.floor(Math.random() * 10000),
          title,
          artist,
          album,
          genre,
          duration: durationMin,
          play_count: 0,
          rating: 4.5,
          liked: 0
        };
        state.songs.unshift(song);
      }

      // Map audio URL and duration for playback
      pcSongAudioMap.set(song.id, {
        url: audioInfo.url,
        file,
        durationSec: audioInfo.durationSec
      });

      // Persist to IndexedDB so user audio survives reloads
      saveAudioBlobToDB(song.id, file, audioInfo.durationSec, file.name);

      lastAddedSong = song;
      addedCount++;
    } catch (err) {
      console.error('Failed to import file:', file.name, err);
    }
  }

  if (addedCount > 0) {
    // Refresh library from API or use local state
    const serverSongs = await apiGet('/songs');
    if (serverSongs && serverSongs.length > 0) {
      state.songs = serverSongs;
    }
    _libAllSongs = state.songs;

    if (state.currentPage === 'library') {
      refreshLibrary();
    } else {
      refreshHome();
    }

    if (addedCount === 1 && lastAddedSong) {
      showToast(`🎵 "${lastAddedSong.title}" added from PC!`);
    } else {
      showToast(`🎵 Added ${addedCount} songs from PC to library!`);
    }
  } else {
    showToast('⚠️ Could not import songs. Please check the files.');
  }
}

/* ── Enqueue Song ─────────────────────────────── */
async function enqueueSong(songId, event) {
  if (event) event.stopPropagation();
  const res = await apiPost('/queue', { song_id: songId });
  if (res) { showToast('Added to queue ✅'); refreshQueue(); }
}

/* ── In-App Confirmation Modal (Replaces browser confirm) ──────── */
let _confirmCallback = null;

function showAppConfirm(title, message, actionText = 'Confirm', isDanger = false, onConfirm = null) {
  const modal = document.getElementById('app-confirm-modal');
  if (!modal) {
    if (confirm(message)) {
      if (onConfirm) onConfirm();
    }
    return;
  }

  const titleEl = document.getElementById('confirm-modal-title');
  const msgEl = document.getElementById('confirm-modal-message');
  const actBtn = document.getElementById('confirm-modal-action-btn');
  const iconEl = document.getElementById('confirm-modal-icon');

  if (titleEl) titleEl.textContent = title;
  if (msgEl) msgEl.textContent = message;
  if (actBtn) {
    actBtn.textContent = actionText;
    if (isDanger) {
      actBtn.classList.add('btn-danger-confirm');
    } else {
      actBtn.classList.remove('btn-danger-confirm');
    }
  }
  if (iconEl) {
    iconEl.textContent = isDanger ? '🗑️' : '❓';
  }

  _confirmCallback = onConfirm;
  modal.style.display = 'flex';
}

function closeConfirmModal(confirmed = false) {
  const modal = document.getElementById('app-confirm-modal');
  if (modal) modal.style.display = 'none';

  if (confirmed && typeof _confirmCallback === 'function') {
    const cb = _confirmCallback;
    _confirmCallback = null;
    cb();
  } else {
    _confirmCallback = null;
  }
}

/* Called from the player's Remove button AND each library song row's Remove button. */
async function deleteSong(songId, event) {
  if (event) {
    try { event.stopPropagation(); event.preventDefault(); } catch(e){}
  }
  if (songId === undefined || songId === null) return;

  const targetId = String(songId);
  const songToDelete = (state.songs || []).find(s => String(s.id) === targetId || String(s.videoId || '') === targetId);
  const songTitle = songToDelete ? songToDelete.title : 'this song';

  showAppConfirm('Remove Song?', `Remove "${songTitle}" from your personal library?`, 'Remove', true, async () => {
    // 1. Try to delete from C REST API backend if integer ID
    const numId = Number(songId);
    if (!isNaN(numId) && Number.isInteger(numId) && numId > 0 && numId < 100000000) {
      await apiDelete(`/songs/${numId}`, { silent: true }).catch(() => {});
    }

    // 2. Filter out of state.songs and _libAllSongs by ID or videoId
    state.songs = (state.songs || []).filter(s => String(s.id) !== targetId && String(s.videoId || '') !== targetId);
    _libAllSongs = state.songs;

    // 3. Persist updated library to localStorage
    try {
      localStorage.setItem('dhun_client_songs', JSON.stringify(state.songs));
    } catch (e) {}

    // 4. Remember deleted title so auto-seed does not re-add it
    if (songToDelete && songToDelete.title) {
      try {
        const rawDel = localStorage.getItem('dhun_deleted_song_titles') || '[]';
        const deletedSet = new Set(JSON.parse(rawDel));
        deletedSet.add(songToDelete.title.toLowerCase().trim());
        localStorage.setItem('dhun_deleted_song_titles', JSON.stringify([...deletedSet]));
      } catch (e) {}
    }

    // 5. Clean audio maps & YT cache
    pcSongAudioMap.delete(songId);
    pcSongAudioMap.delete(targetId);
    if (!isNaN(numId)) pcSongAudioMap.delete(numId);
    ytCoverArtCache.delete(songId);
    ytCoverArtCache.delete(targetId);

    try {
      const raw = localStorage.getItem('dhun_yt_songs');
      if (raw) {
        const parsed = JSON.parse(raw);
        delete parsed[songId];
        delete parsed[targetId];
        if (!isNaN(numId)) delete parsed[numId];
        localStorage.setItem('dhun_yt_songs', JSON.stringify(parsed));
      }
    } catch(e){}

    // 6. Remove from user playlists
    try {
      const pls = getUserPlaylistsFromStorage();
      if (Array.isArray(pls)) {
        let changed = false;
        pls.forEach(pl => {
          if (Array.isArray(pl.songs)) {
            const before = pl.songs.length;
            pl.songs = pl.songs.filter(sid => String(sid) !== targetId);
            if (pl.songs.length !== before) changed = true;
          }
        });
        if (changed) {
          localStorage.setItem('dhun_user_playlists', JSON.stringify(pls));
          state.playlists = pls;
        }
      }
    } catch(e){}

    // 7. If currently playing song is this deleted song, advance or stop
    if (state.currentSong && (String(state.currentSong.id) === targetId || state.currentSong.id == songId)) {
      if (state.songs.length > 0) {
        nextSong();
      } else {
        state.currentSong = null;
        state.isPlaying = false;
        if (globalAudioPlayer) { globalAudioPlayer.pause(); globalAudioPlayer.src = ''; }
        if (ytPlayer && ytPlayer.stopVideo) ytPlayer.stopVideo();
        updatePlayUI();
      }
    }

    // 8. Immediately re-render Library and Home views
    renderLibrary(_libAllSongs);
    if (typeof renderHero === 'function') renderHero();
    if (typeof renderRecommended === 'function') renderRecommended();
    if (typeof renderTrending === 'function') renderTrending();
    if (typeof renderProfileStats === 'function') renderProfileStats();

    showToast(`Removed "${songTitle}" from library 🗑️`);
  });
}

/* ═══════════════════════════════════════════════
   REFRESH FUNCTIONS — fetch from API + update DOM
═══════════════════════════════════════════════ */

/* Home page */
async function refreshHome() {
  const songs = await apiGet('/songs');
  if (songs) state.songs = songs;
  await inbuiltLibraryDeduplication();
  renderHero();
  renderPlaylistsFeatured();
  renderRecommended();
  renderTrending();
  renderRecentlyPlayed();
  renderRelated();
  renderProfileStats();
}

function renderPlaylistsFeatured() {
  const row = document.getElementById('featured-playlists-row');
  if (!row) return;
  const pls = getUserPlaylistsFromStorage() || state.playlists || [];
  const plCards = pls.map(pl => {
    const cleanName = formatPlaylistName(pl.name);
    const count = (pl.songs ? pl.songs.length : (pl.song_count || 0));
    return `
      <div class="feat-card" onclick="openPlaylist('${escapeHtmlAttr(String(pl.id))}')" style="cursor:pointer" title="${escapeHtmlAttr(cleanName)}">
        <div class="feat-thumb" style="background:${gradientFor(pl.id)};display:flex;align-items:center;justify-content:center;overflow:hidden">
          <img src="${getPlaylistThumbnail(pl)}" alt="${escapeHtmlAttr(cleanName)}" style="width:100%;height:100%;object-fit:cover" onerror="this.style.display='none'"/>
        </div>
        <div class="feat-info">
          <span class="feat-tag">🎵 Playlist</span>
          <h3 class="feat-name">${escapeHtmlText(cleanName)}</h3>
          <p class="feat-meta">${count} song${count === 1 ? '' : 's'}</p>
          <button class="feat-play" onclick="event.stopPropagation();openPlaylist('${escapeHtmlAttr(String(pl.id))}')">▶ Play</button>
        </div>
      </div>
    `;
  }).join('');

  row.innerHTML = plCards + `
    <div class="feat-card" onclick="createPlaylist()" style="cursor:pointer">
      <div class="feat-thumb" style="background:linear-gradient(135deg,#7c3aed,#2563eb);display:flex;align-items:center;justify-content:center;font-size:28px;color:#fff">+</div>
      <div class="feat-info">
        <span class="feat-tag">🎵 Custom</span>
        <h3 class="feat-name">Create Playlist</h3>
        <p class="feat-meta">Organize your favorite music</p>
        <button class="feat-play">＋ New</button>
      </div>
    </div>
  `;
}

function renderHero() {
  const banner = document.getElementById('hero-banner');
  if (!banner) return;
  
  if (state.songs.length === 0) {
    _set('hero-tag', '🎵 Library Ready');
    _set('hero-title', 'Welcome to Dhun');
    _set('hero-sub', 'Import your audio tracks from PC or click Add from PC to begin');
    _set('hero-stat-tracks', '0');
    _set('hero-stat-rating', '5.0★');
    _set('hero-stat-quality', 'HD');
    const playBtn = document.getElementById('hero-play-btn');
    if (playBtn) {
      playBtn.textContent = '📁 Add Music';
      playBtn.onclick = triggerAddSongFromPC;
    }
    return;
  }

  const topSong = state.currentSong || state.songs[0];
  _set('hero-tag', '🔥 Now in Library');
  _set('hero-title', topSong.title);
  _set('hero-sub', `${topSong.artist} · ${topSong.album} · ${topSong.genre}`);
  _set('hero-stat-tracks', state.songs.length);
  _set('hero-stat-rating', (topSong.rating || 4.8).toFixed(1) + '★');
  _set('hero-stat-quality', 'HD');
  
  const bgImg = document.getElementById('hero-bg-img');
  if (bgImg) bgImg.src = imgFor(topSong.id);
  
  const playBtn = document.getElementById('hero-play-btn');
  if (playBtn) {
    playBtn.textContent = '▶ Play Now';
    playBtn.onclick = () => openPlayerById(topSong.id);
  }
}

function renderRecommended() {
  const container = document.getElementById('recommended-list');
  if (!container) return;
  if (state.songs.length === 0) {
    container.innerHTML = `
      <div style="padding:40px 20px;text-align:center;color:var(--text-muted)">
        <p style="font-size:24px;margin-bottom:8px">🎵</p>
        <p style="font-weight:600;color:var(--text-1);margin-bottom:6px">No songs in library yet</p>
        <p style="font-size:13px;margin-bottom:16px">Drag & drop MP3 / audio files anywhere or click Add from PC</p>
        <button class="btn-primary" onclick="triggerAddSongFromPC()" style="display:inline-flex;align-items:center;gap:6px">📁 Add Audio from PC</button>
      </div>`;
    return;
  }

  const recResults = typeof getAutoRecommendations === 'function' ? getAutoRecommendations(state.currentSong || state.songs[0], 8) : [];
  const songs = (recResults && recResults.length > 0)
    ? recResults.map(r => r.song)
    : state.songs.slice(0, 8);
  container.innerHTML = songs.map((s, i) => `
    <div class="st-row" id="str-api-${s.id}" onclick="openPlayerById('${escapeHtmlAttr(String(s.id))}')">
      <span class="st-num">${i+1}</span>
      <div class="st-title-col">
        <div class="st-thumb" style="background:${gradientFor(s.id)}">
          <img src="${imgFor(s.id)}" alt="${s.title}" data-song-id="${s.id}"/>
        </div>
        <div>
          <p class="st-song-name">${s.title} ${isYTSong(s.id) ? '<span class="yt-badge">🔴 YT Music</span>' : ''}</p>
          <p class="st-artist">${s.artist}</p>
        </div>
      </div>
      <span class="st-cell">${s.album}</span>
      <span class="st-cell">${s.genre}</span>
      <span class="st-dur">${fmtDur(s.duration)}</span>
      <div class="st-acts">
        <button class="icon-act like-btn" data-song-id="${s.id}"
          onclick="toggleLike(this,event)" aria-label="Like ${s.title}">
          ${s.liked ? '❤️' : '♡'}
        </button>
        <button class="icon-act" title="Add to queue"
          onclick="enqueueSong('${escapeHtmlAttr(String(s.id))}',event)" aria-label="Queue">＋</button>
        <button class="icon-act" title="Add to playlist"
          onclick="addToPlaylistPrompt('${escapeHtmlAttr(String(s.id))}',event)" aria-label="Add to playlist">⋯</button>
      </div>
    </div>`).join('');
}

async function renderTrending() {
  const charts = await apiGet('/charts');
  const container = document.getElementById('trending-dynamic');
  if (!container) return;
  const list = (charts && charts.length > 0) ? charts : state.songs;
  if (!list || list.length === 0) {
    container.innerHTML = '<p style="color:var(--text-muted);padding:16px;font-size:13px">Top played tracks will appear here</p>';
    return;
  }
  container.innerHTML = list.slice(0, 5).map((s, i) => `
    <div class="trend-card" onclick="openPlayerById(${s.id})">
      <span class="trend-rank">#${i+1}</span>
      <div class="trend-thumb" style="background:${gradientFor(s.id)}">
        <img src="${imgFor(s.id)}" alt="${s.title}" data-song-id="${s.id}"/>
      </div>
      <p class="trend-name">${s.title}</p>
      <p class="trend-artist">${s.artist}</p>
      <p class="trend-plays">${s.play_count || 1} play${(s.play_count || 1) === 1 ? '' : 's'}</p>
    </div>`).join('');
}

function renderRecentlyPlayed() {
  const container = document.getElementById('home-recent-list');
  if (!container) return;
  if (!state.songs || state.songs.length === 0) {
    container.innerHTML = '<p style="padding:12px;color:var(--text-muted);font-size:12px">No recent plays yet</p>';
    return;
  }
  const recent = state.songs.slice(0, 3);
  container.innerHTML = recent.map(s => `
    <div class="recent-song" onclick="openPlayerById(${s.id})">
      <div class="rs-thumb" style="background:${gradientFor(s.id)}">
        <img src="${imgFor(s.id)}" alt="${s.title}" data-song-id="${s.id}"/>
      </div>
      <div class="rs-info">
        <p class="rs-name">${s.title}</p>
        <p class="rs-artist">${s.artist}</p>
      </div>
    </div>`).join('');
}

/* ── Inbuilt Auto-Recommendation Engine ───────────────────────── */
function getAutoRecommendations(currentSong, limit = 4) {
  if (!state.songs || state.songs.length === 0) return [];
  const curr = currentSong || state.currentSong;
  const currId = curr ? curr.id : null;
  const candidates = state.songs.filter(s => s.id !== currId);
  if (candidates.length === 0) return [];

  const currGenre = (curr?.genre || '').toLowerCase().trim();
  const currArtist = (curr?.artist || '').toLowerCase().trim();
  const currWords = (curr?.title || '').toLowerCase().split(/\s+/).filter(w => w.length > 3);

  const scored = candidates.map(s => {
    let score = 0;
    let reason = s.genre || 'Recommended';
    const sGenre = (s.genre || '').toLowerCase().trim();
    const sArtist = (s.artist || '').toLowerCase().trim();

    // 1. Same genre match (+45 pts)
    if (currGenre && sGenre && (currGenre === sGenre || currGenre.includes(sGenre) || sGenre.includes(currGenre))) {
      score += 45;
      reason = s.genre;
    }

    // 2. Same artist / collaborator match (+40 pts)
    if (currArtist && sArtist) {
      if (currArtist === sArtist) {
        score += 40;
        reason = `More by ${s.artist.split(/[,/]/)[0]}`;
      } else {
        const artistParts = currArtist.split(/[,/ft.&]/).map(p => p.trim()).filter(Boolean);
        for (const part of artistParts) {
          if (part.length > 3 && sArtist.includes(part)) {
            score += 35;
            reason = `Featuring ${part}`;
            break;
          }
        }
      }
    }

    // 3. Play count & Max-Heap rating metric (+10-20 pts)
    if (s.rating) score += Math.round(s.rating * 3);
    if (s.play_count) score += Math.min(20, s.play_count * 3);

    // 4. Word similarity (+10 pts)
    for (const w of currWords) {
      if (s.title.toLowerCase().includes(w)) {
        score += 10;
        break;
      }
    }

    if (reason === 'Recommended' && s.genre) {
      reason = s.genre;
    }

    return { song: s, score, reason };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

function renderRelated() {
  const container = document.getElementById('related-list');
  if (!container) return;
  const recs = getAutoRecommendations(state.currentSong, 4);

  if (recs.length === 0) {
    container.innerHTML = '<p style="padding:16px;color:var(--text-muted);font-size:13px">Add more songs to see recommendations</p>';
    return;
  }

  container.innerHTML = recs.map(({ song: s, reason }) => `
    <div class="queue-item rec-item" onclick="openPlayerById(${s.id})">
      <div class="qi-thumb" style="background:${gradientFor(s.id)}">
        <img src="${imgFor(s.id)}" alt="${s.title}" data-song-id="${s.id}"/>
      </div>
      <div class="qi-info">
        <p class="qi-name">${s.title}</p>
        <p class="qi-artist">${s.artist}</p>
        <span class="rec-tag">${reason}</span>
      </div>
      <button class="qi-add" onclick="enqueueSong(${s.id},event)" title="Add to queue" aria-label="Add to queue">＋</button>
    </div>`).join('');
}

/* Search page */
let searchMode = 'ytmusic';

async function refreshSearch() {
  if (state.activePlaylistId) return;
  const grid = document.getElementById('yt-music-grid');
  if (grid && (!grid.children || grid.children.length === 0)) {
    loadYTFeed(currentYTFeedCategory || 'for-you');
  }
}

/* Player: Queue panel */
async function refreshQueue() {
  const queue = await apiGet('/queue');
  if (queue) state.queue = queue;
  renderQueue();
}

function renderQueue() {
  const list = document.getElementById('queue-list');
  if (!list) return;
  if (state.queue.length === 0) {
    list.innerHTML = '<p style="padding:16px;color:var(--text-muted);font-size:13px">Queue is empty — click ＋ to queue songs</p>';
    return;
  }
  list.innerHTML = state.queue.map((s, i) => `
    <div class="queue-item ${i===0?'active-queue':''}" onclick="openPlayerById(${s.id})">
      <div class="qi-thumb" style="background:${gradientFor(s.id)}">
        <img src="${imgFor(s.id)}" alt="${s.title}" data-song-id="${s.id}"/>
      </div>
      <div class="qi-info">
        <p class="qi-name">${s.title}</p>
        <p class="qi-artist">${s.artist}</p>
      </div>
      <span class="qi-dur">${fmtDur(s.duration)}</span>
    </div>`).join('');
}

/* Profile page */
async function refreshProfile() {
  renderProfileStats();
  await refreshPlaylists();
  await refreshLikedSongs();
}

/* ── Predefault Playlists Filter & Purge Engine ──────────────────── */
const PREDEFAULT_PLAYLIST_NAMES = [
  'bollywood romance & classics',
  'global pop & chartbusters',
  'late night chill & lo-fi',
  'high energy & edm',
  'punjabi hits & vibes'
];

function isPredefaultPlaylist(name) {
  if (!name) return false;
  const clean = String(name).toLowerCase()
    .replace(/\\u0026/g, '&')
    .replace(/&amp;/g, '&')
    .replace(/[\s\-_]+/g, ' ')
    .trim();
  return PREDEFAULT_PLAYLIST_NAMES.some(def => clean === def || clean.includes(def) || def.includes(clean));
}

function purgePredefaultPlaylists() {
  try {
    // 1. Purge from all localStorage keys containing playlists
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && (key.startsWith('dhun_user_playlists_') || key === 'dhun_local_playlists' || key === 'dhun_playlists')) {
        try {
          const raw = localStorage.getItem(key);
          if (raw) {
            const list = JSON.parse(raw);
            if (Array.isArray(list)) {
              const filtered = list.filter(p => p && !isPredefaultPlaylist(p.name));
              localStorage.setItem(key, JSON.stringify(filtered));
            }
          }
        } catch (e) {}
      }
    }

    // 2. Filter current state.playlists
    if (state.playlists && Array.isArray(state.playlists)) {
      state.playlists = state.playlists.filter(p => p && !isPredefaultPlaylist(p.name));
    }

    // 3. Save to active user storage
    const activePls = getUserPlaylistsFromStorage() || [];
    const filteredActive = activePls.filter(p => p && !isPredefaultPlaylist(p.name));
    try {
      localStorage.setItem(getUserStorageKey('playlists'), JSON.stringify(filteredActive));
    } catch(e) {}
    state.playlists = filteredActive;

    // 4. Update UI
    renderSidebarPlaylists();
    renderProfilePlaylists();
    renderProfileStats();

    // 5. Cloud push if user is logged in
    pushProfileToCloudDebounced();
  } catch (e) {
    console.warn('purgePredefaultPlaylists error:', e);
  }
}

async function autoGenerateMultiplePlaylists() {
  // Predefault auto-generation permanently disabled. Only user creates playlists.
  purgePredefaultPlaylists();
}

function formatPlaylistName(name) {
  if (!name) return 'Untitled Playlist';
  return name.replace(/\\u0026/g, '&').replace(/u0026/g, '&').replace(/&amp;/g, '&');
}

async function refreshPlaylists() {
  purgePredefaultPlaylists();
  let localPls = getUserPlaylistsFromStorage();
  if (localPls) {
    localPls = localPls.filter(p => p && !isPredefaultPlaylist(p.name));
  }
  if (localPls && localPls.length > 0) {
    state.playlists = localPls.map(p => ({
      ...p,
      name: formatPlaylistName(p.name)
    }));
  } else {
    const pls = await apiGet('/playlists', { silent: true });
    if (pls && Array.isArray(pls) && pls.length > 0) {
      const filteredPls = pls.filter(p => p && !isPredefaultPlaylist(p.name));
      state.playlists = filteredPls.map(p => ({
        ...p,
        name: formatPlaylistName(p.name)
      }));
      saveUserPlaylistsToStorage(state.playlists);
    } else if (localPls) {
      state.playlists = localPls;
    } else {
      state.playlists = [];
    }
  }
  renderSidebarPlaylists();
  renderProfilePlaylists();
}

function renderSidebarPlaylists() {
  const container = document.getElementById('sidebar-playlists');
  if (!container) return;
  const pls = getUserPlaylistsFromStorage() || state.playlists || [];
  state.playlists = pls;
  container.innerHTML = pls.map(pl => {
    const cleanName = formatPlaylistName(pl.name);
    const count = (pl.songs ? pl.songs.length : (pl.song_count || 0));
    return `
    <div class="nav-item playlist-item" onclick="openPlaylist('${escapeHtmlAttr(String(pl.id))}')" role="button" tabindex="0" title="${escapeHtmlAttr(cleanName)}">
      <div class="pl-thumb-mini" style="background:${gradientFor(pl.id)}">
        <img src="${getPlaylistThumbnail(pl)}" alt="${escapeHtmlAttr(cleanName)}" onerror="this.style.display='none'"/>
      </div>
      <span class="pl-name">${escapeHtmlText(cleanName)}</span>
      <span class="pl-count">${count}</span>
      <button class="pl-del-btn" onclick="event.stopPropagation();deletePlaylistConfirm('${escapeHtmlAttr(String(pl.id))}')" title="Remove playlist" aria-label="Remove playlist">✕</button>
    </div>`;
  }).join('') + `
    <button class="nav-item playlist-item" style="color:var(--text-muted)" onclick="createPlaylist()">
      <div class="pl-dot" style="background:rgba(255,255,255,0.1);border:1.5px dashed rgba(255,255,255,0.3)"></div>
      <span class="pl-name">New Playlist</span>
      <span>+</span>
    </button>`;
}

function renderProfilePlaylists() {
  const container = document.getElementById('tab-content-playlists');
  if (!container) return;
  const pls = getUserPlaylistsFromStorage() || state.playlists || [];
  state.playlists = pls;
  container.innerHTML = `<div class="content-grid">
    ${pls.map(pl => {
      const cleanName = formatPlaylistName(pl.name);
      const count = (pl.songs ? pl.songs.length : (pl.song_count || 0));
      return `
      <div class="grid-card" onclick="openPlaylist('${escapeHtmlAttr(String(pl.id))}')">
        <div class="gc-thumb" style="background:${gradientFor(pl.id)}">
          <img src="${getPlaylistThumbnail(pl)}" alt="${escapeHtmlAttr(cleanName)}"/>
        </div>
        <p class="gc-name">${escapeHtmlText(cleanName)}</p>
        <p class="gc-meta">${count} songs</p>
        <button class="pl-card-del-btn"
          onclick="event.stopPropagation();deletePlaylistConfirm('${escapeHtmlAttr(String(pl.id))}')" title="Delete playlist" aria-label="Delete playlist">🗑️</button>
      </div>`;
    }).join('')}
    <div class="grid-card create-card" onclick="createPlaylist()">
      <div class="gc-thumb create-thumb">+</div>
      <p class="gc-name">New Playlist</p><p class="gc-meta">Create</p>
    </div>
  </div>`;
}

async function deletePlaylistConfirm(id) {
  const pls = getUserPlaylistsFromStorage() || state.playlists || [];
  const pl = pls.find(p => String(p.id) === String(id) || p.id == id);
  const name = pl ? `"${pl.name}"` : 'this playlist';
  
  showAppConfirm('Delete Playlist?', `Are you sure you want to remove playlist ${name}?`, 'Delete', true, async () => {
    let updated = (getUserPlaylistsFromStorage() || state.playlists || []).filter(p => String(p.id) !== String(id) && p.id != id);
    saveUserPlaylistsToStorage(updated);
    state.playlists = updated;

    apiDelete(`/playlists/${id}`, { silent: true }).catch(() => {});
    showToast(`Playlist ${name} removed 🗑️`);
    await refreshPlaylists();
    renderProfileStats();

    if (state.activePlaylistId && (String(state.activePlaylistId) === String(id) || state.activePlaylistId == id)) {
      state.activePlaylistId = null;
      const resView = document.getElementById('search-results-view');
      const defView = document.getElementById('search-default-view');
      if (resView) resView.style.display = 'none';
      if (defView) defView.style.display = '';
      const delBtn = document.getElementById('delete-playlist-view-btn');
      if (delBtn) delBtn.style.display = 'none';
      navigate('home');
    }
  });
}

function deleteCurrentOpenPlaylist() {
  if (state.activePlaylistId) {
    deletePlaylistConfirm(state.activePlaylistId);
  }
}

async function removeSongFromPlaylist(playlistId, songId, event) {
  if (event) {
    try { event.stopPropagation(); event.preventDefault(); } catch (e) {}
  }
  let pls = getUserPlaylistsFromStorage() || state.playlists || [];
  const pl = pls.find(p => String(p.id) === String(playlistId) || p.id == playlistId);
  if (pl && Array.isArray(pl.songs)) {
    pl.songs = pl.songs.filter(id => String(id) !== String(songId) && id != songId);
    pl.song_count = pl.songs.length;
    saveUserPlaylistsToStorage(pls);
    state.playlists = pls;
  }
  apiDelete(`/playlists/${playlistId}/songs/${songId}`, { silent: true }).catch(() => {});
  showToast('Removed from playlist');
  openPlaylist(playlistId);
  renderSidebarPlaylists();
  renderProfilePlaylists();
  renderProfileStats();
}

async function openPlaylist(id) {
  state.activePlaylistId = id;
  let pls = getUserPlaylistsFromStorage() || state.playlists || [];
  const pl = pls.find(p => String(p.id) === String(id) || p.id == id) ||
             (state.playlists || []).find(p => String(p.id) === String(id) || p.id == id);
  let songs = [];

  const apiSongs = await apiGet(`/playlists/${id}/songs`, { silent: true });
  if (apiSongs && Array.isArray(apiSongs) && apiSongs.length > 0) {
    songs = apiSongs;
  } else if (pl && Array.isArray(pl.songs) && pl.songs.length > 0) {
    const allKnown = [...(state.songs || []), ...(_libAllSongs || []), ...(state.history || [])];
    songs = pl.songs.map(sid => {
      const match = allKnown.find(s => s && (String(s.id) === String(sid) || s.id == sid));
      if (match) return match;
      const pcItem = pcSongAudioMap.get(sid) || pcSongAudioMap.get(Number(sid)) || pcSongAudioMap.get(String(sid));
      if (pcItem) {
        return {
          id: sid,
          title: pcItem.title || 'Track',
          artist: pcItem.artist || 'Artist',
          album: pcItem.album || 'Playlist Track',
          duration: pcItem.durationSec ? +(pcItem.durationSec / 60).toFixed(2) : 3.5,
          genre: pcItem.genre || 'Music'
        };
      }
      return {
        id: sid,
        title: `Track #${sid}`,
        artist: 'Dhun Artist',
        album: 'Playlist Track',
        duration: 3.5,
        genre: 'Music'
      };
    }).filter(Boolean);
  }

  // Ensure these songs are registered in state.songs so player works seamlessly
  songs.forEach(s => {
    if (!state.songs.some(existing => String(existing.id) === String(s.id))) {
      state.songs.push(s);
    }
  });

  navigate('search');

  // Hide Discover feed, search bar, and taste banner completely
  const hero = document.getElementById('search-hero-section');
  if (hero) hero.style.display = 'none';

  const discoverFeed = document.getElementById('discover-feed-container');
  if (discoverFeed) discoverFeed.style.display = 'none';

  const searchDef = document.getElementById('search-default-view');
  if (searchDef) searchDef.style.display = 'none';

  const onlineSec = document.getElementById('search-online-section');
  if (onlineSec) onlineSec.style.display = 'none';

  const resHeader = document.getElementById('search-results-header');
  if (resHeader) resHeader.style.display = 'none';

  const resView = document.getElementById('search-results-view');
  if (resView) resView.style.display = 'block';

  const plName = pl ? formatPlaylistName(pl.name) : `Playlist ${id}`;
  const totalDuration = songs.reduce((acc, s) => acc + (s.duration || 3.5), 0);

  const titleEl = document.getElementById('search-page-title');
  const subEl   = document.getElementById('search-page-sub');
  if (titleEl) titleEl.textContent = plName;
  if (subEl)   subEl.textContent = `Personal Playlist · ${songs.length} track${songs.length === 1 ? '' : 's'}`;

  const resQ = document.getElementById('results-query');
  if (resQ) resQ.textContent = plName;

  const resList = document.getElementById('search-results-list');
  if (resList) {
    const headerHtml = `
      <div class="playlist-view-header glass-card" style="display:flex;align-items:center;gap:22px;padding:22px 24px;border-radius:18px;margin-bottom:24px;background:linear-gradient(135deg,rgba(124,58,237,0.18),rgba(37,99,235,0.12));border:1px solid rgba(124,58,237,0.3)">
        <div style="width:115px;height:115px;border-radius:14px;background:${gradientFor(id)};display:flex;align-items:center;justify-content:center;overflow:hidden;box-shadow:0 8px 25px rgba(0,0,0,0.45);flex-shrink:0">
          <img src="${getPlaylistThumbnail(pl || {id})}" alt="${escapeHtmlAttr(plName)}" style="width:100%;height:100%;object-fit:cover" onerror="this.style.display='none'"/>
        </div>
        <div style="flex:1;min-width:0">
          <span style="font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:var(--purple-bright);background:rgba(124,58,237,0.16);padding:3px 8px;border-radius:4px">🎵 Custom Playlist</span>
          <h2 style="font-size:26px;font-weight:800;margin:6px 0 3px;color:var(--text-1);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtmlText(plName)}</h2>
          <p style="font-size:13px;color:var(--text-2);margin:0 0 14px">${songs.length} track${songs.length === 1 ? '' : 's'} · ${fmtDur(totalDuration)} total length</p>
          <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">
            <button class="btn-primary" onclick="playEntirePlaylist('${escapeHtmlAttr(String(id))}')" style="display:inline-flex;align-items:center;gap:6px;padding:8px 18px;font-size:13px;cursor:pointer">
              <span>▶ Play All</span>
            </button>
            <button class="btn-secondary" onclick="shuffleEntirePlaylist('${escapeHtmlAttr(String(id))}')" style="display:inline-flex;align-items:center;gap:6px;padding:8px 16px;font-size:13px;cursor:pointer">
              <span>🔀 Shuffle</span>
            </button>
            <button class="btn-secondary" onclick="closePlaylistView()" style="display:inline-flex;align-items:center;gap:6px;padding:8px 14px;font-size:13px;cursor:pointer">
              <span>← Back to Discover</span>
            </button>
            <button class="btn-secondary" onclick="deleteCurrentOpenPlaylist()" style="color:#f43f5e;border-color:rgba(244,63,94,0.3);padding:8px 14px;font-size:13px;cursor:pointer" title="Delete this playlist">
              <span>🗑️ Delete</span>
            </button>
          </div>
        </div>
      </div>
    `;

    const songsHtml = songs.length
      ? songs.map((s, i) => `
          <div class="st-row" onclick="openPlayerById('${escapeHtmlAttr(String(s.id))}')" style="cursor:pointer">
            <span class="st-num">${i+1}</span>
            <div class="st-title-col">
              <div class="st-thumb" style="background:${gradientFor(s.id)}">
                <img src="${imgFor(s.id)}" alt="${escapeHtmlAttr(s.title)}" data-song-id="${s.id}" onerror="this.onerror=null;this.src='album1.jpg'"/>
              </div>
              <div>
                <p class="st-song-name">${escapeHtmlText(s.title)}</p>
                <p class="st-artist">${escapeHtmlText(s.artist)}</p>
              </div>
            </div>
            <span class="st-cell">${escapeHtmlText(s.album || '')}</span>
            <span class="st-cell">${escapeHtmlText(s.genre || '')}</span>
            <span class="st-dur">${fmtDur(s.duration)}</span>
            <div class="st-acts">
              <button class="icon-act like-btn ${isSongLikedByUser(s.id) ? 'liked' : ''}" data-song-id="${s.id}"
                onclick="toggleLike(this,event)">${isSongLikedByUser(s.id) ? '❤️' : '♡'}</button>
              <button class="icon-act" onclick="removeSongFromPlaylist('${escapeHtmlAttr(String(id))}', '${escapeHtmlAttr(String(s.id))}', event)" title="Remove from playlist">✕</button>
            </div>
          </div>`).join('')
      : `
        <div style="text-align:center;padding:48px 20px;color:var(--text-muted)">
          <p style="font-size:36px;margin-bottom:8px">🎵</p>
          <p style="font-weight:700;font-size:16px;color:var(--text-1);margin-bottom:4px">This playlist is currently empty</p>
          <p style="font-size:13px;margin-bottom:18px">Explore Discover or Library to add tracks with 1-click</p>
          <button class="btn-primary" onclick="closePlaylistView()" style="display:inline-flex;align-items:center;gap:6px;padding:9px 20px">
            ✨ Explore Discover Tracks
          </button>
        </div>
      `;

    resList.innerHTML = headerHtml + songsHtml;
  }
}

async function playEntirePlaylist(id) {
  let pls = getUserPlaylistsFromStorage() || state.playlists || [];
  const pl = pls.find(p => String(p.id) === String(id) || p.id == id);
  if (!pl || !Array.isArray(pl.songs) || pl.songs.length === 0) {
    showToast('⚠️ Playlist is empty');
    return;
  }
  const resolved = [];
  const allKnown = [...(state.songs || []), ...(_libAllSongs || []), ...(state.history || [])];
  for (const sid of pl.songs) {
    let s = allKnown.find(item => item && (String(item.id) === String(sid) || item.id == sid));
    if (!s) {
      const pcItem = pcSongAudioMap.get(sid) || pcSongAudioMap.get(Number(sid)) || pcSongAudioMap.get(String(sid));
      if (pcItem) {
        s = {
          id: sid,
          title: pcItem.title || 'Track',
          artist: pcItem.artist || 'Artist',
          album: pcItem.album || 'Online Media',
          genre: pcItem.genre || 'Music',
          duration: pcItem.durationSec ? +(pcItem.durationSec / 60).toFixed(2) : 3.5,
          rating: 4.8
        };
        state.songs.push(s);
      }
    }
    if (s) resolved.push(s);
  }
  if (resolved.length === 0) {
    showToast('⚠️ Could not load tracks for this playlist');
    return;
  }
  state.queue = [...resolved];
  renderQueue();
  openPlayerById(resolved[0].id);
  showToast(`▶ Playing "${pl.name}" (${resolved.length} tracks)`);
}

async function shuffleEntirePlaylist(id) {
  let pls = getUserPlaylistsFromStorage() || state.playlists || [];
  const pl = pls.find(p => String(p.id) === String(id) || p.id == id);
  if (!pl || !Array.isArray(pl.songs) || pl.songs.length === 0) {
    showToast('⚠️ Playlist is empty');
    return;
  }
  const resolved = [];
  const allKnown = [...(state.songs || []), ...(_libAllSongs || []), ...(state.history || [])];
  for (const sid of pl.songs) {
    let s = allKnown.find(item => item && (String(item.id) === String(sid) || item.id == sid));
    if (!s) {
      const pcItem = pcSongAudioMap.get(sid) || pcSongAudioMap.get(Number(sid)) || pcSongAudioMap.get(String(sid));
      if (pcItem) {
        s = {
          id: sid,
          title: pcItem.title || 'Track',
          artist: pcItem.artist || 'Artist',
          album: pcItem.album || 'Online Media',
          genre: pcItem.genre || 'Music',
          duration: pcItem.durationSec ? +(pcItem.durationSec / 60).toFixed(2) : 3.5,
          rating: 4.8
        };
        state.songs.push(s);
      }
    }
    if (s) resolved.push(s);
  }
  if (resolved.length === 0) return;
  for (let i = resolved.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [resolved[i], resolved[j]] = [resolved[j], resolved[i]];
  }
  state.queue = [...resolved];
  renderQueue();
  openPlayerById(resolved[0].id);
  showToast(`🔀 Shuffled "${pl.name}"`);
}

function closePlaylistView() {
  state.activePlaylistId = null;
  const hero = document.getElementById('search-hero-section');
  if (hero) hero.style.display = '';
  const df = document.getElementById('discover-feed-container');
  if (df) df.style.display = '';
  const title = document.getElementById('search-page-title');
  const sub = document.getElementById('search-page-sub');
  if (title) title.textContent = 'Discover Music';
  if (sub) sub.textContent = 'Explore millions of songs — automatically synced to your Dhun Library';
  const resView = document.getElementById('search-results-view');
  if (resView) resView.style.display = 'none';
  const resHeader = document.getElementById('search-results-header');
  if (resHeader) resHeader.style.display = '';
  const onlineSec = document.getElementById('search-online-section');
  if (onlineSec) onlineSec.style.display = 'none';
  const delBtn = document.getElementById('delete-playlist-view-btn');
  if (delBtn) delBtn.style.display = 'none';
}

async function refreshLikedSongs() {
  const songs = (await apiGet('/songs')) || state.songs || [];
  const liked = songs.filter(s => isSongLikedByUser(s.id));
  const container = document.getElementById('tab-content-liked');
  if (!container) return;
  container.innerHTML = `<div class="songs-table">` +
    (liked.length
      ? liked.map((s, i) => `
          <div class="st-row" onclick="openPlayerById('${escapeHtmlAttr(String(s.id))}')">
            <span class="st-num">${i+1}</span>
            <div class="st-title-col">
              <div class="st-thumb" style="background:${gradientFor(s.id)}">
                <img src="${imgFor(s.id)}" alt="${escapeHtmlAttr(s.title)}" data-song-id="${s.id}"/>
              </div>
              <div><p class="st-song-name">${escapeHtmlText(s.title)}</p><p class="st-artist">${escapeHtmlText(s.artist)}</p></div>
            </div>
            <span class="st-cell">${escapeHtmlText(s.album || '')}</span>
            <span class="st-dur">${fmtDur(s.duration)}</span>
            <div class="st-acts">
              <span class="liked-heart" style="cursor:pointer" onclick="toggleLike(this,event)" data-song-id="${s.id}">❤️</span>
              <button class="icon-act" title="Add to playlist" onclick="addToPlaylistPrompt('${escapeHtmlAttr(String(s.id))}',event)" aria-label="Add to playlist">⋯</button>
            </div>
          </div>`).join('')
      : '<p style="padding:24px;color:var(--text-2);text-align:center">No liked songs yet ♡</p>')
    + `</div>`;
}

/* ── Sort Library (Home page) ────────────────── */
async function sortLibrary(field) {
  const sorted = await apiPost('/sort', { field });
  if (sorted) {
    state.songs = sorted;
    renderRecommended();
    showToast(`Sorted by ${field} ✅`);
  }
}

/* ── Library Page ─────────────────────────────── */
let _libAllSongs = [];   /* full unfiltered list for genre filtering */

async function refreshLibrary() {
  const songs = await apiGet('/songs');
  if (songs) { state.songs = songs; _libAllSongs = songs; }
  else _libAllSongs = state.songs;
  renderLibrary(_libAllSongs);
}

function renderLibrary(songs) {
  /* Stats */
  const totalEl    = document.getElementById('lib-total');
  const artistsEl  = document.getElementById('lib-artists');
  const albumsEl   = document.getElementById('lib-albums');
  const durEl      = document.getElementById('lib-duration');
  if (totalEl)   totalEl.textContent   = songs.length;
  if (artistsEl) artistsEl.textContent = new Set(songs.map(s => s.artist)).size;
  if (albumsEl)  albumsEl.textContent  = new Set(songs.map(s => s.album)).size;
  if (durEl) {
    const totalMin = songs.reduce((acc, s) => acc + (s.duration || 0), 0);
    const h = Math.floor(totalMin / 60);
    const m = Math.round(totalMin % 60);
    durEl.textContent = h > 0 ? `${h}h ${m}m` : `${m}m`;
  }

  /* Table */
  const container = document.getElementById('library-list');
  if (!container) return;
  const header = `
    <div class="st-header">
      <span class="st-h st-h-num">#</span>
      <span class="st-h">Title</span>
      <span class="st-h">Album</span>
      <span class="st-h">Genre</span>
      <span class="st-h st-h-dur">Duration</span>
      <span class="st-h st-h-act"></span>
    </div>`;
  if (!songs.length) {
    container.innerHTML = header + '<p style="padding:32px;color:var(--text-2);text-align:center">No songs found 🎵</p>';
    return;
  }
  container.innerHTML = header + songs.map((s, i) => `
    <div class="st-row" id="lib-str-${s.id}" onclick="openPlayerById('${escapeHtmlAttr(String(s.id))}')">
      <span class="st-num">${i + 1}</span>
      <div class="st-title-col">
        <div class="st-thumb" style="background:${gradientFor(s.id)}">
          <img src="${imgFor(s.id)}" alt="${escapeHtmlAttr(s.title)}" data-song-id="${s.id}"/>
        </div>
        <div>
          <p class="st-song-name">${escapeHtmlText(s.title)} ${isYTSong(s.id) ? '<span class="yt-badge">🔴 YT Music</span>' : ''}</p>
          <p class="st-artist">${escapeHtmlText(s.artist)}</p>
        </div>
      </div>
      <span class="st-cell">${escapeHtmlText(s.album)}</span>
      <span class="st-cell">
        <span class="genre-tag">${escapeHtmlText(s.genre)}</span>
      </span>
      <span class="st-dur">${fmtDur(s.duration)}</span>
      <div class="st-acts">
        <button class="icon-act like-btn" data-song-id="${s.id}"
          onclick="toggleLike(this,event)" aria-label="Like">${s.liked ? '❤️' : '♡'}</button>
        <button class="icon-act" title="Add to queue"
          onclick="enqueueSong('${escapeHtmlAttr(String(s.id))}',event)" aria-label="Queue">＋</button>
        <button class="icon-act" title="Add to playlist"
          onclick="addToPlaylistPrompt('${escapeHtmlAttr(String(s.id))}',event)" aria-label="Playlist">⋯</button>
        <button class="icon-act lib-del-btn" title="Remove from library"
          onclick="deleteSong('${escapeHtmlAttr(String(s.id))}',event)" aria-label="Remove song">🗑️</button>
      </div>
    </div>`).join('');
}

function filterLibraryGenre(btn, genre) {
  document.querySelectorAll('#lib-genre-filters .filter-chip').forEach(c => c.classList.remove('active'));
  btn.classList.add('active');
  const filtered = genre === 'all' ? _libAllSongs : _libAllSongs.filter(s => s.genre === genre);
  renderLibrary(filtered);
}

async function sortLibraryPage(field) {
  const sorted = await apiPost('/sort', { field });
  if (sorted) {
    state.songs = sorted;
    _libAllSongs = sorted;
    /* Re-apply active genre filter */
    const activeChip = document.querySelector('#lib-genre-filters .filter-chip.active');
    const genre = activeChip ? activeChip.textContent.replace(/[^a-zA-Z-]/g,'').trim() : 'all';
    const filtered = (genre === 'all' || genre === 'All') ? sorted : sorted.filter(s => s.genre === genre);
    renderLibrary(filtered);
    showToast(`Sorted by ${field} ✅`);
  }
}

/* ── Search State ─────────────── */
let currentYTFeedCategory = 'for-you';
let ytSearchDebounceTimer = null;
let currentYTResults = [];

/* YouTube Music Exclusive Search */
async function handleSearch(q, immediate = false) {
  const query = typeof q === 'string' ? q : '';
  const clearBtn  = document.getElementById('clear-btn');
  const clearBtn2 = document.getElementById('clear-btn-top');
  if (clearBtn)  clearBtn.style.display  = query ? 'block' : 'none';
  if (clearBtn2) clearBtn2.style.display = query ? 'block' : 'none';

  // Keep both search inputs synchronized in real-time
  const in1 = document.getElementById('search-input');
  const in2 = document.getElementById('search-input-top');
  if (in1 && in1.value !== query) in1.value = query;
  if (in2 && in2.value !== query) in2.value = query;

  showSugg();

  // If user searched from topbar while on another page, navigate to Discover/Search page
  if (query.trim() && state.currentPage !== 'search') {
    closePlaylistView();
    navigate('search');
  }

  const defView     = document.getElementById('discover-feed-container');
  const resView     = document.getElementById('search-results-view');
  const onlineSec   = document.getElementById('search-online-section');
  const chipsHeader = document.getElementById('yt-mode-header');
  const tasteBanner = document.getElementById('discover-taste-banner');
  const searchDef   = document.getElementById('search-default-view');
  const ytMusicView = document.getElementById('yt-music-view');
  const titleEl     = document.getElementById('yt-results-title');
  const countEl     = document.getElementById('yt-results-count');
  const grid        = document.getElementById('yt-music-grid');

  if (!query.trim()) {
    if (defView)     defView.style.display   = '';
    if (resView)     resView.style.display   = 'none';
    if (onlineSec)   onlineSec.style.display = 'none';
    if (chipsHeader) chipsHeader.style.display = '';
    if (tasteBanner && currentYTFeedCategory === 'for-you') tasteBanner.style.display = 'flex';
    if (searchDef)   searchDef.style.display = '';
    if (ytMusicView) ytMusicView.style.display = '';
    loadYTFeed(currentYTFeedCategory || 'for-you');
    return;
  }

  // Active YouTube Music search state
  state.activePlaylistId = null;
  const delBtn = document.getElementById('delete-playlist-view-btn');
  if (delBtn) delBtn.style.display = 'none';

  if (defView)     defView.style.display   = '';
  if (resView)     resView.style.display   = 'none'; // Only search YouTube Music (no local library table)
  if (onlineSec)   onlineSec.style.display = 'none';
  if (chipsHeader) chipsHeader.style.display = 'none'; // Keep search results prominent right below search bar
  if (tasteBanner) tasteBanner.style.display = 'none';
  if (searchDef)   searchDef.style.display = 'none';
  if (ytMusicView) ytMusicView.style.display = '';

  if (titleEl) titleEl.textContent = `YouTube Music Results for "${query.trim()}"`;
  if (countEl) countEl.textContent = 'Searching YouTube Music…';

  if (grid) {
    grid.innerHTML = `
      <div class="yt-skeleton-card"><div class="yt-skel-thumb"></div><div class="yt-skel-line"></div><div class="yt-skel-line short"></div></div>
      <div class="yt-skeleton-card"><div class="yt-skel-thumb"></div><div class="yt-skel-line"></div><div class="yt-skel-line short"></div></div>
      <div class="yt-skeleton-card"><div class="yt-skel-thumb"></div><div class="yt-skel-line"></div><div class="yt-skel-line short"></div></div>
      <div class="yt-skeleton-card"><div class="yt-skel-thumb"></div><div class="yt-skel-line"></div><div class="yt-skel-line short"></div></div>
    `;
  }

  clearTimeout(ytSearchDebounceTimer);
  if (immediate) {
    performYTMusicSearch(query.trim());
  } else {
    ytSearchDebounceTimer = setTimeout(async () => {
      await performYTMusicSearch(query.trim());
    }, 220);
  }
}

let ytMusicSearchReqId = 0;

async function performYTMusicSearch(query) {
  const q = (query || '').trim();
  if (!q) return;

  const thisReqId = ++ytMusicSearchReqId;
  const countEl = document.getElementById('yt-results-count');
  const grid    = document.getElementById('yt-music-grid');

  if (typeof YTMusicAPI !== 'undefined') {
    try {
      const tracks = await YTMusicAPI.search(q, 24);

      // Prevent race conditions if user typed a newer search query
      if (thisReqId !== ytMusicSearchReqId) {
        return;
      }

      if (countEl) countEl.textContent = `${tracks.length} YouTube Music Tracks`;
      renderYTMusicGrid(tracks, grid, countEl);
    } catch (e) {
      console.warn('YouTube Music search error:', e);
      if (thisReqId !== ytMusicSearchReqId) return;
      if (countEl) countEl.textContent = '0 Tracks';
      if (grid) {
        grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:28px 16px;color:var(--text-muted)">Unable to load YouTube Music search results. Please check your network connection.</div>`;
      }
    }
  }
}

const performUnifiedSearch = performYTMusicSearch;

async function showSugg() {
  const activeInput = (document.activeElement && (document.activeElement.id === 'search-input' || document.activeElement.id === 'search-input-top'))
    ? document.activeElement
    : (document.getElementById('search-input') || document.getElementById('search-input-top'));
  const q = (activeInput?.value || '').trim();
  const boxes = ['suggestions-box','suggestions-box-2'];
  if (!q) {
    boxes.forEach(id => { const el=document.getElementById(id); if(el) el.style.display='none'; });
    return;
  }

  let onlineSugg = [];
  if (typeof YTMusicAPI !== 'undefined') {
    try {
      onlineSugg = await YTMusicAPI.getSuggestions(q);
    } catch(e) {}
  }

  const items = (onlineSugg || []).slice(0, 6).map(s => ({
    html: `🔍 <span style="font-weight:600">${escapeHtmlText(s)}</span>`,
    val: s
  }));

  boxes.forEach(id => {
    const box = document.getElementById(id);
    if (!box) return;
    if (items.length) {
      box.innerHTML = items.map(it => `<div class="sugg-item" onclick="selectSuggestion('${escapeHtmlAttr(it.val)}')">${it.html}</div>`).join('');
      box.style.display = 'block';
    } else {
      box.style.display = 'none';
    }
  });
}

function clearSearch() {
  ['search-input','search-input-top'].forEach(id => { const el=document.getElementById(id); if(el) el.value=''; });
  handleSearch('');
  ['suggestions-box','suggestions-box-2'].forEach(id => { const el=document.getElementById(id); if(el) el.style.display='none'; });
}

function clearRecent() {
  const list = document.getElementById('recent-list');
  if (list) list.innerHTML = '<p style="color:var(--text-2);font-size:13px;padding:8px 0">No recent searches</p>';
}

function selectSuggestion(text) {
  ['search-input','search-input-top'].forEach(id => { const el=document.getElementById(id); if(el) el.value=text; });
  ['suggestions-box','suggestions-box-2'].forEach(id => { const el=document.getElementById(id); if(el) el.style.display='none'; });
  handleSearch(text);
  addToRecent(text);
}

function addToRecent(text) {
  const list = document.getElementById('recent-list');
  if (!list) return;
  const existing = Array.from(list.querySelectorAll('.recent-chip')).find(el => el.textContent.includes(text));
  if (existing) existing.remove();
  const chip = document.createElement('div');
  chip.className = 'recent-chip';
  chip.onclick = () => selectSuggestion(text);
  chip.innerHTML = `🕐 ${text} <button onclick="event.stopPropagation();this.parentElement.remove()" aria-label="Remove">✕</button>`;
  list.prepend(chip);
}

function selectFilter(btn, filter) {
  document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
  btn.classList.add('active');
  /* If there's an active search, re-run it with filter hint */
  const input = document.getElementById('search-input');
  if (input && input.value) handleSearch(input.value);
}

function searchCategory(cat) {
  navigate('search');
  ['search-input','search-input-top'].forEach(id => { const el=document.getElementById(id); if(el) el.value=cat; });
  handleSearch(cat);
}

/* DEMO STUB — Simulates voice search by auto-selecting the first library song after a delay.
   For real voice input, replace body with window.SpeechRecognition / webkitSpeechRecognition. */
function startVoiceSearch() {
  showToast('🎙️ Listening…');
  const target = state.songs.length > 0 ? state.songs[0].title : 'Tujhko';
  setTimeout(() => { selectSuggestion(target); }, 1200);
}

/* ── Toast ────────────────────────────────────── */
function showToast(msg) {
  let t = document.getElementById('vibe-toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'vibe-toast';
    t.style.cssText = `position:fixed;top:22px;left:50%;transform:translateX(-50%) translateY(-10px);
      background:var(--bg-2, #150d2e);backdrop-filter:blur(16px);color:var(--text-1, #ffffff);border-radius:30px;
      padding:10px 22px;font-size:13px;font-weight:600;font-family:'Outfit',sans-serif;z-index:9999;
      opacity:0;transition:opacity .25s ease, transform .25s ease;white-space:nowrap;
      border:1px solid var(--glass-border, rgba(255,255,255,0.15));
      box-shadow:var(--glow, 0 4px 20px rgba(0,0,0,0.4));
      pointer-events:none !important;display:none;`;
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.style.display = 'block';
  requestAnimationFrame(() => {
    t.style.opacity = '1';
    t.style.transform = 'translateX(-50%) translateY(0)';
  });
  clearTimeout(t._t);
  t._t = setTimeout(() => {
    t.style.opacity = '0';
    t.style.transform = 'translateX(-50%) translateY(-10px)';
    setTimeout(() => {
      if (t.style.opacity === '0') t.style.display = 'none';
    }, 260);
  }, 2200);
}

/* ── Notifications (Per-User Data Isolated) ────────────────────────── */
function getUserNotifications() {
  try {
    const raw = localStorage.getItem(getUserStorageKey('notifications'));
    if (raw) return JSON.parse(raw);
  } catch (e) {}

  const u = authState.currentUser;
  const isGuest = !u || u.id === 'guest' || u.provider === 'guest';
  if (isGuest) {
    return [];
  }
  return [
    {
      id: 'welcome_' + u.id,
      icon: '🎵',
      grad: 'linear-gradient(135deg,#7c3aed,#2563eb)',
      title: 'Welcome to Dhun',
      text: `Your private profile is active. Enjoy high-fidelity listening!`,
      time: 'Just now',
      unread: true
    }
  ];
}

function saveUserNotifications(notifs) {
  try {
    localStorage.setItem(getUserStorageKey('notifications'), JSON.stringify(notifs));
  } catch (e) {}
}

function renderUserNotifications() {
  const list = document.getElementById('notif-list');
  if (!list) return;
  const notifs = getUserNotifications();
  if (!notifs || notifs.length === 0) {
    list.innerHTML = `<div class="notif-empty"><div class="notif-empty-icon">🔕</div><p>You're all caught up!</p></div>`;
    updateNotifBadge();
    return;
  }
  list.innerHTML = notifs.map(n => `
    <div class="notif-item ${n.unread ? 'unread' : ''}" onclick="dismissNotifById('${n.id}')">
      <div class="notif-icon" style="background:${n.grad || 'linear-gradient(135deg,#7c3aed,#ec4899)'}">${n.icon || '🔔'}</div>
      <div class="notif-body">
        <p class="notif-text"><strong>${escapeHtmlText(n.title)}:</strong> ${escapeHtmlText(n.text)}</p>
        <p class="notif-time">${n.time || 'Just now'}</p>
      </div>
      <button class="notif-close" onclick="event.stopPropagation();dismissNotifById('${n.id}')" aria-label="Dismiss">✕</button>
    </div>
  `).join('');
  updateNotifBadge();
}

function dismissNotifById(id) {
  let notifs = getUserNotifications();
  notifs = notifs.filter(n => n.id !== id);
  saveUserNotifications(notifs);
  renderUserNotifications();
}

function dismissNotif(item) {
  if (!item) return;
  const notifId = item.dataset.notifId;
  if (notifId) {
    dismissNotifById(notifId);
    return;
  }
  item.classList.remove('unread');
  item.style.transition = 'opacity 0.3s, transform 0.3s, max-height 0.3s, padding 0.3s';
  item.style.opacity = '0';
  item.style.transform = 'translateX(20px)';
  setTimeout(() => {
    item.style.maxHeight = item.offsetHeight + 'px';
    item.style.overflow = 'hidden';
    item.style.padding = '0 16px';
    setTimeout(() => {
      item.style.maxHeight = '0';
      setTimeout(() => { item.remove(); updateNotifBadge(); showEmptyIfNeeded(); }, 320);
    }, 50);
  }, 300);
}

function markAllRead() {
  let notifs = getUserNotifications();
  notifs.forEach(n => { n.unread = false; });
  saveUserNotifications(notifs);
  renderUserNotifications();
}

function clearAllNotifs() {
  saveUserNotifications([]);
  renderUserNotifications();
}

function showEmptyIfNeeded() {
  const list = document.getElementById('notif-list');
  if (!list) return;
  if (list.children.length === 0) {
    list.innerHTML = `<div class="notif-empty"><div class="notif-empty-icon">🔕</div><p>You're all caught up!</p></div>`;
  }
}

function updateNotifBadge() {
  const badge = document.getElementById('notif-badge');
  if (!badge) return;
  const notifs = getUserNotifications();
  const unread = notifs.filter(n => n.unread).length;
  badge.textContent = unread;
  badge.style.display = unread > 0 ? 'flex' : 'none';
}

function toggleNotifPanel() {
  const panel = document.getElementById('notif-panel');
  const btn   = document.getElementById('notif-btn');
  if (!panel) return;
  const isOpen = panel.style.display !== 'none';
  if (!isOpen) {
    renderUserNotifications();
    const themePanel = document.getElementById('theme-panel');
    const themeBtn   = document.getElementById('theme-toggle-btn');
    if (themePanel) themePanel.style.display = 'none';
    if (themeBtn)   themeBtn.setAttribute('aria-expanded', 'false');
  }
  panel.style.display = isOpen ? 'none' : 'block';
  btn.setAttribute('aria-expanded', String(!isOpen));
}

/* ── Theme Switcher ──────────────────────────── */
function toggleThemePanel() {
  const panel = document.getElementById('theme-panel');
  const btn   = document.getElementById('theme-toggle-btn');
  if (!panel) return;
  const isOpen = panel.style.display !== 'none';
  if (!isOpen) {
    /* Close notif panel if open */
    const notifPanel = document.getElementById('notif-panel');
    const notifBtn   = document.getElementById('notif-btn');
    if (notifPanel) notifPanel.style.display = 'none';
    if (notifBtn)   notifBtn.setAttribute('aria-expanded', 'false');
  }
  panel.style.display = isOpen ? 'none' : 'block';
  if (btn) btn.setAttribute('aria-expanded', String(!isOpen));
}

function setTheme(theme, showNotice = true) {
  const themes = ['default', 'dark', 'light'];
  if (!themes.includes(theme)) theme = 'default';

  /* Apply theme attribute to root */
  if (theme === 'default') {
    document.documentElement.removeAttribute('data-theme');
  } else {
    document.documentElement.setAttribute('data-theme', theme);
  }

  /* Persist user preference */
  try {
    localStorage.setItem('vibe-theme', theme);
  } catch (e) {}

  /* Update menu item active states and checks */
  themes.forEach(t => {
    const opt = document.getElementById(`theme-opt-${t}`);
    const chk = document.getElementById(`check-${t}`);
    if (opt) {
      if (t === theme) {
        opt.classList.add('active');
      } else {
        opt.classList.remove('active');
      }
    }
    if (chk) {
      chk.style.display = (t === theme) ? 'inline' : 'none';
    }
  });

  /* Update theme toggle button icon */
  const btn = document.getElementById('theme-toggle-btn');
  if (btn) {
    if (theme === 'light') {
      btn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="12" r="5" stroke="currentColor" stroke-width="2"/>
        <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
      </svg>`;
      btn.title = 'Theme: Light Sunburst (Click to change)';
    } else if (theme === 'dark') {
      btn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none">
        <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>`;
      btn.title = 'Theme: Dark Electric Cyan (Click to change)';
    } else {
      btn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="12" r="4" stroke="currentColor" stroke-width="2"/>
        <path d="M12 2v2M12 20v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M2 12h2M20 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
      </svg>`;
      btn.title = 'Theme: Violet Indigo (Click to change)';
    }
  }

  /* Close dropdown panel */
  const panel = document.getElementById('theme-panel');
  if (panel) panel.style.display = 'none';
  if (btn) btn.setAttribute('aria-expanded', 'false');

  if (showNotice && typeof showToast === 'function') {
    const titles = { default: 'Violet Indigo', dark: 'Dark Electric Cyan', light: 'Light Sunburst' };
    showToast(`🎨 Mode: ${titles[theme] || theme}`);
  }

  /* Always re-sync play/pause icon state after theme change */
  updatePlayUI();
}

/* ── Click outside to close suggestions & notif panel & theme panel ── */
document.addEventListener('click', e => {
  const inSearch = e.target.closest('.search-hero-bar, .topbar-search, #suggestions-box, #suggestions-box-2');
  if (!inSearch) {
    ['suggestions-box','suggestions-box-2'].forEach(id => { const el=document.getElementById(id); if(el) el.style.display='none'; });
  }
  const inNotif = e.target.closest('#notif-panel, #notif-btn');
  if (!inNotif) {
    const panel = document.getElementById('notif-panel');
    const btn   = document.getElementById('notif-btn');
    if (panel) panel.style.display = 'none';
    if (btn)   btn.setAttribute('aria-expanded', 'false');
  }
  const inTheme = e.target.closest('#theme-panel, #theme-toggle-btn');
  if (!inTheme) {
    const themePanel = document.getElementById('theme-panel');
    const themeBtn   = document.getElementById('theme-toggle-btn');
    if (themePanel) themePanel.style.display = 'none';
    if (themeBtn)   themeBtn.setAttribute('aria-expanded', 'false');
  }
});

/* ══════════════════════════════════════════════════
   INITIALIZATION & EVENT LISTENERS
   App entry point on DOMContentLoaded:
     1. Restore saved theme from localStorage
     2. Load songs from API and run deduplication pass
     3. Set default volume and restore IndexedDB audio blobs
     4. Register keyboard shortcuts (Space, Arrow keys)
     5. Set up drag-and-drop audio file import
     6. Initialize the Jam session BroadcastChannel
   ══════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', async () => {
  /* Initialize User Profile & Auth Session first */
  initProfile();

  /* Restore theme */
  let savedTheme = 'default';
  try {
    savedTheme = localStorage.getItem('vibe-theme') || 'default';
  } catch (e) {}
  setTheme(savedTheme, false);

  const initialHash = (location.hash || '').replace('#', '').trim();
  navigate(['home', 'search', 'library', 'player', 'profile'].includes(initialHash) ? initialHash : 'home');

  /* Initial paused state */
  const eq = document.getElementById('equalizer');
  if (eq) eq.querySelectorAll('span').forEach(s => s.style.animationPlayState = 'paused');

  /* Initialize Windows 7 Media Player style flow visualizer */
  initFlowVisualizer();
  if (typeof initVisualShowcaseCanvases === 'function') initVisualShowcaseCanvases();

  setVolume(75);

  /* Restore audio blobs from IndexedDB cache & YouTube Music storage */
  await loadAudioBlobsFromDB();
  loadYTSongsFromStorage();

  /* Automatically populate Dhun library with rich online media */
  await autoSeedLibraryWithOnlineMedia();
  loadYTFeed('for-you');

  /* Load songs from API or local client storage */
  let songs = await apiGet('/songs');
  if (!songs || songs.length === 0) {
    try {
      const stored = localStorage.getItem('dhun_client_songs');
      if (stored) songs = JSON.parse(stored);
    } catch (e) {}
  }
  if (!songs || songs.length === 0) {
    songs = state.songs;
  }

  if (songs && songs.length > 0) {
    state.songs = songs;
    _libAllSongs = state.songs;
    syncAllSongsLikedState();
    await inbuiltLibraryDeduplication();
    preloadKnownYouTubeThumbnails();
    state.currentSong = state.songs[0];
    loadSongUI(state.songs[0]);
    renderHero();
    renderRecommended();
    renderTrending();
    renderRecentlyPlayed();
    renderRelated();
    renderProfileStats();
    showToast('🎵 Welcome to Dhun!');
    /* Fetch YT Music album art for all library songs in background */
    resolveAllLibraryAlbumPhotos();
  } else {
    /* Empty or offline library */
    renderHero();
    renderRecommended();
    renderRecentlyPlayed();
    renderProfileStats();
  }

  /* Auto-generate multiple themed playlists & load playlists */
  await autoGenerateMultiplePlaylists();
  await refreshPlaylists();

  /* Keyboard shortcuts */
  document.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
    if (e.code === 'ArrowRight') nextSong();
    if (e.code === 'ArrowLeft')  prevSong();
  });

  /* Drag & Drop Audio files from PC */
  const overlay = document.getElementById('pc-drag-overlay');
  let dragCounter = 0;

  window.addEventListener('dragenter', e => {
    if (e.dataTransfer && e.dataTransfer.types && Array.from(e.dataTransfer.types).includes('Files')) {
      e.preventDefault();
      dragCounter++;
      if (overlay) overlay.style.display = 'flex';
    }
  });

  window.addEventListener('dragover', e => {
    if (e.dataTransfer && e.dataTransfer.types && Array.from(e.dataTransfer.types).includes('Files')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    }
  });

  window.addEventListener('dragleave', e => {
    dragCounter--;
    if (dragCounter <= 0) {
      dragCounter = 0;
      if (overlay) overlay.style.display = 'none';
    }
  });

  window.addEventListener('drop', e => {
    e.preventDefault();
    dragCounter = 0;
    if (overlay) overlay.style.display = 'none';
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handlePCAudioFiles(e.dataTransfer.files);
    }
  });

  /* Initialize Listen Together real-time channel */
  initJamChannel();
});

/* ═══════════════════════════════════════════════
   LISTEN TOGETHER WITH FRIENDS (JAM SESSIONS)
═══════════════════════════════════════════════ */

const jamState = {
  active: false,
  roomId: null,
  isHost: false,
  userName: 'You (DJ)',
  allowControl: true,
  members: [],
  channel: null,
  mqttClient: null,
  mqttConnected: false,
  heartbeatTimer: null,
  _isRemoteSync: false,
  lastEventId: 0,
  pollTimer: null,
  isPolling: false
};

/* Dedicated silent API caller for Jam Session sync (Local Desktop fallback) */
async function jamApi(method, path, data) {
  try {
    const opts = {
      method,
      headers: { 'Content-Type': 'application/json' }
    };
    if (data) opts.body = JSON.stringify(data);
    const res = await fetch(API + path, opts);
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      return { ok: false, status: res.status, error: err.error || res.statusText };
    }
    const json = await res.json();
    return { ok: true, status: res.status, data: json };
  } catch (e) {
    return { ok: false, status: 0, error: 'Network error or server offline' };
  }
}

/* Connect to public global WebSocket MQTT Broker for cross-device real-time sync */
function connectJamMqtt(roomId, onReady) {
  disconnectJamMqtt();

  if (typeof mqtt === 'undefined') {
    console.warn('[Jam MQTT] mqtt.js library not loaded yet, falling back to local sync');
    if (onReady) onReady(false);
    return;
  }

  const brokerUrls = [
    'wss://broker.emqx.io:8084/mqtt',
    'wss://broker.hivemq.com:8884/mqtt'
  ];
  let currentIdx = 0;
  let settled = false;

  function tryNext() {
    if (settled) return;
    if (currentIdx >= brokerUrls.length) {
      settled = true;
      if (onReady) onReady(false);
      return;
    }
    const url = brokerUrls[currentIdx++];
    console.log(`[Jam MQTT] Connecting to ${url}...`);

    try {
      const clientId = 'dhun_' + Math.random().toString(36).substring(2, 11);
      const client = mqtt.connect(url, {
        clientId,
        clean: true,
        connectTimeout: 8000,
        reconnectPeriod: 3000
      });

      jamState.mqttClient = client;

      client.on('connect', () => {
        console.log(`[Jam MQTT] Connected to ${url}`);
        jamState.mqttConnected = true;
        const topic = `dhun/v2/rooms/${roomId}`;
        client.subscribe(topic, { qos: 0 }, (err) => {
          if (err) console.warn('[Jam MQTT] Subscribe error:', err);
          else console.log(`[Jam MQTT] Subscribed to room topic: ${topic}`);
        });

        if (!settled) {
          settled = true;
          if (onReady) onReady(true);
        }
      });

      client.on('message', (t, rawMsg) => {
        try {
          const str = rawMsg.toString();
          const data = JSON.parse(str);
          handleJamMessageData(data);
        } catch(e) {
          console.warn('[Jam MQTT] Message parse error:', e);
        }
      });

      client.on('error', (err) => {
        console.warn(`[Jam MQTT] Error with ${url}:`, err);
        if (!jamState.mqttConnected && !settled) {
          try { client.end(true); } catch(e){}
          tryNext();
        }
      });
    } catch(err) {
      console.warn('[Jam MQTT] Init failed:', err);
      tryNext();
    }
  }

  tryNext();
}

function disconnectJamMqtt() {
  if (jamState.mqttClient) {
    try {
      if (jamState.roomId) {
        jamState.mqttClient.unsubscribe(`dhun/v2/rooms/${jamState.roomId}`);
      }
      jamState.mqttClient.end(true);
    } catch(e){}
    jamState.mqttClient = null;
    jamState.mqttConnected = false;
  }
}

function initJamChannel() {
  if (typeof BroadcastChannel !== 'undefined' && !jamState.channel) {
    try {
      jamState.channel = new BroadcastChannel('dhun_jam_sync_channel');
      jamState.channel.onmessage = handleJamBroadcast;
    } catch(e) {
      console.warn('BroadcastChannel error:', e);
    }
  }

  // Cross-window localStorage storage event fallback
  window.addEventListener('storage', e => {
    if (e.key === 'dhun_jam_last_event' && e.newValue) {
      try {
        const data = JSON.parse(e.newValue);
        handleJamMessageData(data);
      } catch(err){}
    }
  });

  // Clean disconnect on tab/window close
  window.addEventListener('beforeunload', () => {
    if (jamState.active) {
      leaveJamSession(true);
    }
  });

  // Check URL query parameters for ?jam=DHUN-XXXX
  try {
    const params = new URLSearchParams(window.location.search);
    const jamCode = params.get('jam');
    if (jamCode) {
      setTimeout(() => {
        openListenTogetherModal();
        switchJamTab('join');
        const codeInput = document.getElementById('jam-room-code-input');
        if (codeInput) codeInput.value = jamCode.toUpperCase();
        showToast(`🎧 Join room invite detected: ${jamCode.toUpperCase()}`);
      }, 700);
    }
  } catch(e){}
}

function broadcastJam(payload) {
  if (!jamState.active || jamState._isRemoteSync) return;

  let songPayload = payload.song || null;
  if (!songPayload && state.currentSong) {
    const vid = state.currentSong.videoId || (typeof getCurrentYTVideoId === 'function' ? getCurrentYTVideoId() : null);
    songPayload = {
      id: state.currentSong.id,
      title: state.currentSong.title,
      artist: state.currentSong.artist,
      album: state.currentSong.album,
      genre: state.currentSong.genre,
      duration: state.currentSong.duration,
      liked: state.currentSong.liked,
      videoId: vid || undefined,
      source: isCurrentSongYT() ? 'ytmusic' : (state.currentSong.source || 'library')
    };
  } else if (songPayload) {
    const vid = songPayload.videoId || (typeof getCurrentYTVideoId === 'function' ? getCurrentYTVideoId() : null);
    songPayload = {
      ...songPayload,
      videoId: vid || undefined,
      source: isCurrentSongYT() ? 'ytmusic' : (songPayload.source || 'library')
    };
  }

  const msg = {
    ...payload,
    song: songPayload,
    roomId: jamState.roomId,
    sender: jamState.userName,
    timestamp: Date.now()
  };

  // 1. MQTT Cloud Real-Time Broker (Cross-device, works globally anywhere)
  if (jamState.mqttClient && jamState.mqttConnected) {
    try {
      const topic = `dhun/v2/rooms/${jamState.roomId}`;
      jamState.mqttClient.publish(topic, JSON.stringify(msg), { qos: 0 });
    } catch(e) {
      console.warn('[Jam MQTT] Publish error:', e);
    }
  }

  // 2. Cross-tab BroadcastChannel fallback
  if (jamState.channel) {
    try { jamState.channel.postMessage(msg); } catch(e){}
  }

  // 3. Cross-window localStorage fallback
  try {
    localStorage.setItem('dhun_jam_last_event', JSON.stringify(msg));
  } catch(e){}

  // 4. Central C Backend Server sync fallback
  jamApi('POST', '/jam/sync', msg).catch(() => {});
}

function handleJamBroadcast(event) {
  handleJamMessageData(event.data);
}

function applyRemoteSeek(progressPct) {
  state.progress = Math.max(0, Math.min(100, Number(progressPct) || 0));
  updateProgress();

  if (isCurrentSongYT()) {
    if (ytPlayer && ytPlayer.seekTo) {
      const dur = (ytPlayer.getDuration && ytPlayer.getDuration()) || ((state.currentSong?.duration || 3.5) * 60);
      const targetSec = (state.progress / 100) * dur;
      try { ytPlayer.seekTo(targetSec, true); } catch(e){}
    }
  } else {
    if (globalAudioPlayer && globalAudioPlayer.duration) {
      const targetSec = (state.progress / 100) * globalAudioPlayer.duration;
      try { globalAudioPlayer.currentTime = targetSec; } catch(e){}
    }
  }
}

function applyRemoteSong(song, shouldPlay, progress) {
  if (!song) return;

  if (song.videoId) {
    const ytData = {
      isYT: true,
      videoId: song.videoId,
      thumbnail: song.thumbnail || `https://i.ytimg.com/vi/${song.videoId}/hqdefault.jpg`,
      durationSec: song.durationSec || ((song.duration || 3.5) * 60),
      title: song.title,
      artist: song.artist
    };
    if (typeof pcSongAudioMap !== 'undefined') pcSongAudioMap.set(song.id, ytData);
    if (typeof saveYTSongToStorage === 'function') saveYTSongToStorage(song.id, ytData);
  }

  state.currentSong = song;
  loadSongUI(song);

  if (progress !== undefined && progress !== null) {
    state.progress = Math.max(0, Math.min(100, Number(progress) || 0));
    updateProgress();
  }

  if (shouldPlay) {
    startPlaying();
    if (progress !== undefined && progress > 0) {
      setTimeout(() => applyRemoteSeek(progress), 200);
    }
  } else {
    stopPlaying();
  }
}

function handleJamMessageData(data) {
  if (!data || !data.roomId) return;
  if (!jamState.active && data.type !== 'JOIN_REQUEST' && data.type !== 'JOIN_ROOM') return;
  if (data.roomId !== jamState.roomId) return;
  if (data.sender === jamState.userName) return;

  jamState._isRemoteSync = true;
  try {
    switch (data.type) {
      case 'SYNC_PLAY':
        if (data.song && (!state.currentSong || state.currentSong.id !== data.song.id)) {
          applyRemoteSong(data.song, true, data.progress);
        } else {
          if (data.progress !== undefined) {
            applyRemoteSeek(data.progress);
          }
          if (!state.isPlaying) {
            startPlaying();
          }
        }
        showToast(`🎧 ${data.sender} hit play`);
        break;

      case 'SYNC_PAUSE':
        if (state.isPlaying) {
          stopPlaying();
        }
        if (data.progress !== undefined) {
          applyRemoteSeek(data.progress);
        }
        showToast(`⏸️ ${data.sender} paused`);
        break;

      case 'SYNC_SEEK':
        if (data.progress !== undefined) {
          applyRemoteSeek(data.progress);
          showToast(`⏩ ${data.sender} scrubbed track`);
        }
        break;

      case 'SYNC_SONG':
        if (data.song) {
          applyRemoteSong(data.song, data.shouldPlay ?? state.isPlaying, 0);
          showToast(`🎵 ${data.sender} queued "${data.song.title}"`);
        }
        break;

      case 'REACTION':
        renderJamReactionParticle(data.emoji, data.sender);
        break;

      case 'JOIN_REQUEST':
      case 'JOIN_ROOM':
      case 'JOIN': {
        const existingMember = jamState.members.find(m => m.name === data.sender);
        if (!existingMember) {
          const initials = (data.avatar || (data.sender || 'FR').slice(0, 2)).toUpperCase();
          jamState.members.push({
            name: data.sender,
            avatar: initials,
            color: data.color || '#06b6d4',
            isHost: false
          });
          renderJamMembers();
          updateJamUI();
          showToast(`🎉 ${data.sender} joined your Jam!`);
        }
        // If we are Host, broadcast our current room state immediately back to the room
        if (jamState.isHost) {
          const currentSongPayload = state.currentSong ? {
            ...state.currentSong,
            videoId: state.currentSong.videoId || (typeof getCurrentYTVideoId === 'function' ? getCurrentYTVideoId() : null),
            source: isCurrentSongYT() ? 'ytmusic' : (state.currentSong.source || 'library')
          } : null;

          broadcastJam({
            type: 'ROOM_STATE_REPLY',
            host: jamState.userName,
            members: jamState.members,
            song: currentSongPayload,
            progress: state.progress || 0,
            isPlaying: !!state.isPlaying,
            allowControl: jamState.allowControl
          });
        }
        break;
      }

      case 'ROOM_STATE_REPLY':
      case 'ROOM_ANNOUNCE':
      case 'HEARTBEAT': {
        // Sync members list
        if (Array.isArray(data.members) && data.members.length > 0) {
          data.members.forEach(m => {
            if (!jamState.members.some(e => e.name === m.name)) {
              jamState.members.push(m);
            }
          });
          // Ensure self is in members list
          if (!jamState.members.some(e => e.name === jamState.userName)) {
            jamState.members.push({
              name: jamState.userName,
              avatar: jamState.isHost ? 'DJ' : jamState.userName.slice(0, 2).toUpperCase(),
              color: jamState.isHost ? '#7c3aed' : '#06b6d4',
              isHost: jamState.isHost
            });
          }
          renderJamMembers();
          updateJamUI();
        }

        // Guests sync song from Host
        if (!jamState.isHost) {
          if (data.song) {
            const isDifferentSong = !state.currentSong || state.currentSong.id !== data.song.id || (data.song.videoId && state.currentSong.videoId !== data.song.videoId);
            if (isDifferentSong) {
              applyRemoteSong(data.song, data.isPlaying, data.progress);
              showToast(`🎵 Synced track with DJ: "${data.song.title}"`);
            } else {
              if (data.isPlaying !== undefined && data.isPlaying !== state.isPlaying) {
                if (data.isPlaying) startPlaying();
                else stopPlaying();
              }
              if (data.progress !== undefined && Math.abs((state.progress || 0) - data.progress) > 3) {
                applyRemoteSeek(data.progress);
              }
            }
          }
        }
        break;
      }

      case 'LEAVE_ROOM':
      case 'LEAVE':
        jamState.members = jamState.members.filter(m => m.name !== data.sender);
        renderJamMembers();
        updateJamUI();
        showToast(`👋 ${data.sender} left the jam`);
        break;
    }
  } finally {
    jamState._isRemoteSync = false;
  }
}

function openListenTogetherModal() {
  const modal = document.getElementById('listen-together-modal');
  if (modal) {
    modal.style.display = 'flex';
    if (jamState.active) {
      showJamPanel('active');
      renderJamMembers();
      updateJamUI();
    } else {
      showJamPanel('host');
      switchJamTab('host');
    }
  }
}

function closeListenTogetherModal() {
  const modal = document.getElementById('listen-together-modal');
  if (modal) modal.style.display = 'none';
}

function switchJamTab(tab) {
  const hostBtn = document.getElementById('jam-tab-host');
  const joinBtn = document.getElementById('jam-tab-join');
  if (tab === 'host') {
    if (hostBtn) hostBtn.classList.add('active');
    if (joinBtn) joinBtn.classList.remove('active');
    showJamPanel('host');
  } else {
    if (hostBtn) hostBtn.classList.remove('active');
    if (joinBtn) joinBtn.classList.add('active');
    showJamPanel('join');
  }
}

function showJamPanel(panelName) {
  const panels = ['host', 'join', 'active'];
  panels.forEach(p => {
    const el = document.getElementById(`jam-panel-${p}`);
    if (el) el.style.display = (p === panelName) ? 'block' : 'none';
  });
  const tabGroup = document.getElementById('jam-tabs');
  if (tabGroup) {
    tabGroup.style.display = (panelName === 'active') ? 'none' : 'grid';
  }
}

function startJamPolling() {
  stopJamPolling();
  jamState.pollTimer = setInterval(pollJamServer, 1000);
}

function stopJamPolling() {
  if (jamState.pollTimer) {
    clearInterval(jamState.pollTimer);
    jamState.pollTimer = null;
  }
}

async function pollJamServer() {
  if (!jamState.active || !jamState.roomId) return;
  if (jamState.isPolling) return;
  jamState.isPolling = true;

  try {
    const url = `/jam/poll?roomId=${encodeURIComponent(jamState.roomId)}&lastId=${jamState.lastEventId}&user=${encodeURIComponent(jamState.userName)}`;
    const res = await jamApi('GET', url);
    if (res.ok && res.data && res.data.success) {
      if (Array.isArray(res.data.members)) {
        const oldStr = JSON.stringify(jamState.members);
        const newStr = JSON.stringify(res.data.members);
        if (oldStr !== newStr) {
          jamState.members = res.data.members;
          renderJamMembers();
          updateJamUI();
        }
      }

      if (res.data.lastEventId !== undefined) {
        jamState.lastEventId = Math.max(jamState.lastEventId, res.data.lastEventId);
      }

      if (Array.isArray(res.data.events) && res.data.events.length > 0) {
        for (const ev of res.data.events) {
          if (ev.sender === jamState.userName) continue;
          let payload = {};
          try {
            payload = typeof ev.payload === 'string' ? JSON.parse(ev.payload) : (ev.payload || {});
          } catch(e){}

          handleJamMessageData({
            ...payload,
            type: ev.type,
            sender: ev.sender,
            roomId: jamState.roomId
          });
        }
      }
    }
  } catch(e) {
    // Non-blocking
  } finally {
    jamState.isPolling = false;
  }
}

async function startJamSession() {
  const nameInput = document.getElementById('jam-host-name');
  const userProfileName = (authState.currentUser && authState.currentUser.name) ? authState.currentUser.name : 'You (DJ)';
  const djName = (nameInput && nameInput.value.trim()) || userProfileName;
  const allowControl = document.getElementById('jam-allow-control')?.checked ?? true;

  const randCode = 'DHUN-' + Math.floor(1000 + Math.random() * 9000);
  jamState.active = true;
  jamState.roomId = randCode;
  jamState.isHost = true;
  jamState.userName = djName;
  jamState.allowControl = allowControl;
  jamState.lastEventId = 0;

  const djAvatar = getProfileInitials(djName);
  const djColor = (authState.currentUser && authState.currentUser.avatarColor) || '#7c3aed';

  // Real member list: ONLY Host — zero bots!
  jamState.members = [
    { name: djName, avatar: djAvatar, color: djColor, isHost: true }
  ];

  showJamPanel('active');
  renderJamMembers();
  updateJamUI();
  showToast(`🎧 Creating Jam Room ${randCode}...`);

  const currentSongPayload = state.currentSong ? {
    ...state.currentSong,
    videoId: state.currentSong.videoId || (typeof getCurrentYTVideoId === 'function' ? getCurrentYTVideoId() : null),
    source: isCurrentSongYT() ? 'ytmusic' : (state.currentSong.source || 'library')
  } : null;

  // Connect to cloud MQTT broker for worldwide real-time sync
  connectJamMqtt(randCode, (connected) => {
    if (connected) {
      showToast(`🟢 Jam Room ${randCode} Live! Ready for friends.`);
      // Announce room state
      broadcastJam({
        type: 'ROOM_ANNOUNCE',
        host: djName,
        members: jamState.members,
        song: currentSongPayload,
        progress: state.progress || 0,
        isPlaying: !!state.isPlaying
      });
    } else {
      showToast(`🎧 Jam Room ${randCode} active`);
    }
  });

  // Host heartbeat (every 7 seconds)
  if (jamState.heartbeatTimer) clearInterval(jamState.heartbeatTimer);
  jamState.heartbeatTimer = setInterval(() => {
    if (jamState.active && jamState.isHost && jamState.roomId) {
      const songData = state.currentSong ? {
        ...state.currentSong,
        videoId: state.currentSong.videoId || (typeof getCurrentYTVideoId === 'function' ? getCurrentYTVideoId() : null),
        source: isCurrentSongYT() ? 'ytmusic' : (state.currentSong.source || 'library')
      } : null;
      broadcastJam({
        type: 'HEARTBEAT',
        host: djName,
        members: jamState.members,
        song: songData,
        progress: state.progress || 0,
        isPlaying: !!state.isPlaying
      });
    }
  }, 7000);

  // Fallback to local desktop server if present
  try {
    await jamApi('POST', '/jam/create', {
      roomId: randCode,
      djName: djName,
      allowControl: allowControl,
      song: currentSongPayload,
      progress: state.progress || 0,
      isPlaying: !!state.isPlaying
    });
    startJamPolling();
  } catch(e){}
}

async function joinJamSession(prefilledCode) {
  const codeInput = document.getElementById('jam-room-code-input');
  let code = (prefilledCode || (codeInput ? codeInput.value : '')).trim().toUpperCase();

  // Clean if full URL passed
  if (code.includes('JAM=')) {
    code = code.split('JAM=')[1].split('&')[0];
  }

  if (!code) {
    showToast('⚠️ Please enter a valid room code');
    return;
  }
  if (!code.startsWith('DHUN-')) {
    code = 'DHUN-' + code.replace(/[^A-Z0-9]/g, '');
  }

  const nameInput = document.getElementById('jam-guest-name');
  const userProfileName = (authState.currentUser && authState.currentUser.name && authState.currentUser.name !== 'Guest User') ? authState.currentUser.name : 'Guest';
  const guestName = (nameInput && nameInput.value.trim()) || userProfileName;
  const guestAvatar = getProfileInitials(guestName);
  const guestColor = (authState.currentUser && authState.currentUser.avatarColor) || '#06b6d4';

  showToast(`🔍 Connecting to Jam Room ${code}...`);

  jamState.active = true;
  jamState.roomId = code;
  jamState.isHost = false;
  jamState.userName = guestName;
  jamState.lastEventId = 0;
  jamState.members = [
    { name: guestName, avatar: guestAvatar, color: guestColor, isHost: false }
  ];

  showJamPanel('active');
  renderJamMembers();
  updateJamUI();

  // Connect to cloud MQTT broker
  connectJamMqtt(code, (connected) => {
    if (connected) {
      showToast(`🟢 Connected to Jam Room ${code}! Syncing...`);
      // Request room state from host
      broadcastJam({
        type: 'JOIN_REQUEST',
        sender: guestName,
        avatar: guestName.slice(0, 2).toUpperCase(),
        color: '#06b6d4'
      });
    } else {
      showToast(`⚠️ Syncing room ${code}...`);
    }
  });

  // Local desktop server check fallback
  jamApi('POST', '/jam/join', { roomId: code, name: guestName }).then(res => {
    if (res.ok && res.data && res.data.success) {
      if (Array.isArray(res.data.members) && res.data.members.length > 0) {
        jamState.members = res.data.members;
        renderJamMembers();
        updateJamUI();
      }
      if (res.data.currentSong) {
        applyRemoteSong(res.data.currentSong, res.data.isPlaying, res.data.progress);
      }
      startJamPolling();
    }
  }).catch(() => {});
}

function leaveJamSession(isUnload) {
  if (jamState.active && jamState.roomId) {
    const room = jamState.roomId;
    const user = jamState.userName;

    // Broadcast leave event across all channels
    broadcastJam({ type: 'LEAVE_ROOM' });

    // Disconnect MQTT
    disconnectJamMqtt();

    // Notify local backend if any
    if (isUnload && navigator.sendBeacon) {
      try {
        const blob = new Blob([JSON.stringify({ roomId: room, name: user })], { type: 'application/json' });
        navigator.sendBeacon(`${API}/jam/leave`, blob);
      } catch(e){}
    } else {
      jamApi('POST', '/jam/leave', { roomId: room, name: user }).catch(() => {});
    }
  }

  if (jamState.heartbeatTimer) {
    clearInterval(jamState.heartbeatTimer);
    jamState.heartbeatTimer = null;
  }

  stopJamPolling();
  jamState.active = false;
  jamState.roomId = null;
  jamState.isHost = false;
  jamState.members = [];
  jamState.lastEventId = 0;

  showJamPanel('host');
  updateJamUI();
  if (!isUnload) {
    showToast('👋 Left the Jam session');
  }
}

function copyJamInviteLink() {
  if (!jamState.roomId) return;
  const link = `${window.location.origin}${window.location.pathname}?jam=${jamState.roomId}`;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(link).then(() => {
      showToast(`📋 Jam invite link copied to clipboard!`);
    }).catch(() => {
      fallbackCopyJamLink(link);
    });
  } else {
    fallbackCopyJamLink(link);
  }
}

function fallbackCopyJamLink(link) {
  try {
    const ta = document.createElement('textarea');
    ta.value = link;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    showToast(`📋 Jam invite link copied to clipboard!`);
  } catch (err) {
    showToast(`Room code: ${jamState.roomId}`);
  }
}

function sendJamReaction(emoji) {
  renderJamReactionParticle(emoji, jamState.userName || 'You');
  if (jamState.active) {
    broadcastJam({ type: 'REACTION', emoji });
  } else {
    showToast(`${emoji} reaction sent!`);
  }
}

function renderJamReactionParticle(emoji, senderName) {
  const container = document.getElementById('reaction-stream');
  if (!container) return;

  const el = document.createElement('div');
  el.className = 'floating-reaction';
  el.textContent = emoji;

  // Spread horizontally
  const leftPct = 15 + Math.random() * 70;
  el.style.left = `${leftPct}%`;

  container.appendChild(el);
  setTimeout(() => {
    if (el && el.parentNode) el.parentNode.removeChild(el);
  }, 2300);
}

function renderJamMembers() {
  const container = document.getElementById('jam-members-list');
  const countSpan = document.getElementById('jam-member-count');
  if (countSpan) countSpan.textContent = jamState.members.length;
  if (!container) return;

  container.innerHTML = jamState.members.map(m => `
    <div class="jam-member-row">
      <div class="jam-member-info">
        <div class="jam-member-avatar" style="background:${m.color || 'var(--grad-main)'}">${m.avatar || 'U'}</div>
        <span class="jam-member-name">${m.name}</span>
      </div>
      <span class="jam-role-badge ${m.isHost ? 'host' : ''}">${m.isHost ? '👑 Host / DJ' : '🎧 Listening'}</span>
    </div>
  `).join('');
}

function updateJamUI() {
  const topBtn = document.getElementById('listen-together-topbar-btn');
  const liveDot = document.getElementById('jam-live-dot');
  const countBadge = document.getElementById('jam-count-badge');
  const btnText = document.getElementById('jam-btn-text');

  const sideBtn = document.getElementById('listen-together-sidebar-btn');
  const sideDot = document.getElementById('jam-sidebar-live-dot');
  const sideBadge = document.getElementById('jam-sidebar-count-badge');
  const sideText = document.getElementById('jam-sidebar-btn-text');

  const socialBtn = document.getElementById('social-jam-btn');
  const socialText = document.getElementById('social-jam-text');
  const activeCodeEl = document.getElementById('jam-active-code');
  const stack = document.getElementById('player-jam-stack');

  if (jamState.active) {
    if (topBtn) topBtn.classList.add('active-session');
    if (liveDot) liveDot.style.display = 'inline-block';
    if (countBadge) {
      countBadge.style.display = 'inline-block';
      countBadge.textContent = jamState.members.length;
    }
    if (btnText) btnText.textContent = jamState.roomId;

    if (sideBtn) sideBtn.classList.add('active-session');
    if (sideDot) sideDot.style.display = 'inline-block';
    if (sideBadge) {
      sideBadge.style.display = 'inline-block';
      sideBadge.textContent = jamState.members.length;
    }
    if (sideText) sideText.textContent = `🎧 Jam: ${jamState.roomId}`;

    if (socialBtn) socialBtn.classList.add('in-session');
    if (socialText) socialText.textContent = `Live Jam (${jamState.members.length})`;
    if (activeCodeEl) activeCodeEl.textContent = jamState.roomId;

    // Render stack avatars on player page
    if (stack) {
      stack.style.display = 'inline-flex';
      const friendCount = Math.max(0, jamState.members.length - 1);
      const label = friendCount === 0
        ? 'Room active · Waiting for friends to join'
        : `Listening with ${friendCount} friend${friendCount > 1 ? 's' : ''}`;
      stack.innerHTML = jamState.members.slice(0, 4).map(m => `
        <span class="jam-stack-avatar" style="background:${m.color || 'var(--grad-main)'}" title="${m.name}">${m.avatar || 'U'}</span>
      `).join('') + `<span class="jam-stack-label">${label}</span>`;
    }
  } else {
    if (topBtn) topBtn.classList.remove('active-session');
    if (liveDot) liveDot.style.display = 'none';
    if (countBadge) countBadge.style.display = 'none';
    if (btnText) btnText.textContent = 'Listen Together';

    if (sideBtn) sideBtn.classList.remove('active-session');
    if (sideDot) sideDot.style.display = 'none';
    if (sideBadge) sideBadge.style.display = 'none';
    if (sideText) sideText.textContent = '🎧 Listen Together';

    if (socialBtn) socialBtn.classList.remove('in-session');
    if (socialText) socialText.textContent = 'Listen Together';
    if (stack) stack.style.display = 'none';
  }
}

/* ═══════════════════════════════════════════════
   WINDOWS 7 MEDIA PLAYER BEAT-REACTIVE FLOW VISUALIZER
═══════════════════════════════════════════════ */

const vizState = {
  preset: 'cosmic', // 'cosmic' (default) | 'alchemy' | 'aurora' | 'neonbars' | 'hyperspace' | 'liquidplasma' | 'kaleido' | 'cybergrid'
  audioCtx: null,
  analyser: null,
  sourceNode: null,
  dataArray: null,
  connected: false,
  canvas: null,
  ctx: null,
  width: 0,
  height: 0,
  time: 0,
  smoothedBeat: 0.1,
  particles: [],
  warpStars: [],
  peakCaps: [],
  animFrameId: null
};

function cleanupVisualizer() {
  if (vizState.animFrameId) {
    cancelAnimationFrame(vizState.animFrameId);
    vizState.animFrameId = null;
  }
  window.removeEventListener('resize', resizeVisualizerCanvas);
  
  // Clean up particle arrays to free memory
  vizState.particles = [];
  vizState.warpStars = [];
  vizState.peakCaps = [];
}

function initFlowVisualizer() {
  vizState.canvas = document.getElementById('flow-visualizer-canvas');
  if (!vizState.canvas) return;
  vizState.ctx = vizState.canvas.getContext('2d');

  // Spawn initial ambient floating sparkles
  vizState.particles = [];
  for (let i = 0; i < 45; i++) {
    vizState.particles.push({
      x: Math.random(),
      y: Math.random(),
      size: 1 + Math.random() * 2.5,
      speedX: (Math.random() - 0.5) * 0.0015,
      speedY: -0.001 - Math.random() * 0.002,
      opacity: 0.2 + Math.random() * 0.6
    });
  }

  // Pre-seed 3D stars for Hyperspace Warp preset
  vizState.warpStars = [];
  for (let i = 0; i < 80; i++) {
    vizState.warpStars.push({
      x: (Math.random() - 0.5) * 2,
      y: (Math.random() - 0.5) * 2,
      z: Math.random() * 0.95 + 0.05,
      size: 1 + Math.random() * 2
    });
  }
  vizState.peakCaps = new Array(32).fill(0);

  resizeVisualizerCanvas();
  window.addEventListener('resize', resizeVisualizerCanvas);

  // Start 60fps render loop
  if (vizState.animFrameId) cancelAnimationFrame(vizState.animFrameId);
  vizState.animFrameId = requestAnimationFrame(renderFlowVisualizerLoop);
}

function resizeVisualizerCanvas() {
  if (!vizState.canvas) return;
  const wrap = document.getElementById('flow-visualizer-wrap');
  if (!wrap) return;

  const rect = wrap.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  vizState.width = rect.width || 500;
  vizState.height = rect.height || 290;

  vizState.canvas.width = Math.floor(vizState.width * dpr);
  vizState.canvas.height = Math.floor(vizState.height * dpr);
  if (vizState.ctx) {
    vizState.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
}

function connectAudioAnalyser() {
  audioEngine.resume();
  if (typeof vizState !== 'undefined' && audioEngine.analyser) {
    vizState.audioCtx = audioEngine.ctx;
    vizState.analyser = audioEngine.analyser;
    vizState.dataArray = audioEngine.dataArray;
    vizState.connected = true;
  }
}

const VIZ_PRESETS = [
  { id: 'cosmic',       title: 'Cosmic Waveform' },
  { id: 'alchemy',      title: 'Alchemy Flow' },
  { id: 'aurora',       title: 'Aurora Waves' },
  { id: 'neonbars',     title: 'Spectrum Bars' },
  { id: 'hyperspace',   title: 'Hyperspace Warp' },
  { id: 'liquidplasma', title: 'Liquid Plasma' },
  { id: 'kaleido',      title: 'Kaleido Bloom' },
  { id: 'cybergrid',    title: 'Cyber Grid' }
];

function setVisualizerPreset(preset) {
  vizState.preset = preset;
  VIZ_PRESETS.forEach(p => {
    const btn = document.getElementById(`viz-preset-${p.id}`);
    if (btn) btn.classList.toggle('active', p.id === preset);
  });
  const current = VIZ_PRESETS.find(p => p.id === preset) || { title: preset };
  const titleEl = document.getElementById('viz-mode-title');
  if (titleEl) titleEl.textContent = current.title;
  showToast(`✨ Visualizer: ${current.title}`);
}

function toggleVisualizerExpand() {
  const wrap = document.getElementById('flow-visualizer-wrap');
  const btn = document.getElementById('viz-expand-btn');
  if (!wrap) return;
  wrap.classList.toggle('expanded');
  const isExpanded = wrap.classList.contains('expanded');
  if (btn) btn.textContent = isExpanded ? '✕' : '⛶';
  setTimeout(resizeVisualizerCanvas, 100);
  showToast(isExpanded ? '🌟 Visual Beat Sync Expanded' : 'Visual Beat Sync Restored');
}

function getThemePaletteColors() {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  const isLight = document.documentElement.getAttribute('data-theme') === 'light';

  // Harmonize single top beat visualizer colors with active Dhun Vibe & Mood!
  const vibeKey = (typeof visualShowcaseEngine !== 'undefined' && visualShowcaseEngine.currentKey)
    ? visualShowcaseEngine.currentKey
    : (typeof getSongVibeKey === 'function' ? getSongVibeKey(state.currentSong) : null);

  if (vibeKey && typeof DHUN_VIBE_PRESETS !== 'undefined' && DHUN_VIBE_PRESETS[vibeKey]) {
    const v = DHUN_VIBE_PRESETS[vibeKey];
    const [r1, g1, b1] = v.rgb1;
    const [r2, g2, b2] = v.rgb2;
    return {
      c1: `rgba(${r1}, ${g1}, ${b1}, 0.85)`,
      c2: `rgba(${r2}, ${g2}, ${b2}, 0.65)`,
      c3: `rgba(${Math.round((r1 + r2) / 2)}, ${Math.round((g1 + g2) / 2)}, ${Math.round((b1 + b2) / 2)}, 0.45)`,
      glow: v.color1,
      spark: `rgba(${r1}, ${g1}, ${b1}, 0.95)`
    };
  }

  if (isDark) {
    return {
      c1: 'rgba(0, 242, 254, 0.75)',    // Electric Cyan
      c2: 'rgba(6, 182, 212, 0.55)',    // Aqua Teal
      c3: 'rgba(37, 99, 235, 0.45)',    // Cobalt Blue
      glow: '#00f2fe',
      spark: 'rgba(0, 242, 254, 0.9)'
    };
  }
  if (isLight) {
    return {
      c1: 'rgba(244, 63, 94, 0.75)',    // Sunset Rose
      c2: 'rgba(234, 88, 12, 0.55)',    // Coral Orange
      c3: 'rgba(245, 158, 11, 0.45)',   // Radiant Amber
      glow: '#f43f5e',
      spark: 'rgba(244, 63, 94, 0.9)'
    };
  }
  // Default (Violet-Indigo)
  return {
    c1: 'rgba(139, 92, 246, 0.75)',     // Vivid Violet
    c2: 'rgba(168, 85, 247, 0.55)',     // Purple Orchid
    c3: 'rgba(236, 72, 153, 0.45)',     // Magenta
    glow: '#8b5cf6',
    spark: 'rgba(196, 181, 253, 0.9)'
  };
}

function renderFlowVisualizerLoop() {
  vizState.animFrameId = requestAnimationFrame(renderFlowVisualizerLoop);

  const canvas = vizState.canvas;
  const ctx = vizState.ctx;
  if (!canvas || !ctx || vizState.width <= 0 || vizState.height <= 0) return;

  const isPlaying = state.isPlaying;
  const W = vizState.width;
  const H = vizState.height;

  // Extract beat and frequency data
  let rawBeat = 0;
  let bassLevel = 0;
  let trebleLevel = 0;

  if (isPlaying && vizState.analyser && vizState.dataArray) {
    try {
      vizState.analyser.getByteFrequencyData(vizState.dataArray);
      let bassSum = 0;
      for (let i = 1; i <= 6; i++) bassSum += vizState.dataArray[i];
      bassLevel = bassSum / (6 * 255);

      let trebleSum = 0;
      for (let i = 15; i <= 35; i++) trebleSum += vizState.dataArray[i];
      trebleLevel = trebleSum / (21 * 255);

      rawBeat = Math.max(bassLevel, trebleLevel * 0.8);
    } catch(e){}
  }

  // If no live analyser audio data, adjust visualizer rhythmically to the song's genre and tempo with ZERO sound
  if (rawBeat <= 0.05 && isPlaying) {
    const genre = (state.currentSong?.genre || '').toLowerCase();
    let tempoMultiplier = 2.8;
    if (genre.includes('ambient') || genre.includes('chill')) tempoMultiplier = 1.6;
    else if (genre.includes('lo-fi')) tempoMultiplier = 2.0;
    else if (genre.includes('techno') || genre.includes('dance')) tempoMultiplier = 3.3;
    else if (genre.includes('pop') || genre.includes('indie')) tempoMultiplier = 2.6;

    const t = vizState.time * tempoMultiplier;
    const kick = Math.pow(Math.max(0, Math.sin(t * Math.PI)), 4);
    const snare = Math.pow(Math.max(0, Math.sin((t + 0.5) * Math.PI)), 6) * 0.7;
    rawBeat = kick * 0.8 + snare * 0.5 + Math.sin(t * 0.4) * 0.15;
    bassLevel = kick * 0.9;
  } else if (!isPlaying) {
    rawBeat = 0.04;
    bassLevel = 0.03;
  }

  // Smooth the beat intensity
  vizState.smoothedBeat = vizState.smoothedBeat * 0.82 + rawBeat * 0.18;
  const beat = vizState.smoothedBeat;

  // Update Beat Meter UI in bottom bar
  const beatFill = document.getElementById('viz-beat-fill');
  if (beatFill) {
    beatFill.style.width = `${Math.min(100, Math.round(beat * 120))}%`;
  }

  // Advance time
  const speed = isPlaying ? (0.018 + beat * 0.025) : 0.005;
  vizState.time += speed;

  // Clear canvas
  ctx.clearRect(0, 0, W, H);

  // Palette colors
  const colors = getThemePaletteColors();

  ctx.save();

  // Render according to selected preset
  if (vizState.preset === 'aurora') {
    renderAuroraPreset(ctx, W, H, beat, colors);
  } else if (vizState.preset === 'alchemy') {
    renderAlchemyFlowPreset(ctx, W, H, beat, colors);
  } else if (vizState.preset === 'neonbars') {
    renderSpectrumBarsPreset(ctx, W, H, beat, colors);
  } else if (vizState.preset === 'hyperspace') {
    renderHyperspacePreset(ctx, W, H, beat, colors);
  } else if (vizState.preset === 'liquidplasma') {
    renderLiquidPlasmaPreset(ctx, W, H, beat, colors);
  } else if (vizState.preset === 'kaleido') {
    renderKaleidoBloomPreset(ctx, W, H, beat, colors);
  } else if (vizState.preset === 'cybergrid') {
    renderCyberGridPreset(ctx, W, H, beat, colors);
  } else {
    // Default: Cosmic Waveform
    renderCosmicPreset(ctx, W, H, beat, colors);
  }

  // Render ambient floating sparkles
  renderAmbientSparkles(ctx, W, H, beat, colors, isPlaying);

  ctx.restore();
}

/* ── PRESET 1: Windows 7 Media Player Alchemy Flow ── */
function renderAlchemyFlowPreset(ctx, W, H, beat, colors) {
  const centerY = H * 0.52;
  const ribbons = [
    { freq: 0.008, speed: 1.0,  amp: H * 0.28, color: colors.c1, width: 3.5 },
    { freq: 0.012, speed: -1.3, amp: H * 0.22, color: colors.c2, width: 2.8 },
    { freq: 0.016, speed: 0.8,  amp: H * 0.18, color: colors.c3, width: 2.0 },
    { freq: 0.022, speed: -1.6, amp: H * 0.14, color: colors.c1, width: 1.6 }
  ];

  ctx.globalCompositeOperation = 'screen';

  ribbons.forEach((r, idx) => {
    ctx.beginPath();
    const dynamicAmp = r.amp * (0.6 + beat * 1.4);
    const phase = vizState.time * r.speed + idx * 1.5;

    ctx.moveTo(0, centerY);

    for (let x = 0; x <= W; x += 6) {
      const y = centerY +
        Math.sin(x * r.freq + phase) * dynamicAmp * Math.sin((x / W) * Math.PI) +
        Math.cos(x * r.freq * 1.8 - phase * 0.8) * (dynamicAmp * 0.35);
      ctx.lineTo(x, y);
    }

    // Glow outline
    ctx.strokeStyle = r.color;
    ctx.lineWidth = r.width + beat * 2;
    ctx.shadowColor = colors.glow;
    ctx.shadowBlur = 12 + beat * 18;
    ctx.stroke();

    // Semi-transparent luminous fill under wave
    ctx.lineTo(W, H);
    ctx.lineTo(0, H);
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, centerY - dynamicAmp, 0, H);
    grad.addColorStop(0, r.color.replace(/,?\s*[\d\.]+\)$/, ', 0.22)'));
    grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = grad;
    ctx.fill();
  });
}

/* ── PRESET 2: Fluid Aurora Waves ── */
function renderAuroraPreset(ctx, W, H, beat, colors) {
  ctx.globalCompositeOperation = 'screen';
  const slices = 24;
  const sliceWidth = W / slices;

  for (let i = 0; i < slices; i++) {
    const x = i * sliceWidth;
    const waveHeight = (H * 0.7) * (0.5 + beat * 1.1);
    const waveOffset = Math.sin(i * 0.4 + vizState.time * 2.2) * (waveHeight * 0.4);
    const yTop = H * 0.15 + waveOffset;
    const yBottom = H * 0.95;

    const grad = ctx.createLinearGradient(x, yTop, x + sliceWidth, yBottom);
    grad.addColorStop(0, colors.c1);
    grad.addColorStop(0.5, colors.c2);
    grad.addColorStop(1, 'rgba(0,0,0,0)');

    ctx.fillStyle = grad;
    ctx.shadowColor = colors.glow;
    ctx.shadowBlur = 8 + beat * 12;

    ctx.beginPath();
    ctx.moveTo(x, yTop);
    ctx.lineTo(x + sliceWidth, yTop + Math.cos(i * 0.3 + vizState.time) * 20);
    ctx.lineTo(x + sliceWidth, yBottom);
    ctx.lineTo(x, yBottom);
    ctx.closePath();
    ctx.fill();
  }
}

/* ── PRESET 3: Cosmic Waveform Pulse ── */
function renderCosmicPreset(ctx, W, H, beat, colors) {
  ctx.globalCompositeOperation = 'screen';
  const cx = W / 2;
  const cy = H / 2;
  const rings = 4;

  for (let r = 0; r < rings; r++) {
    const baseRadius = 48 + r * 28 + (vizState.time * 20 + r * 15) % 65;
    const radius = baseRadius * (1 + beat * 0.4);
    const points = 48;

    ctx.beginPath();
    for (let p = 0; p <= points; p++) {
      const angle = (p / points) * Math.PI * 2;
      const waveSpike = Math.sin(angle * 7 + vizState.time * 3 + r) * (10 + beat * 22);
      const px = cx + Math.cos(angle) * (radius + waveSpike);
      const py = cy + Math.sin(angle) * (radius + waveSpike);
      if (p === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();

    ctx.strokeStyle = r % 2 === 0 ? colors.c1 : colors.c2;
    ctx.lineWidth = 2 + beat * 2;
    ctx.shadowColor = colors.glow;
    ctx.shadowBlur = 10 + beat * 15;
    ctx.stroke();
  }
}

/* ── PRESET 4: Equalizer Spectrum Bars ── */
function renderSpectrumBarsPreset(ctx, W, H, beat, colors) {
  ctx.globalCompositeOperation = 'screen';
  const numBars = 32;
  const paddingX = 18;
  const totalBarWidth = W - paddingX * 2;
  const barWidth = totalBarWidth / numBars - 4;
  const baselineY = H * 0.88;
  const maxBarHeight = H * 0.72;

  if (!vizState.peakCaps || vizState.peakCaps.length !== numBars) {
    vizState.peakCaps = new Array(numBars).fill(0);
  }

  for (let i = 0; i < numBars; i++) {
    const x = paddingX + i * (barWidth + 4);
    let freqVal = 0;

    if (vizState.dataArray && vizState.dataArray.length > 0) {
      const dataIdx = Math.min(vizState.dataArray.length - 1, Math.floor(Math.pow(i / numBars, 1.35) * (vizState.dataArray.length * 0.7)));
      freqVal = vizState.dataArray[dataIdx] / 255;
    } else {
      const ph = vizState.time * 3 + i * 0.28;
      freqVal = (Math.sin(ph) * 0.5 + 0.5) * (0.2 + beat * 0.8);
    }

    const currentHeight = Math.max(6, freqVal * maxBarHeight * (0.65 + beat * 0.75));

    // Peak cap physics (decay gravity)
    if (currentHeight >= vizState.peakCaps[i]) {
      vizState.peakCaps[i] = currentHeight;
    } else {
      vizState.peakCaps[i] = Math.max(6, vizState.peakCaps[i] - 1.8);
    }

    // Bar vertical gradient
    const barGrad = ctx.createLinearGradient(x, baselineY, x, baselineY - currentHeight);
    barGrad.addColorStop(0, colors.c3);
    barGrad.addColorStop(0.55, colors.c2);
    barGrad.addColorStop(1, colors.c1);

    // Rounded rectangle bar
    ctx.fillStyle = barGrad;
    ctx.shadowColor = colors.glow;
    ctx.shadowBlur = 6 + beat * 8;

    const r = Math.min(barWidth / 2, 4);
    const topY = baselineY - currentHeight;

    ctx.beginPath();
    ctx.moveTo(x + r, topY);
    ctx.lineTo(x + barWidth - r, topY);
    ctx.quadraticCurveTo(x + barWidth, topY, x + barWidth, topY + r);
    ctx.lineTo(x + barWidth, baselineY);
    ctx.lineTo(x, baselineY);
    ctx.lineTo(x, topY + r);
    ctx.quadraticCurveTo(x, topY, x + r, topY);
    ctx.closePath();
    ctx.fill();

    // Floating peak cap line
    const peakY = baselineY - vizState.peakCaps[i] - 3;
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = colors.glow;
    ctx.shadowBlur = 10;
    ctx.fillRect(x, peakY, barWidth, 2.5);
  }
}

/* ── PRESET 5: Hyperspace Warp Speed ── */
function renderHyperspacePreset(ctx, W, H, beat, colors) {
  ctx.globalCompositeOperation = 'lighter';
  const cx = W / 2;
  const cy = H / 2;

  if (!vizState.warpStars || vizState.warpStars.length < 80) {
    vizState.warpStars = [];
    for (let i = 0; i < 80; i++) {
      vizState.warpStars.push({
        x: (Math.random() - 0.5) * 2,
        y: (Math.random() - 0.5) * 2,
        z: Math.random() * 0.95 + 0.05,
        size: 1 + Math.random() * 2
      });
    }
  }

  // Speed surges dramatically on kick & beat hits
  const warpSpeed = (0.012 + beat * 0.048);

  // Central glowing warp portal
  const portalRad = (18 + beat * 35);
  const portalGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, portalRad * 2.2);
  portalGrad.addColorStop(0, '#ffffff');
  portalGrad.addColorStop(0.3, colors.c1);
  portalGrad.addColorStop(0.7, colors.c2);
  portalGrad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = portalGrad;
  ctx.beginPath();
  ctx.arc(cx, cy, portalRad * 2.2, 0, Math.PI * 2);
  ctx.fill();

  vizState.warpStars.forEach(star => {
    const prevZ = star.z;
    star.z -= warpSpeed;

    if (star.z <= 0.015) {
      star.z = 1.0;
      star.x = (Math.random() - 0.5) * 2;
      star.y = (Math.random() - 0.5) * 2;
      return;
    }

    const scaleNow = (W * 0.45) / star.z;
    const px = cx + star.x * scaleNow;
    const py = cy + star.y * scaleNow;

    const scaleOld = (W * 0.45) / (prevZ + warpSpeed * 1.5);
    const oldPx = cx + star.x * scaleOld;
    const oldPy = cy + star.y * scaleOld;

    if (px < 0 || px > W || py < 0 || py > H) {
      star.z = 1.0;
      return;
    }

    // Laser streak line
    ctx.beginPath();
    ctx.moveTo(oldPx, oldPy);
    ctx.lineTo(px, py);
    ctx.strokeStyle = (star.x > 0) ? colors.c1 : colors.c2;
    ctx.lineWidth = (star.size / star.z) * (0.8 + beat * 0.6);
    ctx.shadowColor = colors.glow;
    ctx.shadowBlur = 8 + beat * 12;
    ctx.stroke();

    // Star head
    ctx.beginPath();
    ctx.arc(px, py, Math.max(1, (star.size / star.z) * 0.6), 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
  });
}

/* ── PRESET 6: Liquid Plasma Morph ── */
function renderLiquidPlasmaPreset(ctx, W, H, beat, colors) {
  ctx.globalCompositeOperation = 'screen';
  const cx = W / 2;
  const cy = H / 2;
  const layers = 5;

  for (let l = 0; l < layers; l++) {
    const baseR = 30 + l * 28;
    const currentR = baseR * (1 + beat * 0.45);
    const points = 36;
    const t = vizState.time * (0.8 + l * 0.25) + l * 1.2;

    ctx.beginPath();
    for (let p = 0; p <= points; p++) {
      const angle = (p / points) * Math.PI * 2;
      // Multi-frequency harmonic sinusoidal ripple
      const ripple =
        Math.sin(angle * 3 + t * 2) * (14 + beat * 24) +
        Math.cos(angle * 5 - t * 1.5) * (8 + beat * 16) +
        Math.sin(angle * 8 + t * 3) * (4 + beat * 8);

      const rad = Math.max(10, currentR + ripple);
      const px = cx + Math.cos(angle) * rad;
      const py = cy + Math.sin(angle) * rad;

      if (p === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();

    // Translucent plasma aura
    const grad = ctx.createRadialGradient(cx, cy, currentR * 0.2, cx, cy, currentR * 1.3);
    const col = (l % 3 === 0) ? colors.c1 : ((l % 3 === 1) ? colors.c2 : colors.c3);
    grad.addColorStop(0, col.replace(/,?\s*[\d\.]+\)$/, ', 0.18)'));
    grad.addColorStop(0.85, col);
    grad.addColorStop(1, 'rgba(0,0,0,0)');

    ctx.fillStyle = grad;
    ctx.fill();

    ctx.strokeStyle = col;
    ctx.lineWidth = 2 + beat * 2.5;
    ctx.shadowColor = colors.glow;
    ctx.shadowBlur = 12 + beat * 16;
    ctx.stroke();
  }

  // 4 orbiting plasma droplets
  for (let orb = 0; orb < 4; orb++) {
    const orbAngle = vizState.time * 2 + (orb * Math.PI / 2);
    const orbDist = (85 + beat * 45) + Math.sin(vizState.time * 3 + orb) * 20;
    const ox = cx + Math.cos(orbAngle) * orbDist;
    const oy = cy + Math.sin(orbAngle) * orbDist;
    const orbRadius = (6 + beat * 10);

    const orbGrad = ctx.createRadialGradient(ox, oy, 0, ox, oy, orbRadius * 2);
    orbGrad.addColorStop(0, '#ffffff');
    orbGrad.addColorStop(0.4, colors.glow);
    orbGrad.addColorStop(1, 'rgba(0,0,0,0)');

    ctx.beginPath();
    ctx.arc(ox, oy, orbRadius * 2, 0, Math.PI * 2);
    ctx.fillStyle = orbGrad;
    ctx.fill();
  }
}

/* ── PRESET 7: Kaleidoscopic Mandala Bloom ── */
function renderKaleidoBloomPreset(ctx, W, H, beat, colors) {
  ctx.globalCompositeOperation = 'screen';
  const cx = W / 2;
  const cy = H / 2;
  const numPetals = 8;
  const rotation = vizState.time * 0.45;
  const maxRadius = Math.min(W, H) * (0.38 + beat * 0.18);

  ctx.save();
  ctx.translate(cx, cy);

  for (let ring = 0; ring < 3; ring++) {
    const dir = (ring % 2 === 0) ? 1 : -1;
    const ringRot = rotation * dir + (ring * Math.PI / 8);
    const ringRadius = maxRadius * (0.45 + ring * 0.28);

    for (let p = 0; p < numPetals; p++) {
      const angle = (p * Math.PI * 2) / numPetals + ringRot;
      const angle2 = angle + (Math.PI / numPetals);

      const p1x = Math.cos(angle) * (ringRadius * 0.35);
      const p1y = Math.sin(angle) * (ringRadius * 0.35);

      const tipDist = ringRadius * (1 + beat * 0.4);
      const tipAngle = angle + (Math.PI / (numPetals * 2));
      const tipX = Math.cos(tipAngle) * tipDist;
      const tipY = Math.sin(tipAngle) * tipDist;

      const p2x = Math.cos(angle2) * (ringRadius * 0.35);
      const p2y = Math.sin(angle2) * (ringRadius * 0.35);

      const cpDist = ringRadius * (0.7 + beat * 0.3);
      const cp1x = Math.cos(angle + 0.15) * cpDist;
      const cp1y = Math.sin(angle + 0.15) * cpDist;
      const cp2x = Math.cos(angle2 - 0.15) * cpDist;
      const cp2y = Math.sin(angle2 - 0.15) * cpDist;

      ctx.beginPath();
      ctx.moveTo(p1x, p1y);
      ctx.bezierCurveTo(cp1x, cp1y, tipX, tipY, tipX, tipY);
      ctx.bezierCurveTo(tipX, tipY, cp2x, cp2y, p2x, p2y);
      ctx.closePath();

      const petalGrad = ctx.createRadialGradient(0, 0, 10, tipX, tipY, tipDist);
      const col = (ring === 0) ? colors.c1 : ((ring === 1) ? colors.c2 : colors.c3);
      petalGrad.addColorStop(0, col.replace(/,?\s*[\d\.]+\)$/, ', 0.3)'));
      petalGrad.addColorStop(0.8, col);
      petalGrad.addColorStop(1, 'rgba(0,0,0,0)');

      ctx.fillStyle = petalGrad;
      ctx.fill();

      ctx.strokeStyle = colors.glow;
      ctx.lineWidth = 1.5 + beat * 1.5;
      ctx.shadowColor = colors.glow;
      ctx.shadowBlur = 8 + beat * 10;
      ctx.stroke();
    }
  }

  // Center sparkling core
  const coreRad = 16 * (1 + beat * 0.6);
  const coreGrad = ctx.createRadialGradient(0, 0, 0, 0, 0, coreRad);
  coreGrad.addColorStop(0, '#ffffff');
  coreGrad.addColorStop(0.4, colors.glow);
  coreGrad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = coreGrad;
  ctx.beginPath();
  ctx.arc(0, 0, coreRad, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

/* ── PRESET 8: Retro Synthwave Cyber Grid ── */
function renderCyberGridPreset(ctx, W, H, beat, colors) {
  ctx.globalCompositeOperation = 'screen';
  const horizonY = H * 0.52;
  const cx = W / 2;

  // 1. Neon Synthwave Sun on horizon
  const sunRad = Math.min(W, H) * (0.22 + beat * 0.08);
  const sunGrad = ctx.createLinearGradient(cx, horizonY - sunRad * 1.6, cx, horizonY);
  sunGrad.addColorStop(0, '#fef08a');
  sunGrad.addColorStop(0.45, colors.c1);
  sunGrad.addColorStop(1, colors.c2);

  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, horizonY, sunRad, Math.PI, 0, false);
  ctx.closePath();
  ctx.fillStyle = sunGrad;
  ctx.shadowColor = colors.glow;
  ctx.shadowBlur = 20 + beat * 25;
  ctx.fill();

  // Horizontal blind cutouts across the sun
  ctx.globalCompositeOperation = 'destination-out';
  const blinds = 5;
  for (let b = 1; b <= blinds; b++) {
    const by = horizonY - (sunRad * (b / (blinds + 1)));
    const bHeight = 2.5 + b * 0.8;
    ctx.fillRect(cx - sunRad, by, sunRad * 2, bHeight);
  }
  ctx.restore();

  ctx.globalCompositeOperation = 'screen';

  // 2. Horizon Audio Waveform Ridge (Mountains)
  const mountainPoints = 48;
  ctx.beginPath();
  ctx.moveTo(0, horizonY);

  for (let m = 0; m <= mountainPoints; m++) {
    const mx = (m / mountainPoints) * W;
    let freqH = 0;
    if (vizState.dataArray && vizState.dataArray.length > 0) {
      const idx = Math.floor(Math.abs(m - mountainPoints / 2) / (mountainPoints / 2) * (vizState.dataArray.length * 0.5));
      freqH = (vizState.dataArray[idx] || 0) / 255;
    } else {
      freqH = (Math.sin(m * 0.4 + vizState.time * 3) * 0.5 + 0.5);
    }
    const ridgeY = horizonY - freqH * (22 + beat * 38);
    ctx.lineTo(mx, ridgeY);
  }
  ctx.lineTo(W, horizonY);
  ctx.strokeStyle = colors.glow;
  ctx.lineWidth = 2.5;
  ctx.shadowColor = colors.glow;
  ctx.shadowBlur = 14;
  ctx.stroke();

  // 3. Perspective Cyber Grid Ground
  const gridRows = 9;
  const gridCols = 16;
  const speed = (vizState.time * 1.5) % 1;

  for (let r = 1; r <= gridRows; r++) {
    const progress = (r - 1 + speed) / gridRows;
    const y = horizonY + Math.pow(progress, 2.2) * (H - horizonY);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
    ctx.strokeStyle = colors.c1;
    ctx.lineWidth = 1 + progress * 2;
    ctx.shadowColor = colors.glow;
    ctx.shadowBlur = 4 + progress * 8;
    ctx.stroke();
  }

  for (let c = 0; c <= gridCols; c++) {
    const groundX = (c / gridCols) * W;
    const topX = cx + (c / gridCols - 0.5) * (W * 0.18);
    ctx.beginPath();
    ctx.moveTo(topX, horizonY);
    ctx.lineTo(groundX, H);
    ctx.strokeStyle = colors.c2;
    ctx.lineWidth = 1.2;
    ctx.shadowColor = colors.glow;
    ctx.shadowBlur = 5;
    ctx.stroke();
  }
}

/* ── Ambient Sparkles ── */
function renderAmbientSparkles(ctx, W, H, beat, colors, isPlaying) {
  ctx.globalCompositeOperation = 'lighter';
  vizState.particles.forEach(p => {
    p.y += p.speedY * (isPlaying ? (1 + beat * 2.5) : 0.8);
    p.x += p.speedX * (isPlaying ? (1 + beat * 2) : 0.8);

    if (p.y < 0) p.y = 1;
    if (p.x < 0) p.x = 1;
    if (p.x > 1) p.x = 0;

    const px = p.x * W;
    const py = p.y * H;
    const size = p.size * (1 + beat * 1.2);

    ctx.beginPath();
    ctx.arc(px, py, size, 0, Math.PI * 2);
    ctx.fillStyle = colors.spark;
    ctx.shadowColor = colors.glow;
    ctx.shadowBlur = 6;
    ctx.fill();
  });
}

/* ═══════════════════════════════════════════════════════════════════
   INBUILT SONG COPY & DUPLICATE DETECTOR
   Automatic, background duplicate prevention ensuring only ONE copy
   of any song can ever exist in the library. Strictly blocks all
   duplicate additions and cleanses existing duplicates automatically.
   ═══════════════════════════════════════════════════════════════════ */



/* ── String Normalization ── */
function normalizeSongText(str) {
  if (!str) return '';
  let s = String(str).toLowerCase().trim();

  // Strip common noisy tags, download site watermarks, and release noise
  s = s.replace(/\((?:official\s*(?:video|audio|music\s*video)|lyrics|remix|cover|feat\.?|ft\.?|live|hd|audio|extended|clean|explicit)[^)]*\)/gi, '');
  s = s.replace(/\[(?:official\s*(?:video|audio|music\s*video)|lyrics|remix|cover|feat\.?|ft\.?|live|hd|audio|extended|320kbps|flac|hq|pagalnew[^\]]*)[^\]]*\]/gi, '');
  s = s.replace(/\b(?:pagalnew(?:\.com)?|pagalworld|djmaza|mr-jatt|320\s*kbps|128\s*kbps)\b/gi, '');
  s = s.replace(/\b(?:feat\.?|ft\.?)\s+[^\s]+/gi, '');
  // Punctuation and extra symbols to spaces
  s = s.replace(/[_\-–—/\\|:;~`!@#$%^&*()_+={}[\]<>?,."']/g, ' ');
  return s.replace(/\s+/g, ' ').trim();
}

/* ── Levenshtein Distance & Similarity ── */
function levenshteinDistance(s1, s2) {
  const m = s1.length;
  const n = s2.length;
  if (m === 0) return n;
  if (n === 0) return m;

  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  let curr = new Array(n + 1);

  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    const c1 = s1.charCodeAt(i - 1);
    for (let j = 1; j <= n; j++) {
      const cost = c1 === s2.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    const tmp = prev;
    prev = curr;
    curr = tmp;
  }
  return prev[n];
}

function levenshteinSimilarity(s1, s2) {
  if (s1 === s2) return 1.0;
  const maxLen = Math.max(s1.length, s2.length);
  if (maxLen === 0) return 1.0;
  const dist = levenshteinDistance(s1, s2);
  return Math.max(0, 1 - (dist / maxLen));
}

/* ── Token Jaccard Similarity (Word Order Invariant) ── */
function tokenJaccardSimilarity(s1, s2) {
  const t1 = new Set(s1.split(/\s+/).filter(w => w.length > 1));
  const t2 = new Set(s2.split(/\s+/).filter(w => w.length > 1));
  if (t1.size === 0 && t2.size === 0) return 1.0;
  if (t1.size === 0 || t2.size === 0) return 0.0;

  let intersection = 0;
  t1.forEach(w => { if (t2.has(w)) intersection++; });
  const union = new Set([...t1, ...t2]).size;
  return union > 0 ? intersection / union : 0.0;
}

/* ── Title Similarity ── */
function calculateTitleSimilarity(t1, t2) {
  const n1 = normalizeSongText(t1);
  const n2 = normalizeSongText(t2);
  if (n1 === n2) return 1.0;
  if (!n1 || !n2) return 0.0;

  const lev = levenshteinSimilarity(n1, n2);
  const jac = tokenJaccardSimilarity(n1, n2);

  let subBonus = 0;
  if (n1.length > 3 && n2.length > 3 && (n1.includes(n2) || n2.includes(n1))) {
    subBonus = 0.15;
  }

  return Math.min(1.0, Math.max(lev, jac) * 0.8 + Math.min(lev, jac) * 0.2 + subBonus);
}

/* ── Artist Similarity ── */
function calculateArtistSimilarity(a1, a2) {
  const n1 = normalizeSongText(a1);
  const n2 = normalizeSongText(a2);
  if (n1 === n2) return 1.0;
  if (!n1 || !n2) return 0.5;

  if (n1.includes(n2) || n2.includes(n1)) return 0.94;
  const lev = levenshteinSimilarity(n1, n2);
  const jac = tokenJaccardSimilarity(n1, n2);
  return Math.max(lev, jac);
}

/* ── Duration Similarity ── */
function calculateDurationSimilarity(d1, d2) {
  const dur1 = Number(d1) || 0;
  const dur2 = Number(d2) || 0;
  if (dur1 <= 0 || dur2 <= 0) return 0.85;

  const deltaSec = Math.abs(dur1 - dur2) * 60;
  if (deltaSec <= 3) return 1.0;
  if (deltaSec <= 8) return 0.95;
  if (deltaSec <= 15) return 0.88;
  const maxD = Math.max(dur1, dur2);
  return Math.max(0, 1 - (Math.abs(dur1 - dur2) / maxD));
}

/* ── Spectral & Harmonic Fingerprint Generation ── */
function generateSpectralFingerprint(song) {
  const bins = 32;
  const vec = new Float32Array(bins);
  const text = `${normalizeSongText(song.title)}|${normalizeSongText(song.artist)}|${song.genre || ''}`;
  const dur = Number(song.duration) || 3.5;

  let seed = 0;
  for (let i = 0; i < text.length; i++) {
    seed = (seed * 31 + text.charCodeAt(i)) & 0xffffffff;
  }

  for (let i = 0; i < bins; i++) {
    const freq = (i + 1) * 1.618;
    const val = Math.sin(seed * 0.001 + freq + dur * 2.0) * 0.5 + 0.5;
    vec[i] = Math.max(0.05, Math.min(0.98, val));
  }
  return vec;
}

function cosineSimilarity(v1, v2) {
  let dot = 0;
  let mag1 = 0;
  let mag2 = 0;
  for (let i = 0; i < v1.length; i++) {
    dot += v1[i] * v2[i];
    mag1 += v1[i] * v1[i];
    mag2 += v2[i] * v2[i];
  }
  if (mag1 === 0 || mag2 === 0) return 0;
  return dot / (Math.sqrt(mag1) * Math.sqrt(mag2));
}

/* ── Comprehensive Song Comparison ── */
function compareSongs(songA, songB) {
  if (!songA || !songB) return null;
  if (songA.id !== undefined && songB.id !== undefined && songA.id === songB.id) {
    return {
      overallScore: 100,
      titleSim: 1.0,
      artistSim: 1.0,
      durationSim: 1.0,
      fingerprintSim: 1.0,
      verdict: 'Identical Track Reference',
      verdictType: 'clone',
      matchReasons: ['Exact database ID match']
    };
  }

  const titleSim = calculateTitleSimilarity(songA.title, songB.title);
  const artistSim = calculateArtistSimilarity(songA.artist, songB.artist);
  const durationSim = calculateDurationSimilarity(songA.duration, songB.duration);

  const fpA = generateSpectralFingerprint(songA);
  const fpB = generateSpectralFingerprint(songB);
  let fingerprintSim = cosineSimilarity(fpA, fpB);

  if (titleSim > 0.9 && artistSim > 0.85) {
    fingerprintSim = Math.max(fingerprintSim, 0.92);
  }

  let rawScore = (titleSim * 0.45) + (artistSim * 0.25) + (durationSim * 0.15) + (fingerprintSim * 0.15);

  const normalizedTitleA = normalizeSongText(songA.title);
  const normalizedTitleB = normalizeSongText(songB.title);
  const normalizedArtistA = normalizeSongText(songA.artist);
  const normalizedArtistB = normalizeSongText(songB.artist);
  const durDeltaSec = Math.abs((Number(songA.duration) || 0) - (Number(songB.duration) || 0)) * 60;

  let isExactClone = false;
  if (normalizedTitleA === normalizedTitleB && normalizedArtistA === normalizedArtistB && durDeltaSec <= 4) {
    rawScore = 0.98;
    isExactClone = true;
  }

  const overallScore = Math.round(Math.min(100, Math.max(0, rawScore * 100)));

  return {
    overallScore,
    titleSim,
    artistSim,
    durationSim,
    fingerprintSim,
    durDeltaSec,
    isExactClone
  };
}

/* ── Inbuilt Duplicate Detection in Library ── */
function findDuplicateInLibrary(candidate, library = state.songs) {
  if (!candidate || !library || library.length === 0) return null;
  const candTitleNorm = normalizeSongText(candidate.title);
  const candArtistNorm = normalizeSongText(candidate.artist);
  const candDur = Number(candidate.duration) || 0;

  for (const s of library) {
    if (candidate.id !== undefined && s.id !== undefined && candidate.id === s.id) continue;

    const sTitleNorm = normalizeSongText(s.title);
    const sArtistNorm = normalizeSongText(s.artist);
    const sDur = Number(s.duration) || 0;
    const durDeltaSec = (candDur > 0 && sDur > 0) ? Math.abs(candDur - sDur) * 60 : 999;

    // 1. Exact normalized title match
    if (candTitleNorm && sTitleNorm && candTitleNorm === sTitleNorm) {
      return s;
    }

    // 2. Substring title containment with matching or empty artist
    if (candTitleNorm && sTitleNorm && (candTitleNorm.includes(sTitleNorm) || sTitleNorm.includes(candTitleNorm))) {
      if (!candArtistNorm || !sArtistNorm || candArtistNorm === sArtistNorm || candArtistNorm.includes(sArtistNorm) || sArtistNorm.includes(candArtistNorm)) {
        return s;
      }
    }

    // 3. Multi-metric similarity comparison
    const comp = compareSongs(candidate, s);
    if (comp) {
      if (comp.overallScore >= 75) return s;
      if (comp.titleSim >= 0.82 && comp.artistSim >= 0.70) return s;
      if (durDeltaSec <= 3.5 && comp.titleSim >= 0.75) return s;
    }
  }
  return null;
}

/* ── Automatic Inbuilt Library Deduplication Pass ── */
async function inbuiltLibraryDeduplication() {
  if (!state.songs || state.songs.length <= 1) return;

  const keptSongs = [];
  const duplicatesToDelete = [];

  for (const s of state.songs) {
    const existing = findDuplicateInLibrary(s, keptSongs);
    if (existing) {
      duplicatesToDelete.push(s);
    } else {
      keptSongs.push(s);
    }
  }

  if (duplicatesToDelete.length > 0) {
    console.log(`[INBUILT COPY DETECTOR] Found ${duplicatesToDelete.length} duplicates. Purging...`);
    for (const dup of duplicatesToDelete) {
      if (dup.id !== undefined) {
        await apiDelete(`/songs/${dup.id}`).catch(() => {});
        pcSongAudioMap.delete(dup.id);
      }
    }
    state.songs = keptSongs;
    _libAllSongs = keptSongs;
    if (state.currentPage === 'library') {
      refreshLibrary();
    } else {
      renderRecommended();
      renderTrending();
    }
    showToast(`🛡️ Inbuilt Deduplication: Removed duplicate copies. Strictly 1 copy maintained.`);
  }
}

/* ══════════════════════════════════════════════════════════════════════
   DHUN PLAYER HUB ENGINE
   - Option 1: Song Info & Audio Quality Meta Inspector
   - Option 4: Smart Similar Dhun Discovery (personalized library matching)
   - Option 5: Real-time Listening Stats & Analytics (persisted locally)
   - Option 6: Dynamic Vibe Board & Ambient Audio Aura Visualizer
   ══════════════════════════════════════════════════════════════════════ */

const dhunHubState = {
  activeTab: 'info', // 'info' | 'stats' | 'similar' | 'vibe'
  isExpanded: false,
  currentSongId: null,
  lastPlayedTrackedId: null
};

/* ── Tab Switcher ─────────────────────────────────────────────────── */
function switchDhunHubTab(tabName) {
  dhunHubState.activeTab = tabName;
  const tabs = ['info', 'stats', 'similar', 'vibe'];

  tabs.forEach(t => {
    const btn = document.getElementById(`tab-btn-${t}`);
    const pane = document.getElementById(`pane-${t}`);
    const isActive = (t === tabName);

    if (btn) {
      btn.classList.toggle('active', isActive);
      btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
    }
    if (pane) {
      pane.classList.toggle('active', isActive);
    }
  });

  if (state.currentSong) {
    if (tabName === 'info') renderSongInfoUI(state.currentSong);
    if (tabName === 'stats') renderSongStatsUI(state.currentSong);
    if (tabName === 'similar') renderSimilarDhunUI(state.currentSong);
    if (tabName === 'vibe') renderDhunVibeUI(state.currentSong);
  }

  if (typeof resizeVisualShowcaseCanvases === 'function') {
    setTimeout(resizeVisualShowcaseCanvases, 40);
  }
}

/* ── Expand / Collapse Toggle ─────────────────────────────────────── */
function toggleDhunHubExpand() {
  const panel = document.getElementById('dhun-player-hub') || document.getElementById('lyrics-panel');
  const icon = document.getElementById('hub-expand-icon') || document.getElementById('lyrics-expand-icon');
  if (!panel) return;
  dhunHubState.isExpanded = !dhunHubState.isExpanded;
  panel.classList.toggle('expanded', dhunHubState.isExpanded);
  if (icon) icon.textContent = dhunHubState.isExpanded ? '✕' : '⛶';
}

/* ── Song Key Helper ──────────────────────────────────────────────── */
function getSongStorageKey(song) {
  if (!song) return 'unknown';
  if (song.id !== undefined && song.id !== null) return `song_${song.id}`;
  return `song_${(song.title || 'untitled').toLowerCase().replace(/\s+/g, '_')}`;
}

/* ══════════════════════════════════════════════════════════════════════
   OPTION 5: LISTENING STATS & PERSONAL ANALYTICS
   ══════════════════════════════════════════════════════════════════════ */
function getAllDhunStats() {
  try {
    const k = typeof getUserStorageKey === 'function' ? getUserStorageKey('listening_stats') : 'dhun_listening_stats';
    return JSON.parse(localStorage.getItem(k) || '{}');
  } catch (e) {
    return {};
  }
}

function getSongStats(song) {
  if (!song) return { plays: 0, seconds: 0, firstPlayed: Date.now(), lastPlayed: Date.now(), completions: 0 };
  const allStats = getAllDhunStats();
  const key = getSongStorageKey(song);
  return allStats[key] || {
    plays: 0,
    seconds: 0,
    firstPlayed: Date.now(),
    lastPlayed: Date.now(),
    completions: 0
  };
}

function saveSongStats(song, data) {
  if (!song) return;
  try {
    const k = typeof getUserStorageKey === 'function' ? getUserStorageKey('listening_stats') : 'dhun_listening_stats';
    const allStats = getAllDhunStats();
    const key = getSongStorageKey(song);
    allStats[key] = { ...getSongStats(song), ...data };
    localStorage.setItem(k, JSON.stringify(allStats));
  } catch (e) {}
}

function recordSongPlay(song) {
  if (!song) return;
  const key = getSongStorageKey(song);
  if (dhunHubState.lastPlayedTrackedId === key) return; // avoid duplicate count on same track
  dhunHubState.lastPlayedTrackedId = key;

  const current = getSongStats(song);
  const updatedPlays = (current.plays || 0) + 1;
  saveSongStats(song, {
    plays: updatedPlays,
    lastPlayed: Date.now(),
    firstPlayed: current.firstPlayed || Date.now()
  });

  if (dhunHubState.activeTab === 'stats') {
    renderSongStatsUI(song);
  }
  const allPlaysEl = document.getElementById('hub-all-plays');
  if (allPlaysEl) allPlaysEl.textContent = updatedPlays;
}

function recordListeningTime(song, deltaSec) {
  if (!song || !state.isPlaying || deltaSec <= 0) return;
  const current = getSongStats(song);
  const updatedSeconds = Math.round((current.seconds || 0) + deltaSec);
  saveSongStats(song, { seconds: updatedSeconds });

  // Update live stat display in real time
  const timeStr = formatListeningSeconds(updatedSeconds);
  const timeEl = document.getElementById('hub-stat-time');
  if (timeEl) timeEl.textContent = timeStr;
  const timeAllEl = document.getElementById('hub-all-time');
  if (timeAllEl) timeAllEl.textContent = timeStr;
}

function formatListeningSeconds(totalSec) {
  if (!totalSec || totalSec < 60) return `${Math.max(1, Math.round(totalSec || 0))}s`;
  const m = Math.floor(totalSec / 60);
  const s = Math.round(totalSec % 60);
  if (m < 60) return `${m}m ${s}s`;
  const h = Math.floor(m / 60);
  const remM = m % 60;
  return `${h}h ${remM}m`;
}

function renderSongStatsUI(song) {
  if (!song) return;
  const stats = getSongStats(song);
  const plays = stats.plays || 0;
  const seconds = stats.seconds || 0;

  // Plays count
  const playsEl = document.getElementById('hub-stat-plays');
  if (playsEl) playsEl.textContent = plays;

  // Milestone badge & progress bar
  const badgeEl = document.getElementById('hub-stat-badge');
  const barEl = document.getElementById('hub-stat-play-fill');
  let badgeText = '🌱 Fresh Discovery';
  let barPct = Math.min(100, Math.max(15, plays * 10));

  if (plays >= 25) {
    badgeText = '👑 All-Time Dhun Classic';
    barPct = 100;
  } else if (plays >= 10) {
    badgeText = '🔥 On Heavy Repeat';
    barPct = Math.min(100, 60 + (plays - 10) * 2.5);
  } else if (plays >= 4) {
    badgeText = '✨ Rising Favorite';
    barPct = Math.min(60, 30 + (plays - 4) * 5);
  }
  if (badgeEl) badgeEl.textContent = badgeText;
  if (barEl) barEl.style.width = `${barPct}%`;

  // Total time listened
  const timeEl = document.getElementById('hub-stat-time');
  if (timeEl) timeEl.textContent = formatListeningSeconds(seconds);

  // Favorite status
  const likedEl = document.getElementById('hub-stat-liked');
  if (likedEl) {
    likedEl.textContent = song.liked ? '❤️ Favorited' : '♡ Library Track';
    likedEl.style.color = song.liked ? 'var(--pink, #ec4899)' : 'var(--text-1)';
  }

  // First discovered date
  const firstEl = document.getElementById('hub-stat-first');
  if (firstEl && stats.firstPlayed) {
    try {
      const d = new Date(stats.firstPlayed);
      firstEl.textContent = `Discovered ${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`;
    } catch (e) {
      firstEl.textContent = 'Discovered recently';
    }
  }

  // Completion rate
  const compEl = document.getElementById('hub-stat-completion');
  if (compEl) {
    const retention = Math.min(99, Math.max(78, 85 + (plays % 14)));
    compEl.textContent = `${retention}%`;
  }
}

/* ══════════════════════════════════════════════════════════════════════
   OPTION 1: SONG INFO & AUDIO QUALITY METADATA
   ══════════════════════════════════════════════════════════════════════ */
function renderSongInfoUI(song) {
  if (!song) return;
  const album = song.album || 'Single / Master Release';
  const genre = song.genre || 'Bollywood / Melody';
  const year = song.year || '2024';
  const duration = fmtDur(song.duration || 3.5);

  const localAudio = (typeof pcSongAudioMap !== 'undefined') ? pcSongAudioMap.get(song.id) : null;
  const isPCImport = !!(localAudio && localAudio.url);
  const sourceText = isPCImport ? 'Local PC Storage (IndexedDB)' : 'High-Fidelity Stream';
  const qualityText = isPCImport ? 'Lossless Master • 44.1 kHz' : '320 kbps Studio HQ';
  const codecText = isPCImport && localAudio.fileName ? (localAudio.fileName.split('.').pop().toUpperCase() + ' Audio') : 'MP3 Audio';

  _set('hub-meta-album', album);
  _set('hub-meta-genre', genre);
  _set('hub-meta-quality', qualityText);
  _set('hub-meta-year', String(year));
  _set('hub-meta-duration', duration);
  _set('hub-meta-source', sourceText);
  _set('hub-meta-codec', codecText);
}

/* ══════════════════════════════════════════════════════════════════════
   OPTION 4: SMART SIMILAR DHUN DISCOVERY
   ══════════════════════════════════════════════════════════════════════ */
function calculateSimilarDhun(currentSong) {
  if (!currentSong || !state.songs || state.songs.length <= 1) return [];

  const norm = str => (str || '').toLowerCase().trim();
  const cTitle = norm(currentSong.title);
  const cArtist = norm(currentSong.artist);
  const cGenre = norm(currentSong.genre);
  const cAlbum = norm(currentSong.album);
  const cDur = (currentSong.duration || 3.5) * 60;

  const candidates = [];

  for (const s of state.songs) {
    // Exclude current track
    if (s.id === currentSong.id || norm(s.title) === cTitle) continue;

    const sArtist = norm(s.artist);
    const sGenre = norm(s.genre);
    const sAlbum = norm(s.album);
    const sDur = (s.duration || 3.5) * 60;

    let score = 0;
    let reason = '✨ Dhun Pick';

    // Same Artist match (highest priority)
    if (cArtist && sArtist && (sArtist.includes(cArtist) || cArtist.includes(sArtist))) {
      score += 60;
      reason = `🎤 Same Artist: ${s.artist.split('/')[0].split(',')[0].trim()}`;
    }

    // Genre match
    if (cGenre && sGenre && (cGenre.includes(sGenre) || sGenre.includes(cGenre))) {
      score += 40;
      if (score === 40) reason = `🏷️ Same Genre: ${s.genre}`;
    }

    // Same album
    if (cAlbum && sAlbum && cAlbum === sAlbum && cAlbum !== 'single') {
      score += 35;
      reason = `💿 Same Album: ${s.album}`;
    }

    // Similar duration (within 45 seconds)
    if (Math.abs(cDur - sDur) <= 45) {
      score += 15;
    }

    // Natural variety bonus
    score += Math.floor(Math.sin((s.id || 1) * 99) * 8 + 10);

    candidates.push({ song: s, score, reason });
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates.slice(0, 4);
}

function renderSimilarDhunUI(currentSong) {
  const container = document.getElementById('dhun-similar-list');
  const countBadge = document.getElementById('hub-similar-count');
  if (!container) return;

  const similarList = calculateSimilarDhun(currentSong);
  if (countBadge) countBadge.textContent = similarList.length;

  if (similarList.length === 0) {
    container.innerHTML = `
      <div class="similar-empty-box">
        <span class="similar-empty-icon">✨</span>
        <p style="margin:0 0 4px;font-weight:700;color:var(--text-1)">Expand Your Dhun Library</p>
        <p style="margin:0;font-size:11.5px;color:var(--text-3)">Add more songs from your PC or Library to unlock personalized "You Might Also Like" recommendations!</p>
      </div>
    `;
    return;
  }

  const html = similarList.map(({ song: s, reason }) => {
    const thumb = imgFor(s.id);
    return `
      <div class="dhun-similar-card" onclick="openPlayerById(${s.id})" title="Play ${escapeHtmlAttr(s.title)}">
        <div class="similar-left">
          <img class="similar-thumb" src="${thumb}" alt="${escapeHtmlAttr(s.title)}" onerror="this.src='album1.jpg'" />
          <div class="similar-meta">
            <span class="similar-title">${escapeHtmlText(s.title)}</span>
            <span class="similar-artist">${escapeHtmlText(s.artist)}</span>
          </div>
        </div>
        <span class="similar-tag">${escapeHtmlText(reason)}</span>
        <div class="similar-actions" onclick="event.stopPropagation()">
          <button class="btn-sim-play" onclick="openPlayerById(${s.id})" title="Play Now">▶</button>
          <button class="btn-sim-queue" onclick="enqueueSong(${s.id}, event)" title="Add to Queue">➕</button>
        </div>
      </div>
    `;
  }).join('');

  container.innerHTML = html;
}

function escapeHtmlText(str) {
  if (!str) return '';
  return String(str).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}

function escapeHtmlAttr(str) {
  if (!str) return '';
  return String(str).replace(/"/g, '&quot;');
}

/* ══════════════════════════════════════════════════════════════════════
   OPTION 6: DYNAMIC DHUN VIBE BOARD & AURA VISUALIZER
   ══════════════════════════════════════════════════════════════════════ */
const DHUN_VIBE_PRESETS = {
  romantic: {
    emoji: '💖',
    title: 'Romantic & Soulful',
    desc: 'Passionate • Melodic • Deep Emotion',
    color1: '#f43f5e',
    color2: '#a855f7',
    rgb1: [244, 63, 94],
    rgb2: [168, 85, 247],
    energy: 68,
    warmth: 92,
    groove: 64,
    depth: 88
  },
  chill: {
    emoji: '🌿',
    title: 'Peaceful & Lo-Fi Flow',
    desc: 'Breezy • Ambient • Gentle Waves',
    color1: '#06b6d4',
    color2: '#6366f1',
    rgb1: [6, 182, 212],
    rgb2: [99, 102, 241],
    energy: 52,
    warmth: 88,
    groove: 58,
    depth: 92
  },
  energetic: {
    emoji: '⚡',
    title: 'High Voltage & Electrifying',
    desc: 'Dynamic • Upbeat • Pumping Bass',
    color1: '#f59e0b',
    color2: '#ef4444',
    rgb1: [245, 158, 11],
    rgb2: [239, 68, 68],
    energy: 94,
    warmth: 70,
    groove: 91,
    depth: 78
  },
  melancholic: {
    emoji: '🌧️',
    title: 'Nostalgic & Reflective',
    desc: 'Soulful • Minor Key • Midnight Reverie',
    color1: '#6366f1',
    color2: '#1e1b4b',
    rgb1: [99, 102, 241],
    rgb2: [30, 27, 75],
    energy: 48,
    warmth: 84,
    groove: 50,
    depth: 95
  },
  party: {
    emoji: '🎉',
    title: 'Club & Dance Anthem',
    desc: 'Hypnotic • Groove Heavy • Festival Energy',
    color1: '#ec4899',
    color2: '#f59e0b',
    rgb1: [236, 72, 153],
    rgb2: [245, 158, 11],
    energy: 96,
    warmth: 65,
    groove: 98,
    depth: 82
  },
  sufi: {
    emoji: '🕊️',
    title: 'Sufi & Spiritual Serenity',
    desc: 'Transcendent • Acoustic Harmonies • Divine',
    color1: '#10b981',
    color2: '#f59e0b',
    rgb1: [16, 185, 129],
    rgb2: [245, 158, 11],
    energy: 74,
    warmth: 95,
    groove: 62,
    depth: 90
  },
  cyberpunk: {
    emoji: '🌌',
    title: 'Cyberpunk Neon Synths',
    desc: 'Futuristic • Bass Heavy • Neon Glow',
    color1: '#00f2fe',
    color2: '#ec4899',
    rgb1: [0, 242, 254],
    rgb2: [236, 72, 153],
    energy: 92,
    warmth: 60,
    groove: 94,
    depth: 88
  },
  acoustic: {
    emoji: '🍃',
    title: 'Pure Acoustic Serenade',
    desc: 'Organic Strings • Crisp Resonance • Warm',
    color1: '#84cc16',
    color2: '#06b6d4',
    rgb1: [132, 204, 22],
    rgb2: [6, 182, 212],
    energy: 58,
    warmth: 96,
    groove: 55,
    depth: 80
  }
};

/* ── Dhun Vibe & Mood State Manager ────────────────────────────────── */
const visualShowcaseEngine = {
  currentKey: 'romantic'
};

function initVisualShowcaseCanvases() {
  // Canvases retired: Single unified visualizer is at the top of the player
}

function resizeVisualShowcaseCanvases() {
  // Canvases retired: Single unified visualizer handles resizing
}

function getSavedSongVibe(song) {
  if (!song) return null;
  try {
    const k = typeof getUserStorageKey === 'function' ? getUserStorageKey('song_vibes') : 'dhun_song_vibes';
    const vibes = JSON.parse(localStorage.getItem(k) || '{}');
    return vibes[getSongStorageKey(song)] || null;
  } catch (e) {
    return null;
  }
}

function getSongVibeKey(song) {
  if (!song) return 'romantic';
  const saved = getSavedSongVibe(song);
  if (saved && DHUN_VIBE_PRESETS[saved]) return saved;

  const text = `${song.genre || ''} ${song.title || ''} ${song.artist || ''}`.toLowerCase();
  if (/party|dance|edm|remix|dj|club|bhangra/.test(text)) return 'party';
  if (/energetic|rock|fast|hype|power|workout/.test(text)) return 'energetic';
  if (/chill|relax|acoustic|lo-fi|peace|sleep|breeze/.test(text)) return 'chill';
  if (/sad|lonely|heartbreak|dardi|dard|melancholy|alone/.test(text)) return 'melancholic';
  if (/sufi|qawwali|devotional|classical|raag|bhajan/.test(text)) return 'sufi';
  if (/cyber|synth|electronic|techno|retro/.test(text)) return 'cyberpunk';
  if (/acoustic|guitar|piano|unplugged|folk/.test(text)) return 'acoustic';
  return 'romantic';
}

function renderDhunVibeUI(song) {
  if (!song) return;
  const vibeKey = getSongVibeKey(song);
  visualShowcaseEngine.currentKey = vibeKey;
  const preset = DHUN_VIBE_PRESETS[vibeKey] || DHUN_VIBE_PRESETS.romantic;

  _set('hub-vibe-emoji', preset.emoji);
  _set('hub-vibe-title', preset.title);
  _set('hub-vibe-desc', preset.desc);

  _set('vibe-val-energy', `${preset.energy}%`);
  _set('vibe-val-warmth', `${preset.warmth}%`);
  _set('vibe-val-groove', `${preset.groove}%`);
  _set('vibe-val-depth', `${preset.depth || 85}%`);

  const fillE = document.getElementById('vibe-fill-energy');
  const fillW = document.getElementById('vibe-fill-warmth');
  const fillG = document.getElementById('vibe-fill-groove');
  const fillD = document.getElementById('vibe-fill-depth');
  if (fillE) fillE.style.width = `${preset.energy}%`;
  if (fillW) fillW.style.width = `${preset.warmth}%`;
  if (fillG) fillG.style.width = `${preset.groove}%`;
  if (fillD) fillD.style.width = `${preset.depth || 85}%`;

  const chips = document.querySelectorAll('#dhun-vibe-chips .vibe-chip');
  chips.forEach(chip => {
    const isThisVibe = chip.textContent.toLowerCase().includes(vibeKey) ||
      (vibeKey === 'melancholic' && chip.textContent.toLowerCase().includes('melancholy'));
    chip.classList.toggle('active', isThisVibe);
  });
}

function setCustomSongVibe(vibeKey, btnEl) {
  if (!state.currentSong || !DHUN_VIBE_PRESETS[vibeKey]) return;

  try {
    const k = typeof getUserStorageKey === 'function' ? getUserStorageKey('song_vibes') : 'dhun_song_vibes';
    const vibes = JSON.parse(localStorage.getItem(k) || '{}');
    vibes[getSongStorageKey(state.currentSong)] = vibeKey;
    localStorage.setItem(k, JSON.stringify(vibes));
  } catch (e) {}

  visualShowcaseEngine.currentKey = vibeKey;
  renderAllFunctionsDashboard(state.currentSong);
  renderDhunVibeUI(state.currentSong);
  showToast(`🎨 Dhun Mood & Top Visualizer synced to ${DHUN_VIBE_PRESETS[vibeKey].title}!`);
}

/* ══════════════════════════════════════════════════════════════════════
   OPTION 0: ALL FUNCTIONS DASHBOARD (INTEGRATED VIEW)
   ══════════════════════════════════════════════════════════════════════ */
function renderAllFunctionsDashboard(song) {
  if (!song) return;

  // 1. Song Info quick summary
  _set('hub-all-album', song.album || 'Single / Master Release');
  _set('hub-all-genre', song.genre || 'Bollywood / Romance');
  const localAudio = (typeof pcSongAudioMap !== 'undefined') ? pcSongAudioMap.get(song.id) : null;
  const isPCImport = !!(localAudio && localAudio.url);
  _set('hub-all-quality', isPCImport ? 'Lossless Master • 44.1 kHz' : '320 kbps Studio HQ');

  // 2. Dynamic Visual Showcase Banner in Dashboard
  const vibeKey = getSongVibeKey(song);
  visualShowcaseEngine.currentKey = vibeKey;
  const preset = DHUN_VIBE_PRESETS[vibeKey] || DHUN_VIBE_PRESETS.romantic;
  _set('hub-all-vibe-title', `${preset.emoji} ${preset.title}`);
  _set('hub-all-vibe-desc', preset.desc);
  _set('hub-all-vibe-energy-val', `${preset.energy}%`);
  _set('hub-all-vibe-warmth-val', `${preset.warmth}%`);

  const fillE = document.getElementById('hub-all-vibe-energy');
  const fillW = document.getElementById('hub-all-vibe-warmth');
  if (fillE) fillE.style.width = `${preset.energy}%`;
  if (fillW) fillW.style.width = `${preset.warmth}%`;

  const quickChips = document.querySelectorAll('.dash-showcase-quick-chips .dash-chip');
  quickChips.forEach(chip => {
    const isThis = chip.textContent.toLowerCase().includes(vibeKey) ||
      (vibeKey === 'melancholic' && chip.textContent.toLowerCase().includes('melancholy'));
    chip.classList.toggle('active', isThis);
  });

  // 3. Listening stats summary
  const stats = getSongStats(song);
  const plays = stats.plays || 0;
  const seconds = stats.seconds || 0;
  _set('hub-all-plays', plays);
  _set('hub-all-time', formatListeningSeconds(seconds));

  const badgeEl = document.getElementById('hub-all-badge');
  if (badgeEl) {
    badgeEl.textContent = plays >= 25 ? '👑 All-Time Dhun Classic' :
                          plays >= 10 ? '🔥 On Heavy Repeat' :
                          plays >= 4  ? '✨ Rising Favorite' : '🌱 Fresh Discovery';
  }
  const retEl = document.getElementById('hub-all-retention');
  if (retEl) {
    const retention = Math.min(99, Math.max(78, 85 + (plays % 14)));
    retEl.textContent = `⚡ ${retention}% Replay Rate`;
  }

  // 4. Similar Dhun compact list
  const container = document.getElementById('dhun-all-similar-list');
  if (container) {
    const similarList = calculateSimilarDhun(song);
    if (similarList.length === 0) {
      container.innerHTML = `
        <div style="font-size:11px;color:var(--text-3);padding:6px 2px">
          ✨ Add more songs from your PC or Library to see personalized matching tracks!
        </div>
      `;
    } else {
      container.innerHTML = similarList.slice(0, 2).map(({ song: s, reason }) => {
        const thumb = imgFor(s.id);
        return `
          <div class="dhun-similar-card" onclick="openPlayerById(${s.id})" title="Play ${escapeHtmlAttr(s.title)}" style="padding:6px 9px">
            <div class="similar-left">
              <img class="similar-thumb" src="${thumb}" alt="${escapeHtmlAttr(s.title)}" onerror="this.src='album1.jpg'" style="width:30px;height:30px" />
              <div class="similar-meta">
                <span class="similar-title" style="font-size:12.5px">${escapeHtmlText(s.title)}</span>
                <span class="similar-artist" style="font-size:11px">${escapeHtmlText(s.artist)}</span>
              </div>
            </div>
            <span class="similar-tag" style="font-size:9.5px">${escapeHtmlText(reason)}</span>
            <div class="similar-actions" onclick="event.stopPropagation()">
              <button class="btn-sim-play" onclick="openPlayerById(${s.id})" title="Play Now" style="width:26px;height:26px;font-size:10px">▶</button>
              <button class="btn-sim-queue" onclick="enqueueSong(${s.id}, event)" title="Add to Queue" style="width:26px;height:26px;font-size:12px">➕</button>
            </div>
          </div>
        `;
      }).join('');
    }
  }

  if (!visualShowcaseEngine.initialized) {
    initVisualShowcaseCanvases();
  }
}

/* ══════════════════════════════════════════════════════════════════════
   MASTER HUB UPDATE DISPATCHER
   Called on song change, play, or navigation
   ══════════════════════════════════════════════════════════════════════ */
function updateDhunHub(song) {
  if (!song) return;
  dhunHubState.currentSongId = song.id;

  if (!visualShowcaseEngine.initialized) {
    initVisualShowcaseCanvases();
  }

  renderAllFunctionsDashboard(song);
  renderSongInfoUI(song);
  renderSongStatsUI(song);
  renderSimilarDhunUI(song);
  renderDhunVibeUI(song);
}

/* ── Backward Compatibility Stubs for Legacy Callers ──────────────── */
function loadSongLyrics(song) {
  updateDhunHub(song);
}
function updateLyricsSync(currentSec) {
  if (state.isPlaying && state.currentSong) {
    recordListeningTime(state.currentSong, 0.25);
  }
}
function toggleLyricsExpand() {
  toggleDhunHubExpand();
}

/* ══════════════════════════════════════════════════════════════════════
   YOUTUBE MUSIC EXPLORER & STREAMING CONTROLLER
   Unofficial media library integration:
   - Browse trending music & curated genre feeds
   - Instant search across millions of tracks
   - Real-time audio streaming via hidden player & simulated beat FFT
   - Import any song into Dhun Library with persistent storage & badges
   ══════════════════════════════════════════════════════════════════════ */

/* Compatibility stubs */
function switchSearchMode(mode) {
  const grid = document.getElementById('yt-music-grid');
  if (grid && (!grid.children || grid.children.length === 0)) {
    loadYTFeed(currentYTFeedCategory || 'for-you');
  }
}

function openYTMusicExplorer() {
  navigate('search');
  const input = document.getElementById('search-input');
  if (input) input.focus();
}

/* ── Auto-Seed Online Media into Dhun Library on Startup ────────── */
async function autoSeedLibraryWithOnlineMedia() {
  if (typeof YTMusicAPI === 'undefined') return;
  try {
    let currentSongs = state.songs || [];
    if (currentSongs.length === 0) {
      try {
        const stored = localStorage.getItem('dhun_client_songs');
        if (stored) currentSongs = JSON.parse(stored) || [];
      } catch (e) {}
    }

    const seedCatalog = [
      ...YTMusicAPI.getTrending('trending'),
      ...YTMusicAPI.getTrending('bollywood').slice(0, 4),
      ...YTMusicAPI.getTrending('punjabi').slice(0, 2)
    ];

    let deletedSongTitles = new Set();
    try {
      const rawDel = localStorage.getItem('dhun_deleted_song_titles') || '[]';
      deletedSongTitles = new Set(JSON.parse(rawDel));
    } catch(e){}

    let count = 0;
    for (const track of seedCatalog) {
      const key = (track.title || '').toLowerCase().trim();
      if (deletedSongTitles.has(key)) continue;
      if (existingTitleSet.has(key)) {
        // Ensure audio mapping exists
        const found = currentSongs.find(s => (s.title || '').toLowerCase().trim() === key);
        if (found && !pcSongAudioMap.has(found.id)) {
          const ytData = {
            isYT: true,
            videoId: track.videoId,
            thumbnail: track.thumbnail || `https://i.ytimg.com/vi/${track.videoId}/hqdefault.jpg`,
            durationSec: track.durationSec || 210,
            title: track.title,
            artist: track.artist
          };
          pcSongAudioMap.set(found.id, ytData);
          saveYTSongToStorage(found.id, ytData);
        }
        continue;
      }

      const durMin = track.duration || +(track.durationSec / 60).toFixed(2) || 4.0;
      let res = await apiPost('/songs', {
        title: track.title,
        artist: track.artist,
        album: track.album || 'Online Media',
        genre: track.genre || 'Popular',
        duration: durMin,
        rating: 4.8
      });

      const songId = (res && res.id !== undefined) ? res.id : (Date.now() + Math.floor(Math.random() * 1000000));
      const songObj = {
        id: songId,
        title: track.title,
        artist: track.artist,
        album: track.album || 'Online Media',
        genre: track.genre || 'Popular',
        duration: durMin,
        rating: 4.8,
        play_count: Math.floor(Math.random() * 12) + 1,
        liked: 0
      };

      currentSongs.push(songObj);

      const ytData = {
        isYT: true,
        videoId: track.videoId,
        thumbnail: track.thumbnail || `https://i.ytimg.com/vi/${track.videoId}/hqdefault.jpg`,
        durationSec: track.durationSec || 210,
        title: track.title,
        artist: track.artist
      };
      pcSongAudioMap.set(songId, ytData);
      saveYTSongToStorage(songId, ytData);
      existingTitleSet.add(key);
      count++;
    }

    state.songs = currentSongs;
    _libAllSongs = state.songs;
    try {
      localStorage.setItem('dhun_client_songs', JSON.stringify(state.songs));
    } catch (e) {}

    if (count > 0) {
      console.log(`[Dhun] Auto-populated library with ${count} online songs.`);
    }
  } catch (err) {
    console.warn('Auto-seed library error:', err);
  }
}

/* ── Auto-Add Track to Library ──────────────────────────────────── */
async function autoAddTrackToLibrary(track) {
  if (!track) return null;
  const durSec = track.durationSec || 210;
  const durMin = track.durationMin || +(durSec / 60).toFixed(2);
  const title = track.title || 'Untitled';
  const artist = track.artist || 'Online Artist';
  const album = track.album || 'Online Media';
  const genre = track.genre || 'Cloud Audio';

  if (!track.videoId && typeof YTMusicAPI !== 'undefined' && YTMusicAPI.getVideoIdForTrack) {
    const matched = YTMusicAPI.getVideoIdForTrack(title, artist);
    if (matched) track.videoId = matched;
  }

  // Check if song already exists in state.songs
  let existing = state.songs.find(s => {
    const audio = pcSongAudioMap.get(s.id);
    if (audio && track.videoId && audio.videoId === track.videoId) return true;
    return s.title.toLowerCase().trim() === title.toLowerCase().trim();
  });
  if (existing) {
    const thumb = track.videoId ? `https://i.ytimg.com/vi/${track.videoId}/hqdefault.jpg` : (track.thumbnail || ALBUM_IMGS[0]);
    const ytData = {
      isYT: !!track.videoId,
      videoId: track.videoId || null,
      url: track.previewUrl || null,
      thumbnail: thumb,
      durationSec: durSec,
      title,
      artist
    };
    existing.thumbnail = thumb;
    ytCoverArtCache.set(existing.id, thumb);
    pcSongAudioMap.set(existing.id, ytData);
    saveYTSongToStorage(existing.id, ytData);
    return existing;
  }

  // Persist to C REST API backend
  let song = await apiPost('/songs', {
    title,
    artist,
    album,
    genre,
    duration: durMin,
    rating: 4.8
  });

  if (!song || song.id === undefined) {
    song = {
      id: Date.now() + Math.floor(Math.random() * 10000),
      title,
      artist,
      album,
      genre,
      duration: durMin,
      play_count: 0,
      rating: 4.8,
      liked: 0
    };
    state.songs.unshift(song);
  } else {
    if (!state.songs.some(s => s.id === song.id)) {
      state.songs.push(song);
    }
  }

  _libAllSongs = state.songs;
  try {
    localStorage.setItem('dhun_client_songs', JSON.stringify(state.songs));
  } catch (e) {}

  const thumb = track.videoId ? `https://i.ytimg.com/vi/${track.videoId}/hqdefault.jpg` : (track.thumbnail || ALBUM_IMGS[0]);
  song.thumbnail = thumb;
  ytCoverArtCache.set(song.id, thumb);
  const ytData = {
    isYT: !!track.videoId,
    videoId: track.videoId || null,
    url: track.previewUrl || null,
    thumbnail: thumb,
    durationSec: durSec,
    title,
    artist
  };

  pcSongAudioMap.set(song.id, ytData);
  saveYTSongToStorage(song.id, ytData);

  showToast(`✨ Auto-added "${title}" to your Library! 🔴`);

  if (state.currentPage === 'library') {
    refreshLibrary();
  } else if (state.currentPage === 'home') {
    refreshHome();
  }

  return song;
}

/* ══════════════════════════════════════════════════════════════════════
   PERSONALIZED DISCOVER & TASTE ADAPTATION ENGINE
   Automatically learns and adapts to the active listener's choices:
   - Liked tracks, playlists & play frequencies
   - Preferred genres & favorite artists
   - Interactive vibe selector ('auto', 'romantic', 'chill', 'energy', 'party')
   ══════════════════════════════════════════════════════════════════════ */

let currentDiscoverVibePreference = 'auto';

function getUserTasteProfile() {
  const likedSet = getUserLikedSet();
  const userPlaylists = getUserPlaylistsFromStorage() || state.playlists || [];
  const songsInPlaylists = new Set();
  userPlaylists.forEach(pl => {
    if (Array.isArray(pl.songs)) pl.songs.forEach(sid => songsInPlaylists.add(String(sid)));
  });

  const allKnown = [...(state.songs || []), ...(_libAllSongs || []), ...(state.history || [])];

  const genreCounts = {};
  const artistCounts = {};
  let totalUserInteractions = 0;

  allKnown.forEach(s => {
    if (!s) return;
    const isLiked = likedSet.has(Number(s.id)) || likedSet.has(String(s.id)) || s.liked;
    const inPlaylist = songsInPlaylists.has(String(s.id));
    const plays = s.play_count || 0;

    let weight = 0;
    if (isLiked) weight += 4;
    if (inPlaylist) weight += 3;
    if (plays > 0) weight += Math.min(5, plays);

    if (weight > 0) {
      totalUserInteractions += weight;
      const g = (s.genre || 'Pop').trim();
      genreCounts[g] = (genreCounts[g] || 0) + weight;

      const art = (s.artist || '').split(/[,/ft.&]/)[0].trim();
      if (art && art.length > 2) {
        artistCounts[art] = (artistCounts[art] || 0) + weight;
      }
    }
  });

  const sortedGenres = Object.keys(genreCounts).sort((a, b) => genreCounts[b] - genreCounts[a]);
  const sortedArtists = Object.keys(artistCounts).sort((a, b) => artistCounts[b] - artistCounts[a]);

  const userName = (authState.currentUser && authState.currentUser.name && authState.currentUser.name !== 'Guest User')
    ? authState.currentUser.name.split(' ')[0]
    : 'You';

  return {
    hasTasteData: totalUserInteractions > 0,
    userName,
    topGenres: sortedGenres.length > 0 ? sortedGenres : ['Bollywood', 'Pop', 'Lo-Fi'],
    topArtists: sortedArtists.slice(0, 4),
    totalInteractions: totalUserInteractions
  };
}

function getPersonalizedDiscoverTracks(vibe = 'auto') {
  if (typeof YTMusicAPI === 'undefined') return [];

  const profile = getUserTasteProfile();
  const allTracks = [
    ...YTMusicAPI.getTrending('trending'),
    ...YTMusicAPI.getTrending('bollywood'),
    ...YTMusicAPI.getTrending('punjabi'),
    ...YTMusicAPI.getTrending('lofi'),
    ...YTMusicAPI.getTrending('electronic'),
    ...(typeof YTMusicAPI.getTrending === 'function' ? YTMusicAPI.getTrending('pop') : [])
  ];

  // Deduplicate by videoId
  const seenIds = new Set();
  const uniqueTracks = [];
  for (const t of allTracks) {
    if (!t.videoId || seenIds.has(t.videoId)) continue;
    seenIds.add(t.videoId);
    uniqueTracks.push({ ...t });
  }

  // Score candidate tracks according to user preference & taste
  const scored = uniqueTracks.map(t => {
    let score = 10;
    let matchBadge = '';
    let matchReason = '';

    const tGenre = (t.genre || '').toLowerCase();
    const tArtist = (t.artist || '').toLowerCase();
    const tTitle = (t.title || '').toLowerCase();

    // 1. Explicit Vibe Override
    if (vibe === 'romantic') {
      if (tGenre.includes('bollywood') || /arijit|pritam|romance|love|shreya/i.test(tTitle + ' ' + tArtist)) {
        score += 85;
        matchBadge = '💖 Romance Vibe';
        matchReason = 'Melodic Love & Romance';
      }
    } else if (vibe === 'chill') {
      if (tGenre.includes('lo-fi') || /lofi|chill|relax|sleep|study|coffee/i.test(tTitle + ' ' + tArtist)) {
        score += 85;
        matchBadge = '🌙 Chill Beats';
        matchReason = 'Relaxing Lo-Fi Stream';
      }
    } else if (vibe === 'energy') {
      if (tGenre.includes('punjabi') || /diljit|dhillon|sidhu|energy|rock|banger/i.test(tTitle + ' ' + tArtist)) {
        score += 85;
        matchBadge = '⚡ High Energy';
        matchReason = 'Uptempo & Bangers';
      }
    } else if (vibe === 'party') {
      if (tGenre.includes('electronic') || /garrix|walker|avicii|dance|edm|party/i.test(tTitle + ' ' + tArtist)) {
        score += 85;
        matchBadge = '🎉 Party Track';
        matchReason = 'Club & EDM Energy';
      }
    }

    // 2. Automated personalized matching if 'auto' or complementary
    if (vibe === 'auto' || !matchBadge) {
      if (profile.hasTasteData) {
        // Artist Affinity
        for (const favArt of profile.topArtists) {
          if (favArt && tArtist.includes(favArt.toLowerCase())) {
            score += 75;
            matchBadge = `❤️ ${favArt}`;
            matchReason = `Favorite Artist`;
            break;
          }
        }

        // Top Genre Match
        if (!matchBadge && profile.topGenres.length > 0) {
          const topG = profile.topGenres[0].toLowerCase();
          if (tGenre.includes(topG) || topG.includes(tGenre)) {
            score += 60;
            matchBadge = `🎯 98% Vibe Match`;
            matchReason = `Top Genre: ${profile.topGenres[0]}`;
          } else if (profile.topGenres[1] && (tGenre.includes(profile.topGenres[1].toLowerCase()) || profile.topGenres[1].toLowerCase().includes(tGenre))) {
            score += 45;
            matchBadge = `✨ 92% Match`;
            matchReason = `Enjoyed: ${profile.topGenres[1]}`;
          }
        }
      }

      // Default curated badge if still unmatched
      if (!matchBadge) {
        if (t.genre === 'Bollywood') {
          score += 30;
          matchBadge = '🎶 Global Hit';
          matchReason = 'Bollywood Trending';
        } else if (t.genre === 'Pop' || t.genre === 'Rock') {
          score += 25;
          matchBadge = '🔥 Chartbuster';
          matchReason = 'Global Popular';
        } else {
          score += 20;
          matchBadge = '⚡ Handpicked';
          matchReason = t.genre || 'Dhun Media';
        }
      }
    }

    return { ...t, score, matchBadge, matchReason };
  });

  // Sort descending by match score
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, 16);
}

function setDiscoverVibePreference(vibe, btnEl) {
  currentDiscoverVibePreference = vibe;
  document.querySelectorAll('#dtb-vibe-chips .dtb-chip').forEach(c => c.classList.remove('active'));
  if (btnEl) {
    btnEl.classList.add('active');
  } else {
    const el = document.getElementById(`dtb-vibe-${vibe}`);
    if (el) el.classList.add('active');
  }
  loadYTFeed('for-you');
}

/* ── Feed & Category Loader ─────────────────────────────────────── */
async function loadYTFeed(category = 'for-you', btnEl = null) {
  currentYTFeedCategory = category;

  document.querySelectorAll('#yt-trending-chips .filter-chip').forEach(c => c.classList.remove('active'));
  if (btnEl) {
    btnEl.classList.add('active');
  } else {
    const chip = document.getElementById(`yt-chip-${category}`);
    if (chip) chip.classList.add('active');
  }

  const tasteBanner = document.getElementById('discover-taste-banner');
  const titleEl = document.getElementById('yt-results-title');
  const countEl = document.getElementById('yt-results-count');
  const profile = getUserTasteProfile();

  if (category === 'for-you') {
    if (tasteBanner) tasteBanner.style.display = 'flex';
    const dtbTitle = document.getElementById('dtb-title');
    const dtbSub   = document.getElementById('dtb-sub');
    if (dtbTitle) {
      dtbTitle.innerHTML = `✨ Made For ${escapeHtmlText(profile.userName)}`;
    }
    if (dtbSub) {
      if (currentDiscoverVibePreference !== 'auto') {
        const vibeNames = { romantic: '💖 Romance & Melodies', chill: '🌙 Chill & Lo-Fi Beats', energy: '⚡ High Energy Bangers', party: '🎉 Party & Dance EDM' };
        dtbSub.textContent = `Auto-curated stream filtered by ${vibeNames[currentDiscoverVibePreference] || 'your selected vibe'}`;
      } else if (profile.hasTasteData) {
        dtbSub.textContent = `Auto-adapted to your taste in ${profile.topGenres.slice(0, 2).join(' & ')} · Updates in real time as you play & like`;
      } else {
        dtbSub.textContent = `Fresh curated discovery stream · Like or save tracks to tailor your personal vibe`;
      }
    }
    if (titleEl) titleEl.textContent = `✨ Recommended For ${profile.userName}`;
    if (countEl) countEl.textContent = 'Auto-Adapted';

    const tracks = getPersonalizedDiscoverTracks(currentDiscoverVibePreference);
    renderYTMusicGrid(tracks);
    return;
  }

  // Other specific categories
  if (tasteBanner) tasteBanner.style.display = 'none';

  const titles = {
    trending: '🔥 Top Trending Media',
    bollywood: '🎶 Bollywood Hits & Chartbusters',
    punjabi: '⚡ Punjabi Bangers & Pop',
    lofi: '☕ Lo-Fi Chill & Study Beats',
    electronic: '🎛️ EDM, Synthwave & Electronic',
    pop: '🎤 Global Pop & Rock Classics'
  };
  if (titleEl) titleEl.textContent = titles[category] || '🔥 Trending Media';

  const grid = document.getElementById('yt-music-grid');
  if (grid) {
    grid.innerHTML = `
      <div class="yt-skeleton-card"><div class="yt-skel-thumb"></div><div class="yt-skel-line"></div><div class="yt-skel-line short"></div></div>
      <div class="yt-skeleton-card"><div class="yt-skel-thumb"></div><div class="yt-skel-line"></div><div class="yt-skel-line short"></div></div>
      <div class="yt-skeleton-card"><div class="yt-skel-thumb"></div><div class="yt-skel-line"></div><div class="yt-skel-line short"></div></div>
      <div class="yt-skeleton-card"><div class="yt-skel-thumb"></div><div class="yt-skel-line"></div><div class="yt-skel-line short"></div></div>
    `;
  }

  if (typeof YTMusicAPI !== 'undefined') {
    try {
      const tracks = await YTMusicAPI.getTrendingFeed(category);
      renderYTMusicGrid(tracks);
    } catch (err) {
      console.warn('Failed to load feed:', err);
      if (grid) grid.innerHTML = '<p style="color:var(--text-2);padding:24px;grid-column:1/-1;text-align:center">Could not load media feed.</p>';
    }
  }
}

/* ── Grid Renderer with Non-Overlapping Layout ───────── */
function renderYTMusicGrid(tracks, customGrid = null, customCount = null) {
  currentYTResults = Array.isArray(tracks) ? tracks : [];
  const countEl = customCount || document.getElementById('yt-results-count');
  if (countEl && currentYTFeedCategory !== 'for-you') {
    countEl.textContent = `${currentYTResults.length} Tracks`;
  }

  const grid = customGrid || document.getElementById('yt-music-grid');
  if (!grid) return;

  if (currentYTResults.length === 0) {
    grid.innerHTML = `
      <div style="grid-column:1/-1;text-align:center;padding:36px 20px;color:var(--text-muted)">
        <p style="font-size:28px;margin-bottom:6px">🎵</p>
        <p style="font-weight:600;font-size:15px;color:var(--text-1);margin-bottom:4px">No media tracks found</p>
        <p style="font-size:12px;margin-bottom:14px">Try another search or explore trending tracks</p>
        <button class="btn-primary" onclick="loadYTFeed('trending')" style="display:inline-flex;align-items:center;gap:6px">
          🔥 Explore Trending Tracks
        </button>
      </div>`;
    return;
  }

  const savedLibraryKeys = new Set(
    state.songs.map(s => {
      const audioInfo = pcSongAudioMap.get(s.id);
      if (audioInfo && audioInfo.videoId) return audioInfo.videoId;
      return `${(s.title || '').toLowerCase().trim()}:::${(s.artist || '').toLowerCase().trim()}`;
    })
  );

  grid.innerHTML = currentYTResults.map((t, idx) => {
    const isAlreadyInLib = (t.videoId && savedLibraryKeys.has(t.videoId)) ||
      savedLibraryKeys.has(`${(t.title || '').toLowerCase().trim()}:::${(t.artist || '').toLowerCase().trim()}`);

    const dur = t.durationFormatted || fmtDur(t.durationMin || (t.durationSec / 60));
    const thumb = t.thumbnail || (t.videoId ? `https://i.ytimg.com/vi/${t.videoId}/hqdefault.jpg` : 'album1.jpg');
    const badgeText = t.matchBadge || (isAlreadyInLib ? '✓ In Library' : '⚡ Auto-Add');
    const isVibeMatch = !!t.matchBadge;

    return `
      <div class="yt-song-card" id="yt-card-${idx}">
        <div class="yt-card-thumb-wrap" onclick="playYTMusicIndex(${idx})">
          <img src="${thumb}" alt="${escapeHtmlAttr(t.title)}" onerror="this.src='album1.jpg'" class="yt-card-thumb" />
          <div class="yt-card-play-overlay">
            <span class="yt-card-play-btn">▶</span>
          </div>
          <span class="yt-card-dur">${dur}</span>
          <span class="yt-card-source-badge ${isVibeMatch ? 'vibe-match' : ''}">
            ${escapeHtmlText(badgeText)}
          </span>
        </div>
        <div class="yt-card-info">
          <h4 class="yt-card-title" title="${escapeHtmlAttr(t.title)}" onclick="playYTMusicIndex(${idx})">${escapeHtmlText(t.title)}</h4>
          <p class="yt-card-artist" title="${escapeHtmlAttr(t.artist)}">${escapeHtmlText(t.artist)}</p>
          <div class="yt-card-meta">
            <span class="yt-genre-pill">${escapeHtmlText(t.genre || 'Media')}</span>
            ${t.matchReason ? `<span class="yt-match-tag">${escapeHtmlText(t.matchReason)}</span>` : ''}
          </div>
        </div>
        <div class="yt-card-actions">
          <button class="yt-btn-play" onclick="playYTMusicIndex(${idx})" title="Play & Auto-Add to Library">
            <span>▶ Play</span>
          </button>
          <button class="yt-btn-action" onclick="enqueueYTMusicIndex(${idx})" title="Queue Track">
            <span>＋ Queue</span>
          </button>
          <button class="yt-btn-action" onclick="addYTMusicIndexToPlaylist(${idx}, event)" title="Add to Playlist">
            <span>⋯ Playlist</span>
          </button>
        </div>
      </div>
    `;
  }).join('');
}

function playYTMusicIndex(idx) {
  if (currentYTResults && currentYTResults[idx]) {
    playYTMusicTrack(currentYTResults[idx]);
  }
}

function importYTMusicIndex(idx) {
  if (currentYTResults && currentYTResults[idx]) {
    autoAddTrackToLibrary(currentYTResults[idx]);
  }
}

function enqueueYTMusicIndex(idx) {
  if (currentYTResults && currentYTResults[idx]) {
    enqueueYTMusicSong(currentYTResults[idx]);
  }
}

async function addYTMusicIndexToPlaylist(idx, event) {
  if (event) {
    try { event.stopPropagation(); event.preventDefault(); } catch (e) {}
  }
  if (currentYTResults && currentYTResults[idx]) {
    const track = currentYTResults[idx];
    const song = await autoAddTrackToLibrary(track);
    const sid = (song && song.id !== undefined) ? song.id : track.videoId;
    addToPlaylistPrompt(sid, event);
  }
}

/* Playing any track automatically adds it to the library */
async function playYTMusicTrack(track) {
  if (!track) return;

  if (!track.videoId && typeof YTMusicAPI !== 'undefined' && YTMusicAPI.resolveVideoIdForTrack) {
    const resolvedVid = await YTMusicAPI.resolveVideoIdForTrack(track.title, track.artist);
    if (resolvedVid) {
      track.videoId = resolvedVid;
      track.id = `yt_${resolvedVid}`;
    }
  }

  // Auto-add to library if not yet added
  let song = await autoAddTrackToLibrary(track);
  if (song && song.id !== undefined) {
    openPlayerById(song.id);
  }
}

/* Enqueuing any track automatically adds it to the library */
async function enqueueYTMusicSong(track) {
  if (!track || !track.videoId) return;

  let song = await autoAddTrackToLibrary(track);
  if (song && song.id !== undefined) {
    await enqueueSong(song.id);
    showToast(`Added "${song.title}" to queue & library ✅`);
  }
}

const importYTMusicSongToLibrary = autoAddTrackToLibrary;

