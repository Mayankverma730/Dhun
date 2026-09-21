/*
 * playlist.c — Playlist Management
 * Music Management System (C + DSA)
 *
 * A PlaylistManager is a singly linked list of Playlists.
 * Each Playlist is a singly linked list of song IDs (referencing the Library).
 *
 * Structure:
 *   PlaylistManager
 *      └─ Playlist("My Favs") → Playlist("Workout") → Playlist("Chill") → NULL
 *              │                       │
 *         [id:1]→[id:3]→NULL      [id:5]→[id:2]→NULL
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "playlist.h"

/* ── Create manager ──────────────────────────── */
PlaylistManager *pm_create(void)
{
    PlaylistManager *pm = (PlaylistManager *)malloc(sizeof(PlaylistManager));
    if (!pm) { perror("pm_create"); return NULL; }
    pm->head    = NULL;
    pm->count   = 0;
    pm->next_id = 1;
    return pm;
}

/* ── Destroy manager (free everything) ───────── */
void pm_destroy(PlaylistManager *pm)
{
    if (!pm) return;
    Playlist *pl = pm->head;
    while (pl) {
        /* Free song list */
        PLSongNode *sn = pl->head;
        while (sn) {
            PLSongNode *nxt = sn->next;
            free(sn);
            sn = nxt;
        }
        Playlist *nxt = pl->next;
        free(pl);
        pl = nxt;
    }
    free(pm);
}

/* ── Create a new playlist ───────────────────── */
Playlist *pm_create_playlist(PlaylistManager *pm, const char *name)
{
    if (!pm || !name) return NULL;
    Playlist *pl = (Playlist *)malloc(sizeof(Playlist));
    if (!pl) { perror("pm_create_playlist"); return NULL; }
    pl->id         = pm->next_id++;
    pl->head       = NULL;
    pl->song_count = 0;
    pl->next       = NULL;
    strncpy(pl->name, name, MAX_PLAYLIST_NAME - 1);
    pl->name[MAX_PLAYLIST_NAME - 1] = '\0';

    /* Prepend to manager's list */
    pl->next = pm->head;
    pm->head = pl;
    pm->count++;
    return pl;
}

/* ── Delete a playlist ───────────────────────── */
int pm_delete_playlist(PlaylistManager *pm, int playlist_id)
{
    if (!pm) return 0;
    Playlist *cur  = pm->head;
    Playlist *prev = NULL;
    while (cur) {
        if (cur->id == playlist_id) {
            if (prev) prev->next = cur->next;
            else      pm->head   = cur->next;
            /* Free songs */
            PLSongNode *sn = cur->head;
            while (sn) { PLSongNode *nxt = sn->next; free(sn); sn = nxt; }
            free(cur);
            pm->count--;
            return 1;
        }
        prev = cur;
        cur  = cur->next;
    }
    return 0;
}

/* ── Find playlist by ID ─────────────────────── */
Playlist *pm_find(PlaylistManager *pm, int playlist_id)
{
    Playlist *cur = pm->head;
    while (cur) {
        if (cur->id == playlist_id) return cur;
        cur = cur->next;
    }
    return NULL;
}

/* ── Add song ID to playlist ─────────────────── */
int pm_add_song(PlaylistManager *pm, int playlist_id, int song_id)
{
    Playlist *pl = pm_find(pm, playlist_id);
    if (!pl) { printf("  Playlist %d not found.\n", playlist_id); return 0; }

    /* Check duplicate */
    PLSongNode *cur = pl->head;
    while (cur) {
        if (cur->song_id == song_id) {
            printf("  Song %d already in playlist.\n", song_id);
            return 0;
        }
        cur = cur->next;
    }

    PLSongNode *node = (PLSongNode *)malloc(sizeof(PLSongNode));
    if (!node) { perror("pm_add_song"); return 0; }
    node->song_id = song_id;
    node->next    = pl->head;
    pl->head      = node;
    pl->song_count++;
    return 1;
}

/* ── Remove song ID from playlist ────────────── */
int pm_remove_song(PlaylistManager *pm, int playlist_id, int song_id)
{
    Playlist *pl = pm_find(pm, playlist_id);
    if (!pl) return 0;

    PLSongNode *cur  = pl->head;
    PLSongNode *prev = NULL;
    while (cur) {
        if (cur->song_id == song_id) {
            if (prev) prev->next = cur->next;
            else      pl->head   = cur->next;
            free(cur);
            pl->song_count--;
            return 1;
        }
        prev = cur;
        cur  = cur->next;
    }
    return 0;
}

/* ── List all playlists ──────────────────────── */
void pm_list_all(const PlaylistManager *pm)
{
    if (!pm || !pm->head) { printf("  No playlists created yet.\n"); return; }
    printf("\n  %-5s %-30s %s\n", "ID", "Name", "Songs");
    printf("  %s\n", "---------------------------------------------");
    const Playlist *pl = pm->head;
    while (pl) {
        printf("  %-5d %-30s %d\n", pl->id, pl->name, pl->song_count);
        pl = pl->next;
    }
    printf("\n");
}

/* ── Display songs in a playlist ─────────────── */
void pm_display_playlist(const PlaylistManager *pm, int playlist_id,
                          const Library *lib)
{
    Playlist *pl = pm_find((PlaylistManager *)pm, playlist_id);
    if (!pl) { printf("  Playlist %d not found.\n", playlist_id); return; }

    printf("\n  Playlist: \"%s\"  (%d songs)\n", pl->name, pl->song_count);
    if (!pl->head) { printf("  (Empty playlist)\n\n"); return; }

    song_print_header();
    const PLSongNode *sn = pl->head;
    while (sn) {
        Song *s = lib_find_by_id((Library *)lib, sn->song_id);
        if (s) song_print(s);
        else printf("  [Song ID %d — not found in library]\n", sn->song_id);
        sn = sn->next;
    }
    printf("\n");
}
