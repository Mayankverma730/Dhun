/**
 * ══════════════════════════════════════════════════════════════════
 *   DHUN — Unofficial YouTube Music API Client (ytmusic_api.js)
 *   Enables searching millions of tracks, streaming media,
 *   and importing online tracks into the local Dhun Library.
 *   No API keys, Google login, or auth tokens required.
 * ══════════════════════════════════════════════════════════════════
 */

'use strict';

const YTMusicAPI = (() => {
  // Curated public Invidious instances with CORS and API enabled
  const INVIDIOUS_INSTANCES = [
    'https://invidious.f5.si',
    'https://invidious.protokolla.fi',
    'https://invidious.drgns.space',
    'https://yt.artemislena.eu',
    'https://iv.melmac.space'
  ];

  let currentInstanceIndex = 0;

  function getBaseUrl() {
    return INVIDIOUS_INSTANCES[currentInstanceIndex % INVIDIOUS_INSTANCES.length];
  }

  function rotateInstance() {
    currentInstanceIndex = (currentInstanceIndex + 1) % INVIDIOUS_INSTANCES.length;
    console.log('[YTMusicAPI] Switching to instance:', getBaseUrl());
  }

  /**
   * Parse video ID from direct YouTube / YouTube Music URL
   */
  function extractVideoId(url) {
    if (!url || typeof url !== 'string') return null;
    const regex = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/|music\.youtube\.com\/watch\?v=)([^"&?\/\s]{11})/i;
    const match = url.match(regex);
    return match ? match[1] : null;
  }

  /**
   * Instant search suggestions using Google's public YouTube completion endpoint
   */
  async function getSuggestions(query) {
    if (!query || query.trim().length < 2) return [];
    try {
      const url = `https://suggestqueries.google.com/complete/search?client=firefox&ds=yt&q=${encodeURIComponent(query.trim())}`;
      const res = await fetch(url);
      if (!res.ok) return [];
      const data = await res.json();
      return Array.isArray(data[1]) ? data[1].slice(0, 7) : [];
    } catch (e) {
      return [];
    }
  }

  /**
   * Search for songs on YouTube Music / YouTube with automatic failover
   */
  async function search(query, maxResults = 25) {
    if (!query || !query.trim()) return [];
    const q = query.trim();

    // Check if user pasted a direct YouTube or YouTube Music link
    const directId = extractVideoId(q);
    if (directId) {
      const singleTrack = await getTrackDetails(directId);
      if (singleTrack) return [singleTrack];
    }

    // Attempt through public instances with fallback
    for (let attempt = 0; attempt < INVIDIOUS_INSTANCES.length; attempt++) {
      const base = getBaseUrl();
      try {
        const endpoint = `${base}/api/v1/search?q=${encodeURIComponent(q + ' music')}&type=music`;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 4500);

        const res = await fetch(endpoint, { signal: controller.signal });
        clearTimeout(timeout);

        if (!res.ok) {
          rotateInstance();
          continue;
        }

        const data = await res.json();
        if (Array.isArray(data) && data.length > 0) {
          return normalizeResults(data, maxResults);
        }
      } catch (err) {
        rotateInstance();
      }
    }

    // Ultimate fallback: Search via noembed if single/known or curated search match
    return getCuratedFallback(q);
  }

  /**
   * Normalize Invidious API results to Dhun Song schema
   */
  function normalizeResults(items, limit = 25) {
    const list = [];
    for (const item of items) {
      if (!item || (!item.videoId && !item.id)) continue;
      const vid = item.videoId || item.id;
      const title = cleanSongTitle(item.title || 'Unknown Title');
      const artist = item.author || 'YouTube Artist';
      const durationSec = Math.max(30, Number(item.lengthSeconds) || 210);
      const durMinutes = Number((durationSec / 60).toFixed(2));

      // High-reliability YouTube CDN thumbnail delivery (CORS-free, globally cached)
      const thumb = `https://i.ytimg.com/vi/${vid}/hqdefault.jpg`;

      list.push({
        id: `yt_${vid}`,
        videoId: vid,
        title,
        artist,
        album: 'YouTube Music Single',
        genre: detectGenre(title, artist),
        duration: durMinutes,
        durationSec,
        thumbnail: thumb,
        source: 'ytmusic',
        viewCount: item.viewCountText || (item.viewCount ? `${item.viewCount.toLocaleString()} views` : 'Popular'),
        published: item.publishedText || ''
      });

      if (list.length >= limit) break;
    }
    return list;
  }

  /**
   * Fetch track details from videoId using noembed & fallback
   */
  async function getTrackDetails(videoId) {
    if (!videoId) return null;
    try {
      const res = await fetch(`https://noembed.com/embed?url=https://www.youtube.com/watch?v=${videoId}`);
      if (res.ok) {
        const data = await res.json();
        return {
          id: `yt_${videoId}`,
          videoId,
          title: cleanSongTitle(data.title || 'YouTube Music Track'),
          artist: cleanArtistName(data.author_name || 'YouTube Artist'),
          album: 'YouTube Music Master',
          genre: 'Online Media',
          duration: 3.5,
          durationSec: 210,
          thumbnail: data.thumbnail_url || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
          source: 'ytmusic'
        };
      }
    } catch (e) {}

    // Fallback if noembed fails
    return {
      id: `yt_${videoId}`,
      videoId,
      title: `YouTube Track (${videoId})`,
      artist: 'Online Artist',
      album: 'YouTube Music',
      genre: 'Online Media',
      duration: 3.5,
      durationSec: 210,
      thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
      source: 'ytmusic'
    };
  }

  /**
   * Clean titles by removing redundant strings like "(Official Video)", "4K", etc.
   */
  function cleanSongTitle(str) {
    if (!str) return 'Untitled';
    return str
      .replace(/\s*[\(\[](?:Official\s+(?:Music\s+)?(?:Video|Audio|Song|Lyric\s+Video)|Audio|Video|HD|4K|Visualizer|Lyrics)[\)\]]/gi, '')
      .replace(/\|.*$/g, '')
      .trim();
  }

  function cleanArtistName(str) {
    if (!str) return 'Unknown Artist';
    return str.replace(/\s*-\s*Topic$/i, '').trim();
  }

  function detectGenre(title, artist) {
    const text = `${title} ${artist}`.toLowerCase();
    if (/arijit|kumar sanu|shreya|sonu|pritam|crook|aashiqui|bollywood|hindi/.test(text)) return 'Bollywood';
    if (/diljit|ap dhillon|karan aujla|shubh|sidhu|punjabi/.test(text)) return 'Punjabi';
    if (/lofi|lo-fi|chill|relax|study|rain/.test(text)) return 'Lo-Fi';
    if (/edm|remix|dj|alan walker|martin garrix|club/.test(text)) return 'Electronic';
    if (/rock|guitar|metal|linkin/.test(text)) return 'Rock';
    if (/hip\s*hop|rap|eminem|drake|subh/.test(text)) return 'Hip-Hop';
    return 'Pop';
  }

  /**
   * Curated Trending / Popular YouTube Music feeds
   */
  const TRENDING_FEEDS = {
    trending: [
      { videoId: 'fsiPzT50ZiM', title: 'Tum Hi Ho', artist: 'Arijit Singh', album: 'Aashiqui 2', genre: 'Bollywood', duration: 4.37, durationSec: 262 },
      { videoId: 'brnIlxX_XKs', title: 'Kesariya', artist: 'Arijit Singh, Pritam', album: 'Brahmāstra', genre: 'Bollywood', duration: 4.47, durationSec: 268 },
      { videoId: 'kJQP7kiw5Fk', title: 'Despacito', artist: 'Luis Fonsi ft. Daddy Yankee', album: 'Vida', genre: 'Pop', duration: 4.42, durationSec: 265 },
      { videoId: 'fJ9rUzIMcZQ', title: 'Bohemian Rhapsody', artist: 'Queen', album: 'A Night at the Opera', genre: 'Rock', duration: 5.98, durationSec: 359 },
      { videoId: 'JGwWNGJdvx8', title: 'Shape of You', artist: 'Ed Sheeran', album: '÷ (Divide)', genre: 'Pop', duration: 3.88, durationSec: 233 },
      { videoId: '4NRXx6U8ABQ', title: 'Blinding Lights', artist: 'The Weeknd', album: 'After Hours', genre: 'Pop', duration: 3.33, durationSec: 200 },
      { videoId: 'jfKfPfyJRdk', title: 'Lofi Hip Hop Radio — Beats to Relax/Study to', artist: 'Lofi Girl', album: 'Lofi Chill', genre: 'Lo-Fi', duration: 3.5, durationSec: 210 },
      { videoId: '60ItHLz5WEA', title: 'Faded', artist: 'Alan Walker', album: 'Different World', genre: 'Electronic', duration: 3.53, durationSec: 212 }
    ],
    bollywood: [
      { videoId: 'fsiPzT50ZiM', title: 'Tum Hi Ho', artist: 'Arijit Singh', album: 'Aashiqui 2', genre: 'Bollywood', duration: 4.37, durationSec: 262 },
      { videoId: 'brnIlxX_XKs', title: 'Kesariya', artist: 'Arijit Singh, Pritam', album: 'Brahmāstra', genre: 'Bollywood', duration: 4.47, durationSec: 268 },
      { videoId: 'Ax0G_P2dSBw', title: 'Channa Mereya', artist: 'Arijit Singh, Pritam', album: 'Ae Dil Hai Mushkil', genre: 'Bollywood', duration: 4.82, durationSec: 289 },
      { videoId: 'VUhygK39V98', title: 'Raataan Lambiyan', artist: 'Jubin Nautiyal, Asees Kaur', album: 'Shershaah', genre: 'Bollywood', duration: 3.83, durationSec: 230 },
      { videoId: 'yIIGQB6VUPY', title: 'Apna Bana Le', artist: 'Arijit Singh, Sachin-Jigar', album: 'Bhediya', genre: 'Bollywood', duration: 4.35, durationSec: 261 },
      { videoId: 'tK3zHw7D6Q8', title: 'Vaari Jaavan', artist: 'T-Series', album: 'No Entry', genre: 'Bollywood', duration: 4.8, durationSec: 288 },
      { videoId: 'e8BwtpQJ43E', title: 'Tujhko Jo Paaya', artist: 'Mohit Chauhan / Pritam', album: 'Crook', genre: 'Bollywood', duration: 5.72, durationSec: 343 },
      { videoId: '4H91pMh1wR0', title: 'Tujhko', artist: 'Arijit Singh, Sunidhi Chauhan', album: 'Cocktail 2', genre: 'Bollywood', duration: 5.71, durationSec: 343 },
      { videoId: 'xEbD8G_CszY', title: 'Pasoori', artist: 'Ali Sethi x Shae Gill', album: 'Coke Studio', genre: 'Pop', duration: 3.73, durationSec: 224 },
      { videoId: 'Vd4aK9W8yZ0', title: 'Satranga', artist: 'Arijit Singh', album: 'Animal', genre: 'Bollywood', duration: 4.52, durationSec: 271 },
      { videoId: 'V1Pl8CzNzCw', title: 'Chaleya', artist: 'Arijit Singh, Shilpa Rao', album: 'Jawan', genre: 'Bollywood', duration: 3.33, durationSec: 200 }
    ],
    punjabi: [
      { videoId: 'dCmp56tSSmA', title: 'Lover', artist: 'Diljit Dosanjh', album: 'MoonChild Era', genre: 'Punjabi', duration: 3.12, durationSec: 187 },
      { videoId: 'cl0a3i2wFcc', title: 'Brown Munde', artist: 'AP Dhillon, Gurinder Gill, Shinda Kahlon', album: 'Brown Munde Single', genre: 'Punjabi', duration: 4.28, durationSec: 257 },
      { videoId: 'e-ORhEE9VVg', title: '295', artist: 'Sidhu Moose Wala', album: 'Moosetape', genre: 'Punjabi', duration: 4.5, durationSec: 270 },
      { videoId: 'vX2cDW8LUWk', title: 'Excuses', artist: 'AP Dhillon, Gurinder Gill', album: 'Hidden Gems', genre: 'Punjabi', duration: 2.93, durationSec: 176 }
    ],
    lofi: [
      { videoId: 'jfKfPfyJRdk', title: 'Lofi Study Session', artist: 'Lofi Girl', album: 'Peaceful Beats', genre: 'Lo-Fi', duration: 3.5, durationSec: 210 },
      { videoId: '5qap5aO4i9A', title: 'ChilledCow Lo-Fi Beats', artist: 'ChilledCow', album: 'Midnight Lo-Fi', genre: 'Lo-Fi', duration: 4.0, durationSec: 240 },
      { videoId: 'TURbeWK2wwg', title: 'Cozy Winter Coffee Shop Ambience', artist: 'Lofi Records', album: 'Cozy Vibes', genre: 'Lo-Fi', duration: 3.8, durationSec: 228 }
    ],
    electronic: [
      { videoId: '60ItHLz5WEA', title: 'Faded', artist: 'Alan Walker', album: 'Different World', genre: 'Electronic', duration: 3.53, durationSec: 212 },
      { videoId: 'gCYcHz2k5x0', title: 'Animals', artist: 'Martin Garrix', album: 'Gold Skies', genre: 'Electronic', duration: 2.93, durationSec: 176 },
      { videoId: 'IcrbM1l_BoI', title: 'Wake Me Up', artist: 'Avicii', album: 'True', genre: 'Electronic', duration: 4.12, durationSec: 247 },
      { videoId: 'ALZHF5UqnU4', title: 'Alone', artist: 'Marshmello', album: 'Joytime', genre: 'Electronic', duration: 3.32, durationSec: 199 }
    ]
  };

  function getTrending(category = 'trending') {
    const list = TRENDING_FEEDS[category] || TRENDING_FEEDS.trending;
    return list.map(item => ({
      ...item,
      id: `yt_${item.videoId}`,
      thumbnail: `https://i.ytimg.com/vi/${item.videoId}/hqdefault.jpg`,
      source: 'ytmusic',
      viewCount: '🔥 Top Trending'
    }));
  }

  function getCuratedFallback(query) {
    const q = query.toLowerCase();
    const all = [
      ...TRENDING_FEEDS.trending,
      ...TRENDING_FEEDS.bollywood,
      ...TRENDING_FEEDS.punjabi,
      ...TRENDING_FEEDS.lofi,
      ...TRENDING_FEEDS.electronic
    ];

    const matches = all.filter(t =>
      t.title.toLowerCase().includes(q) ||
      t.artist.toLowerCase().includes(q) ||
      t.genre.toLowerCase().includes(q)
    );

    if (matches.length > 0) {
      return matches.map(m => ({
        ...m,
        id: `yt_${m.videoId}`,
        thumbnail: `https://i.ytimg.com/vi/${m.videoId}/hqdefault.jpg`,
        source: 'ytmusic'
      }));
    }

    return getTrending('trending');
  }

  function getVideoIdForTrack(title, artist = '') {
    if (!title) return null;
    const cleanT = cleanSongTitle(title).toLowerCase().trim();
    const all = [
      ...TRENDING_FEEDS.trending,
      ...TRENDING_FEEDS.bollywood,
      ...TRENDING_FEEDS.punjabi,
      ...TRENDING_FEEDS.lofi,
      ...TRENDING_FEEDS.electronic
    ];
    for (const item of all) {
      const it = cleanSongTitle(item.title).toLowerCase().trim();
      if (cleanT.includes(it) || it.includes(cleanT)) {
        return item.videoId;
      }
      const w1 = cleanT.split(/\s+/)[0];
      const iw1 = it.split(/\s+/)[0];
      if (w1 && w1.length >= 4 && w1 === iw1) {
        return item.videoId;
      }
    }
    return null;
  }

  async function getSongFromUrl(url) {
    const vid = extractVideoId(url);
    if (!vid) return null;
    return getTrackDetails(vid);
  }

  return {
    search,
    searchTracks: search,
    getSuggestions,
    getTrending,
    getTrendingFeed: getTrending,
    getTrackDetails,
    getSongFromUrl,
    getVideoIdForTrack,
    extractVideoId
  };
})();

