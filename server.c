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

#define _WIN32_WINNT 0x0600
#include <winsock2.h>
#include <ws2tcpip.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <ctype.h>
#include <math.h>

#pragma comment(lib, "ws2_32.lib")

#include "song.h"
#include "library.h"
#include "stack.h"
#include "queue.h"
#include "bst.h"
#include "heap.h"
#include "hash.h"
#include "sort.h"
#include "playlist.h"

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

static int song_to_json(const Song *s, char *buf, int maxlen)
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
#define MAX_SONGS 500
static int g_liked[MAX_SONGS]; /* indexed by song id */

static int song_to_json_liked(const Song *s, char *buf, int maxlen)
{
    char t[256], ar[256], al[256], g[128];
    json_escape(s->title,  t,  sizeof(t));
    json_escape(s->artist, ar, sizeof(ar));
    json_escape(s->album,  al, sizeof(al));
    json_escape(s->genre,  g,  sizeof(g));
    int liked = (s->id >= 0 && s->id < MAX_SONGS) ? g_liked[s->id] : 0;
    return snprintf(buf, maxlen,
        "{\"id\":%d,\"title\":\"%s\",\"artist\":\"%s\","
        "\"album\":\"%s\",\"genre\":\"%s\","
        "\"duration\":%.2f,\"play_count\":%d,\"rating\":%.1f,\"liked\":%d}",
        s->id, t, ar, al, g, s->duration, s->play_count, s->rating, liked);
}

/* ── HTTP helpers ─────────────────────────────── */
static void send_response(SOCKET sock, int status, const char *body)
{
    const char *status_text = "OK";
    if (status == 201) status_text = "Created";
    else if (status == 400) status_text = "Bad Request";
    else if (status == 404) status_text = "Not Found";
    else if (status == 405) status_text = "Method Not Allowed";
    else if (status == 500) status_text = "Internal Server Error";

    char header[512];
    int hlen = snprintf(header, sizeof(header),
        "HTTP/1.1 %d %s\r\n"
        "Content-Type: application/json\r\n"
        "Access-Control-Allow-Origin: *\r\n"
        "Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS\r\n"
        "Access-Control-Allow-Headers: Content-Type\r\n"
        "Content-Length: %d\r\n"
        "Connection: close\r\n"
        "\r\n",
        status, status_text, (int)strlen(body));

    send(sock, header, hlen, 0);
    send(sock, body, (int)strlen(body), 0);
}

static void send_ok(SOCKET sock, const char *body)   { send_response(sock, 200, body); }
static void send_created(SOCKET sock, const char *b)  { send_response(sock, 201, b); }
static void send_error(SOCKET sock, int c, const char *m) {
    char buf[256];
    snprintf(buf, sizeof(buf), "{\"error\":\"%s\"}", m);
    send_response(sock, c, buf);
}
static void send_options(SOCKET sock) {
    const char *h =
        "HTTP/1.1 204 No Content\r\n"
        "Access-Control-Allow-Origin: *\r\n"
        "Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS\r\n"
        "Access-Control-Allow-Headers: Content-Type\r\n"
        "Content-Length: 0\r\n"
        "Connection: close\r\n\r\n";
    send(sock, h, (int)strlen(h), 0);
}

/* ── Static file server ──────────────────── */
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
    /* Map URL path to filesystem path */
    char file_path[512];
    const char *rel = url_path;
    /* / -> index.html */
    if (strcmp(rel, "/") == 0) rel = "/index.html";
    /* Strip leading / */
    if (rel[0] == '/') rel++;

    /* Sanitize: reject paths with .. */
    if (strstr(rel, "..")) {
        const char *h = "HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";
        send(sock, h, (int)strlen(h), 0);
        return;
    }

    snprintf(file_path, sizeof(file_path), "./%s", rel);

    FILE *f = fopen(file_path, "rb");
    if (!f) {
        /* Try index.html as fallback */
        f = fopen("./index.html", "rb");
        if (!f) {
            const char *h = "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";
            send(sock, h, (int)strlen(h), 0);
            return;
        }
        rel = "index.html";
    }

    fseek(f, 0, SEEK_END);
    long size = ftell(f);
    fseek(f, 0, SEEK_SET);

    char header[512];
    int hlen = snprintf(header, sizeof(header),
        "HTTP/1.1 200 OK\r\n"
        "Content-Type: %s\r\n"
        "Content-Length: %ld\r\n"
        "Cache-Control: no-cache\r\n"
        "Connection: close\r\n"
        "\r\n",
        mime_type(rel), size);
    send(sock, header, hlen, 0);

    char *buf = malloc(65536);
    if (buf) {
        size_t n;
        while ((n = fread(buf, 1, 65536, f)) > 0)
            send(sock, buf, (int)n, 0);
        free(buf);
    }
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
            if (*p == '\\' && *(p+1)) { p++; out[i++] = *p; }
            else out[i++] = *p;
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
        int i = 0;
        while (*p && i < maxlen - 1) {
            out[i++] = *p;
            if (*p == '{') depth++;
            else if (*p == '}') {
                depth--;
                if (depth == 0) { p++; break; }
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
        if (!first) resp[pos++] = ',';
        first = 0;
        char tmp[512];
        song_to_json_liked(&node->song, tmp, sizeof(tmp));
        int len = (int)strlen(tmp);
        if (pos + len + 4 < BUF) { memcpy(resp+pos, tmp, len); pos += len; }
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
            if (!first) resp[pos++] = ',';
            first = 0;
            char tmp[512];
            song_to_json_liked(&node->song, tmp, sizeof(tmp));
            int len = (int)strlen(tmp);
            if (pos + len + 4 < BUF) { memcpy(resp+pos, tmp, len); pos += len; }
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
    Song *s = hash_lookup(g_hash, id);
    if (!s) s = lib_find_by_id(g_lib, id);
    if (!s) { send_error(sock, 404, "song not found"); return; }
    char buf[512];
    song_to_json_liked(s, buf, sizeof(buf));
    send_ok(sock, buf);
}

/* POST /api/songs  body: {title,artist,album,genre,duration,rating} */
static void route_add_song(SOCKET sock, const char *body)
{
    /* Debug: print first 200 chars of body */
    fprintf(stderr, "[DEBUG add_song] body=%.200s\n", body ? body : "(null)");
    fflush(stderr);
    
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

    /* Input validation */
    if (!title[0] || !artist[0]) { send_error(sock,400,"title and artist required"); return; }
    if (duration <= 0 || duration > 600) { send_error(sock,400,"duration must be between 0 and 600 minutes"); return; }
    if (rating < 0 || rating > 5) { send_error(sock,400,"rating must be between 0 and 5"); return; }

    /* Sanitize inputs - remove control characters */
    for (int i = 0; title[i]; i++) if ((unsigned char)title[i] < 32) title[i] = ' ';
    for (int i = 0; artist[i]; i++) if ((unsigned char)artist[i] < 32) artist[i] = ' ';
    for (int i = 0; album[i]; i++) if ((unsigned char)album[i] < 32) album[i] = ' ';
    for (int i = 0; genre[i]; i++) if ((unsigned char)genre[i] < 32) genre[i] = ' ';

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
        hash_insert(g_hash, *s);
        heap_insert(g_heap_plays, *s);
        heap_insert(g_heap_rating, *s);
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

    /* BST deletes by title, hash by id */
    Song *sdel = lib_find_by_id(g_lib, id);
    if (sdel) bst_delete(g_bst, sdel->title);
    hash_delete(g_hash, id);
    lib_remove_song(g_lib, id);

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
    if (queue_enqueue(g_queue, *s) != 0) { send_error(sock,400,"queue full"); return; }
    send_ok(sock, "{\"success\":true}");
}

/* DELETE /api/queue */
static void route_dequeue(SOCKET sock)
{
    Song s;
    if (queue_dequeue(g_queue, &s) != 0) { send_error(sock,400,"queue empty"); return; }
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
        if (!first) resp[pos++] = ',';
        first = 0;
        char tmp[512];
        song_to_json_liked(&g_history->data[i], tmp, sizeof(tmp));
        int len = (int)strlen(tmp);
        if (pos + len + 4 < BUF) { memcpy(resp+pos, tmp, len); pos += len; }
    }
    resp[pos++] = ']';
    resp[pos]   = '\0';
    send_ok(sock, resp);
    free(resp);
}

/* POST /api/history/back — pop history */
static void route_history_back(SOCKET sock)
{
    Song s;
    if (stack_pop(g_history, &s) != 0) { send_error(sock,400,"history empty"); return; }
    char buf[512];
    song_to_json_liked(&s, buf, sizeof(buf));
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
        if (!first) resp[pos++] = ',';
        first = 0;
        char pname[256]; json_escape(pl->name, pname, sizeof(pname));
        char tmp[256];
        int len = snprintf(tmp, sizeof(tmp),
            "{\"id\":%d,\"name\":\"%s\",\"song_count\":%d}",
            pl->id, pname, pl->song_count);
        if (pos + len + 4 < BUF) { memcpy(resp+pos, tmp, len); pos += len; }
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
    Playlist *pl = pm_create_playlist(g_pm, name);
    if (!pl) { send_error(sock,500,"failed"); return; }
    char pname[256]; json_escape(pl->name, pname, sizeof(pname));
    char buf[256];
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
            if (!first) resp[pos++] = ',';
            first = 0;
            char tmp[512];
            song_to_json_liked(s, tmp, sizeof(tmp));
            int len = (int)strlen(tmp);
            if (pos + len + 4 < BUF) { memcpy(resp+pos, tmp, len); pos += len; }
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
        if (!first) resp[pos++] = ',';
        first = 0;
        char tmp[512];
        song_to_json_liked(&arr[j], tmp, sizeof(tmp));
        int len = (int)strlen(tmp);
        if (pos + len + 4 < BUF) { memcpy(resp+pos, tmp, len); pos += len; }
    }
    resp[pos++] = ']';
    resp[pos]   = '\0';
    free(arr);
    send_ok(sock, resp);
    free(resp);
}

/* ═══════════════════════════════════════════════
   LISTEN TOGETHER / JAM SESSION DSA & ROUTES
═══════════════════════════════════════════════ */
#include <time.h>

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
    int allow_control;
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
    "#7c3aed", "#06b6d4", "#ec4899", "#10b981", "#f59e0b", "#8b5cf6", "#3b82f6", "#ef4444"
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
        /* Remove rooms with no activity for > 2 hours, or empty rooms inactive > 10 mins */
        if (difftime(now, entry->last_activity) > 7200 ||
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
    JamRoom *r = existing ? existing : (JamRoom*)calloc(1, sizeof(JamRoom));
    if (!r) { send_error(sock, 500, "out of memory"); return; }

    strncpy(r->code, room_code, sizeof(r->code) - 1);
    strncpy(r->host_name, dj_name, sizeof(r->host_name) - 1);
    r->allow_control = allow_control;
    r->member_count = 1;
    r->event_count = 0;
    r->last_event_id = 0;
    r->created_at = time(NULL);
    r->last_activity = r->created_at;

    /* Host is member #0 — NO BOTS */
    strncpy(r->members[0].name, dj_name, sizeof(r->members[0].name) - 1);
    strcpy(r->members[0].avatar, "DJ");
    strcpy(r->members[0].color, "#7c3aed");
    r->members[0].is_host = 1;
    r->members[0].last_seen = r->created_at;

    char song_buf[2048];
    if (json_obj(body, "song", song_buf, sizeof(song_buf))) {
        strncpy(r->current_song, song_buf, sizeof(r->current_song) - 1);
    } else {
        r->current_song[0] = '\0';
    }
    r->progress = json_float(body, "progress", 0.0f);
    r->is_playing = json_bool(body, "isPlaying", 0);

    if (!existing) {
        r->next = g_jam_rooms;
        g_jam_rooms = r;
    }

    jam_add_event(r, "ROOM_CREATED", dj_name, body);

    char resp[512];
    snprintf(resp, sizeof(resp),
        "{\"success\":true,\"roomId\":\"%s\",\"host\":\"%s\",\"allowControl\":%s}",
        r->code, r->host_name, r->allow_control ? "true" : "false");
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
        strncpy(r->members[idx].name, user_name, sizeof(r->members[idx].name) - 1);
        r->members[idx].name[sizeof(r->members[idx].name) - 1] = '\0';

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

        char jpayload[256];
        snprintf(jpayload, sizeof(jpayload),
            "{\"sender\":\"%s\",\"avatar\":\"%s\",\"color\":\"%s\"}",
            user_name, r->members[idx].avatar, r->members[idx].color);
        jam_add_event(r, "JOIN", user_name, jpayload);
    }

    char *resp = malloc(BUF);
    if (!resp) { send_error(sock, 500, "out of memory"); return; }

    int pos = snprintf(resp, BUF,
        "{\"success\":true,\"roomId\":\"%s\",\"host\":\"%s\",\"allowControl\":%s,"
        "\"progress\":%.2f,\"isPlaying\":%s,\"lastEventId\":%d,\"members\":[",
        r->code, r->host_name, r->allow_control ? "true" : "false",
        r->progress, r->is_playing ? "true" : "false", r->last_event_id);

    for (int i = 0; i < r->member_count; i++) {
        if (i > 0 && pos < BUF - 2) resp[pos++] = ',';
        pos += snprintf(resp + pos, BUF - pos,
            "{\"name\":\"%s\",\"avatar\":\"%s\",\"color\":\"%s\",\"isHost\":%s}",
            r->members[i].name, r->members[i].avatar, r->members[i].color,
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
    char room_code[32], sender[64], type[32];
    json_str(body, "roomId", room_code, sizeof(room_code));
    json_str(body, "sender", sender, sizeof(sender));
    json_str(body, "type", type, sizeof(type));

    JamRoom *r = jam_find_room(room_code);
    if (!r) { send_error(sock, 404, "Room not found"); return; }

    int is_host = (strcmp(r->host_name, sender) == 0);
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

    int pos = snprintf(resp, BUF,
        "{\"success\":true,\"roomId\":\"%s\",\"host\":\"%s\",\"allowControl\":%s,"
        "\"progress\":%.2f,\"isPlaying\":%s,\"lastEventId\":%d,\"members\":[",
        r->code, r->host_name, r->allow_control ? "true" : "false",
        r->progress, r->is_playing ? "true" : "false", r->last_event_id);

    for (int i = 0; i < r->member_count; i++) {
        if (i > 0 && pos < BUF - 2) resp[pos++] = ',';
        pos += snprintf(resp + pos, BUF - pos,
            "{\"name\":\"%s\",\"avatar\":\"%s\",\"color\":\"%s\",\"isHost\":%s}",
            r->members[i].name, r->members[i].avatar, r->members[i].color,
            r->members[i].is_host ? "true" : "false");
    }

    pos += snprintf(resp + pos, BUF - pos, "],\"events\":[");

    int ev_first = 1;
    for (int i = 0; i < r->event_count; i++) {
        if (r->events[i].id > last_id) {
            if (!ev_first && pos < BUF - 2) resp[pos++] = ',';
            ev_first = 0;
            pos += snprintf(resp + pos, BUF - pos,
                "{\"id\":%d,\"type\":\"%s\",\"sender\":\"%s\",\"payload\":%s,\"timestamp\":%lld}",
                r->events[i].id, r->events[i].type, r->events[i].sender,
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

            char lpayload[128];
            snprintf(lpayload, sizeof(lpayload), "{\"sender\":\"%s\"}", user_name);
            jam_add_event(r, "LEAVE", user_name, lpayload);

            if (was_host && r->member_count > 0) {
                r->members[0].is_host = 1;
                strncpy(r->host_name, r->members[0].name, sizeof(r->host_name) - 1);
            }
        }
    }
    send_ok(sock, "{\"success\":true}");
}

/* ═══════════════════════════════════════════════
   REQUEST DISPATCHER
═══════════════════════════════════════════════ */
static void handle_request(SOCKET sock, char *req, int req_len)
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

    /* ── /api/songs ─────────────────────────── */
    if (strcmp(seg2,"songs")==0) {

        if (strcmp(seg3,"")==0 || seg3[0]=='\0') {
            /* /api/songs */
            if (strcmp(method,"GET")==0)  { route_get_songs(sock); return; }
            if (strcmp(method,"POST")==0) { route_add_song(sock, body); return; }
            send_error(sock,405,"method not allowed"); return;
        }

        if (strcmp(seg3,"search")==0) {
            /* /api/songs/search?q= */
            char q[MAX_TITLE];
            get_query_param(path, "q", q, sizeof(q));
            route_search_songs(sock, q); return;
        }

        int song_id = atoi(seg3);

        if (seg4[0]=='\0') {
            /* /api/songs/:id */
            if (strcmp(method,"GET")==0)    { route_get_song_by_id(sock, song_id); return; }
            if (strcmp(method,"DELETE")==0) { route_delete_song(sock, song_id); return; }
            send_error(sock,405,"method not allowed"); return;
        }

        if (strcmp(seg4,"play")==0 && strcmp(method,"PUT")==0) {
            route_play_song(sock, song_id); return;
        }
        if (strcmp(seg4,"like")==0 && strcmp(method,"PUT")==0) {
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

        int pl_id = atoi(seg3);

        if (seg4[0]=='\0') {
            if (strcmp(method,"DELETE")==0) { route_delete_playlist(sock, pl_id); return; }
            send_error(sock,405,"method not allowed"); return;
        }

        if (strcmp(seg4,"songs")==0) {
            if (strcmp(method,"GET")==0)  { route_playlist_songs(sock, pl_id); return; }
            if (strcmp(method,"POST")==0) { route_playlist_add_song(sock, pl_id, body); return; }
            if (strcmp(method,"DELETE")==0 && seg5[0]) {
                route_playlist_remove_song(sock, pl_id, atoi(seg5)); return;
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
        send_error(sock,404,"not found"); return;
    }

    /* ── Anything else: serve as static file ── */
    serve_static(sock, path);
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
            hash_insert(g_hash, *s);
            heap_insert(g_heap_plays, *s);
            heap_insert(g_heap_rating, *s);
        }
    }
}

/* ══════════════════════════════════════════════
   MAIN — Winsock2 TCP server
══════════════════════════════════════════════ */
int main(void)
{
    /* Init DSA */
    g_lib          = lib_create();
    g_history      = stack_create();
    g_queue        = queue_create();
    g_bst          = bst_create();
    g_heap_plays   = heap_create(HEAP_BY_PLAYS);
    g_heap_rating  = heap_create(HEAP_BY_RATING);
    g_hash         = hash_create();
    g_pm           = pm_create();
    memset(g_liked, 0, sizeof(g_liked));

    if (!g_lib || !g_history || !g_queue || !g_bst ||
        !g_heap_plays || !g_heap_rating || !g_hash || !g_pm) {
        fprintf(stderr, "Failed to initialize DSA structures\n");
        return 1;
    }

    seed_data();

    /* Winsock init */
    WSADATA wsa;
    if (WSAStartup(MAKEWORD(2,2), &wsa) != 0) {
        fprintf(stderr, "WSAStartup failed\n"); return 1;
    }

    SOCKET server_sock = socket(AF_INET, SOCK_STREAM, 0);
    if (server_sock == INVALID_SOCKET) {
        fprintf(stderr, "socket() failed\n"); WSACleanup(); return 1;
    }

    /* Allow port reuse */
    int opt = 1;
    setsockopt(server_sock, SOL_SOCKET, SO_REUSEADDR, (char*)&opt, sizeof(opt));

    struct sockaddr_in addr;
    memset(&addr, 0, sizeof(addr));
    addr.sin_family      = AF_INET;
    addr.sin_addr.s_addr = INADDR_ANY;
    addr.sin_port        = htons(PORT);

    if (bind(server_sock, (struct sockaddr*)&addr, sizeof(addr)) == SOCKET_ERROR) {
        fprintf(stderr, "bind() failed (port %d in use?)\n", PORT);
        closesocket(server_sock); WSACleanup(); return 1;
    }

    if (listen(server_sock, 10) == SOCKET_ERROR) {
        fprintf(stderr, "listen() failed\n");
        closesocket(server_sock); WSACleanup(); return 1;
    }

    printf("\n");
    printf("  ╔══════════════════════════════════════════════════╗\n");
    printf("  ║  🎵  VIBE API Server — C + DSA Backend           ║\n");
    printf("  ╠══════════════════════════════════════════════════╣\n");
    printf("  ║  Listening on  http://localhost:%d              ║\n", PORT);
    printf("  ║  Library: DLL  |  Search: BST  |  Lookup: Hash  ║\n");
    printf("  ║  Queue: CQ     |  History: Stack | Charts: Heap  ║\n");
    printf("  ║  Sort: MergeSort  |  Playlists: SLL             ║\n");
    printf("  ╠══════════════════════════════════════════════════╣\n");
    printf("  ║  Songs seeded: %d                                ║\n", lib_size(g_lib));
    printf("  ║  Press Ctrl+C to stop.                          ║\n");
    printf("  ╚══════════════════════════════════════════════════╝\n\n");
    fflush(stdout);

    char *req_buf = malloc(BUF);
    if (!req_buf) { fprintf(stderr,"oom\n"); return 1; }

    for (;;) {
        struct sockaddr_in client_addr;
        int addr_len = sizeof(client_addr);
        SOCKET client = accept(server_sock, (struct sockaddr*)&client_addr, &addr_len);
        if (client == INVALID_SOCKET) continue;

        /* Receive full request — loop until \r\n\r\n found */
        int total = 0;
        int done  = 0;
        /* Set a receive timeout so we don't hang */
        DWORD tv = 2000; /* 2 seconds */
        setsockopt(client, SOL_SOCKET, SO_RCVTIMEO, (char*)&tv, sizeof(tv));
        while (total < BUF - 1 && !done) {
            int n = recv(client, req_buf + total, BUF - 1 - total, 0);
            if (n <= 0) break;
            total += n;
            req_buf[total] = '\0';
            /* Stop once we have full headers */
            if (strstr(req_buf, "\r\n\r\n")) {
                /* Check for body: if Content-Length present, read body too */
                const char *cl = strstr(req_buf, "Content-Length:");
                if (!cl) cl = strstr(req_buf, "content-length:");
                if (cl) {
                    int body_len = atoi(cl + 15);
                    const char *hdr_end = strstr(req_buf, "\r\n\r\n");
                    int hdr_len = (int)(hdr_end - req_buf) + 4;
                    int body_received = total - hdr_len;
                    while (body_received < body_len && total < BUF - 1) {
                        int m = recv(client, req_buf + total, BUF - 1 - total, 0);
                        if (m <= 0) break;
                        total += m;
                        req_buf[total] = '\0';
                        body_received += m;
                    }
                }
                done = 1;
            }
        }
        if (total > 0) {
            handle_request(client, req_buf, total);
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
    WSACleanup();
    return 0;
}
