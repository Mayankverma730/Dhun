/*
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║          VIBE — HTTP REST API Server  (server.c)                ║
 * ║                                                                  ║
 * ║  Pure C, Winsock2, no external dependencies.                    ║
 * ║  Listens on  http://localhost:3000                              ║
 * ║                                                                  ║
 * ║  Endpoints:                                                      ║
 * ║   GET  /api/songs              → list all (DLL)                 ║
 * ║   POST /api/songs              → add song (DLL+BST+Hash)        ║
 * ║   GET  /api/songs/search?q=    → BST search                     ║
 * ║   GET  /api/songs/:id          → hash O(1) lookup               ║
 * ║   PUT  /api/songs/:id/play     → increment plays, push history  ║
 * ║   PUT  /api/songs/:id/like     → toggle like flag               ║
 * ║   DELETE /api/songs/:id        → remove from all structures     ║
 * ║   GET  /api/charts             → top-10 by plays (Heap)         ║
 * ║   GET  /api/charts/rating      → top-10 by rating (Heap)        ║
 * ║   GET  /api/queue              → show play queue (Circ. Queue)  ║
 * ║   POST /api/queue              → enqueue song                   ║
 * ║   DELETE /api/queue            → dequeue (play next)            ║
 * ║   GET  /api/history            → play history (Stack)           ║
 * ║   POST /api/history/back       → pop history (go back)          ║
 * ║   GET  /api/playlists          → list all playlists             ║
 * ║   POST /api/playlists          → create playlist                ║
 * ║   DELETE /api/playlists/:id    → delete playlist                ║
 * ║   GET  /api/playlists/:id/songs → songs in playlist             ║
 * ║   POST /api/playlists/:id/songs → add song to playlist          ║
 * ║   DELETE /api/playlists/:id/songs/:sid → remove from playlist   ║
 * ║   POST /api/sort               → merge-sort library by field    ║
 * ╚══════════════════════════════════════════════════════════════════╝
 */

#ifdef _WIN32
#define _WIN32_WINNT 0x0600
#include <winsock2.h>
#include <ws2tcpip.h>
#include <bcrypt.h>
#pragma comment(lib, "ws2_32.lib")
#pragma comment(lib, "bcrypt.lib")
#define strncasecmp _strnicmp
#else
#include <sys/types.h>
#include <sys/socket.h>
#include <netinet/in.h>
#include <arpa/inet.h>
#include <unistd.h>
#include <fcntl.h>
#include <errno.h>
#include <stdint.h>
#define SOCKET int
#define INVALID_SOCKET -1
#define SOCKET_ERROR -1
#define closesocket close
#define _stricmp strcasecmp
#endif

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#ifndef _WIN32
#include <strings.h>
#endif
#include <ctype.h>
#include <limits.h>
#include <math.h>

#include "song.h"
#include "library.h"
#include "stack.h"
#include "queue.h"
#include "bst.h"
#include "heap.h"
#include "hash.h"
#include "sort.h"
#include "playlist.h"
#include "avl.h"
#include "trie.h"
#include "graph.h"
#include "cache.h"
#include "logger.h"

/* ── Port ─────────────────────────────────────── */
#define PORT 3000
#define BUF  65536

/* ── Global DSA instances ────────────────────── */
static Library        *g_lib;
static Stack          *g_history;
static Queue          *g_queue;
static BST            *g_bst;
static Heap           *g_heap_plays;
static Heap           *g_heap_rating;
static HashTable      *g_hash;
static PlaylistManager*g_pm;
static AVLTree        *g_avl;
static Trie           *g_trie;
static SongGraph      *g_graph;
static LRUCache       *g_cache;

/* ── JSON helpers ─────────────────────────────── */
static void json_escape(const char *src, char *dst, int max)
{
    int j = 0;
    for (int i = 0; src[i] && j < max - 2; i++) {
        if (src[i] == '"')  { dst[j++] = '\\'; dst[j++] = '"'; }
        else if (src[i] == '\\') { dst[j++] = '\\'; dst[j++] = '\\'; }
        else if (src[i] == '\n') { dst[j++] = '\\'; dst[j++] = 'n'; }
        else dst[j++] = src[i];
    }
    dst[j] = '\0';
}

/* Constant-time string equality check to prevent timing side-channel attacks on tokens/passwords */
static int constant_time_eq(const char *a, const char *b)
{
    if (!a || !b) return 0;
    size_t len_a = strlen(a);
    size_t len_b = strlen(b);
    if (len_a != len_b) return 0;
    unsigned char diff = 0;
    for (size_t i = 0; i < len_a; i++) {
        diff |= (unsigned char)(a[i] ^ b[i]);
    }
    return diff == 0;
}

static __attribute__((unused)) int song_to_json(const Song *s, char *buf, int maxlen)
{
    char t[256], ar[256], al[256], g[128];
    json_escape(s->title,  t,  sizeof(t));
    json_escape(s->artist, ar, sizeof(ar));
    json_escape(s->album,  al, sizeof(al));
    json_escape(s->genre,  g,  sizeof(g));
    return snprintf(buf, maxlen,
        "{\"id\":%d,\"title\":\"%s\",\"artist\":\"%s\","
        "\"album\":\"%s\",\"genre\":\"%s\","
        "\"duration\":%.2f,\"play_count\":%d,\"rating\":%.1f,\"liked\":0}",
        s->id, t, ar, al, g, s->duration, s->play_count, s->rating);
}

/* ── Liked flags (stored separately since Song struct has no field) */
#define MAX_SONGS 100000
static int g_liked[MAX_SONGS]; /* indexed by song id */

static int song_to_json_liked(const Song *s, char *buf, int maxlen)
{
    char t[128], ar[128], al[128], g[64];
    json_escape(s->title,  t,  sizeof(t));
    json_escape(s->artist, ar, sizeof(ar));
    json_escape(s->album,  al, sizeof(al));
    json_escape(s->genre,  g,  sizeof(g));
    int liked = (s->id >= 0 && s->id < MAX_SONGS) ? g_liked[s->id] : 0;
    return snprintf(buf, maxlen,
        "{\"id\":%d,\"title\":\"%.100s\",\"artist\":\"%.100s\","
        "\"album\":\"%.100s\",\"genre\":\"%.50s\","
        "\"duration\":%.2f,\"play_count\":%d,\"rating\":%.1f,\"liked\":%d}",
        s->id, t, ar, al, g, s->duration, s->play_count, s->rating, liked);
}

/* ── HTTP helpers ─────────────────────────────── */
static int send_all(SOCKET sock, const char *data, size_t length)
{
    size_t sent = 0;
    while (sent < length) {
        size_t remaining = length - sent;
        if (remaining > INT_MAX) remaining = INT_MAX;
#ifdef MSG_NOSIGNAL
        int flags = MSG_NOSIGNAL;
#else
        int flags = 0;
#endif
        int n = send(sock, data + sent, (int)remaining, flags);
        if (n == SOCKET_ERROR) {
#ifdef _WIN32
            if (WSAGetLastError() == WSAEINTR) continue;
#else
            if (errno == EINTR) continue;
#endif
            return 0;
        }
        if (n == 0) return 0;
        sent += (size_t)n;
    }
    return 1;
}

static void send_response(SOCKET sock, int status, const char *body)
{
    const char *status_text = "OK";
    if (status == 201) status_text = "Created";
    else if (status == 400) status_text = "Bad Request";
    else if (status == 401) status_text = "Unauthorized";
    else if (status == 403) status_text = "Forbidden";
    else if (status == 404) status_text = "Not Found";
    else if (status == 405) status_text = "Method Not Allowed";
    else if (status == 409) status_text = "Conflict";
    else if (status == 410) status_text = "Gone";
    else if (status == 413) status_text = "Payload Too Large";
    else if (status == 429) status_text = "Too Many Requests";
    else if (status == 500) status_text = "Internal Server Error";
    else if (status == 501) status_text = "Not Implemented";

    char header[1024];
    /* Fix C-05: Restrict CORS to configured origin, not wildcard */
    const char *allowed_origin = getenv("DHUN_ALLOWED_ORIGIN");
    if (!allowed_origin || !allowed_origin[0]) allowed_origin = "http://localhost:3000";
    if (strlen(allowed_origin) > 256) allowed_origin = "http://localhost:3000";

    int hlen = snprintf(header, sizeof(header),
        "HTTP/1.1 %d %s\r\n"
        "Content-Type: application/json; charset=utf-8\r\n"
        "Access-Control-Allow-Origin: %s\r\n"
        "Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS\r\n"
        "Access-Control-Allow-Headers: Content-Type, Authorization\r\n"
        "X-Content-Type-Options: nosniff\r\n"
        "X-Frame-Options: SAMEORIGIN\r\n"
        "Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline' blob: https://cdn.jsdelivr.net https://www.youtube.com https://accounts.google.com; worker-src 'self' blob:; child-src 'self' blob:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://accounts.google.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob: https://i.ytimg.com https://img.youtube.com https://*.googleusercontent.com; media-src 'self' blob: data:; connect-src 'self' wss://broker.emqx.io:8084 wss://broker.hivemq.com:8884 https://*; frame-src 'self' https://www.youtube.com https://accounts.google.com;\r\n"
        "Content-Length: %d\r\n"
        "Connection: close\r\n"
        "\r\n",
        status, status_text, allowed_origin, (int)strlen(body));

    if (hlen <= 0 || hlen >= (int)sizeof(header) || !send_all(sock, header, (size_t)hlen)) return;
    send_all(sock, body, strlen(body));
}

static void send_ok(SOCKET sock, const char *body)   { send_response(sock, 200, body); }
static void send_created(SOCKET sock, const char *b)  { send_response(sock, 201, b); }
static void send_error(SOCKET sock, int c, const char *m) {
    /* Fix H-01: JSON-escape the message to prevent JSON injection */
    char escaped[512];
    json_escape(m, escaped, sizeof(escaped));
    char buf[600];
    snprintf(buf, sizeof(buf), "{\"error\":\"%s\"}", escaped);
    send_response(sock, c, buf);
}
static void send_options(SOCKET sock) {
    /* Fix M-02: Use configured origin and allow Authorization/custom headers in preflight */
    const char *allowed_origin = getenv("DHUN_ALLOWED_ORIGIN");
    if (!allowed_origin || !allowed_origin[0]) allowed_origin = "http://localhost:3000";
    if (strlen(allowed_origin) > 256) allowed_origin = "http://localhost:3000";

    char header[512];
    int hlen = snprintf(header, sizeof(header),
        "HTTP/1.1 204 No Content\r\n"
        "Access-Control-Allow-Origin: %s\r\n"
        "Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS\r\n"
        "Access-Control-Allow-Headers: Content-Type, Authorization, X-User-Id, X-Host-Token\r\n"
        "Content-Length: 0\r\n"
        "Connection: close\r\n\r\n",
        allowed_origin);
    if (hlen > 0 && hlen < (int)sizeof(header)) send_all(sock, header, (size_t)hlen);
}

/* ── Static file server ──────────────────── */
static int is_allowed_static_ext(const char *path)
{
    const char *ext = strrchr(path, '.');
    if (!ext) return 0;
    if (strcmp(ext, ".html") == 0 || strcmp(ext, ".css") == 0 ||
        strcmp(ext, ".js")   == 0 || strcmp(ext, ".png") == 0 ||
        strcmp(ext, ".jpg")  == 0 || strcmp(ext, ".jpeg")== 0 ||
        strcmp(ext, ".svg")  == 0 || strcmp(ext, ".ico") == 0 ||
        strcmp(ext, ".woff2")== 0 || strcmp(ext, ".mp3") == 0 ||
        strcmp(ext, ".wav")  == 0 || strcmp(ext, ".ogg") == 0 ||
        strcmp(ext, ".m4a")  == 0) {
        return 1;
    }
    return 0;
}

static const char *mime_type(const char *path)
{
    const char *ext = strrchr(path, '.');
    if (!ext) return "application/octet-stream";
    if (strcmp(ext,".html")==0) return "text/html; charset=utf-8";
    if (strcmp(ext,".css") ==0) return "text/css";
    if (strcmp(ext,".js")  ==0) return "application/javascript";
    if (strcmp(ext,".jpg") ==0 || strcmp(ext,".jpeg")==0) return "image/jpeg";
    if (strcmp(ext,".png") ==0) return "image/png";
    if (strcmp(ext,".ico") ==0) return "image/x-icon";
    if (strcmp(ext,".svg") ==0) return "image/svg+xml";
    if (strcmp(ext,".woff2")==0) return "font/woff2";
    if (strcmp(ext,".mp3") ==0) return "audio/mpeg";
    if (strcmp(ext,".wav") ==0) return "audio/wav";
    if (strcmp(ext,".ogg") ==0) return "audio/ogg";
    if (strcmp(ext,".m4a") ==0) return "audio/mp4";
    return "application/octet-stream";
}

static void serve_static(SOCKET sock, const char *url_path)
{
    /* Fix M-01: Strip query string (?) and hash (#) from url_path */
    char clean_path[512];
    strncpy(clean_path, url_path, sizeof(clean_path) - 1);
    clean_path[sizeof(clean_path) - 1] = '\0';
    char *q = strchr(clean_path, '?');
    if (q) *q = '\0';
    char *hash = strchr(clean_path, '#');
    if (hash) *hash = '\0';

    const char *rel = clean_path;
    if (strcmp(rel, "/") == 0 || rel[0] == '\0') rel = "/index.html";
    while (rel[0] == '/' || rel[0] == '\\') rel++;

    /* Fix C-01: Reject directory traversal, dotfiles (.git, .env), and non-whitelisted files */
    if (strstr(rel, "..") || rel[0] == '.' || strstr(rel, "/.") || strstr(rel, "\\.")) {
        const char *h = "HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";
        send_all(sock, h, strlen(h));
        return;
    }

    if (!is_allowed_static_ext(rel)) {
        const char *h = "HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";
        send_all(sock, h, strlen(h));
        return;
    }

    char file_path[1024];
    snprintf(file_path, sizeof(file_path), "./%s", rel);

    FILE *f = fopen(file_path, "rb");
    if (!f) {
        /* Only fallback to index.html for html navigation, never for missing assets */
        const char *ext = strrchr(rel, '.');
        if (ext && strcmp(ext, ".html") == 0) {
            f = fopen("./index.html", "rb");
            rel = "index.html";
        }
        if (!f) {
            const char *h = "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";
            send_all(sock, h, strlen(h));
            return;
        }
    }

    fseek(f, 0, SEEK_END);
    long size = ftell(f);
    fseek(f, 0, SEEK_SET);

    char *buf = malloc(65536);
    if (!buf) {
        fclose(f);
        send_error(sock, 500, "out of memory");
        return;
    }

    char header[1024];
    int hlen = snprintf(header, sizeof(header),
        "HTTP/1.1 200 OK\r\n"
        "Content-Type: %s\r\n"
        "Content-Length: %ld\r\n"
        "Cache-Control: no-cache\r\n"
        "X-Content-Type-Options: nosniff\r\n"
        "X-Frame-Options: SAMEORIGIN\r\n"
        "Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline' blob: https://cdn.jsdelivr.net https://www.youtube.com https://accounts.google.com; worker-src 'self' blob:; child-src 'self' blob:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://accounts.google.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob: https://i.ytimg.com https://img.youtube.com https://*.googleusercontent.com; media-src 'self' blob: data:; connect-src 'self' wss://broker.emqx.io:8084 wss://broker.hivemq.com:8884 https://*; frame-src 'self' https://www.youtube.com https://accounts.google.com;\r\n"
        "Connection: close\r\n"
        "\r\n",
        mime_type(rel), size);
    if (hlen <= 0 || hlen >= (int)sizeof(header) || !send_all(sock, header, (size_t)hlen)) {
        free(buf);
        fclose(f);
        return;
    }

    size_t n;
    while ((n = fread(buf, 1, 65536, f)) > 0) {
        if (!send_all(sock, buf, n)) break;
    }
    free(buf);
    fclose(f);
}

/* ── Simple JSON body parser ──────────────────── */
static const char *json_str(const char *body, const char *key, char *out, int maxlen)
{
    char search[128];
    snprintf(search, sizeof(search), "\"%s\"", key);
    const char *p = strstr(body, search);
    if (!p) { out[0]='\0'; return NULL; }
    p += strlen(search);
    while (*p && (*p == ':' || *p == ' ')) p++;
    if (*p == '"') {
        p++;
        int i = 0;
        while (*p && *p != '"' && i < maxlen-1) {
            if (*p == '\\' && *(p+1)) {
                p++;
                if (*p == 'n') out[i++] = '\n';
                else if (*p == 'r') out[i++] = '\r';
                else if (*p == 't') out[i++] = '\t';
                else if (*p == '"') out[i++] = '"';
                else if (*p == '\\') out[i++] = '\\';
                else if (*p == '/') out[i++] = '/';
                else out[i++] = *p;
            } else {
                out[i++] = *p;
            }
            p++;
        }
        out[i] = '\0';
        return out;
    }
    out[0]='\0'; return NULL;
}

static float json_float(const char *body, const char *key, float def)
{
    char search[128];
    snprintf(search, sizeof(search), "\"%s\"", key);
    const char *p = strstr(body, search);
    if (!p) return def;
    p += strlen(search);
    while (*p && (*p == ':' || *p == ' ')) p++;
    if (*p == '-' || isdigit((unsigned char)*p)) return (float)atof(p);
    return def;
}

static int json_int(const char *body, const char *key, int def)
{
    return (int)json_float(body, key, (float)def);
}

static int json_bool(const char *body, const char *key, int def)
{
    char search[128];
    snprintf(search, sizeof(search), "\"%s\"", key);
    const char *p = strstr(body, search);
    if (!p) return def;
    p += strlen(search);
    while (*p && (*p == ':' || *p == ' ')) p++;
    if (strncmp(p, "true", 4) == 0) return 1;
    if (strncmp(p, "false", 5) == 0) return 0;
    if (*p == '1') return 1;
    if (*p == '0') return 0;
    return def;
}

static const char *json_obj(const char *body, const char *key, char *out, int maxlen)
{
    char search[128];
    snprintf(search, sizeof(search), "\"%s\"", key);
    const char *p = strstr(body, search);
    if (!p) { out[0] = '\0'; return NULL; }
    p += strlen(search);
    while (*p && (*p == ':' || *p == ' ')) p++;
    if (*p == '{') {
        int depth = 0;
        int in_str = 0;
        int i = 0;
        while (*p && i < maxlen - 1) {
            out[i++] = *p;
            if (*p == '"' && (i < 2 || out[i-2] != '\\')) {
                in_str = !in_str;
            } else if (!in_str) {
                if (*p == '{') depth++;
                else if (*p == '}') {
                    depth--;
                    if (depth == 0) { break; }
                }
            }
            p++;
        }
        out[i] = '\0';
        return out;
    }
    out[0] = '\0';
    return NULL;
}

/* ── URL helpers ──────────────────────────────── */
static void url_decode(const char *src, char *dst, int maxlen)
{
    int j = 0;
    for (int i = 0; src[i] && j < maxlen-1; i++) {
        if (src[i] == '+') { dst[j++] = ' '; }
        else if (src[i] == '%' && src[i+1] && src[i+2]) {
            char hex[3] = { src[i+1], src[i+2], '\0' };
            dst[j++] = (char)strtol(hex, NULL, 16);
            i += 2;
        } else dst[j++] = src[i];
    }
    dst[j] = '\0';
}

static int get_path_segment(const char *path, int seg, char *out, int maxlen)
{
    /* /api/songs/5/play → seg 0="/api", 1="songs", 2="5", 3="play" */
    const char *p = path;
    int s = 0;
    while (*p) {
        if (*p == '/') {
            p++;
            if (s == seg) {
                int i = 0;
                while (*p && *p != '/' && *p != '?' && i < maxlen-1) out[i++] = *p++;
                out[i] = '\0';
                return 1;
            }
            s++;
        } else p++;
    }
    out[0]='\0'; return 0;
}

/* Path IDs must be complete positive integers; atoi silently accepts junk. */
static int parse_positive_id(const char *text, int *id)
{
    if (!text || !text[0]) return 0;
    for (const unsigned char *p = (const unsigned char *)text; *p; p++) {
        if (!isdigit(*p)) return 0;
    }
    errno = 0;
    char *end = NULL;
    long value = strtol(text, &end, 10);
    if (errno == ERANGE || end == text || *end || value <= 0 || value > INT_MAX) return 0;
    *id = (int)value;
    return 1;
}

static void get_query_param(const char *path, const char *key, char *out, int maxlen)
{
    const char *q = strchr(path, '?');
    if (!q) { out[0]='\0'; return; }
    q++;
    char search[128];
    snprintf(search, sizeof(search), "%s=", key);
    const char *p = strstr(q, search);
    if (!p) { out[0]='\0'; return; }
    p += strlen(search);
    int i = 0;
    while (*p && *p != '&' && i < maxlen-1) out[i++] = *p++;
    out[i] = '\0';
    url_decode(out, out, maxlen);
}

/* ═══════════════════════════════════════════════
   ROUTE HANDLERS
═══════════════════════════════════════════════ */

/* GET /api/songs */
static void route_get_songs(SOCKET sock)
{
    char *resp = malloc(BUF);
    if (!resp) { send_error(sock,500,"out of memory"); return; }
    int pos = 0;
    resp[pos++] = '[';

    LibNode *node = g_lib->head;
    int first = 1;
    while (node) {
        char tmp[512];
        song_to_json_liked(&node->song, tmp, sizeof(tmp));
        int len = (int)strlen(tmp);
        int needed = len + (first ? 0 : 1) + 2;
        if (pos + needed < BUF) {
            if (!first) resp[pos++] = ',';
            first = 0;
            memcpy(resp+pos, tmp, len);
            pos += len;
        }
        node = node->next;
    }
    resp[pos++] = ']';
    resp[pos]   = '\0';
    send_ok(sock, resp);
    free(resp);
}

/* GET /api/songs/search?q=... */
static void route_search_songs(SOCKET sock, const char *q)
{
    if (!q || !q[0]) { route_get_songs(sock); return; }

    /* BST search — collect all matching titles */
    char *resp = malloc(BUF);
    if (!resp) { send_error(sock,500,"out of memory"); return; }
    int pos = 0;
    resp[pos++] = '[';
    int first = 1;

    /* Walk library and match title or artist (BST find + fallback DLL scan) */
    LibNode *node = g_lib->head;
    while (node) {
        char lc_title[MAX_TITLE], lc_q[MAX_TITLE];
        int ti = 0, ai = 0;
        for (int i = 0; node->song.title[i] && ti < MAX_TITLE-1; i++)
            lc_title[ti++] = (char)tolower((unsigned char)node->song.title[i]);
        lc_title[ti] = '\0';
        char lc_artist[MAX_ARTIST];
        ai = 0;
        for (int i = 0; node->song.artist[i] && ai < MAX_ARTIST-1; i++)
            lc_artist[ai++] = (char)tolower((unsigned char)node->song.artist[i]);
        lc_artist[ai] = '\0';
        int qi = 0;
        for (int i = 0; q[i] && qi < MAX_TITLE-1; i++)
            lc_q[qi++] = (char)tolower((unsigned char)q[i]);
        lc_q[qi] = '\0';

        if (strstr(lc_title, lc_q) || strstr(lc_artist, lc_q)) {
            char tmp[512];
            song_to_json_liked(&node->song, tmp, sizeof(tmp));
            int len = (int)strlen(tmp);
            int needed = len + (first ? 0 : 1) + 2;
            if (pos + needed < BUF) {
                if (!first) resp[pos++] = ',';
                first = 0;
                memcpy(resp+pos, tmp, len);
                pos += len;
            }
        }
        node = node->next;
    }
    resp[pos++] = ']';
    resp[pos]   = '\0';
    send_ok(sock, resp);
    free(resp);
}

/* GET /api/songs/:id */
static void route_get_song_by_id(SOCKET sock, int id)
{
    /* LRU Cache check [T5-08] */
    Song *cached = cache_get(g_cache, id);
    if (cached) {
        char buf[512];
        song_to_json_liked(cached, buf, sizeof(buf));
        send_ok(sock, buf);
        return;
    }

    Song *s = hash_lookup(g_hash, id);
    if (!s) s = lib_find_by_id(g_lib, id);
    if (!s) { send_error(sock, 404, "song not found"); return; }

    cache_put(g_cache, id, *s);

    char buf[512];
    song_to_json_liked(s, buf, sizeof(buf));
    send_ok(sock, buf);
}

/* GET /api/songs/autocomplete?q=... [T5-02] */
static void route_autocomplete(SOCKET sock, const char *prefix)
{
    if (!prefix || !prefix[0]) {
        send_ok(sock, "[]");
        return;
    }

    int ids[20];
    char titles[20][128];
    int count = trie_autocomplete(g_trie, prefix, ids, titles, 10);

    char *resp = malloc(BUF);
    if (!resp) { send_error(sock, 500, "out of memory"); return; }
    int pos = 0;
    resp[pos++] = '[';
    int first = 1;
    for (int i = 0; i < count; i++) {
        Song *s = hash_lookup(g_hash, ids[i]);
        if (!s) s = lib_find_by_id(g_lib, ids[i]);
        if (s) {
            char tmp[512];
            song_to_json_liked(s, tmp, sizeof(tmp));
            int len = (int)strlen(tmp);
            int needed = len + (first ? 0 : 1) + 2;
            if (pos + needed < BUF) {
                if (!first) resp[pos++] = ',';
                first = 0;
                memcpy(resp + pos, tmp, len);
                pos += len;
            }
        }
    }
    resp[pos++] = ']';
    resp[pos] = '\0';
    send_ok(sock, resp);
    free(resp);
}

/* GET /api/songs/avl/search?q=... [T5-01] */
static void route_avl_search(SOCKET sock, const char *q)
{
    if (!q || !q[0]) {
        route_get_songs(sock);
        return;
    }

    AVLNode *n = avl_search(g_avl, q);
    if (!n) {
        send_ok(sock, "[]");
        return;
    }

    char tmp[512];
    song_to_json_liked(&n->song, tmp, sizeof(tmp));
    char resp[600];
    snprintf(resp, sizeof(resp), "[%s]", tmp);
    send_ok(sock, resp);
}

/* GET /api/songs/:id/similar [T5-03] */
static void route_song_similar(SOCKET sock, int id)
{
    int similar_ids[10];
    float scores[10];
    int count = graph_get_similar(g_graph, id, similar_ids, scores, 5);

    char *resp = malloc(BUF);
    if (!resp) { send_error(sock, 500, "out of memory"); return; }
    int pos = 0;
    resp[pos++] = '[';
    int first = 1;
    for (int i = 0; i < count; i++) {
        Song *s = hash_lookup(g_hash, similar_ids[i]);
        if (!s) s = lib_find_by_id(g_lib, similar_ids[i]);
        if (s) {
            if (!first) resp[pos++] = ',';
            first = 0;
            char tmp[512];
            song_to_json_liked(s, tmp, sizeof(tmp));
            int len = (int)strlen(tmp);
            if (pos + len + 4 < BUF) { memcpy(resp + pos, tmp, len); pos += len; }
        }
    }
    resp[pos++] = ']';
    resp[pos] = '\0';
    send_ok(sock, resp);
    free(resp);
}

/* POST /api/songs  body: {title,artist,album,genre,duration,rating} */
/* Trim field boundaries so whitespace-only input cannot enter the library. */
static void trim_ascii(char *value)
{
    size_t start = 0, end = strlen(value);
    while (start < end && isspace((unsigned char)value[start])) start++;
    while (end > start && isspace((unsigned char)value[end - 1])) end--;
    if (start) memmove(value, value + start, end - start);
    value[end - start] = '\0';
}

static void route_add_song(SOCKET sock, const char *body)
{
    LOG_DEBUG("add_song body=%.200s", body ? body : "(null)");
    
    if (!body || strlen(body) == 0) {
        send_error(sock, 400, "empty request body");
        return;
    }

    char title[MAX_TITLE], artist[MAX_ARTIST], album[MAX_ALBUM], genre[MAX_GENRE];
    json_str(body, "title",  title,  sizeof(title));
    json_str(body, "artist", artist, sizeof(artist));
    json_str(body, "album",  album,  sizeof(album));
    json_str(body, "genre",  genre,  sizeof(genre));
    float duration = json_float(body, "duration", 3.0f);
    float rating   = json_float(body, "rating",   3.0f);

    /* Input validation [T1-05] */
    if (!title[0] || !artist[0]) { send_error(sock,400,"title and artist required"); return; }
    if (strlen(title) > MAX_TITLE - 1) { send_error(sock,400,"title too long (max 255 chars)"); return; }
    if (strlen(artist) > MAX_ARTIST - 1) { send_error(sock,400,"artist name too long (max 255 chars)"); return; }
    if (!isfinite(duration) || duration <= 0 || duration > 600) { send_error(sock,400,"duration must be between 0 and 600 minutes"); return; }
    if (!isfinite(rating) || rating < 0 || rating > 5) { send_error(sock,400,"rating must be between 0 and 5"); return; }

    /* Sanitize inputs - remove control characters */
    for (int i = 0; title[i]; i++) if ((unsigned char)title[i] < 32) title[i] = ' ';
    for (int i = 0; artist[i]; i++) if ((unsigned char)artist[i] < 32) artist[i] = ' ';
    for (int i = 0; album[i]; i++) if ((unsigned char)album[i] < 32) album[i] = ' ';
    for (int i = 0; genre[i]; i++) if ((unsigned char)genre[i] < 32) genre[i] = ' ';
    trim_ascii(title);
    trim_ascii(artist);
    if (!title[0] || !artist[0]) { send_error(sock,400,"title and artist required"); return; }

    /* Inbuilt duplicate check: Reject copy if title and artist already exist in library */
    if (g_lib) {
        LibNode *cur = g_lib->head;
        while (cur) {
            if (_stricmp(cur->song.title, title) == 0 && _stricmp(cur->song.artist, artist) == 0) {
                send_error(sock, 409, "Duplicate song detected. Only one copy is allowed in library.");
                return;
            }
            cur = cur->next;
        }
    }

    int id = lib_add_song(g_lib, title, artist, album, genre, duration, rating);
    if (id < 0) { send_error(sock,500,"failed to add song"); return; }

    Song *s = lib_find_by_id(g_lib, id);
    if (s) {
        bst_insert(g_bst, *s);
        avl_insert(g_avl, *s);
        hash_insert(g_hash, *s);
        heap_insert(g_heap_plays, *s);
        heap_insert(g_heap_rating, *s);
        trie_insert(g_trie, s->title, s->id, s->title);
        graph_add_song(g_graph, s);
        cache_put(g_cache, s->id, *s);
    }

    char buf[512];
    song_to_json_liked(s ? s : &(Song){0}, buf, sizeof(buf));
    send_created(sock, buf);
}

/* DELETE /api/songs/:id */
static void route_delete_song(SOCKET sock, int id)
{
    Song *s = lib_find_by_id(g_lib, id);
    if (!s) { send_error(sock, 404, "song not found"); return; }

    char title[MAX_TITLE];
    strncpy(title, s->title, sizeof(title) - 1);
    title[sizeof(title) - 1] = '\0';

    /* Title indexes hold one entry per title. Delete only when this ID owns the
     * indexed entry, then restore a remaining same-title song if one exists. */
    BSTNode *bst_entry = bst_search(g_bst, title);
    int remove_bst_entry = bst_entry && bst_entry->song.id == id;
    AVLNode *avl_entry = avl_search(g_avl, title);
    int remove_avl_entry = avl_entry && avl_entry->song.id == id;
    if (remove_bst_entry) bst_delete(g_bst, title);
    if (remove_avl_entry) avl_delete(g_avl, title);
    hash_delete(g_hash, id);
    lib_remove_song(g_lib, id);

    if (remove_bst_entry || remove_avl_entry) {
        for (LibNode *node = g_lib->head; node; node = node->next) {
            if (remove_bst_entry && strcmp(node->song.title, title) == 0) {
                bst_insert(g_bst, node->song);
                remove_bst_entry = 0;
            }
            if (remove_avl_entry && _stricmp(node->song.title, title) == 0) {
                avl_insert(g_avl, node->song);
                remove_avl_entry = 0;
            }
            if (!remove_bst_entry && !remove_avl_entry) break;
        }
    }

    graph_remove_song(g_graph, id);

    /* Invalidate deleted song from LRU cache */
    cache_remove(g_cache, id);

    /* Reset like status */
    if (id >= 0 && id < MAX_SONGS) g_liked[id] = 0;

    /* Purge deleted song from all playlists */
    if (g_pm) {
        Playlist *pl = g_pm->head;
        while (pl) {
            pm_remove_song(g_pm, pl->id, id);
            pl = pl->next;
        }
    }

    /* Purge from active queue */
    if (g_queue && g_queue->count > 0) {
        Queue *nq = queue_create();
        if (nq) {
            Song qsong;
            while (queue_dequeue(g_queue, &qsong)) {
                if (qsong.id != id) queue_enqueue(nq, qsong);
            }
            *g_queue = *nq;
            free(nq);
        }
    }

    /* Rebuild heaps to remove deleted song */
    heap_rebuild_from_library(g_heap_plays, g_lib);
    heap_rebuild_from_library(g_heap_rating, g_lib);

    send_ok(sock, "{\"success\":true}");
}

/* PUT /api/songs/:id/play */
static void route_play_song(SOCKET sock, int id)
{
    Song *s = lib_find_by_id(g_lib, id);
    if (!s) { send_error(sock, 404, "song not found"); return; }

    s->play_count++;
    hash_insert(g_hash, *s);   /* refresh hash */
    bst_update_song(g_bst, id, s->play_count);  /* refresh BST */

    /* Fix H-01: Sync updated play_count to LRU cache */
    cache_put(g_cache, id, *s);

    /* Push to play history stack */
    stack_push(g_history, *s);

    /* Update heap entries - insert updated copy */
    if (heap_is_full(g_heap_plays)) {
        heap_rebuild_from_library(g_heap_plays, g_lib);
    } else {
        heap_insert(g_heap_plays, *s);
    }
    if (heap_is_full(g_heap_rating)) {
        heap_rebuild_from_library(g_heap_rating, g_lib);
    } else {
        heap_insert(g_heap_rating, *s);
    }

    char buf[512];
    song_to_json_liked(s, buf, sizeof(buf));
    send_ok(sock, buf);
}

/* PUT /api/songs/:id/like */
static void route_like_song(SOCKET sock, int id)
{
    Song *s = lib_find_by_id(g_lib, id);
    if (!s) { send_error(sock, 404, "song not found"); return; }

    if (id >= 0 && id < MAX_SONGS) g_liked[id] ^= 1;

    /* Sync like state to hash table */
    hash_insert(g_hash, *s);

    char buf[512];
    song_to_json_liked(s, buf, sizeof(buf));
    send_ok(sock, buf);
}

/* GET /api/charts  — top-10 by plays */
static void route_charts(SOCKET sock, int by_rating)
{
    /* Build heap from current library */
    Heap *h = heap_create(by_rating ? HEAP_BY_RATING : HEAP_BY_PLAYS);
    if (!h) { send_error(sock,500,"heap error"); return; }

    LibNode *node = g_lib->head;
    while (node) { heap_insert(h, node->song); node = node->next; }

    char *resp = malloc(BUF);
    if (!resp) { heap_destroy(h); send_error(sock,500,"oom"); return; }
    int pos = 0;
    resp[pos++] = '[';
    int first = 1, k = 0;
    Song s;
    while (k < 10 && heap_extract_max(h, &s) == 1) {
        if (!first) resp[pos++] = ',';
        first = 0;
        char tmp[512];
        song_to_json_liked(&s, tmp, sizeof(tmp));
        int len = (int)strlen(tmp);
        if (pos + len + 4 < BUF) { memcpy(resp+pos, tmp, len); pos += len; }
        k++;
    }
    resp[pos++] = ']';
    resp[pos]   = '\0';
    heap_destroy(h);
    send_ok(sock, resp);
    free(resp);
}

/* GET /api/queue */
static void route_get_queue(SOCKET sock)
{
    char *resp = malloc(BUF);
    if (!resp) { send_error(sock,500,"oom"); return; }
    int pos = 0;
    resp[pos++] = '[';
    /* Walk circular queue by index */
    int first = 1;
    for (int i = 0; i < g_queue->count; i++) {
        int idx = (g_queue->front + i) % QUEUE_MAX_SIZE;
        if (!first) resp[pos++] = ',';
        first = 0;
        char tmp[512];
        song_to_json_liked(&g_queue->data[idx], tmp, sizeof(tmp));
        int len = (int)strlen(tmp);
        if (pos + len + 4 < BUF) { memcpy(resp+pos, tmp, len); pos += len; }
    }
    resp[pos++] = ']';
    resp[pos]   = '\0';
    send_ok(sock, resp);
    free(resp);
}

/* POST /api/queue  body: {song_id} */
static void route_enqueue(SOCKET sock, const char *body)
{
    int song_id = json_int(body, "song_id", -1);
    Song *s = lib_find_by_id(g_lib, song_id);
    if (!s) { send_error(sock, 404, "song not found"); return; }
    if (!queue_enqueue(g_queue, *s)) { send_error(sock,400,"queue full"); return; }
    send_ok(sock, "{\"success\":true}");
}

/* DELETE /api/queue */
static void route_dequeue(SOCKET sock)
{
    Song s;
    if (!queue_dequeue(g_queue, &s)) { send_error(sock,400,"queue empty"); return; }
    char buf[512];
    song_to_json_liked(&s, buf, sizeof(buf));
    send_ok(sock, buf);
}

/* GET /api/history */
static void route_get_history(SOCKET sock)
{
    char *resp = malloc(BUF);
    if (!resp) { send_error(sock,500,"oom"); return; }
    int pos = 0;
    resp[pos++] = '[';
    int first = 1;
    for (int i = g_history->top; i >= 0; i--) {
        char tmp[512];
        song_to_json_liked(&g_history->data[i], tmp, sizeof(tmp));
        int len = (int)strlen(tmp);
        int needed = len + (first ? 0 : 1) + 2;
        if (pos + needed < BUF) {
            if (!first) resp[pos++] = ',';
            first = 0;
            memcpy(resp+pos, tmp, len);
            pos += len;
        }
    }
    resp[pos++] = ']';
    resp[pos]   = '\0';
    send_ok(sock, resp);
    free(resp);
}

/* POST /api/history/back — pop history */
static void route_history_back(SOCKET sock)
{
    Song current, previous;
    if (!stack_pop(g_history, &current) || !stack_pop(g_history, &previous)) {
        send_error(sock,400,"history empty"); return;
    }
    (void)current;
    char buf[512];
    song_to_json_liked(&previous, buf, sizeof(buf));
    send_ok(sock, buf);
}

/* GET /api/playlists */
static void route_get_playlists(SOCKET sock)
{
    char *resp = malloc(BUF);
    if (!resp) { send_error(sock,500,"oom"); return; }
    int pos = 0;
    resp[pos++] = '[';
    int first = 1;
    Playlist *pl = g_pm->head;
    while (pl) {
        char pname[256]; json_escape(pl->name, pname, sizeof(pname));
        char tmp[256];
        int len = snprintf(tmp, sizeof(tmp),
            "{\"id\":%d,\"name\":\"%s\",\"song_count\":%d}",
            pl->id, pname, pl->song_count);
        int needed = len + (first ? 0 : 1) + 2;
        if (pos + needed < BUF) {
            if (!first) resp[pos++] = ',';
            first = 0;
            memcpy(resp+pos, tmp, len);
            pos += len;
        }
        pl = pl->next;
    }
    resp[pos++] = ']';
    resp[pos]   = '\0';
    send_ok(sock, resp);
    free(resp);
}

/* POST /api/playlists  body:{name} */
static void route_create_playlist(SOCKET sock, const char *body)
{
    char name[MAX_PLAYLIST_NAME];
    json_str(body, "name", name, sizeof(name));
    if (!name[0]) { send_error(sock,400,"name required"); return; }
    if (strlen(name) > 64) { send_error(sock,400,"playlist name too long (max 64 chars)"); return; }
    int non_space = 0;
    for (int i = 0; name[i]; i++) {
        if ((unsigned char)name[i] < 32) name[i] = ' ';
        if (!isspace((unsigned char)name[i])) non_space = 1;
    }
    if (!non_space) { send_error(sock,400,"playlist name cannot be empty or all whitespace"); return; }
    Playlist *pl = pm_create_playlist(g_pm, name);
    if (!pl) { send_error(sock,500,"failed"); return; }
    char pname[256]; json_escape(pl->name, pname, sizeof(pname));
    char buf[512];
    snprintf(buf, sizeof(buf), "{\"id\":%d,\"name\":\"%s\",\"song_count\":0}", pl->id, pname);
    send_created(sock, buf);
}

/* DELETE /api/playlists/:id */
static void route_delete_playlist(SOCKET sock, int id)
{
    if (pm_delete_playlist(g_pm, id) == 0) { send_error(sock,404,"playlist not found"); return; }
    send_ok(sock, "{\"success\":true}");
}

/* GET /api/playlists/:id/songs */
static void route_playlist_songs(SOCKET sock, int pl_id)
{
    Playlist *pl = pm_find(g_pm, pl_id);
    if (!pl) { send_error(sock,404,"playlist not found"); return; }

    char *resp = malloc(BUF);
    if (!resp) { send_error(sock,500,"oom"); return; }
    int pos = 0;
    resp[pos++] = '[';
    int first = 1;
    PLSongNode *n = pl->head;
    while (n) {
        Song *s = lib_find_by_id(g_lib, n->song_id);
        if (s) {
            char tmp[512];
            song_to_json_liked(s, tmp, sizeof(tmp));
            int len = (int)strlen(tmp);
            int needed = len + (first ? 0 : 1) + 2;
            if (pos + needed < BUF) {
                if (!first) resp[pos++] = ',';
                first = 0;
                memcpy(resp+pos, tmp, len);
                pos += len;
            }
        }
        n = n->next;
    }
    resp[pos++] = ']';
    resp[pos]   = '\0';
    send_ok(sock, resp);
    free(resp);
}

/* POST /api/playlists/:id/songs  body:{song_id} */
static void route_playlist_add_song(SOCKET sock, int pl_id, const char *body)
{
    int song_id = json_int(body, "song_id", -1);
    if (song_id < 0) { send_error(sock,400,"song_id required"); return; }
    
    /* Validate song exists in library */
    Song *s = lib_find_by_id(g_lib, song_id);
    if (!s) { send_error(sock, 404, "song not found"); return; }
    
    if (pm_add_song(g_pm, pl_id, song_id) == 0) { send_error(sock,400,"failed"); return; }
    send_ok(sock, "{\"success\":true}");
}

/* DELETE /api/playlists/:pl_id/songs/:song_id */
static void route_playlist_remove_song(SOCKET sock, int pl_id, int song_id)
{
    if (pm_remove_song(g_pm, pl_id, song_id) == 0) { send_error(sock,400,"failed"); return; }
    send_ok(sock, "{\"success\":true}");
}

/* POST /api/sort  body:{field:"title"|"artist"|"plays"|"rating"} */
static void route_sort(SOCKET sock, const char *body)
{
    char field[64];
    json_str(body, "field", field, sizeof(field));

    /* Copy library to array */
    int n = lib_size(g_lib);
    if (n == 0) { send_ok(sock, "[]"); return; }
    Song *arr = malloc(n * sizeof(Song));
    if (!arr) { send_error(sock,500,"oom"); return; }

    LibNode *nd = g_lib->head;
    int i = 0;
    while (nd && i < n) { arr[i++] = nd->song; nd = nd->next; }

    if (strcmp(field,"artist")==0) sort_by_artist(arr, n);
    else if (strcmp(field,"plays")==0) sort_by_plays(arr, n);
    else if (strcmp(field,"rating")==0) sort_by_rating(arr, n);
    else sort_by_title(arr, n);

    char *resp = malloc(BUF);
    if (!resp) { free(arr); send_error(sock,500,"oom"); return; }
    int pos = 0;
    resp[pos++] = '[';
    int first = 1;
    for (int j = 0; j < n; j++) {
        char tmp[512];
        song_to_json_liked(&arr[j], tmp, sizeof(tmp));
        int len = (int)strlen(tmp);
        int needed = len + (first ? 0 : 1) + 2;
        if (pos + needed < BUF) {
            if (!first) resp[pos++] = ',';
            first = 0;
            memcpy(resp+pos, tmp, len);
            pos += len;
        }
    }
    resp[pos++] = ']';
    resp[pos]   = '\0';
    free(arr);
    send_ok(sock, resp);
    free(resp);
}

/* ═══════════════════════════════════════════════
   TIER 1 SECURITY: RATE LIMITING & SECURE HASHING
═══════════════════════════════════════════════ */
#include <time.h>

#define MAX_RATE_LIMIT_ENTRIES 1024
#define RATE_LIMIT_WINDOW_SEC 60
#define MAX_REQUESTS_PER_WINDOW 120

typedef struct {
    char ip[46];
    time_t window_start;
    int count;
} RateLimitEntry;

static RateLimitEntry g_rate_limits[MAX_RATE_LIMIT_ENTRIES];
static int g_rate_limit_count = 0;

static int check_rate_limit(const char *ip) {
    if (!ip || !ip[0]) return 1;
    time_t now = time(NULL);
    for (int i = 0; i < g_rate_limit_count; i++) {
        if (strcmp(g_rate_limits[i].ip, ip) == 0) {
            if (difftime(now, g_rate_limits[i].window_start) > RATE_LIMIT_WINDOW_SEC) {
                g_rate_limits[i].window_start = now;
                g_rate_limits[i].count = 1;
                return 1;
            }
            if (g_rate_limits[i].count >= MAX_REQUESTS_PER_WINDOW) {
                return 0; /* Rate limit exceeded */
            }
            g_rate_limits[i].count++;
            return 1;
        }
    }
    /* New IP */
    if (g_rate_limit_count < MAX_RATE_LIMIT_ENTRIES) {
        strncpy(g_rate_limits[g_rate_limit_count].ip, ip, sizeof(g_rate_limits[0].ip) - 1);
        g_rate_limits[g_rate_limit_count].window_start = now;
        g_rate_limits[g_rate_limit_count].count = 1;
        g_rate_limit_count++;
        return 1;
    }
    /* Evict expired entries — if none can be evicted, deny the request */
    for (int i = 0; i < g_rate_limit_count; i++) {
        if (difftime(now, g_rate_limits[i].window_start) > RATE_LIMIT_WINDOW_SEC) {
            strncpy(g_rate_limits[i].ip, ip, sizeof(g_rate_limits[0].ip) - 1);
            g_rate_limits[i].window_start = now;
            g_rate_limits[i].count = 1;
            return 1;
        }
    }
    /* Fix M-01: Table is full and no slot could be reclaimed — deny to be safe */
    return 0;
}

/* TODO: Replace this custom hash with a standard password KDF (PBKDF2, scrypt, or Argon2).
 * A salt and repeated custom mixing do not make this a password-safe cryptographic hash. */
static void hash_password_salted(const char *password, const char *custom_salt, char *out_hash, size_t out_size)
{
    unsigned long long h1 = 14695981039346656037ULL;
    unsigned long long h2 = 0xabcdef0123456789ULL;
    const char *base_salt = "Dhun_Auth_Salt_v2_2026_SecureKey#99";
    const char *salt = (custom_salt && custom_salt[0]) ? custom_salt : base_salt;

    for (const char *p = salt; *p; p++) {
        h1 ^= (unsigned char)(*p);
        h1 *= 1099511628211ULL;
        h2 = ((h2 << 7) | (h2 >> 57)) ^ (unsigned char)(*p);
    }
    for (const char *p = base_salt; *p; p++) {
        h1 ^= (unsigned char)(*p);
        h1 *= 1099511628211ULL;
        h2 = ((h2 << 5) | (h2 >> 59)) ^ (unsigned char)(*p);
    }
    for (const char *p = password; *p; p++) {
        h1 ^= (unsigned char)(*p);
        h1 *= 1099511628211ULL;
        h2 = ((h2 << 11) | (h2 >> 53)) ^ (unsigned char)(*p);
    }
    for (int round = 0; round < 2500; round++) {
        h1 ^= (h2 + round);
        h1 = ((h1 << 13) | (h1 >> 51)) * 1099511628211ULL;
        h2 ^= (h1 + 0x9e3779b97f4a7c15ULL);
        h2 = ((h2 << 17) | (h2 >> 47)) * 0x517cc1b727220a95ULL;
    }
    snprintf(out_hash, out_size, "%016llx%016llx", h1, h2);
}

static void hash_password(const char *password, char *out_hash, size_t out_size)
{
    hash_password_salted(password, NULL, out_hash, out_size);
}

/* Input validation helper [T1-05] */
static int validate_email_syntax(const char *email) {
    if (!email || strlen(email) < 3 || strlen(email) > 120) return 0;
    const char *at = strchr(email, '@');
    if (!at || at == email) return 0;
    const char *dot = strchr(at + 1, '.');
    if (!dot || dot == at + 1 || *(dot + 1) == '\0') return 0;
    return 1;
}

static void generate_secure_token(char *out, size_t out_size, const char *prefix);

/* ═══════════════════════════════════════════════
   LISTEN TOGETHER / JAM SESSION DSA & ROUTES [T1-06]
═══════════════════════════════════════════════ */

#define MAX_JAM_MEMBERS 32
#define MAX_JAM_EVENTS  64

typedef struct {
    char name[64];
    char avatar[8];
    char color[16];
    int is_host;
    time_t last_seen;
} JamMember;

typedef struct {
    int id;
    char type[32];
    char sender[64];
    char payload[2048];
    long long timestamp;
} JamEvent;

typedef struct JamRoom {
    char code[32];
    char host_name[64];
    char host_token[64];
    int allow_control;
    char password_hash[128];
    int has_password;
    time_t expires_at;
    JamMember members[MAX_JAM_MEMBERS];
    int member_count;
    JamEvent events[MAX_JAM_EVENTS];
    int event_count;
    int last_event_id;
    char current_song[2048];
    float progress;
    int is_playing;
    time_t created_at;
    time_t last_activity;
    struct JamRoom *next;
} JamRoom;

static JamRoom *g_jam_rooms = NULL;

static const char *JAM_COLORS[] = {
    "#829779", "#53684D", "#E9DFF0", "#F4DED2", "#DCE9E9", "#F5EBCB", "#10b981", "#3b82f6"
};
#define JAM_COLORS_COUNT 8

static JamRoom *jam_find_room(const char *code)
{
    if (!code || !code[0]) return NULL;
    JamRoom *curr = g_jam_rooms;
    while (curr) {
#ifdef _WIN32
        if (_stricmp(curr->code, code) == 0) return curr;
#else
        if (strcasecmp(curr->code, code) == 0) return curr;
#endif
        curr = curr->next;
    }
    return NULL;
}

static void jam_cleanup_stale_rooms(void)
{
    time_t now = time(NULL);
    JamRoom **curr = &g_jam_rooms;
    while (*curr) {
        JamRoom *entry = *curr;
        /* Remove expired rooms (> 60m session), rooms with no activity for > 1 hour, or empty rooms inactive > 10 mins */
        if ((entry->expires_at > 0 && now > entry->expires_at) ||
            difftime(now, entry->last_activity) > 3600 ||
            (entry->member_count == 0 && difftime(now, entry->last_activity) > 600)) {
            *curr = entry->next;
            free(entry);
        } else {
            curr = &(entry->next);
        }
    }
}

static void jam_add_event(JamRoom *r, const char *type, const char *sender, const char *payload)
{
    if (!r) return;
    r->last_event_id++;
    r->last_activity = time(NULL);

    JamEvent *ev;
    if (r->event_count < MAX_JAM_EVENTS) {
        ev = &r->events[r->event_count++];
    } else {
        /* Circular shift: shift left by 1, replace last */
        memmove(&r->events[0], &r->events[1], sizeof(JamEvent) * (MAX_JAM_EVENTS - 1));
        ev = &r->events[MAX_JAM_EVENTS - 1];
    }

    ev->id = r->last_event_id;
    strncpy(ev->type, type ? type : "", sizeof(ev->type) - 1);
    ev->type[sizeof(ev->type) - 1] = '\0';
    strncpy(ev->sender, sender ? sender : "", sizeof(ev->sender) - 1);
    ev->sender[sizeof(ev->sender) - 1] = '\0';
    strncpy(ev->payload, payload ? payload : "{}", sizeof(ev->payload) - 1);
    ev->payload[sizeof(ev->payload) - 1] = '\0';
    ev->timestamp = (long long)time(NULL) * 1000;
}

static void jam_update_member_activity(JamRoom *r, const char *name)
{
    if (!r) return;
    time_t now = time(NULL);
    r->last_activity = now;

    if (name && name[0]) {
        for (int i = 0; i < r->member_count; i++) {
            if (strcmp(r->members[i].name, name) == 0) {
                r->members[i].last_seen = now;
                break;
            }
        }
    }

    /* Prune disconnected members who haven't polled in 25 seconds */
    int i = 0;
    while (i < r->member_count) {
        if (!r->members[i].is_host && difftime(now, r->members[i].last_seen) > 25) {
            char left_user[64];
            strncpy(left_user, r->members[i].name, sizeof(left_user) - 1);
            left_user[sizeof(left_user) - 1] = '\0';

            for (int j = i; j < r->member_count - 1; j++) {
                r->members[j] = r->members[j + 1];
            }
            r->member_count--;

            char pl[128];
            snprintf(pl, sizeof(pl), "{\"sender\":\"%s\"}", left_user);
            jam_add_event(r, "LEAVE", left_user, pl);
        } else {
            i++;
        }
    }
}

/* POST /api/jam/create */
static void route_jam_create(SOCKET sock, const char *body)
{
    jam_cleanup_stale_rooms();

    char dj_name[64];
    json_str(body, "djName", dj_name, sizeof(dj_name));
    if (!dj_name[0]) strcpy(dj_name, "You (DJ)");

    int allow_control = json_bool(body, "allowControl", 1);

    char room_code[32];
    json_str(body, "roomId", room_code, sizeof(room_code));
    if (!room_code[0] || strncmp(room_code, "DHUN-", 5) != 0) {
        snprintf(room_code, sizeof(room_code), "DHUN-%04d", 1000 + (rand() % 9000));
    }

    JamRoom *existing = jam_find_room(room_code);
    if (existing) {
        send_error(sock, 409, "A room with this code already exists. Please choose another code or join it.");
        return;
    }
    JamRoom *r = (JamRoom*)calloc(1, sizeof(JamRoom));
    if (!r) { send_error(sock, 500, "out of memory"); return; }

    snprintf(r->code, sizeof(r->code), "%s", room_code);
    snprintf(r->host_name, sizeof(r->host_name), "%s", dj_name);
    r->allow_control = allow_control;
    r->member_count = 1;
    r->event_count = 0;
    r->last_event_id = 0;
    r->created_at = time(NULL);
    r->last_activity = r->created_at;
    r->expires_at = r->created_at + 3600; /* 60 minutes automatic room expiry [T1-06] */
    /* Fix C-02: Cryptographically random token for DJ/host authorization */
    generate_secure_token(r->host_token, sizeof(r->host_token), "host_");

    /* Optional room password protection [T1-06] */
    char raw_password[128] = {0};
    json_str(body, "password", raw_password, sizeof(raw_password));
    if (raw_password[0]) {
        hash_password(raw_password, r->password_hash, sizeof(r->password_hash));
        r->has_password = 1;
    } else {
        r->password_hash[0] = '\0';
        r->has_password = 0;
    }

    /* Host is member #0 — NO BOTS */
    snprintf(r->members[0].name, sizeof(r->members[0].name), "%s", dj_name);
    strcpy(r->members[0].avatar, "DJ");
    strcpy(r->members[0].color, "#829779");
    r->members[0].is_host = 1;
    r->members[0].last_seen = r->created_at;

    char song_buf[2048];
    if (json_obj(body, "song", song_buf, sizeof(song_buf))) {
        snprintf(r->current_song, sizeof(r->current_song), "%s", song_buf);
    } else {
        r->current_song[0] = '\0';
    }
    r->progress = json_float(body, "progress", 0.0f);
    r->is_playing = json_bool(body, "isPlaying", 0);

    r->next = g_jam_rooms;
    g_jam_rooms = r;

    jam_add_event(r, "ROOM_CREATED", dj_name, body);

    /* Fix M-03: Escape host_name before embedding in JSON */
    char esc_host[128], esc_code[64];
    json_escape(r->host_name, esc_host, sizeof(esc_host));
    json_escape(r->code,      esc_code, sizeof(esc_code));

    char resp[512];
    snprintf(resp, sizeof(resp),
        "{\"success\":true,\"roomId\":\"%s\",\"host\":\"%s\",\"hostToken\":\"%s\",\"allowControl\":%s,\"hasPassword\":%s}",
        esc_code, esc_host, r->host_token, r->allow_control ? "true" : "false", r->has_password ? "true" : "false");
    send_ok(sock, resp);
}

/* POST /api/jam/join */
static void route_jam_join(SOCKET sock, const char *body)
{
    char room_code[32], user_name[64];
    json_str(body, "roomId", room_code, sizeof(room_code));
    json_str(body, "name", user_name, sizeof(user_name));
    if (!user_name[0]) strcpy(user_name, "Guest");

    JamRoom *r = jam_find_room(room_code);
    if (!r) {
        send_error(sock, 404, "Jam room not found. Check the code and try again.");
        return;
    }

    /* Check room expiration [T1-06] */
    time_t now = time(NULL);
    if (r->expires_at > 0 && now > r->expires_at) {
        send_error(sock, 410, "This Jam room has expired. Please ask the DJ to start a new room.");
        return;
    }

    /* Check room password if protected [T1-06] */
    if (r->has_password) {
        char prov_password[128] = {0};
        json_str(body, "password", prov_password, sizeof(prov_password));
        char prov_hash[128];
        hash_password(prov_password, prov_hash, sizeof(prov_hash));
        if (!constant_time_eq(r->password_hash, prov_hash)) {
            send_error(sock, 401, "Invalid room password");
            return;
        }
    }

    int found_idx = -1;
    for (int i = 0; i < r->member_count; i++) {
        if (strcmp(r->members[i].name, user_name) == 0) {
            found_idx = i;
            r->members[i].last_seen = time(NULL);
            break;
        }
    }

    if (found_idx == -1 && r->member_count < MAX_JAM_MEMBERS) {
        int idx = r->member_count++;
        snprintf(r->members[idx].name, sizeof(r->members[idx].name), "%s", user_name);

        char av[4] = "GU";
        if (user_name[0]) {
            av[0] = (char)toupper((unsigned char)user_name[0]);
            av[1] = user_name[1] ? (char)toupper((unsigned char)user_name[1]) : '\0';
            av[2] = '\0';
        }
        strcpy(r->members[idx].avatar, av);
        strcpy(r->members[idx].color, JAM_COLORS[idx % JAM_COLORS_COUNT]);
        r->members[idx].is_host = 0;
        r->members[idx].last_seen = time(NULL);

        /* Fix H-02: Escape user_name in join payload */
        char esc_user[128];
        json_escape(user_name, esc_user, sizeof(esc_user));
        char jpayload[256];
        snprintf(jpayload, sizeof(jpayload),
            "{\"sender\":\"%s\",\"avatar\":\"%s\",\"color\":\"%s\"}",
            esc_user, r->members[idx].avatar, r->members[idx].color);
        jam_add_event(r, "JOIN", user_name, jpayload);
    }

    char *resp = malloc(BUF);
    if (!resp) { send_error(sock, 500, "out of memory"); return; }

    char esc_host[128], esc_code[64];
    json_escape(r->host_name, esc_host, sizeof(esc_host));
    json_escape(r->code,      esc_code, sizeof(esc_code));

    int pos = snprintf(resp, BUF,
        "{\"success\":true,\"roomId\":\"%s\",\"host\":\"%s\",\"allowControl\":%s,"
        "\"progress\":%.2f,\"isPlaying\":%s,\"lastEventId\":%d,\"members\":[",
        esc_code, esc_host, r->allow_control ? "true" : "false",
        r->progress, r->is_playing ? "true" : "false", r->last_event_id);

    for (int i = 0; i < r->member_count; i++) {
        if (i > 0 && pos < BUF - 2) resp[pos++] = ',';
        /* Fix M-03: Escape member fields before embedding in JSON */
        char esc_name[128], esc_avatar[16], esc_color[32];
        json_escape(r->members[i].name,   esc_name,   sizeof(esc_name));
        json_escape(r->members[i].avatar, esc_avatar, sizeof(esc_avatar));
        json_escape(r->members[i].color,  esc_color,  sizeof(esc_color));
        pos += snprintf(resp + pos, BUF - pos,
            "{\"name\":\"%s\",\"avatar\":\"%s\",\"color\":\"%s\",\"isHost\":%s}",
            esc_name, esc_avatar, esc_color,
            r->members[i].is_host ? "true" : "false");
    }
    pos += snprintf(resp + pos, BUF - pos, "],\"currentSong\":%s}",
        (r->current_song[0] ? r->current_song : "null"));

    send_ok(sock, resp);
    free(resp);
}

/* POST /api/jam/sync */
static void route_jam_sync(SOCKET sock, const char *body)
{
    char room_code[32], sender[64], type[32], prov_token[64] = {0};
    json_str(body, "roomId", room_code, sizeof(room_code));
    json_str(body, "sender", sender, sizeof(sender));
    json_str(body, "type", type, sizeof(type));
    json_str(body, "hostToken", prov_token, sizeof(prov_token));

    JamRoom *r = jam_find_room(room_code);
    if (!r) { send_error(sock, 404, "Room not found"); return; }

    /* Fix C-02: Authenticate DJ/host using cryptographic host_token (constant-time check) */
    int is_host = (r->host_token[0] && constant_time_eq(r->host_token, prov_token));
    if (!is_host && !r->allow_control && strcmp(type, "REACTION") != 0) {
        send_error(sock, 403, "DJ has locked controls for this room");
        return;
    }

    if (strcmp(type, "SYNC_PLAY") == 0) {
        r->is_playing = 1;
        r->progress = json_float(body, "progress", r->progress);
    } else if (strcmp(type, "SYNC_PAUSE") == 0) {
        r->is_playing = 0;
        r->progress = json_float(body, "progress", r->progress);
    } else if (strcmp(type, "SYNC_SEEK") == 0) {
        r->progress = json_float(body, "progress", r->progress);
    } else if (strcmp(type, "SYNC_SONG") == 0) {
        char sbuf[2048];
        if (json_obj(body, "song", sbuf, sizeof(sbuf))) {
            strncpy(r->current_song, sbuf, sizeof(r->current_song) - 1);
            r->current_song[sizeof(r->current_song) - 1] = '\0';
        }
        r->progress = 0.0f;
        r->is_playing = json_bool(body, "shouldPlay", 1);
    }

    jam_add_event(r, type, sender, body);
    send_ok(sock, "{\"success\":true}");
}

/* GET /api/jam/poll?roomId=...&lastId=...&user=... */
static void route_jam_poll(SOCKET sock, const char *path)
{
    char room_code[32], user_name[64];
    get_query_param(path, "roomId", room_code, sizeof(room_code));
    get_query_param(path, "user", user_name, sizeof(user_name));
    int last_id = 0;
    char last_id_str[32];
    get_query_param(path, "lastId", last_id_str, sizeof(last_id_str));
    if (last_id_str[0]) last_id = atoi(last_id_str);

    JamRoom *r = jam_find_room(room_code);
    if (!r) {
        send_error(sock, 404, "Room not found");
        return;
    }

    jam_update_member_activity(r, user_name);

    char *resp = malloc(BUF);
    if (!resp) { send_error(sock, 500, "out of memory"); return; }

    char esc_host[128], esc_code[64];
    json_escape(r->host_name, esc_host, sizeof(esc_host));
    json_escape(r->code,      esc_code, sizeof(esc_code));

    int pos = snprintf(resp, BUF,
        "{\"success\":true,\"roomId\":\"%s\",\"host\":\"%s\",\"allowControl\":%s,"
        "\"progress\":%.2f,\"isPlaying\":%s,\"lastEventId\":%d,\"members\":[",
        esc_code, esc_host, r->allow_control ? "true" : "false",
        r->progress, r->is_playing ? "true" : "false", r->last_event_id);

    for (int i = 0; i < r->member_count; i++) {
        if (i > 0 && pos < BUF - 2) resp[pos++] = ',';
        /* Fix H-02: Escape member name and fields */
        char esc_name[128], esc_avatar[16], esc_color[32];
        json_escape(r->members[i].name,   esc_name,   sizeof(esc_name));
        json_escape(r->members[i].avatar, esc_avatar, sizeof(esc_avatar));
        json_escape(r->members[i].color,  esc_color,  sizeof(esc_color));
        pos += snprintf(resp + pos, BUF - pos,
            "{\"name\":\"%s\",\"avatar\":\"%s\",\"color\":\"%s\",\"isHost\":%s}",
            esc_name, esc_avatar, esc_color,
            r->members[i].is_host ? "true" : "false");
    }

    pos += snprintf(resp + pos, BUF - pos, "],\"events\":[");

    int ev_first = 1;
    for (int i = 0; i < r->event_count; i++) {
        if (r->events[i].id > last_id) {
            if (!ev_first && pos < BUF - 2) resp[pos++] = ',';
            ev_first = 0;
            /* Fix H-02: Escape event sender */
            char esc_sender[128];
            json_escape(r->events[i].sender, esc_sender, sizeof(esc_sender));
            pos += snprintf(resp + pos, BUF - pos,
                "{\"id\":%d,\"type\":\"%s\",\"sender\":\"%s\",\"payload\":%s,\"timestamp\":%lld}",
                r->events[i].id, r->events[i].type, esc_sender,
                r->events[i].payload[0] == '{' ? r->events[i].payload : "{}",
                r->events[i].timestamp);
        }
    }

    pos += snprintf(resp + pos, BUF - pos, "],\"currentSong\":%s}",
        (r->current_song[0] ? r->current_song : "null"));

    send_ok(sock, resp);
    free(resp);
}

/* POST /api/jam/leave */
static void route_jam_leave(SOCKET sock, const char *body)
{
    char room_code[32], user_name[64];
    json_str(body, "roomId", room_code, sizeof(room_code));
    json_str(body, "name", user_name, sizeof(user_name));

    JamRoom *r = jam_find_room(room_code);
    if (r) {
        int found = -1;
        for (int i = 0; i < r->member_count; i++) {
            if (strcmp(r->members[i].name, user_name) == 0) {
                found = i;
                break;
            }
        }
        if (found != -1) {
            int was_host = r->members[found].is_host;
            for (int j = found; j < r->member_count - 1; j++) {
                r->members[j] = r->members[j + 1];
            }
            r->member_count--;

            /* Fix H-02: Escape user_name in leave event */
            char esc_user[128];
            json_escape(user_name, esc_user, sizeof(esc_user));
            char lpayload[256];
            snprintf(lpayload, sizeof(lpayload), "{\"sender\":\"%s\"}", esc_user);
            jam_add_event(r, "LEAVE", user_name, lpayload);

            if (was_host && r->member_count > 0) {
                r->members[0].is_host = 1;
                snprintf(r->host_name, sizeof(r->host_name), "%s", r->members[0].name);
            }
        }
    }
    send_ok(sock, "{\"success\":true}");
}

/* POST /api/jam/suggest [T3-09] */
static void route_jam_suggest(SOCKET sock, const char *body)
{
    char room_code[32], sender[64], song_buf[2048];
    json_str(body, "roomId", room_code, sizeof(room_code));
    json_str(body, "sender", sender, sizeof(sender));
    if (!sender[0]) strcpy(sender, "Guest");

    JamRoom *r = jam_find_room(room_code);
    if (!r) {
        send_error(sock, 404, "jam room not found");
        return;
    }

    if (json_obj(body, "song", song_buf, sizeof(song_buf))) {
        jam_add_event(r, "SONG_SUGGEST", sender, song_buf);
        send_ok(sock, "{\"success\":true,\"message\":\"Song suggested to host\"}");
    } else {
        send_error(sock, 400, "song object required");
    }
}

/* POST /api/jam/chat [T3-08] */
static void route_jam_chat(SOCKET sock, const char *body)
{
    char room_code[32], sender[64], message[512];
    json_str(body, "roomId", room_code, sizeof(room_code));
    json_str(body, "sender", sender, sizeof(sender));
    json_str(body, "message", message, sizeof(message));
    if (!sender[0]) strcpy(sender, "Guest");

    JamRoom *r = jam_find_room(room_code);
    if (!r) {
        send_error(sock, 404, "jam room not found");
        return;
    }

    if (!message[0]) {
        send_error(sock, 400, "message cannot be empty");
        return;
    }

    char payload[1024];
    char escaped_msg[512], escaped_sender[128];
    /* Fix N-M-06: Escape sender name to prevent JSON injection in chat events */
    json_escape(message, escaped_msg,    sizeof(escaped_msg));
    json_escape(sender,  escaped_sender, sizeof(escaped_sender));
    snprintf(payload, sizeof(payload), "{\"sender\":\"%s\",\"message\":\"%s\"}",
             escaped_sender, escaped_msg);
    jam_add_event(r, "CHAT_MESSAGE", sender, payload);
    send_ok(sock, "{\"success\":true}");
}

/* ═══════════════════════════════════════════════
   USER AUTHENTICATION & PASSWORD RESET MODULE
   ═══════════════════════════════════════════════ */
typedef struct {
    char id[64];
    char name[64];
    char email[128];
    char password_hash[128];
    char salt[32];
    char avatar_color[16];
    char provider[16];
    char session_token[64];
    time_t created_at;
} AuthUser;

typedef struct {
    char token[64];
    char email[128];
    time_t expires_at;
    int used;
} AuthResetToken;

#define MAX_AUTH_USERS 256
#define MAX_RESET_TOKENS 256

static AuthUser g_auth_users[MAX_AUTH_USERS];
static int g_auth_user_count = 0;

static AuthResetToken g_reset_tokens[MAX_RESET_TOKENS];
static int g_reset_token_count = 0;

/* Password hashing helper is defined above for Tier 1 security */

static AuthUser* auth_find_user_by_email(const char *email)
{
    for (int i = 0; i < g_auth_user_count; i++) {
        if (_stricmp(g_auth_users[i].email, email) == 0) {
            return &g_auth_users[i];
        }
    }
    return NULL;
}

/* Fix C-03: Use BCryptGenRandom (Windows) / /dev/urandom (POSIX) for secure token generation */
static void generate_secure_token(char *out, size_t out_size, const char *prefix) {
    unsigned char raw[16];
    int success = 0;
#ifdef _WIN32
    if (BCryptGenRandom(NULL, raw, sizeof(raw), BCRYPT_USE_SYSTEM_PREFERRED_RNG) == 0) {
        success = 1;
    }
#else
    FILE *urandom = fopen("/dev/urandom", "rb");
    if (urandom) {
        if (fread(raw, 1, sizeof(raw), urandom) == sizeof(raw)) success = 1;
        fclose(urandom);
    }
#endif
    if (!success) {
        srand((unsigned)time(NULL) ^ (unsigned)(uintptr_t)out);
        for (int i = 0; i < (int)sizeof(raw); i++) raw[i] = (unsigned char)(rand() & 0xff);
    }
    /* Encode as hex */
    char hex[33] = {0};
    for (int i = 0; i < 16; i++) snprintf(hex + i * 2, 3, "%02x", raw[i]);
    snprintf(out, out_size, "%s%s", prefix, hex);
}

/* Helper: find a user by their session token */
static AuthUser *auth_find_user_by_token(const char *token) {
    if (!token || !token[0]) return NULL;
    for (int i = 0; i < g_auth_user_count; i++) {
        if (g_auth_users[i].session_token[0] &&
            constant_time_eq(g_auth_users[i].session_token, token)) {
            return &g_auth_users[i];
        }
    }
    return NULL;
}

/* Helper: extract Bearer token from a raw HTTP request string */
static void extract_bearer_token(const char *req, char *out, int maxlen) {
    out[0] = '\0';
    if (!req) return;
    const char *h = strstr(req, "Authorization:");
    if (!h) h = strstr(req, "authorization:");
    if (!h) return;
    h += 14; /* skip "Authorization:" */
    while (*h == ' ') h++;
    if (strncmp(h, "Bearer ", 7) != 0) return;
    h += 7;
    int i = 0;
    while (*h && *h != '\r' && *h != '\n' && *h != ' ' && i < maxlen - 1)
        out[i++] = *h++;
    out[i] = '\0';
}

static void route_register(SOCKET sock, const char *body)
{
    char name[64] = {0}, email[128] = {0}, password[128] = {0};
    json_str(body, "name", name, sizeof(name));
    json_str(body, "email", email, sizeof(email));
    json_str(body, "password", password, sizeof(password));

    if (!name[0] || !email[0] || !password[0]) {
        send_error(sock, 400, "name, email, and password required");
        return;
    }
    if (strlen(name) < 2 || strlen(name) > 60) {
        send_error(sock, 400, "name must be between 2 and 60 characters");
        return;
    }
    if (!validate_email_syntax(email)) {
        send_error(sock, 400, "invalid email address format");
        return;
    }
    if (strlen(password) < 6) {
        send_error(sock, 400, "password must be at least 6 characters");
        return;
    }

    if (auth_find_user_by_email(email)) {
        send_error(sock, 409, "An account with this email already exists");
        return;
    }

    if (g_auth_user_count >= MAX_AUTH_USERS) {
        send_error(sock, 500, "Maximum user limit reached");
        return;
    }

    AuthUser *u = &g_auth_users[g_auth_user_count++];
    /* Fix C-03 & Finding 14: Use secure token and per-user salt */
    generate_secure_token(u->id, sizeof(u->id), "usr_");
    generate_secure_token(u->salt, sizeof(u->salt), "s_");
    snprintf(u->name, sizeof(u->name), "%s", name);
    snprintf(u->email, sizeof(u->email), "%s", email);
    hash_password_salted(password, u->salt, u->password_hash, sizeof(u->password_hash));
    strcpy(u->avatar_color, "#829779");
    strcpy(u->provider, "email");
    generate_secure_token(u->session_token, sizeof(u->session_token), "sess_");
    u->created_at = time(NULL);

    /* Fix M-04: Escape user fields in JSON responses */
    char esc_name[128], esc_email[128];
    json_escape(u->name,  esc_name,  sizeof(esc_name));
    json_escape(u->email, esc_email, sizeof(esc_email));

    char resp[512];
    snprintf(resp, sizeof(resp),
        "{\"status\":\"ok\",\"user\":{\"id\":\"%s\",\"name\":\"%s\",\"email\":\"%s\",\"provider\":\"email\",\"avatarColor\":\"%s\"},\"token\":\"%s\"}",
        u->id, esc_name, esc_email, u->avatar_color, u->session_token);
    send_created(sock, resp);
}

/* POST /api/login */
static void route_login(SOCKET sock, const char *body)
{
    char email[128] = {0}, password[128] = {0};
    json_str(body, "email", email, sizeof(email));
    json_str(body, "password", password, sizeof(password));

    if (!email[0] || !password[0]) {
        send_error(sock, 400, "email and password required");
        return;
    }

    AuthUser *u = auth_find_user_by_email(email);
    if (!u) {
        send_error(sock, 401, "Invalid email or password");
        return;
    }

    char pass_hash[128];
    hash_password_salted(password, u->salt[0] ? u->salt : NULL, pass_hash, sizeof(pass_hash));
    if (!constant_time_eq(u->password_hash, pass_hash)) {
        send_error(sock, 401, "Invalid email or password");
        return;
    }

    /* Fix C-03: Rotate session token using secure generator */
    generate_secure_token(u->session_token, sizeof(u->session_token), "sess_");

    /* Fix M-04: Escape user fields in JSON responses */
    char esc_name[128], esc_email[128];
    json_escape(u->name,  esc_name,  sizeof(esc_name));
    json_escape(u->email, esc_email, sizeof(esc_email));

    char resp[512];
    snprintf(resp, sizeof(resp),
        "{\"status\":\"ok\",\"user\":{\"id\":\"%s\",\"name\":\"%s\",\"email\":\"%s\",\"provider\":\"%s\",\"avatarColor\":\"%s\"},\"token\":\"%s\"}",
        u->id, esc_name, esc_email, u->provider, u->avatar_color, u->session_token);
    send_ok(sock, resp);
}

/* GET /api/auth/google or GET /api/auth/google/config — return Client ID from environment */
static void route_google_config(SOCKET sock)
{
    const char *client_id = getenv("GOOGLE_CLIENT_ID");
    char esc_id[256] = {0};
    if (client_id) {
        json_escape(client_id, esc_id, sizeof(esc_id));
    }
    char resp[512];
    snprintf(resp, sizeof(resp),
        "{\"success\":true,\"configured\":%s,\"clientId\":\"%s\"}",
        (client_id && client_id[0]) ? "true" : "false",
        esc_id);
    send_ok(sock, resp);
}

/* POST /api/google-login or POST /api/auth/google
 * Finding 01 (CRITICAL): Disable C Google Sign-In route to prevent unauthenticated session issuance.
 * Google OAuth authentication is securely handled by the serverless /api/auth/google endpoint.
 */
static void route_google_login(SOCKET sock, const char *body)
{
    (void)body;
    send_error(sock, 501, "Google Sign-In on C daemon is disabled. Please authenticate via the verified serverless endpoint /api/auth/google.");
}

/* POST /api/forgot-password (Section 8: Anti-Enumeration Generic Notice) */
static void route_forgot_password(SOCKET sock, const char *body)
{
    char email[128] = {0};
    json_str(body, "email", email, sizeof(email));

    if (!email[0]) {
        send_error(sock, 400, "email required");
        return;
    }

    time_t now = time(NULL);

    /* Fix H-03: Prune expired or already used reset tokens to prevent table exhaustion DoS */
    int write_idx = 0;
    for (int i = 0; i < g_reset_token_count; i++) {
        if (!g_reset_tokens[i].used && g_reset_tokens[i].expires_at > now) {
            if (write_idx != i) {
                g_reset_tokens[write_idx] = g_reset_tokens[i];
            }
            write_idx++;
        }
    }
    g_reset_token_count = write_idx;

    AuthUser *u = auth_find_user_by_email(email);
    char reset_token[64] = "";
    if (u && g_reset_token_count < MAX_RESET_TOKENS) {
        /* Fix C-03: Use cryptographically secure token generator instead of weak rand() */
        generate_secure_token(reset_token, sizeof(reset_token), "rst_");

        AuthResetToken *rt = &g_reset_tokens[g_reset_token_count++];
        snprintf(rt->token, sizeof(rt->token), "%s", reset_token);
        snprintf(rt->email, sizeof(rt->email), "%s", u->email);
        rt->expires_at = now + (15 * 60); /* 15 minutes */
        rt->used = 0;
    }

    /* Fix C-02: NEVER return the reset token in the HTTP response body or log it to stderr.
     * In production, dispatch the token via an email service provider. */

    /* Always return generic message (anti-enumeration) */
    send_ok(sock, "{\"status\":\"ok\",\"message\":\"If an account exists for this email, you will receive a password reset link.\"}");
}

/* POST /api/reset-password */
static void route_reset_password(SOCKET sock, const char *body)
{
    char token[64] = {0}, password[128] = {0};
    json_str(body, "token", token, sizeof(token));
    json_str(body, "newPassword", password, sizeof(password));
    if (!password[0]) json_str(body, "password", password, sizeof(password)); /* Keep older clients compatible. */

    if (!token[0] || !password[0]) {
        send_error(sock, 400, "token and new password required");
        return;
    }
    if (strlen(password) < 6) {
        send_error(sock, 400, "password must be at least 6 characters");
        return;
    }

    AuthResetToken *found_token = NULL;
    for (int i = 0; i < g_reset_token_count; i++) {
        if (constant_time_eq(g_reset_tokens[i].token, token)) {
            found_token = &g_reset_tokens[i];
            break;
        }
    }

    if (!found_token) {
        send_error(sock, 404, "Invalid or unrecognized reset token");
        return;
    }
    if (found_token->used) {
        send_error(sock, 400, "Reset token has already been used");
        return;
    }
    if (time(NULL) > found_token->expires_at) {
        send_error(sock, 400, "Reset token has expired");
        return;
    }

    AuthUser *u = auth_find_user_by_email(found_token->email);
    if (!u) {
        send_error(sock, 404, "Associated user account not found");
        return;
    }

    generate_secure_token(u->salt, sizeof(u->salt), "s_");
    hash_password_salted(password, u->salt, u->password_hash, sizeof(u->password_hash));
    memset(u->session_token, 0, sizeof(u->session_token)); /* Finding 15: Revoke all active sessions on password reset */
    found_token->used = 1;

    char esc_email[256], response[512];
    json_escape(u->email, esc_email, sizeof(esc_email));
    snprintf(response, sizeof(response),
        "{\"status\":\"ok\",\"message\":\"Password updated successfully\",\"email\":\"%s\"}", esc_email);
    send_ok(sock, response);
}

/* POST /api/logout — receives the FULL raw HTTP request to access headers */
static void route_logout(SOCKET sock, const char *req)
{
    /* Fix N-H-02 / C-07: extract Bearer token from HTTP headers (not body).
     * The Authorization header lives in the header section, not the POST body,
     * so we must search the full request string here. */
    char token[128] = {0};
    extract_bearer_token(req, token, sizeof(token));
    AuthUser *u = auth_find_user_by_token(token);
    if (u) {
        /* Overwrite session token so it can never match again */
        memset(u->session_token, 0, sizeof(u->session_token));
    }
    send_ok(sock, "{\"status\":\"ok\",\"message\":\"Logged out successfully\"}");
}

/* GET /api/me */
static void route_me(SOCKET sock, const char *req)
{
    /* Fix C-06: Validate the Authorization Bearer token before returning user info */
    char token[128] = {0};
    extract_bearer_token(req, token, sizeof(token));
    AuthUser *u = auth_find_user_by_token(token);
    if (!u) {
        send_error(sock, 401, "Unauthorized: valid Bearer token required");
        return;
    }

    /* Fix M-04: Escape user fields in JSON responses */
    char esc_name[128], esc_email[128];
    json_escape(u->name,  esc_name,  sizeof(esc_name));
    json_escape(u->email, esc_email, sizeof(esc_email));

    char resp[512];
    snprintf(resp, sizeof(resp),
        "{\"authenticated\":true,\"user\":{\"id\":\"%s\",\"name\":\"%s\",\"email\":\"%s\",\"provider\":\"%s\",\"avatarColor\":\"%s\"}}",
        u->id, esc_name, esc_email, u->provider, u->avatar_color);
    send_ok(sock, resp);
}

/* ═══════════════════════════════════════════════
   REQUEST DISPATCHER
═══════════════════════════════════════════════ */
static void handle_request(SOCKET sock, char *req, int req_len, const char *client_ip)
{
    (void)req_len;
    /* Parse method and path */
    char method[16], path[512];
    if (sscanf(req, "%15s %511s", method, path) != 2) {
        send_error(sock,400,"bad request"); return;
    }

    /* Handle CORS preflight */
    if (strcmp(method,"OPTIONS") == 0) { send_options(sock); return; }

    /* Find body (after \r\n\r\n) */
    const char *body = strstr(req, "\r\n\r\n");
    body = body ? body + 4 : "";

    /* Segment parsing — 0-based: /api/songs/5/play
       seg0="api", seg1="songs"|"charts"|"queue"|"history"|"playlists"|"sort"
       seg2=id or "search" or "back" or "rating"
       seg3="play"|"like"|"songs"
       seg4=song_id (playlist songs delete) */
    char seg1[64], seg2[64], seg3[64], seg4[64];
    get_path_segment(path, 0, seg1, sizeof(seg1)); /* "api" */
    get_path_segment(path, 1, seg2, sizeof(seg2)); /* "songs" | "playlists" | ... */
    get_path_segment(path, 2, seg3, sizeof(seg3)); /* id or "search" or "back" or "rating" */
    get_path_segment(path, 3, seg4, sizeof(seg4)); /* "play" | "like" | "songs" */
    char seg5[64];
    get_path_segment(path, 4, seg5, sizeof(seg5)); /* song_id (for playlist songs delete) */

    /* Strip query from seg3 */
    char *qmark = strchr(seg3, '?');
    if (qmark) *qmark = '\0';

    /* ── Must be /api/ prefix to reach REST routes ── */
    if (strcmp(seg1, "api") != 0) {
        serve_static(sock, path);
        return;
    }

    /* Fix N-H-03: Anonymize client IP (mask last octet) for privacy compliance */
    char masked_ip[64];
    strncpy(masked_ip, client_ip, sizeof(masked_ip) - 1);
    masked_ip[sizeof(masked_ip) - 1] = '\0';
    char *last_dot = strrchr(masked_ip, '.');
    if (last_dot) {
        strncpy(last_dot + 1, "xxx", sizeof(masked_ip) - (last_dot + 1 - masked_ip) - 1);
    }

    /* Rate limiting check for all API routes [T1-04] */
    if (!check_rate_limit(client_ip)) {
        LOG_WARN("Rate limit exceeded for %s", masked_ip);
        send_response(sock, 429, "{\"error\":\"Rate limit exceeded. Please wait a moment.\"}");
        return;
    }

    /* Strip query string from path when logging to prevent credential/token leakage */
    char clean_path[512];
    strncpy(clean_path, path, sizeof(clean_path) - 1);
    clean_path[sizeof(clean_path) - 1] = '\0';
    char *q_param = strchr(clean_path, '?');
    if (q_param) *q_param = '\0';

    /* Avoid logging sensitive authentication endpoints at INFO */
    if (strcmp(seg2, "login") != 0 && strcmp(seg2, "register") != 0 &&
        strcmp(seg2, "reset-password") != 0 && strcmp(seg2, "forgot-password") != 0) {
        LOG_INFO("%s %s from %s", method, clean_path, masked_ip);
    }

    /* ── /api/songs ─────────────────────────── */
    if (strcmp(seg2,"songs")==0) {

        if (strcmp(seg3,"")==0 || seg3[0]=='\0') {
            /* /api/songs */
            if (strcmp(method,"GET")==0)  { route_get_songs(sock); return; }
            if (strcmp(method,"POST")==0) {
                /* Fix Finding 02: Enforce server-issued session token for catalog mutations */
                char auth_tok[128] = {0};
                extract_bearer_token(req, auth_tok, sizeof(auth_tok));
                if (!auth_find_user_by_token(auth_tok) && strcmp(client_ip, "127.0.0.1") != 0 && strcmp(client_ip, "::1") != 0) {
                    send_error(sock, 401, "unauthorized: sign in required to add songs");
                    return;
                }
                route_add_song(sock, body);
                return;
            }
            send_error(sock,405,"method not allowed"); return;
        }

        if (strcmp(seg3,"search")==0) {
            /* /api/songs/search?q= */
            char q[MAX_TITLE];
            get_query_param(path, "q", q, sizeof(q));
            route_search_songs(sock, q); return;
        }

        if (strcmp(seg3,"autocomplete")==0) {
            /* /api/songs/autocomplete?q= [T5-02] */
            char q[MAX_TITLE];
            get_query_param(path, "q", q, sizeof(q));
            route_autocomplete(sock, q); return;
        }

        if (strcmp(seg3,"avl")==0 && strcmp(seg4,"search")==0) {
            /* /api/songs/avl/search?q= [T5-01] */
            char q[MAX_TITLE];
            get_query_param(path, "q", q, sizeof(q));
            route_avl_search(sock, q); return;
        }

        int song_id = 0;
        /* Reject malformed, zero, and out-of-range IDs before touching arrays. */
        if (!parse_positive_id(seg3, &song_id) || song_id >= MAX_SONGS) {
            send_error(sock, 400, "invalid song id"); return;
        }

        if (seg4[0]=='\0') {
            /* /api/songs/:id */
            if (strcmp(method,"GET")==0)    { route_get_song_by_id(sock, song_id); return; }
            if (strcmp(method,"DELETE")==0) {
                /* Fix Finding 02: Enforce server-issued session token for catalog deletion */
                char auth_tok[128] = {0};
                extract_bearer_token(req, auth_tok, sizeof(auth_tok));
                if (!auth_find_user_by_token(auth_tok) && strcmp(client_ip, "127.0.0.1") != 0 && strcmp(client_ip, "::1") != 0) {
                    send_error(sock, 401, "unauthorized: sign in required to delete songs");
                    return;
                }
                route_delete_song(sock, song_id);
                return;
            }
            send_error(sock,405,"method not allowed"); return;
        }

        if (strcmp(seg4,"similar")==0 && strcmp(method,"GET")==0) {
            /* /api/songs/:id/similar [T5-03] */
            route_song_similar(sock, song_id); return;
        }

        if (strcmp(seg4,"play")==0 && strcmp(method,"PUT")==0) {
            /* Fix Finding 02: Protect play counter mutation */
            char auth_tok[128] = {0};
            extract_bearer_token(req, auth_tok, sizeof(auth_tok));
            if (!auth_find_user_by_token(auth_tok) && strcmp(client_ip, "127.0.0.1") != 0 && strcmp(client_ip, "::1") != 0) {
                send_error(sock, 401, "unauthorized: sign in required to record play");
                return;
            }
            route_play_song(sock, song_id); return;
        }
        if (strcmp(seg4,"like")==0 && strcmp(method,"PUT")==0) {
            /* Fix Finding 02: Protect like status mutation */
            char auth_tok[128] = {0};
            extract_bearer_token(req, auth_tok, sizeof(auth_tok));
            if (!auth_find_user_by_token(auth_tok) && strcmp(client_ip, "127.0.0.1") != 0 && strcmp(client_ip, "::1") != 0) {
                send_error(sock, 401, "unauthorized: sign in required to like songs");
                return;
            }
            route_like_song(sock, song_id); return;
        }
        send_error(sock,404,"not found"); return;
    }

    /* ── /api/charts ────────────────────────── */
    if (strcmp(seg2,"charts")==0 && strcmp(method,"GET")==0) {
        int by_rating = strcmp(seg3,"rating")==0;
        route_charts(sock, by_rating); return;
    }

    /* ── /api/queue ─────────────────────────── */
    if (strcmp(seg2,"queue")==0) {
        if (strcmp(method,"GET")==0)    { route_get_queue(sock); return; }
        if (strcmp(method,"POST")==0)   { route_enqueue(sock, body); return; }
        if (strcmp(method,"DELETE")==0) { route_dequeue(sock); return; }
        send_error(sock,405,"method not allowed"); return;
    }

    /* ── /api/history ───────────────────────── */
    if (strcmp(seg2,"history")==0) {
        if (strcmp(method,"GET")==0 && seg3[0]=='\0') { route_get_history(sock); return; }
        if (strcmp(method,"POST")==0 && strcmp(seg3,"back")==0) { route_history_back(sock); return; }
        send_error(sock,404,"not found"); return;
    }

    /* ── /api/playlists ─────────────────────── */
    if (strcmp(seg2,"playlists")==0) {

        if (seg3[0]=='\0') {
            if (strcmp(method,"GET")==0)  { route_get_playlists(sock); return; }
            if (strcmp(method,"POST")==0) { route_create_playlist(sock, body); return; }
            send_error(sock,405,"method not allowed"); return;
        }

        int pl_id = 0;
        if (!parse_positive_id(seg3, &pl_id)) {
            send_error(sock, 400, "invalid playlist id"); return;
        }

        if (seg4[0]=='\0') {
            if (strcmp(method,"DELETE")==0) { route_delete_playlist(sock, pl_id); return; }
            send_error(sock,405,"method not allowed"); return;
        }

        if (strcmp(seg4,"songs")==0) {
            if (strcmp(method,"GET")==0)  { route_playlist_songs(sock, pl_id); return; }
            if (strcmp(method,"POST")==0) { route_playlist_add_song(sock, pl_id, body); return; }
            if (strcmp(method,"DELETE")==0 && seg5[0]) {
                int song_id = 0;
                if (!parse_positive_id(seg5, &song_id)) {
                    send_error(sock, 400, "invalid song id"); return;
                }
                route_playlist_remove_song(sock, pl_id, song_id); return;
            }
        }
        send_error(sock,404,"not found"); return;
    }

    /* ── /api/sort ──────────────────────────── */
    if (strcmp(seg2,"sort")==0 && strcmp(method,"POST")==0) {
        route_sort(sock, body); return;
    }

    /* ── /api/jam ───────────────────────────── */
    if (strcmp(seg2,"jam")==0) {
        if (strcmp(seg3,"create")==0 && strcmp(method,"POST")==0) {
            route_jam_create(sock, body); return;
        }
        if (strcmp(seg3,"join")==0 && strcmp(method,"POST")==0) {
            route_jam_join(sock, body); return;
        }
        if (strcmp(seg3,"sync")==0 && strcmp(method,"POST")==0) {
            route_jam_sync(sock, body); return;
        }
        if (strcmp(seg3,"poll")==0 && strcmp(method,"GET")==0) {
            route_jam_poll(sock, path); return;
        }
        if (strcmp(seg3,"leave")==0 && strcmp(method,"POST")==0) {
            route_jam_leave(sock, body); return;
        }
        if (strcmp(seg3,"suggest")==0 && strcmp(method,"POST")==0) {
            route_jam_suggest(sock, body); return;
        }
        if (strcmp(seg3,"chat")==0 && strcmp(method,"POST")==0) {
            route_jam_chat(sock, body); return;
        }
        send_error(sock,404,"not found"); return;
    }

    /* ── Authentication & Password Reset Endpoints ── */
    if (strcmp(seg2, "register") == 0 && strcmp(method, "POST") == 0) {
        route_register(sock, body); return;
    }
    if (strcmp(seg2, "login") == 0 && strcmp(method, "POST") == 0) {
        route_login(sock, body); return;
    }
    if (strcmp(seg2, "google-login") == 0 && strcmp(method, "POST") == 0) {
        route_google_login(sock, body); return;
    }
    if (strcmp(seg2, "auth") == 0) {
        if (strcmp(method, "GET") == 0) {
            route_google_config(sock); return;
        }
        if (strcmp(method, "POST") == 0) {
            route_google_login(sock, body); return;
        }
    }
    if (strcmp(seg2, "forgot-password") == 0 && strcmp(method, "POST") == 0) {
        route_forgot_password(sock, body); return;
    }
    if (strcmp(seg2, "reset-password") == 0 && strcmp(method, "POST") == 0) {
        route_reset_password(sock, body); return;
    }
    if (strcmp(seg2, "logout") == 0 && strcmp(method, "POST") == 0) {
        /* Fix N-H-02: Pass full request (not just body) so the Bearer token
         * in the Authorization header can be found by extract_bearer_token. */
        route_logout(sock, req); return;
    }
    if (strcmp(seg2, "me") == 0 && strcmp(method, "GET") == 0) {
        route_me(sock, req); return;
    }

    /* ── Unhandled /api/ route: return 404 JSON, never fall through to static files ── */
    send_error(sock, 404, "endpoint not found");
}

static int get_server_port(void)
{
    const char *p = getenv("DHUN_PORT");
    return p ? atoi(p) : PORT;
}

/* Parse request framing before dispatch so a timed-out or oversized body is
 * never treated as a complete JSON request. Header names are case-insensitive. */
static int parse_content_length(const char *request, const char *headers_end,
                                long *content_length, int *found)
{
    *content_length = 0;
    *found = 0;
    const char *line = strstr(request, "\r\n");
    if (!line) return 0;
    line += 2;

    while (line < headers_end) {
        const char *line_end = strstr(line, "\r\n");
        if (!line_end || line_end > headers_end) line_end = headers_end;
        const char *colon = memchr(line, ':', (size_t)(line_end - line));
        if (colon) {
            size_t name_len = (size_t)(colon - line);
            if (name_len == 14 && strncasecmp(line, "Content-Length", 14) == 0) {
                const char *value = colon + 1;
                while (value < line_end && (*value == ' ' || *value == '\t')) value++;
                if (value == line_end || !isdigit((unsigned char)*value)) return 0;
                errno = 0;
                char *value_end = NULL;
                long parsed = strtol(value, &value_end, 10);
                if (errno == ERANGE || value_end == value || parsed < 0) return 0;
                while (value_end < line_end && (*value_end == ' ' || *value_end == '\t')) value_end++;
                if (value_end != line_end || (*found && parsed != *content_length)) return 0;
                *content_length = parsed;
                *found = 1;
            } else if (name_len == 17 && strncasecmp(line, "Transfer-Encoding", 17) == 0) {
                /* Chunked bodies are not supported by this small HTTP server. */
                return 0;
            }
        }
        if (line_end == headers_end) break;
        line = line_end + 2;
    }
    return 1;
}

/* ── Seed sample songs ────────────────────────── */
static void seed_data(void)
{
    /* Only seed if library is empty */
    if (lib_size(g_lib) > 0) return;

    /* Check if local audio file tujhko.mp3 is available, if so register it as a real track */
    FILE *f = fopen("tujhko.mp3", "rb");
    if (f) {
        fclose(f);
        int id = lib_add_song(g_lib, "Tujhko Jo Paaya", "Mohit Chauhan / Pritam",
                              "Crook", "Bollywood", 5.72f, 4.9f);
        Song *s = lib_find_by_id(g_lib, id);
        if (s) {
            s->play_count = 1;
            bst_insert(g_bst, *s);
            avl_insert(g_avl, *s);
            hash_insert(g_hash, *s);
            heap_insert(g_heap_plays, *s);
            heap_insert(g_heap_rating, *s);
            trie_insert(g_trie, s->title, s->id, s->title);
            graph_add_song(g_graph, s);
            cache_put(g_cache, s->id, *s);
        }
    }
}

/* ══════════════════════════════════════════════
   MAIN — Winsock2 TCP server
══════════════════════════════════════════════ */
int main(void)
{
    log_init(LOG_LEVEL_INFO, NULL);
    LOG_INFO("Starting Dhun Music Management System server...");

    /* Init DSA */
    g_lib          = lib_create();
    g_history      = stack_create();
    g_queue        = queue_create();
    g_bst          = bst_create();
    g_heap_plays   = heap_create(HEAP_BY_PLAYS);
    g_heap_rating  = heap_create(HEAP_BY_RATING);
    g_hash         = hash_create();
    g_pm           = pm_create();
    g_avl          = avl_create();
    g_trie         = trie_create();
    g_graph        = graph_create();
    g_cache        = cache_create(50);
    memset(g_liked, 0, sizeof(g_liked));

    if (!g_lib || !g_history || !g_queue || !g_bst ||
        !g_heap_plays || !g_heap_rating || !g_hash || !g_pm ||
        !g_avl || !g_trie || !g_graph || !g_cache) {
        LOG_ERROR("Failed to initialize DSA structures");
        fprintf(stderr, "Failed to initialize DSA structures\n");
        return 1;
    }

    seed_data();

    /* Winsock init */
#ifdef _WIN32
    WSADATA wsa;
    if (WSAStartup(MAKEWORD(2,2), &wsa) != 0) {
        LOG_ERROR("WSAStartup failed");
        fprintf(stderr, "WSAStartup failed\n"); return 1;
    }
#endif

    SOCKET server_sock = socket(AF_INET, SOCK_STREAM, 0);
    if (server_sock == INVALID_SOCKET) {
        LOG_ERROR("socket() failed");
        fprintf(stderr, "socket() failed\n");
#ifdef _WIN32
        WSACleanup();
#endif
        return 1;
    }

    /* Allow port reuse */
    int opt = 1;
    setsockopt(server_sock, SOL_SOCKET, SO_REUSEADDR, (const char*)&opt, sizeof(opt));

    int active_port = get_server_port();

    struct sockaddr_in addr;
    memset(&addr, 0, sizeof(addr));
    addr.sin_family      = AF_INET;
    addr.sin_addr.s_addr = INADDR_ANY;
    addr.sin_port        = htons((u_short)active_port);

    if (bind(server_sock, (struct sockaddr*)&addr, sizeof(addr)) == SOCKET_ERROR) {
        /* Port may be in TIME_WAIT — try fallback ports 3001, 3002, 3003 */
        int fallback_ports[] = {3001, 3002, 3003, 3004, 8080, 8888};
        int fb_count = (int)(sizeof(fallback_ports)/sizeof(fallback_ports[0]));
        int bound = 0;
        for (int f = 0; f < fb_count && !bound; f++) {
            active_port = fallback_ports[f];
            addr.sin_port = htons((u_short)active_port);
            if (bind(server_sock, (struct sockaddr*)&addr, sizeof(addr)) != SOCKET_ERROR) {
                bound = 1;
                printf("[Server] Port 3000 busy, using fallback port %d\n", active_port);
            }
        }
        if (!bound) {
            LOG_ERROR("bind() failed on all ports");
            fprintf(stderr, "bind() failed — all ports busy\n");
            closesocket(server_sock);
#ifdef _WIN32
            WSACleanup();
#endif
            return 1;
        }
    }

    /* Fix L-04: Increase backlog from 10 to 128 so concurrent connection
     * attempts are not immediately refused under moderate load. */
    if (listen(server_sock, 128) == SOCKET_ERROR) {
        LOG_ERROR("listen() failed");
        fprintf(stderr, "listen() failed\n");
        closesocket(server_sock);
#ifdef _WIN32
        WSACleanup();
#endif
        return 1;
    }

    printf("\n");
    printf("  ╔══════════════════════════════════════════════════╗\n");
    printf("  ║  🎵  VIBE API Server — C + DSA Backend           ║\n");
    printf("  ╠══════════════════════════════════════════════════╣\n");
    printf("  ║  Listening on  http://localhost:%d              ║\n", active_port);
    printf("  ║  Library: DLL  |  Search: BST & AVL | Hash: O(1) ║\n");
    printf("  ║  Queue: CQ     |  History: Stack | Charts: Heap  ║\n");
    printf("  ║  Trie: Prefix  |  Graph: Similar | Cache: LRU    ║\n");
    printf("  ╠══════════════════════════════════════════════════╣\n");
    printf("  ║  Songs seeded: %d                                ║\n", lib_size(g_lib));
    printf("  ║  Press Ctrl+C to stop.                          ║\n");
    printf("  ╚══════════════════════════════════════════════════╝\n\n");
    fflush(stdout);

    LOG_INFO("Server listening on port %d with all DSA engines initialized", active_port);

    char *req_buf = malloc(BUF);
    if (!req_buf) { LOG_ERROR("oom for req_buf"); fprintf(stderr,"oom\n"); return 1; }

    for (;;) {
        struct sockaddr_in client_addr;
#ifdef _WIN32
        int addr_len = sizeof(client_addr);
#else
        socklen_t addr_len = sizeof(client_addr);
#endif
        SOCKET client = accept(server_sock, (struct sockaddr*)&client_addr, &addr_len);
        if (client == INVALID_SOCKET) continue;

        /* Receive full request — loop until \r\n\r\n found with strict absolute deadline */
        int total = 0;
        int done  = 0;
        int request_complete = 0;
        int request_bad = 0;
        int request_too_large = 0;
        time_t req_start = time(NULL);
        const int MAX_REQ_TIME = 3; /* 3-second total request deadline (Finding 19) */
        /* Set a 1000ms receive timeout so slow clients cannot monopolize the worker */
#ifdef _WIN32
        DWORD tv = 1000; /* 1 second */
        setsockopt(client, SOL_SOCKET, SO_RCVTIMEO, (const char*)&tv, sizeof(tv));
#else
        struct timeval tv;
        tv.tv_sec = 1;
        tv.tv_usec = 0;
        setsockopt(client, SOL_SOCKET, SO_RCVTIMEO, (const void*)&tv, sizeof(tv));
#endif
        while (total < BUF - 1 && !done) {
            if (time(NULL) - req_start > MAX_REQ_TIME) break;
            int n = recv(client, req_buf + total, BUF - 1 - total, 0);
            if (n <= 0) break;
            total += n;
            req_buf[total] = '\0';
            /* Stop once we have full headers */
            if (strstr(req_buf, "\r\n\r\n")) {
                const char *hdr_end = strstr(req_buf, "\r\n\r\n");
                int hdr_len = (int)(hdr_end - req_buf) + 4;
                long body_len = 0;
                int has_content_length = 0;
                if (!parse_content_length(req_buf, hdr_end, &body_len, &has_content_length)) {
                    request_bad = 1;
                    done = 1;
                    break;
                }
                int max_body = BUF - 1 - hdr_len;
                if (has_content_length && body_len > max_body) {
                    request_too_large = 1;
                    done = 1;
                    break;
                }

                int expected_body = has_content_length ? (int)body_len : 0;
                int body_received = total - hdr_len;
                while (body_received < expected_body && total < BUF - 1) {
                    if (time(NULL) - req_start > MAX_REQ_TIME) break;
                    int m = recv(client, req_buf + total, BUF - 1 - total, 0);
                    if (m <= 0) break;
                    total += m;
                    req_buf[total] = '\0';
                    body_received += m;
                }
                request_complete = body_received >= expected_body;
                done = 1;
            }
        }
        if (total > 0) {
            if (request_too_large) {
                send_response(client, 413, "{\"error\":\"request body too large\"}");
            } else if (request_bad || !request_complete) {
                send_error(client, 400, "incomplete or malformed request");
            } else {
                char client_ip[64] = "127.0.0.1";
                char *ip_str = inet_ntoa(client_addr.sin_addr);
                if (ip_str) strncpy(client_ip, ip_str, sizeof(client_ip) - 1);
                handle_request(client, req_buf, total, client_ip);
            }
        }
        closesocket(client);
    }

    free(req_buf);
    lib_destroy(g_lib);
    stack_destroy(g_history);
    queue_destroy(g_queue);
    bst_destroy(g_bst);
    heap_destroy(g_heap_plays);
    heap_destroy(g_heap_rating);
    hash_destroy(g_hash);
    pm_destroy(g_pm);
    avl_destroy(g_avl);
    trie_destroy(g_trie);
    graph_destroy(g_graph);
    cache_destroy(g_cache);
    log_close();
#ifdef _WIN32
    WSACleanup();
#endif
    return 0;
}
