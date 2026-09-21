/*
 * playlist.h — Playlist Management
 * Music Management System (C + DSA)
 *
 * DSA: Linked list of playlists, each playlist is a singly linked list of song IDs.
 *   - Create / delete playlists
 *   - Add / remove songs from a playlist
 *   - Display playlist
 */

#ifndef PLAYLIST_H
#define PLAYLIST_H

#include "song.h"
#include "library.h"

#define MAX_PLAYLIST_NAME 100

/* ── Playlist song entry ─────────────────────── */
typedef struct PLSongNode {
    int              song_id;
    struct PLSongNode *next;
} PLSongNode;

/* ── Playlist ────────────────────────────────── */
typedef struct Playlist {
    int           id;
    char          name[MAX_PLAYLIST_NAME];
    PLSongNode   *head;
    int           song_count;
    struct Playlist *next;   /* next playlist in the list */
} Playlist;

/* ── Playlist Manager ────────────────────────── */
typedef struct PlaylistManager {
    Playlist *head;
    int       count;
    int       next_id;
} PlaylistManager;

/* ── API ─────────────────────────────────────── */
PlaylistManager *pm_create(void);
void             pm_destroy(PlaylistManager *pm);

Playlist *pm_create_playlist(PlaylistManager *pm, const char *name);
int       pm_delete_playlist(PlaylistManager *pm, int playlist_id);

int       pm_add_song(PlaylistManager *pm, int playlist_id, int song_id);
int       pm_remove_song(PlaylistManager *pm, int playlist_id, int song_id);

Playlist *pm_find(PlaylistManager *pm, int playlist_id);
void      pm_list_all(const PlaylistManager *pm);
void      pm_display_playlist(const PlaylistManager *pm, int playlist_id,
                               const Library *lib);

#endif /* PLAYLIST_H */
