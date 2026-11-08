/**
 * ══════════════════════════════════════════════════════════════════
 *   DHUN — Vercel Serverless YouTube Music Search API (/api/search)
 *   Directly queries YouTube's official InnerTube API from the edge.
 *   - Fast (<200ms)
 *   - Returns authentic YouTube Music tracks with genuine videoIds
 *   - Fix N-C-01: Restricted CORS
 *   - Fix N-C-03: Strict query sanitization & SSRF guard
 *   - Fix N-M-04: Per-IP rate limiting (token bucket / window)
 * ══════════════════════════════════════════════════════════════════
 */

// In-memory rate limiting map (IP -> timestamp array)
if (!global._dhunSearchRateLimit) {
  global._dhunSearchRateLimit = new Map();
}

function checkRateLimit(ip, limit = 30, windowMs = 60000) {
  const now = Date.now();
  const map = global._dhunSearchRateLimit;
  
  // Clean up old entries periodically
  if (map.size > 1000) {
    for (const [k, v] of map.entries()) {
      const recent = v.filter(ts => now - ts < windowMs);
      if (recent.length === 0) map.delete(k);
      else map.set(k, recent);
    }
  }

  const timestamps = (map.get(ip) || []).filter(ts => now - ts < windowMs);
  if (timestamps.length >= limit) {
    return false;
  }
  timestamps.push(now);
  map.set(ip, timestamps);
  return true;
}

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

  // Rate limiting (Fix N-M-04)
  const clientIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';
  if (!checkRateLimit(clientIp, 30, 60000)) {
    return res.status(429).json({ error: 'Rate limit exceeded. Please wait a moment.' });
  }

  const rawQuery = req.query.q || req.query.query || '';
  if (!rawQuery || typeof rawQuery !== 'string' || !rawQuery.trim()) {
    return res.status(200).json([]);
  }

  // Fix N-C-03: Strict query sanitization against SSRF and injection
  const q = rawQuery.replace(/[^\w\s\u0900-\u097F\u0A00-\u0A7F\-']/g, ' ').trim().slice(0, 100);
  if (!q) {
    return res.status(200).json([]);
  }

  const isCategory = /^(pop|electronic|bollywood|punjabi|lo-?fi|rock|romantic|hip-?hop|dance|chill|ambient|classical|indie|jazz|metal)$/i.test(q);
  const musicQuery = isCategory ? `${q} hit songs music` : (q.toLowerCase().includes('song') || q.toLowerCase().includes('music') ? q : `${q} song music`);

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);

    const ytRes = await fetch('https://www.youtube.com/youtubei/v1/search?prettyPrint=false', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'
      },
      body: JSON.stringify({
        context: {
          client: {
            clientName: 'WEB',
            clientVersion: '2.20240101.00.00',
            hl: 'en',
            gl: 'US'
          }
        },
        query: musicQuery
      })
    });
    clearTimeout(timeout);

    if (!ytRes.ok) {
      return res.status(200).json([]);
    }

    const data = await ytRes.json();
    const sections = data?.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents || [];
    const tracks = [];

    function detectGenre(title, artist, queryTerm) {
      const text = `${title} ${artist} ${queryTerm}`.toLowerCase();
      if (/arijit|kumar sanu|shreya|sonu|pritam|crook|aashiqui|bollywood|hindi/.test(text)) return 'Bollywood';
      if (/diljit|ap dhillon|karan aujla|shubh|sidhu|punjabi/.test(text)) return 'Punjabi';
      if (/lofi|lo-fi|chill|relax|study|rain/.test(text)) return 'Lo-Fi';
      if (/edm|remix|dj|alan walker|martin garrix|club|electronic/.test(text)) return 'Electronic';
      if (/rock|guitar|metal|linkin/.test(text)) return 'Rock';
      if (/hip\s*hop|rap|eminem|drake|subh/.test(text)) return 'Hip-Hop';
      if (/romantic|romance|love|heart|soulful/.test(text)) return 'Romantic';
      if (isCategory) return q.charAt(0).toUpperCase() + q.slice(1);
      return 'Pop';
    }

    for (const s of sections) {
      const items = s?.itemSectionRenderer?.contents || [];
      for (const item of items) {
        const v = item?.videoRenderer;
        if (!v || !v.videoId) continue;

        const rawTitle = v.title?.runs?.[0]?.text || 'Untitled Video';

        // Filter out non-music videos (trailers, movies, reactions, interviews, podcasts, news)
        const lowerTitle = rawTitle.toLowerCase();
        if (/trailer|teaser|review|reaction|gameplay|walkthrough|episode|full movie|news|press conference|interview|vlog|unboxing|podcast/i.test(lowerTitle)) {
          continue;
        }

        const cleanTitle = rawTitle
          .replace(/\s*[\(\[](?:Official\s+(?:Music\s+)?(?:Video|Audio|Song|Lyric\s+Video)|Audio|Video|HD|4K|Visualizer|Lyrics)[\)\]]/gi, '')
          .replace(/\|.*$/g, '')
          .trim();

        const rawArtist = v.ownerText?.runs?.[0]?.text || 'YouTube Artist';
        const cleanArtist = rawArtist.replace(/\s*-\s*Topic$/i, '').trim();

        const durText = v.lengthText?.simpleText || '3:30';
        let durMin = 3.5;
        let durSec = 210;
        if (durText && durText.includes(':')) {
          const parts = durText.split(':').map(Number);
          if (parts.length === 2) {
            durSec = parts[0] * 60 + parts[1];
            durMin = +(durSec / 60).toFixed(2);
          } else if (parts.length === 3) {
            durSec = parts[0] * 3600 + parts[1] * 60 + parts[2];
            durMin = +(durSec / 60).toFixed(2);
          }
        }

        // Music videos are generally between 45 seconds and 12 minutes
        if (durSec < 45 || durSec > 720) {
          continue;
        }

        const genre = detectGenre(cleanTitle, cleanArtist, q);

        tracks.push({
          id: `yt_${v.videoId}`,
          videoId: v.videoId,
          title: cleanTitle,
          artist: cleanArtist,
          album: isCategory ? `${genre} Music` : 'YouTube Music Single',
          genre: genre,
          duration: durMin,
          durationSec: durSec,
          durationFormatted: durText,
          thumbnail: `https://i.ytimg.com/vi/${v.videoId}/hqdefault.jpg`,
          source: 'ytmusic',
          viewCount: v.viewCountText?.simpleText || 'Popular'
        });

        if (tracks.length >= 24) break;
      }
      if (tracks.length >= 24) break;
    }

    return res.status(200).json(tracks);
  } catch (err) {
    return res.status(200).json([]);
  }
};
