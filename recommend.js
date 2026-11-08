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

/* ── Fisher-Yates Array Shuffle for Refresh Randomness ── */
function _shuffleArray(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* ── Curated Evergreen Fallback Tracks (Guarantees Recommendations Never Fail) ── */
const _CURATED_FALLBACK = [
  { name: 'Tum Hi Ho', artist: 'Arijit Singh & Mithoon', image: 'https://is1-ssl.mzstatic.com/image/thumb/Music115/v4/98/95/92/989592f6-3023-e292-1dc3-9994c6439e6a/8902894354784_Cover.jpg/300x300bb.jpg' },
  { name: 'Kesariya', artist: 'Pritam & Arijit Singh', image: 'https://is1-ssl.mzstatic.com/image/thumb/Music112/v4/7c/ec/c0/7cecc0df-56ad-506e-8e8e-8a9010ebff6c/196589334863.jpg/300x300bb.jpg' },
  { name: 'Apna Bana Le', artist: 'Arijit Singh & Sachin-Jigar', image: 'https://is1-ssl.mzstatic.com/image/thumb/Music122/v4/d9/f4/bf/d9f4bf4e-b5f7-876b-965a-044238e8cb57/196589578649.jpg/300x300bb.jpg' },
  { name: 'Channa Mereya', artist: 'Pritam & Arijit Singh', image: 'https://is1-ssl.mzstatic.com/image/thumb/Music125/v4/71/34/08/713408f6-df30-9706-9ea6-f6d8924b1a45/886446153676.jpg/300x300bb.jpg' },
  { name: 'Raataan Lambiyan', artist: 'Tanishk Bagchi, Jubin Nautiyal & Asees Kaur', image: 'https://is1-ssl.mzstatic.com/image/thumb/Music115/v4/a5/d5/07/a5d50711-b847-f831-2917-8e6ca6fbf5e2/8902894361003_Cover.jpg/300x300bb.jpg' },
  { name: 'Shayad', artist: 'Pritam & Arijit Singh', image: 'https://is1-ssl.mzstatic.com/image/thumb/Music114/v4/ee/17/dc/ee17dcc9-122e-1c88-e925-5e6df7db0ec8/886448259741.jpg/300x300bb.jpg' },
  { name: 'Agar Tum Saath Ho', artist: 'Alka Yagnik & Arijit Singh', image: 'https://is1-ssl.mzstatic.com/image/thumb/Music124/v4/c7/2b/9d/c72b9d03-2415-3221-5a9f-4375b48695d7/8902894357730_Cover.jpg/300x300bb.jpg' },
  { name: 'Hawayein', artist: 'Pritam & Arijit Singh', image: 'https://is1-ssl.mzstatic.com/image/thumb/Music125/v4/80/e7/7d/80e77d01-e737-fb42-ae5a-69488a0b5a19/886446654876.jpg/300x300bb.jpg' },
  { name: 'Heeriye', artist: 'Jasleen Royal & Arijit Singh', image: 'https://is1-ssl.mzstatic.com/image/thumb/Music126/v4/b4/0b/c4/b40bc438-660b-85cf-155e-653140656a8d/197188764028.jpg/300x300bb.jpg' },
  { name: 'Kalank (Title Track)', artist: 'Pritam & Arijit Singh', image: 'https://is1-ssl.mzstatic.com/image/thumb/Music114/v4/b8/47/98/b84798c8-b593-3d08-8f83-84f981156553/886447662054.jpg/300x300bb.jpg' }
];

function _getCuratedFallback(seed) {
  const seedNorm = seed && seed.title ? _cleanSongTitle(seed.title).toLowerCase().replace(/[^a-z0-9]/g, '') : '';
  const filtered = _CURATED_FALLBACK.filter(c => {
    const cNorm = _cleanSongTitle(c.name).toLowerCase().replace(/[^a-z0-9]/g, '');
    return !seedNorm || (!cNorm.includes(seedNorm) && !seedNorm.includes(cNorm));
  });
  return _shuffleArray(filtered.map(t => ({ ...t, match: 0.90, url: '' })));
}


/* ── Smart Query Cleaner & Indian/Bollywood Genre Detector ── */
function _isIndianMusic(title, artist) {
  const text = `${title || ''} ${artist || ''}`.toLowerCase();
  const indianPatterns = /bollywood|hindi|punjabi|sufi|ghazal|qawwali|bhangra|desi|arijit|pritam|mithoon|neha|badshah|jubin|asees|t-series|zee music|sony music|shreya|sunidhi|atif|mohit|rahat|tanishk|bagchi|sachin-jigar|alka|kumar sanu|udit|sonu nigam|shankar|vishal|shekhar|rahman|jasleen|b praak|darshan|diljit|sidhu|karan aujla|shubh|crook|aashiqui|simmba|shershaah|brahmastra|jawan|pathaan|war|loveyatri|pagalpanti|half girlfriend|kabira|tum hi ho|darkhaast|tere bin/i;
  return indianPatterns.test(text);
}

function _cleanSeedQuery(artist, title) {
  const labelPatterns = /^(t-series|tseries|sony music|zee music|tips|yrf|speed records|geet mp3|desi music|white hill|saregama|aditya|times music|eros)/i;
  let cleanT = (title || '')
    .replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '')
    .replace(/(\s*-\s*|\s*\|\s*)?(full song|video song|official video|lyrical video|audio song|official lyrical|lyrics|audio|hd|4k)\b/gi, '')
    .replace(/\(.*?\)|\[.*?\]/g, '')
    .split('/')[0]
    .split(':')[0]
    .trim();

  const isLabel = labelPatterns.test((artist || '').trim());
  const isIndian = _isIndianMusic(title, artist);

  if (isIndian) {
    if (isLabel) return cleanT ? `${cleanT} Bollywood` : 'Bollywood Romance Hits';
    if (artist && cleanT) return `${artist} ${cleanT}`;
    return cleanT ? `${cleanT} Bollywood` : 'Bollywood Romance Hits';
  }

  if (isLabel) return cleanT || 'Pop Hits';
  if (artist && cleanT) return `${artist} ${cleanT}`;
  return cleanT || artist || 'Pop Hits';
}

function _cleanArtistOnly(artist) {
  if (!artist) return '';
  const labelPatterns = /^(t-series|tseries|sony music|zee music|tips|yrf|speed records|geet mp3|desi music|white hill|saregama|aditya|times music|eros)/i;
  if (labelPatterns.test(artist.trim())) return '';
  return artist.trim();
}
/* ── Multi-Tier iTunes Discovery Fallback (Strict Genre Matching & country=IN) ── */
async function _fetchItunesFallback(artist, title, force = false) {
  const cacheKey = 'itunes_fallback|' + (artist || '').toLowerCase() + '|' + (title || '').toLowerCase();
  if (!force && _lastfmCache.has(cacheKey)) return _lastfmCache.get(cacheKey);

  try {
    const isIndian = _isIndianMusic(title, artist);
    const cleanTitle = _cleanSongTitle(title || '');
    const cleanArtist = _cleanArtistOnly(artist || '');
    const primaryQuery = _cleanSeedQuery(artist, title);
    const countryParam = isIndian ? '&country=IN' : '';

    let pool = [];

    // 1. Search primary query with country=IN for Indian songs
    try {
      const q = encodeURIComponent(primaryQuery);
      const res = await fetch(`${ITUNES_BASE}?term=${q}${countryParam}&media=music&entity=song&limit=25`);
      if (res.ok) {
        const data = await res.json();
        pool.push(...(data.results || []));
      }
    } catch(e) {}

    // 2. Discover individual artists from the results
    const artistsFound = new Set();
    if (cleanArtist) artistsFound.add(cleanArtist);
    for (const r of pool) {
      if (!r.artistName) continue;
      const parts = r.artistName.split(/[,&/|]/).map(p => p.trim()).filter(p => p.length > 2);
      for (const p of parts) {
        if (!/^(feat|various|original|soundtrack|zee|t-series|sony|tips|yrf)/i.test(p)) {
          artistsFound.add(p);
        }
      }
    }

    // 3. Query hit songs for top discovered artists
    const topArtists = Array.from(artistsFound).slice(0, 2);
    for (const art of topArtists) {
      try {
        const qArt = isIndian ? `${art} Bollywood Hits` : `${art} Hits`;
        const resA = await fetch(`${ITUNES_BASE}?term=${encodeURIComponent(qArt)}${countryParam}&media=music&entity=song&limit=20`);
        if (resA.ok) {
          const dA = await resA.json();
          pool.push(...(dA.results || []));
        }
      } catch(e) {}
    }

    // 4. Broad fallback if pool is small
    if (pool.length < 20) {
      try {
        const fbTerm = isIndian ? 'Bollywood Romance Hits' : 'Top Hits';
        const resB = await fetch(`${ITUNES_BASE}?term=${encodeURIComponent(fbTerm)}${countryParam}&media=music&entity=song&limit=20`);
        if (resB.ok) {
          const dB = await resB.json();
          pool.push(...(dB.results || []));
        }
      } catch(e) {}
    }

    // 5. Format and strictly filter by genre (NO English rock/metal for Bollywood!)
    const cleanSeedNorm = cleanTitle ? cleanTitle.toLowerCase().replace(/[^a-z0-9]/g, '') : '';
    const seenTitles = new Set();
    const seenArt = new Set();
    let results = [];

    const westernDisallowed = /metal|punk|americana|country|hard rock|heavy metal|alternative|death metal/i;

    for (const r of pool) {
      const tName = r.trackName || '';
      const aName = r.artistName || artist || '';
      const genre = r.primaryGenreName || '';
      const art = (r.artworkUrl100 || '').replace('100x100bb', '300x300bb');
      if (!tName) continue;

      // Strict check: If user is listening to Indian/Bollywood, filter out Western rock/metal/Americana tracks
      if (isIndian && westernDisallowed.test(genre)) continue;

      const tNorm = _cleanSongTitle(tName).toLowerCase().replace(/[^a-z0-9]/g, '');
      // Skip if it is the current seed song
      if (cleanSeedNorm && (tNorm.includes(cleanSeedNorm) || cleanSeedNorm.includes(tNorm))) continue;
      if (seenTitles.has(tNorm)) continue;
      if (art && seenArt.has(art)) continue; // Max 1 per album cover!

      seenTitles.add(tNorm);
      if (art) seenArt.add(art);

      results.push({
        name: tName,
        artist: aName,
        url: r.trackViewUrl || '',
        match: 0.90,
        image: art
      });
    }

    // Fallback to curated tracks if pool is somehow still small
    if (results.length < 6) {
      const seedObj = { artist, title };
      const cur = _getCuratedFallback(seedObj);
      for (const c of cur) {
        const cNorm = _cleanSongTitle(c.name).toLowerCase().replace(/[^a-z0-9]/g, '');
        if (cleanSeedNorm && (cNorm.includes(cleanSeedNorm) || cleanSeedNorm.includes(cNorm))) continue;
        if (seenTitles.has(cNorm)) continue;
        seenTitles.add(cNorm);
        results.push(c);
      }
    }

    if (force || results.length > DISPLAY_LIMIT) {
      results = _shuffleArray(results);
    }

    _lastfmCache.set(cacheKey, results);
    return results;
  } catch (e) {
    return _getCuratedFallback({ artist, title });
  }
}
async function fetchSimilar(artist, title, force = false) {
  const cacheKey = `${(artist || '').toLowerCase()}|${(title || '').toLowerCase()}`;
  if (!force && _lastfmCache.has(cacheKey)) return _lastfmCache.get(cacheKey);

  if (!LASTFM_API_KEY || LASTFM_API_KEY === 'YOUR_LASTFM_API_KEY_HERE') {
    return await _fetchItunesFallback(artist, title, force);
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

    let normalized = tracks.map(t => ({
      name  : t.name   || '',
      artist: typeof t.artist === 'string' ? t.artist : (t.artist && t.artist.name) || '',
      url   : t.url    || '',
      match : parseFloat(t.match) || 0,
      image : _pickLargestImage(t.image)
    })).filter(t => t.name && t.artist);

    if (normalized.length === 0) {
      const artistTracks = await _fetchArtistSimilar(artist);
      if (force) artistTracks = _shuffleArray(artistTracks);
      _lastfmCache.set(cacheKey, artistTracks);
      return artistTracks;
    }

    if (force) normalized = _shuffleArray(normalized);
    _lastfmCache.set(cacheKey, normalized);
    return normalized;

  } catch (err) {
    console.warn('[Recommend] Last.fm fetch failed, using iTunes discovery:', err.message);
    return await _fetchItunesFallback(artist, title, force);
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
/* ── Clean and Deduplicate Track Titles ── */
function _cleanSongTitle(title) {
  if (!title) return '';
  return String(title)
    .toLowerCase()
    .replace(/\s*[\(\[].*?[\)\]]/g, '')
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function deduplicateTracks(tracks) {
  if (!Array.isArray(tracks)) return [];
  const seenKeys = new Set();
  const seenCleanTitles = new Set();
  const result = [];

  const seed = getSeed();
  if (seed && seed.title) {
    seenCleanTitles.add(_cleanSongTitle(seed.title));
    if (seed.artist) seenKeys.add(_normalizeKey(seed.artist, seed.title));
  }
  if (window.state && window.state.currentSong) {
    const cs = window.state.currentSong;
    if (cs.title) seenCleanTitles.add(_cleanSongTitle(cs.title));
    if (cs.artist && cs.title) seenKeys.add(_normalizeKey(cs.artist, cs.title));
  }

  for (const t of tracks) {
    if (!t) continue;
    const name = (t.name || t.title || '').trim();
    const artist = (t.artist || '').trim();
    if (!name) continue;

    const cleanTitle = _cleanSongTitle(name);
    const key = _normalizeKey(artist, name);

    if (seenKeys.has(key) || seenCleanTitles.has(cleanTitle)) {
      continue;
    }

    seenKeys.add(key);
    seenCleanTitles.add(cleanTitle);
    result.push(t);
  }

  return result;
}

function filterLocal(tracks) {
  const known = new Set();
  const knownCleanTitles = new Set();

  const allKnown = [
    ...(window.state && window.state.songs   || []),
    ...(window.state && window.state.history || [])
  ];

  for (const s of allKnown) {
    if (!s) continue;
    const key = _normalizeKey(s.artist, s.title);
    if (key) known.add(key);
    if (s.title) {
      known.add(s.title.toLowerCase().trim());
      knownCleanTitles.add(_cleanSongTitle(s.title));
    }
  }

  const seed = getSeed();
  if (seed && seed.title) {
    known.add(_normalizeKey(seed.artist, seed.title));
    known.add(seed.title.toLowerCase().trim());
    knownCleanTitles.add(_cleanSongTitle(seed.title));
  }

  const result = [];
  const localSeen = new Set();

  for (const t of tracks) {
    if (!t || !t.name) continue;
    const key = _normalizeKey(t.artist, t.name);
    const byTitle = t.name.toLowerCase().trim();
    const cleanTitle = _cleanSongTitle(t.name);

    if (known.has(key) || known.has(byTitle) || knownCleanTitles.has(cleanTitle) || localSeen.has(cleanTitle) || localSeen.has(key)) {
      continue;
    }
    localSeen.add(cleanTitle);
    localSeen.add(key);
    result.push(t);
  }

  return result;
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

  const uniqueTracks = deduplicateTracks(tracks);

  if (!uniqueTracks || uniqueTracks.length === 0) {
    grid.innerHTML = `
      <div class="rec-empty">
        <span style="font-size:32px">🌐</span>
        <p>No similar tracks found right now.</p>
        <p style="font-size:12px;opacity:0.6">Try playing a popular song, then click Refresh.</p>
      </div>`;
    return;
  }

  grid.innerHTML = uniqueTracks.slice(0, DISPLAY_LIMIT).map((t, idx) => {
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

    return `
      <div class="rec-card" id="rec-card-${idx}"
           onclick="_recPlayDirect(this.dataset.name, this.dataset.artist, this.dataset.art, event)"
           data-name="${_escAttr(t.name)}"
           data-artist="${_escAttr(t.artist)}"
           data-art="${_escAttr(artwork)}"
           title="Click to play ${safeTitle} directly on Dhun">
        <div class="rec-art" style="background:${gradient}">
          ${artImg}
        </div>
        <div class="rec-info">
          <p class="rec-track-name" title="${safeTitle}">${safeTitle}</p>
          <p class="rec-artist-name">${safeArtist}</p>
          ${safeAlbum ? `<p class="rec-album">${safeAlbum}</p>` : ''}
          ${duration   ? `<span class="rec-dur">${duration}</span>` : ''}
        </div>
        <div class="rec-actions">
          <button class="rec-btn rec-btn-play-action"
                  data-name="${_escAttr(t.name)}"
                  data-artist="${_escAttr(t.artist)}"
                  data-art="${_escAttr(artwork)}"
                  onclick="_recPlayDirect(this.dataset.name, this.dataset.artist, this.dataset.art, event)"
                  title="Play directly on Dhun">▶ Play</button>
          <button class="rec-btn rec-btn-queue"
                  data-name="${_escAttr(t.name)}"
                  data-artist="${_escAttr(t.artist)}"
                  data-art="${_escAttr(artwork)}"
                  onclick="_recAddToQueue(this.dataset.name, this.dataset.artist, this.dataset.art, event)"
                  title="Add to Queue">＋ Queue</button>
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

/* ── Direct Play from YouTube Music / Library ── */
window._recPlayDirect = async function(title, artist, artwork, e) {
  if (e) {
    try { e.stopPropagation(); e.preventDefault(); } catch(err) {}
  }
  if (!title) return;

  // CRITICAL: Stop ANY audio currently playing across all engines so 2 songs NEVER play simultaneously
  if (typeof stopPlaying === 'function') stopPlaying();
  if (typeof globalAudioPlayer !== 'undefined' && globalAudioPlayer && !globalAudioPlayer.paused) {
    globalAudioPlayer.pause();
    globalAudioPlayer.currentTime = 0;
  }
  if (typeof ytPlayer !== 'undefined' && ytPlayer && ytPlayer.pauseVideo) {
    try { ytPlayer.pauseVideo(); } catch(err) {}
  }
  if (typeof _recAudio !== 'undefined' && _recAudio) {
    try { _recAudio.pause(); _recAudio.src = ''; } catch(err) {}
  }

  if (typeof showToast === 'function') {
    showToast(`▶ Finding exact track "${title}" on YouTube...`);
  }

  const cleanTitle = title.trim();
  const cleanArtist = (artist || '').trim();
  const query = `${cleanTitle} ${cleanArtist}`.trim();

  // 1. Search YouTube Music for the exact official track
  let ytTrack = null;
  try {
    if (typeof YTMusicAPI !== 'undefined' && YTMusicAPI.search) {
      const results = await YTMusicAPI.search(query, 3);
      if (Array.isArray(results) && results.length > 0 && results[0].videoId) {
        ytTrack = results[0];
      }
    }
  } catch (err) {}

  if (!ytTrack) {
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data) && data.length > 0 && data[0].videoId) {
          ytTrack = data[0];
        }
      }
    } catch(err) {}
  }

  // 2. If track resolved with valid YouTube videoId, play it directly
  if (ytTrack && ytTrack.videoId) {
    if (typeof playYTMusicTrack === 'function') {
      await playYTMusicTrack(ytTrack);
      return;
    }
    if (typeof autoAddTrackToLibrary === 'function' && typeof openPlayerById === 'function') {
      const s = await autoAddTrackToLibrary(ytTrack);
      if (s && s.id !== undefined) {
        openPlayerById(s.id);
        return;
      }
    }
  }

  // 3. Check if song already exists in state.songs WITH a valid videoId
  const allSongs = (window.state && window.state.songs) || [];
  const found = allSongs.find(s => {
    if (!s || !s.title) return false;
    const sameTitle = s.title.toLowerCase().trim() === cleanTitle.toLowerCase();
    if (!sameTitle) return false;
    const audio = (typeof pcSongAudioMap !== 'undefined') ? pcSongAudioMap.get(s.id) : null;
    return (audio && audio.videoId) || s.videoId;
  });
  if (found && typeof openPlayerById === 'function') {
    openPlayerById(found.id);
    return;
  }

  // 4. Fallback: Search on Dhun
  if (typeof _recSearchTrack === 'function') {
    _recSearchTrack(cleanTitle, cleanArtist, null);
  }
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

window._recAddToQueue = async function(title, artist, artwork, e) {
  if (e) {
    try { e.stopPropagation(); e.preventDefault(); } catch(err) {}
  }
  if (!title) return;
  if (typeof showToast === 'function') {
    showToast(`⏳ Resolving "${title}" for queue...`);
  }

  const query = `${title} ${artist || ''}`.trim();
  let ytTrack = null;

  try {
    if (typeof YTMusicAPI !== 'undefined' && YTMusicAPI.search) {
      const results = await YTMusicAPI.search(query, 3);
      if (Array.isArray(results) && results.length > 0 && results[0].videoId) {
        ytTrack = results[0];
      }
    }
  } catch(err) {}

  if (!ytTrack) {
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data) && data.length > 0 && data[0].videoId) {
          ytTrack = data[0];
        }
      }
    } catch(err) {}
  }

  if (ytTrack && ytTrack.videoId && typeof enqueueYTMusicSong === 'function') {
    await enqueueYTMusicSong(ytTrack);
    return;
  }

  // Fallback: Search & Queue
  _recSearchTrack(title, artist, null);
};

/* ── Loading / Error states ── */
function _renderLoading() {
  const grid     = document.getElementById('rec-grid');
  const statusEl = document.getElementById('rec-status');
  if (statusEl) {
    statusEl.style.display = 'flex';
    statusEl.innerHTML = `<div class="rec-spinner"></div><span>Finding similar tracks…</span>`;
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
async function initRecommendations(force = false) {
  _renderLoading();

  const seed = getSeed();
  if (!seed) {
    _renderError('Play any song to get personalized recommendations.');
    return;
  }

  let similar = [];
  try {
    similar = await fetchSimilar(seed.artist, seed.title, force);
  } catch (e) {
    console.warn('[Recommend] fetchSimilar error:', e);
  }

  let filtered = filterLocal(similar);

  if (filtered.length < 6 || force) {
    try {
      const more = await _fetchItunesFallback(seed.artist, seed.title, force);
      const moreFiltered = filterLocal(more);
      filtered = deduplicateTracks([...filtered, ...moreFiltered]);
    } catch (e) {}
  }

  filtered = deduplicateTracks(filtered);

  if (force) {
    filtered = _shuffleArray(filtered);
  }

  if (filtered.length < 4) {
    const fallback = _getCuratedFallback(seed);
    filtered = deduplicateTracks([...filtered, ...fallback]);
  }

  if (filtered.length === 0) {
    filtered = _getCuratedFallback(seed);
  }

  let enriched = [];
  try {
    enriched = await enrich(filtered.slice(0, DISPLAY_LIMIT));
  } catch (e) {
    enriched = filtered.slice(0, DISPLAY_LIMIT).map(t => ({ ...t, itunes: null }));
  }

  render(enriched, seed.title);
}

/* ── Interactive Manual Refresh with UI Feedback ── */
window.refreshRecommendations = async function(e) {
  if (e) {
    try { e.stopPropagation(); e.preventDefault(); } catch(err) {}
  }
  const btn = document.getElementById('rec-refresh-btn') || (e && e.target ? e.target : null);
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '⏳ Refreshing…';
    btn.style.opacity = '0.7';
  }

  _lastfmCache.clear();
  _itunesCache.clear();

  try {
    await initRecommendations(true);
    if (typeof showToast === 'function') {
      showToast('✨ Recommendations refreshed!');
    }
  } catch (err) {
    console.warn('[Recommend] Refresh failed:', err);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '↻ Refresh';
      btn.style.opacity = '1';
    }
  }
};

/* ── Auto-refresh hooks ── */
window.onSongChange = function(song) {
  clearTimeout(_recRefreshTimer);
  _recRefreshTimer = setTimeout(() => {
    _injectRecommendationsSection();
    initRecommendations(true);
  }, 100);
};

function _hookSongChange() {
  const _orig = window.openPlayerById;
  if (typeof _orig === 'function') {
    window.openPlayerById = async function(id) {
      await _orig.call(this, id);
      clearTimeout(_recRefreshTimer);
      _recRefreshTimer = setTimeout(() => {
        _injectRecommendationsSection();
        if (document.getElementById('recommendations')) initRecommendations(true);
      }, 300);
    };
  }
  const _origYT = window.playYTMusicTrack;
  if (typeof _origYT === 'function') {
    window.playYTMusicTrack = async function(track) {
      await _origYT.call(this, track);
      clearTimeout(_recRefreshTimer);
      _recRefreshTimer = setTimeout(() => {
        _injectRecommendationsSection();
        if (document.getElementById('recommendations')) initRecommendations(true);
      }, 300);
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
  background: var(--primary-sage, #829779);
  color: #fff;
  padding: 2px 8px;
  border-radius: 20px;
}
#rec-seed-label {
  font-size: 12px;
  font-weight: 400;
  color: var(--text-muted, #74796F);
  font-style: italic;
}
.rec-refresh-btn {
  font-size: 12px;
  font-weight: 600;
  color: var(--dark-sage, #53684D);
  background: var(--light-sage, #DDE6D5);
  border: 1px solid var(--border-subtle, #EAE8E0);
  border-radius: 20px;
  padding: 5px 14px;
  cursor: pointer;
  transition: all 0.2s;
}
.rec-refresh-btn:hover { background: #cfdec4; transform: scale(1.03); }
#rec-status {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 20px;
  font-size: 13px;
  color: var(--text-muted, #74796F);
}
.rec-spinner {
  width: 18px; height: 18px;
  border: 2px solid var(--border-subtle, #EAE8E0);
  border-top-color: var(--primary-sage, #829779);
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
.rec-match-badge { display: none !important; 
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
  font-size: 10px; color: var(--dark-sage, #53684D); font-weight: 600;
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
  background: var(--light-sage, #DDE6D5); color: var(--dark-sage, #53684D);
  border: 1px solid var(--border-subtle, #EAE8E0);
  width: 100%; justify-content: center; padding: 7px 12px; font-size: 12px;
}
.rec-btn-preview:hover { background: #cedbc5; color: var(--text-primary, #303A32); }
.rec-btn-search {
  background: var(--secondary-bg, #F3F1E9); color: var(--text-primary, #303A32);
  border: 1px solid var(--border-subtle, #EAE8E0);
  width: 100%; justify-content: center; padding: 7px 12px; font-size: 12px;
}
.rec-btn-search:hover { background: #e8e5db; color: #111; }
.rec-btn-queue {
  background: var(--dusty-lilac, #E9DFF0);
  color: var(--text-primary, #303A32);
  border: 1px solid var(--border-subtle, #EAE8E0);
  flex: 1; justify-content: center;
}
.rec-btn-queue:hover { background: #ddd0e6; }

.rec-btn-play-overlay {
  background: var(--primary-sage, #829779) !important;
  color: #FFFFFF !important;
  border: none;
  font-weight: 700;
  box-shadow: 0 4px 14px rgba(0,0,0,0.3);
  padding: 8px 16px;
  font-size: 13px;
  gap: 6px;
  border-radius: 999px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  transition: all 0.2s ease;
}
.rec-btn-play-overlay:hover {
  filter: brightness(1.12);
  transform: scale(1.06);
}
.rec-btn-play-action {
  background: var(--light-sage, #DDE6D5);
  color: var(--dark-sage, #3e5039);
  border: 1px solid var(--border-subtle, #EAE8E0);
  flex: 1;
  justify-content: center;
  font-weight: 700;
  font-size: 12px;
  padding: 6px 10px;
  border-radius: 8px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.rec-btn-play-action:hover {
  background: #ccd9c4;
}
.rec-card {
  cursor: pointer;
  transition: transform 0.2s ease, box-shadow 0.2s ease;
}
.rec-card:hover {
  transform: translateY(-3px);
  box-shadow: 0 8px 24px rgba(0,0,0,0.1);
}

.rec-btn-lastfm {
  background: rgba(210,35,42,0.12); color: #c53030;
  border: 1px solid rgba(210,35,42,0.25);
  padding: 4px 8px; text-decoration: none;
}
.rec-btn-lastfm:hover { background: rgba(210,35,42,0.25); }
.rec-empty {
  grid-column: 1 / -1;
  text-align: center;
  padding: 40px 20px;
  color: var(--text-muted, #74796F);
  display: flex; flex-direction: column; align-items: center; gap: 8px;
}
.rec-empty p { margin: 0; font-size: 13px; }
.rec-api-banner {
  margin-bottom: 16px; border-radius: 14px;
  background: var(--secondary-bg, #F3F1E9);
  border: 1px solid var(--border-subtle, #EAE8E0);
}
.rec-api-banner-inner {
  display: flex; align-items: flex-start; gap: 14px; padding: 16px 18px;
}
.rec-api-icon { font-size: 28px; flex-shrink: 0; }
.rec-api-title { font-size: 14px; font-weight: 700; color: var(--text-primary, #303A32); margin: 0 0 4px; }
.rec-api-desc { font-size: 12px; color: var(--text-muted, #74796F); margin: 0; }
.rec-api-link-btn {
  display: inline-flex; font-size: 12px; font-weight: 700;
  color: #fff; background: var(--primary-sage, #829779);
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
   DOM INJECTION — Ensures #recommendations is in #page-player ONLY
══════════════════════════════════════════════════════════════════ */
function _injectRecommendationsSection() {
  // 1. Remove recommendations if it ever appears on Home page
  const homeCol = document.querySelector('.home-col-main');
  if (homeCol) {
    const inHome = homeCol.querySelector('#recommendations');
    if (inHome) inHome.remove();
  }
  const pageHome = document.getElementById('page-home');
  if (pageHome) {
    const inHome = pageHome.querySelector('#recommendations');
    if (inHome) inHome.remove();
  }

  const playerPage = document.getElementById('page-player');
  if (!playerPage) return;

  let section = document.getElementById('recommendations');
  if (!section) {
    section = document.createElement('section');
    section.id = 'recommendations';
    section.className = 'player-recommendations-section';
    section.innerHTML = `
      <div class="section-header rec-section-header">
        <h2 class="section-title">
          🌐 Recommended For You
        </h2>
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
          <span id="rec-seed-label"></span>
          <button class="see-all-btn rec-refresh-btn" id="rec-refresh-btn" onclick="refreshRecommendations(event)">↻ Refresh</button>
        </div>
      </div>
      <div id="rec-status" style="display:none"></div>
      <div id="rec-grid"></div>`;
    playerPage.appendChild(section);
  } else if (!playerPage.contains(section)) {
    playerPage.appendChild(section);
  }
}

/* ══════════════════════════════════════════════════════════════════
   BOOT — runs when script loads
══════════════════════════════════════════════════════════════════ */
function _boot() {
  _injectStyles();
  _injectRecommendationsSection();
  _hookSongChange();

  // Patch navigate() so Now Playing page activates recommendations
  const _origNavigate = window.navigate;
  if (typeof _origNavigate === 'function') {
    window.navigate = function(page) {
      _origNavigate.call(this, page);
      if (page === 'player') {
        clearTimeout(_recRefreshTimer);
        _recRefreshTimer = setTimeout(() => {
          _injectRecommendationsSection();
          initRecommendations();
        }, 200);
      }
    };
  }

  // Pre-load recommendations into #page-player when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(() => {
      _injectRecommendationsSection();
      initRecommendations();
    }, 800));
  } else {
    setTimeout(() => {
      _injectRecommendationsSection();
      initRecommendations();
    }, 800);
  }
}

// Public API
window.initRecommendations = initRecommendations;
window.refreshRecommendations = refreshRecommendations;
window.fetchSimilar        = fetchSimilar;
window.filterLocal         = filterLocal;
window.enrich              = enrich;
window.getSeed             = getSeed;

_boot();
