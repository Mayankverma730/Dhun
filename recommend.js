'use strict';

/* ══════════════════════════════════════════════════════════════════════
   DHUN — recommend.js
   Last.fm + iTunes-powered Global Recommendation Engine
   ─────────────────────────────────────────────────────────────────────
   Integrates with the existing Dhun app.js architecture:
     • Uses state.songs / state.currentSong from app.js
     • Calls same API base (http://127.0.0.1:3000/api)
     • Renders into #recommendations section on Home page
     • Falls back gracefully at every step

   HOW IT WORKS:
     1. getSeed()        – picks last played / current song from app state
     2. fetchSimilar()   – calls Last.fm track.getSimilar (free, CORS-ok)
     3. filterLocal()    – removes songs already in the user's library
     4. enrich()         – adds artwork + 30s preview via iTunes Search API
     5. render()         – injects beautiful cards into #recommendations
     6. initRecommendations() – orchestrates the full flow

   SETUP: Replace LASTFM_API_KEY below with your own free key from
          https://www.last.fm/api/account/create
══════════════════════════════════════════════════════════════════════ */

/* ── Configuration ───────────────────────────────────────────────── */
const LASTFM_API_KEY = 'YOUR_LASTFM_API_KEY_HERE';   // paste your key here
const LASTFM_BASE    = 'https://ws.audioscrobbler.com/2.0/';
const ITUNES_BASE    = 'https://itunes.apple.com/search';
const SIMILAR_LIMIT  = 20;   // how many Last.fm similar tracks to fetch
const DISPLAY_LIMIT  = 10;   // how many to show in the UI
const REQUEST_DELAY  = 220;  // ms between batched iTunes calls

/* ── In-memory caches (survive page navigation, cleared on hard reload) ── */
const _itunesCache    = new Map();
const _lastfmCache    = new Map();
let   _recRefreshTimer = null;

/* ══════════════════════════════════════════════════════════════════
   STEP 1 — getSeed
   Picks the "seed" track from app state.
   Priority: currentSong > history > first song in library > YT songs
══════════════════════════════════════════════════════════════════ */
function getSeed() {
  try {
    if (window.state && window.state.currentSong) {
      const s = window.state.currentSong;
      if (s.artist && s.title) return { artist: s.artist.trim(), title: s.title.trim(), song: s };
    }
    if (window.state && window.state.history && window.state.history.length > 0) {
      const s = window.state.history[window.state.history.length - 1];
      if (s && s.artist && s.title) return { artist: s.artist.trim(), title: s.title.trim(), song: s };
    }
    if (window.state && window.state.songs && window.state.songs.length > 0) {
      const s = window.state.songs[0];
      if (s && s.artist && s.title) return { artist: s.artist.trim(), title: s.title.trim(), song: s };
    }
    try {
      const ytRaw = localStorage.getItem('dhun_yt_songs');
      if (ytRaw) {
        const ytSongs = Object.values(JSON.parse(ytRaw));
        if (ytSongs.length > 0) {
          const s = ytSongs[ytSongs.length - 1];
          if (s.artist && s.title) return { artist: s.artist.trim(), title: s.title.trim(), song: s };
        }
      }
    } catch (e) {}
  } catch (e) {
    console.warn('[Recommend] getSeed error:', e);
  }
  return null;
}

/* ══════════════════════════════════════════════════════════════════
   STEP 2 — fetchSimilar
   Calls Last.fm track.getSimilar (JSON, CORS-enabled).
   Falls back to artist.getSimilar if track returns nothing.
══════════════════════════════════════════════════════════════════ */
async function fetchSimilar(artist, title) {
  const cacheKey = `${artist.toLowerCase()}|${title.toLowerCase()}`;
  if (_lastfmCache.has(cacheKey)) return _lastfmCache.get(cacheKey);

  if (!LASTFM_API_KEY || LASTFM_API_KEY === 'YOUR_LASTFM_API_KEY_HERE') {
    console.warn('[Recommend] Last.fm API key not set — recommendations limited.');
    return [];
  }

  const params = new URLSearchParams({
    method: 'track.getSimilar',
    artist,
    track: title,
    api_key: LASTFM_API_KEY,
    format: 'json',
    limit: SIMILAR_LIMIT
  });

  try {
    const res  = await fetch(`${LASTFM_BASE}?${params}`);
    if (!res.ok) throw new Error(`Last.fm HTTP ${res.status}`);
    const data = await res.json();

    let tracks = (data.similartracks && data.similartracks.track) || [];
    if (!Array.isArray(tracks)) tracks = tracks ? [tracks] : [];

    const normalized = tracks.map(t => ({
      name  : t.name   || '',
      artist: typeof t.artist === 'string' ? t.artist : (t.artist && t.artist.name) || '',
      url   : t.url    || '',
      match : parseFloat(t.match) || 0,
      image : _pickLargestImage(t.image)
    })).filter(t => t.name && t.artist);

    if (normalized.length === 0) {
      const artistTracks = await _fetchArtistSimilar(artist);
      _lastfmCache.set(cacheKey, artistTracks);
      return artistTracks;
    }

    _lastfmCache.set(cacheKey, normalized);
    return normalized;

  } catch (err) {
    console.warn('[Recommend] Last.fm fetch failed:', err.message);
    try {
      const af = await _fetchArtistSimilar(artist);
      _lastfmCache.set(cacheKey, af);
      return af;
    } catch (e2) { return []; }
  }
}

async function _fetchArtistSimilar(artist) {
  const params = new URLSearchParams({
    method : 'artist.getSimilar',
    artist,
    api_key: LASTFM_API_KEY,
    format : 'json',
    limit  : 10
  });
  try {
    const res  = await fetch(`${LASTFM_BASE}?${params}`);
    if (!res.ok) return [];
    const data = await res.json();
    const artists = (data.similarartists && data.similarartists.artist) || [];
    const arr = Array.isArray(artists) ? artists : (artists ? [artists] : []);
    return arr.map(a => ({
      name  : `${a.name} Mix`,
      artist: a.name || '',
      url   : a.url  || '',
      match : parseFloat(a.match) || 0.5,
      image : _pickLargestImage(a.image)
    })).filter(t => t.artist);
  } catch (e) { return []; }
}

function _pickLargestImage(imageArr) {
  if (!Array.isArray(imageArr) || imageArr.length === 0) return '';
  const priority = ['mega', 'extralarge', 'large', 'medium', 'small'];
  for (const size of priority) {
    const img = imageArr.find(i => i.size === size);
    if (img && img['#text']) return img['#text'];
  }
  const last = [...imageArr].reverse().find(i => i['#text']);
  return last ? last['#text'] : '';
}

/* ══════════════════════════════════════════════════════════════════
   STEP 3 — filterLocal
   Removes songs already in the user's local library.
══════════════════════════════════════════════════════════════════ */
function filterLocal(tracks) {
  const known = new Set();

  const allKnown = [
    ...(window.state && window.state.songs   || []),
    ...(window.state && window.state.history || [])
  ];

  for (const s of allKnown) {
    if (!s) continue;
    const key = _normalizeKey(s.artist, s.title);
    if (key) known.add(key);
    if (s.title) known.add(s.title.toLowerCase().trim());
  }

  const seed = getSeed();
  if (seed) {
    known.add(_normalizeKey(seed.artist, seed.title));
    known.add(seed.title.toLowerCase().trim());
  }

  return tracks.filter(t => {
    const key = _normalizeKey(t.artist, t.name);
    const byTitle = t.name.toLowerCase().trim();
    return !known.has(key) && !known.has(byTitle);
  });
}

function _normalizeKey(artist, title) {
  if (!artist || !title) return '';
  return `${artist.toLowerCase().trim()}|${title.toLowerCase().trim()}`;
}

/* ══════════════════════════════════════════════════════════════════
   STEP 4 — enrich
   Adds HD artwork + 30s preview URL from iTunes Search API.
   Results are cached to avoid repeat calls.
══════════════════════════════════════════════════════════════════ */
async function enrich(tracks) {
  const enriched = [];
  for (let i = 0; i < tracks.length; i++) {
    const t = tracks[i];
    const cKey = _normalizeKey(t.artist, t.name);

    let itunesData = _itunesCache.get(cKey) || null;

    if (!itunesData) {
      try {
        const term = encodeURIComponent(`${t.artist} ${t.name}`);
        const url  = `${ITUNES_BASE}?term=${term}&media=music&entity=song&limit=1`;
        const res  = await fetch(url);
        if (res.ok) {
          const data = await res.json();
          if (data.results && data.results.length > 0) {
            const r = data.results[0];
            itunesData = {
              artwork   : (r.artworkUrl100 || '').replace('100x100bb', '300x300bb'),
              preview   : r.previewUrl || '',
              trackName : r.trackName  || t.name,
              artistName: r.artistName || t.artist,
              collectionName: r.collectionName || '',
              trackTimeMillis: r.trackTimeMillis || 0
            };
            _itunesCache.set(cKey, itunesData);
          }
        }
      } catch (e) {
        // Silently ignore — Last.fm image used as fallback
      }
      if (i < tracks.length - 1) await _sleep(REQUEST_DELAY);
    }

    enriched.push({ ...t, itunes: itunesData || null });
  }
  return enriched;
}

function _sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

/* ══════════════════════════════════════════════════════════════════
   STEP 5 — render
   Renders recommendation cards into #rec-grid.
══════════════════════════════════════════════════════════════════ */
function render(tracks, seedTitle) {
  const section  = document.getElementById('recommendations');
  if (!section) return;
  const grid     = section.querySelector('#rec-grid');
  const statusEl = section.querySelector('#rec-status');
  const seedSpan = section.querySelector('#rec-seed-label');

  if (!grid) return;
  if (statusEl) statusEl.style.display = 'none';
  if (seedSpan && seedTitle) seedSpan.textContent = `Based on: ${seedTitle}`;

  if (!tracks || tracks.length === 0) {
    grid.innerHTML = `
      <div class="rec-empty">
        <span style="font-size:32px">🌐</span>
        <p>No similar tracks found right now.</p>
        <p style="font-size:12px;opacity:0.6">Try playing a popular song, then click Refresh.</p>
      </div>`;
    return;
  }

  grid.innerHTML = tracks.slice(0, DISPLAY_LIMIT).map((t, idx) => {
    const artwork   = (t.itunes && t.itunes.artwork) || t.image || '';
    const previewUrl= (t.itunes && t.itunes.preview) || '';
    const duration  = t.itunes && t.itunes.trackTimeMillis ? _fmtMs(t.itunes.trackTimeMillis) : '';
    const album     = (t.itunes && t.itunes.collectionName) || '';
    const matchPct  = Math.round((t.match || 0) * 100);
    const gradient  = _gradientFromString(t.name + t.artist);
    const safeTitle = _escHtml(t.name);
    const safeArtist= _escHtml(t.artist);
    const safeAlbum = _escHtml(album);
    const artImg    = artwork
      ? `<img src="${_escAttr(artwork)}" alt="${safeTitle}" class="rec-art-img"
             onerror="this.style.display='none'" />`
      : '';
    const previewBtn = previewUrl
      ? `<button class="rec-btn rec-btn-preview"
              onclick="_recPlayPreview(this,'${_escAttr(previewUrl)}',event)"
              title="30s Preview">
           <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
           Preview
         </button>`
      : `<button class="rec-btn rec-btn-search"
              onclick="_recSearchTrack('${_escAttr(t.name)}','${_escAttr(t.artist)}',event)"
              title="Search on Dhun">
           🔍 Search
         </button>`;

    return `
      <div class="rec-card" id="rec-card-${idx}">
        <div class="rec-art" style="background:${gradient}">
          ${artImg}
          <div class="rec-art-overlay">${previewBtn}</div>
          ${matchPct > 0 ? `<span class="rec-match-badge">${matchPct}% match</span>` : ''}
        </div>
        <div class="rec-info">
          <p class="rec-track-name" title="${safeTitle}">${safeTitle}</p>
          <p class="rec-artist-name">${safeArtist}</p>
          ${safeAlbum ? `<p class="rec-album">${safeAlbum}</p>` : ''}
          ${duration   ? `<span class="rec-dur">${duration}</span>` : ''}
        </div>
        <div class="rec-actions">
          <button class="rec-btn rec-btn-queue"
                  onclick="_recAddToQueue('${_escAttr(t.name)}','${_escAttr(t.artist)}','${_escAttr(artwork)}',event)"
                  title="Search and Queue">＋ Queue</button>
          ${t.url ? `<a class="rec-btn rec-btn-lastfm" href="${_escAttr(t.url)}"
               target="_blank" rel="noopener noreferrer" title="View on Last.fm">🎵 Last.fm</a>` : ''}
        </div>
      </div>`;
  }).join('');
}

/* ── Preview audio player ── */
let _recAudio = null;
let _recActiveBtn = null;

window._recPlayPreview = function(btn, url, e) {
  if (e) e.stopPropagation();
  if (!url) return;
  if (_recAudio && _recAudio.src === url) {
    if (_recAudio.paused) {
      _recAudio.play().catch(() => {});
      btn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg> Pause`;
    } else {
      _recAudio.pause();
      btn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg> Preview`;
    }
    return;
  }
  if (_recAudio) { _recAudio.pause(); _recAudio.src = ''; }
  if (_recActiveBtn && _recActiveBtn !== btn) {
    _recActiveBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg> Preview`;
  }
  _recAudio = new Audio(url);
  _recAudio.volume = 0.8;
  _recAudio.play().then(() => {
    btn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg> Pause`;
    _recActiveBtn = btn;
  }).catch(err => { console.warn('[Recommend] Preview failed:', err.message); });
  _recAudio.onended = () => {
    btn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg> Preview`;
    _recActiveBtn = null;
  };
};

window._recSearchTrack = function(title, artist, e) {
  if (e) e.stopPropagation();
  const query = `${artist} ${title}`.trim();
  if (typeof navigate === 'function') navigate('search');
  setTimeout(() => {
    const inp = document.getElementById('search-input');
    if (inp) {
      inp.value = query;
      if (typeof handleSearch === 'function') handleSearch(query, true);
    }
  }, 300);
};

window._recAddToQueue = function(title, artist, artwork, e) {
  if (e) e.stopPropagation();
  const found = ((window.state && window.state.songs) || []).find(s =>
    s.title && s.artist &&
    s.title.toLowerCase().trim() === title.toLowerCase().trim() &&
    s.artist.toLowerCase().trim() === artist.toLowerCase().trim()
  );
  if (found && typeof enqueueSong === 'function') {
    enqueueSong(String(found.id));
    if (typeof showToast === 'function') showToast(`Queued: "${title}"`);
    return;
  }
  _recSearchTrack(title, artist, null);
  if (typeof showToast === 'function') showToast(`Searching for "${title}" by ${artist}`);
};

/* ── Loading / Error states ── */
function _renderLoading() {
  const grid     = document.getElementById('rec-grid');
  const statusEl = document.getElementById('rec-status');
  if (statusEl) {
    statusEl.style.display = 'flex';
    statusEl.innerHTML = `<div class="rec-spinner"></div><span>Finding similar tracks via Last.fm…</span>`;
  }
  if (grid) grid.innerHTML = '';
}

function _renderError(msg) {
  const grid     = document.getElementById('rec-grid');
  const statusEl = document.getElementById('rec-status');
  if (statusEl) statusEl.style.display = 'none';
  if (!grid) return;
  grid.innerHTML = `
    <div class="rec-empty">
      <span style="font-size:28px">⚠️</span>
      <p style="color:var(--text-2)">${_escHtml(msg)}</p>
      <button class="rec-refresh-btn" onclick="initRecommendations()" style="margin-top:10px">↻ Retry</button>
    </div>`;
}

/* ══════════════════════════════════════════════════════════════════
   STEP 6 — initRecommendations (Main Orchestrator)
══════════════════════════════════════════════════════════════════ */
async function initRecommendations() {
  _renderLoading();

  const seed = getSeed();
  if (!seed) {
    _renderError('Add songs to your library or play something to get global recommendations.');
    return;
  }

  let similar = [];
  try { similar = await fetchSimilar(seed.artist, seed.title); }
  catch (e) { console.warn('[Recommend] fetchSimilar error:', e); }

  const filtered = filterLocal(similar);

  if (LASTFM_API_KEY === 'YOUR_LASTFM_API_KEY_HERE') {
    _renderError('');
    const grid = document.getElementById('rec-grid');
    if (grid) grid.innerHTML = `
      <div class="rec-api-banner" style="grid-column:1/-1">
        <div class="rec-api-banner-inner">
          <span class="rec-api-icon">🔑</span>
          <div>
            <p class="rec-api-title">Unlock Global Recommendations</p>
            <p class="rec-api-desc">Get a free Last.fm API key in 2 minutes — no credit card needed.</p>
            <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">
              <a href="https://www.last.fm/api/account/create" target="_blank" rel="noopener noreferrer"
                 class="rec-api-link-btn">Get Free API Key →</a>
              <span style="font-size:12px;color:var(--text-muted);align-self:center">
                Then paste it in recommend.js line 28 → LASTFM_API_KEY
              </span>
            </div>
          </div>
        </div>
      </div>`;
    return;
  }

  if (filtered.length === 0) {
    try {
      const more = await _fetchArtistSimilar(seed.artist);
      const moreFiltered = filterLocal(more);
      if (moreFiltered.length > 0) {
        const enriched = await enrich(moreFiltered.slice(0, DISPLAY_LIMIT));
        render(enriched, seed.title);
        return;
      }
    } catch (e) {}
    _renderError(`You already have everything similar to "${seed.title}" in your library!`);
    return;
  }

  let enriched = [];
  try { enriched = await enrich(filtered.slice(0, DISPLAY_LIMIT + 5)); }
  catch (e) { enriched = filtered.slice(0, DISPLAY_LIMIT).map(t => ({ ...t, itunes: null })); }

  render(enriched, seed.title);
}

/* ── Auto-refresh hooks ── */
function _hookSongChange() {
  const _orig = window.openPlayerById;
  if (typeof _orig === 'function') {
    window.openPlayerById = async function(id) {
      await _orig.call(this, id);
      clearTimeout(_recRefreshTimer);
      _recRefreshTimer = setTimeout(() => {
        if (document.getElementById('recommendations')) initRecommendations();
      }, 1200);
    };
  }
}

/* ── Utility helpers ── */
function _escHtml(s) {
  if (!s) return '';
  return String(s).replace(/[&<>"']/g, m => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[m]));
}
function _escAttr(s) { return _escHtml(s); }
function _fmtMs(ms) {
  if (!ms) return '';
  const total = Math.floor(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2,'0')}`;
}
function _gradientFromString(str) {
  if (typeof gradientFor === 'function') return gradientFor(str);
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = ((hash << 5) - hash) + str.charCodeAt(i);
  const hue1 = ((hash & 0xFF) / 255) * 360;
  const hue2 = (hue1 + 40) % 360;
  return `linear-gradient(135deg,hsl(${Math.round(hue1)},70%,35%),hsl(${Math.round(hue2)},60%,20%))`;
}

/* ══════════════════════════════════════════════════════════════════
   CSS INJECTION — injects all styles into <head> at runtime
══════════════════════════════════════════════════════════════════ */
function _injectStyles() {
  if (document.getElementById('rec-styles')) return;
  const style = document.createElement('style');
  style.id = 'rec-styles';
  style.textContent = `
#recommendations {
  margin: 36px 0 20px;
  animation: recFadeIn 0.5s ease;
}
@keyframes recFadeIn { from { opacity:0; transform:translateY(12px); } to { opacity:1; transform:none; } }

.rec-section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 20px;
  flex-wrap: wrap;
  gap: 8px;
}
.rec-badge {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.8px;
  text-transform: uppercase;
  background: linear-gradient(90deg, #7c3aed, #ec4899);
  color: #fff;
  padding: 2px 8px;
  border-radius: 20px;
}
#rec-seed-label {
  font-size: 12px;
  font-weight: 400;
  color: var(--text-muted, rgba(255,255,255,0.4));
  font-style: italic;
}
.rec-refresh-btn {
  font-size: 12px;
  font-weight: 600;
  color: var(--accent, #7c3aed);
  background: rgba(124,58,237,0.12);
  border: 1px solid rgba(124,58,237,0.25);
  border-radius: 20px;
  padding: 5px 14px;
  cursor: pointer;
  transition: all 0.2s;
}
.rec-refresh-btn:hover { background: rgba(124,58,237,0.24); transform: scale(1.03); }
#rec-status {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 20px;
  font-size: 13px;
  color: var(--text-2, rgba(255,255,255,0.6));
}
.rec-spinner {
  width: 18px; height: 18px;
  border: 2px solid rgba(124,58,237,0.25);
  border-top-color: #7c3aed;
  border-radius: 50%;
  animation: recSpin 0.8s linear infinite;
  flex-shrink: 0;
}
@keyframes recSpin { to { transform: rotate(360deg); } }
#rec-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(168px, 1fr));
  gap: 16px;
}
@media (max-width: 600px) {
  #rec-grid { grid-template-columns: repeat(auto-fill, minmax(140px,1fr)); gap: 12px; }
}
.rec-card {
  background: var(--glass-bg, rgba(255,255,255,0.04));
  border: 1px solid var(--glass-border, rgba(255,255,255,0.08));
  border-radius: 14px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  cursor: pointer;
  transition: transform 0.22s ease, box-shadow 0.22s ease, border-color 0.22s ease;
}
.rec-card:hover {
  transform: translateY(-5px) scale(1.02);
  box-shadow: 0 16px 40px rgba(0,0,0,0.45);
  border-color: rgba(124,58,237,0.35);
}
.rec-art {
  position: relative;
  width: 100%;
  aspect-ratio: 1/1;
  overflow: hidden;
  flex-shrink: 0;
}
.rec-art-img {
  width: 100%; height: 100%;
  object-fit: cover;
  display: block;
  transition: transform 0.3s ease;
}
.rec-card:hover .rec-art-img { transform: scale(1.06); }
.rec-art-overlay {
  position: absolute;
  inset: 0;
  background: linear-gradient(to top, rgba(0,0,0,0.7) 0%, transparent 50%);
  display: flex;
  align-items: flex-end;
  justify-content: center;
  padding: 10px;
  opacity: 0;
  transition: opacity 0.22s ease;
}
.rec-card:hover .rec-art-overlay { opacity: 1; }
.rec-match-badge {
  position: absolute;
  top: 8px; right: 8px;
  font-size: 10px; font-weight: 700;
  color: #fff;
  background: rgba(0,0,0,0.55);
  backdrop-filter: blur(6px);
  border-radius: 20px;
  padding: 2px 7px;
}
.rec-info { padding: 10px 12px 6px; flex: 1; }
.rec-track-name {
  font-size: 13px; font-weight: 600;
  color: var(--text-1, #f1f1f5);
  margin: 0 0 3px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.rec-artist-name {
  font-size: 11px; color: var(--text-muted, rgba(255,255,255,0.45));
  margin: 0 0 2px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.rec-album {
  font-size: 10px; color: var(--text-muted, rgba(255,255,255,0.35));
  margin: 0;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.rec-dur {
  display: inline-block; margin-top: 4px;
  font-size: 10px; color: var(--accent, #7c3aed); font-weight: 600;
}
.rec-actions {
  display: flex; gap: 6px; padding: 6px 10px 10px; flex-wrap: wrap;
}
.rec-btn {
  display: inline-flex; align-items: center; gap: 4px;
  font-size: 11px; font-weight: 600;
  border-radius: 20px; padding: 4px 10px;
  cursor: pointer; border: none;
  transition: all 0.18s;
  text-decoration: none; line-height: 1;
}
.rec-btn-preview {
  background: rgba(124,58,237,0.18); color: #a78bfa;
  border: 1px solid rgba(124,58,237,0.3);
  width: 100%; justify-content: center; padding: 7px 12px; font-size: 12px;
}
.rec-btn-preview:hover { background: rgba(124,58,237,0.35); color: #fff; }
.rec-btn-search {
  background: rgba(255,255,255,0.07); color: var(--text-2, rgba(255,255,255,0.6));
  border: 1px solid rgba(255,255,255,0.1);
  width: 100%; justify-content: center; padding: 7px 12px; font-size: 12px;
}
.rec-btn-search:hover { background: rgba(255,255,255,0.14); color: #fff; }
.rec-btn-queue {
  background: linear-gradient(90deg, rgba(124,58,237,0.2), rgba(236,72,153,0.2));
  color: var(--text-1, #f1f1f5);
  border: 1px solid rgba(124,58,237,0.25);
  flex: 1; justify-content: center;
}
.rec-btn-queue:hover { background: linear-gradient(90deg, rgba(124,58,237,0.4), rgba(236,72,153,0.4)); }
.rec-btn-lastfm {
  background: rgba(210,35,42,0.12); color: #f87171;
  border: 1px solid rgba(210,35,42,0.25);
  padding: 4px 8px; text-decoration: none;
}
.rec-btn-lastfm:hover { background: rgba(210,35,42,0.25); }
.rec-empty {
  grid-column: 1 / -1;
  text-align: center;
  padding: 40px 20px;
  color: var(--text-2, rgba(255,255,255,0.5));
  display: flex; flex-direction: column; align-items: center; gap: 8px;
}
.rec-empty p { margin: 0; font-size: 13px; }
.rec-api-banner {
  margin-bottom: 16px; border-radius: 14px;
  background: linear-gradient(135deg, rgba(124,58,237,0.15), rgba(236,72,153,0.1));
  border: 1px solid rgba(124,58,237,0.3);
}
.rec-api-banner-inner {
  display: flex; align-items: flex-start; gap: 14px; padding: 16px 18px;
}
.rec-api-icon { font-size: 28px; flex-shrink: 0; }
.rec-api-title { font-size: 14px; font-weight: 700; color: var(--text-1, #f1f1f5); margin: 0 0 4px; }
.rec-api-desc { font-size: 12px; color: var(--text-2, rgba(255,255,255,0.6)); margin: 0; }
.rec-api-link-btn {
  display: inline-flex; font-size: 12px; font-weight: 700;
  color: #fff; background: linear-gradient(90deg,#7c3aed,#ec4899);
  border-radius: 20px; padding: 6px 14px; text-decoration: none; transition: opacity 0.18s;
}
.rec-api-link-btn:hover { opacity: 0.85; }
[data-theme="light"] .rec-card { background: rgba(0,0,0,0.04); border-color: rgba(0,0,0,0.08); }
[data-theme="light"] .rec-track-name { color: #1a1a2e; }
[data-theme="light"] .rec-artist-name { color: rgba(0,0,0,0.45); }
[data-theme="light"] #rec-status { color: rgba(0,0,0,0.55); }
  `;
  document.head.appendChild(style);
}

/* ══════════════════════════════════════════════════════════════════
   DOM INJECTION — Creates #recommendations in home-col-main
══════════════════════════════════════════════════════════════════ */
function _injectRecommendationsSection() {
  if (document.getElementById('recommendations')) return;
  const colMain = document.querySelector('.home-col-main') || document.getElementById('page-home');
  if (!colMain) return;
  const section = document.createElement('section');
  section.id = 'recommendations';
  section.innerHTML = `
    <div class="section-header rec-section-header">
      <h2 class="section-title">
        🌐 Recommended For You
        <span class="rec-badge">Last.fm AI</span>
      </h2>
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
        <span id="rec-seed-label"></span>
        <button class="see-all-btn rec-refresh-btn" onclick="initRecommendations()">↻ Refresh</button>
      </div>
    </div>
    <div id="rec-status" style="display:none"></div>
    <div id="rec-grid"></div>`;
  colMain.appendChild(section);
}

/* ══════════════════════════════════════════════════════════════════
   BOOT — runs when script loads
══════════════════════════════════════════════════════════════════ */
function _boot() {
  _injectStyles();
  _injectRecommendationsSection();
  _hookSongChange();

  // Patch navigate() so Home always triggers fresh recommendations
  const _origNavigate = window.navigate;
  if (typeof _origNavigate === 'function') {
    window.navigate = function(page) {
      _origNavigate.call(this, page);
      if (page === 'home') {
        clearTimeout(_recRefreshTimer);
        _recRefreshTimer = setTimeout(initRecommendations, 600);
      }
    };
  }

  // Initial load after DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(initRecommendations, 900));
  } else {
    setTimeout(initRecommendations, 900);
  }
}

// Public API
window.initRecommendations = initRecommendations;
window.fetchSimilar        = fetchSimilar;
window.filterLocal         = filterLocal;
window.enrich              = enrich;
window.getSeed             = getSeed;

_boot();
