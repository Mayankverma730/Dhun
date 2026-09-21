/*
 * library.c — Music Library (Doubly Linked List)
 * Music Management System (C + DSA)
 *
 * ┌──────────────────────────────────────────────────────────────┐
 * │ DOUBLY LINKED LIST                                           │
 * │                                                              │
 * │  head                                             tail       │
 * │   ↓                                                ↓        │
 * │  [prev|Song|next] ↔ [prev|Song|next] ↔ [prev|Song|next]    │
 * │                                                              │
 * │  Operations: insert O(1), delete O(n), traverse O(n)        │
 * └──────────────────────────────────────────────────────────────┘
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "library.h"

/* ── Create empty library ────────────────────── */
Library *lib_create(void)
{
    Library *lib = (Library *)malloc(sizeof(Library));
    if (!lib) { perror("lib_create"); return NULL; }
    lib->head    = NULL;
    lib->tail    = NULL;
    lib->size    = 0;
    lib->next_id = 1;
    return lib;
}

/* ── Free all nodes and the library ─────────── */
void lib_destroy(Library *lib)
{
    if (!lib) return;
    LibNode *cur = lib->head;
    while (cur) {
        LibNode *nxt = cur->next;
        free(cur);
        cur = nxt;
    }
    free(lib);
}

/* ── Add song at tail — O(1) ────────────────── */
int lib_add_song(Library *lib, const char *title, const char *artist,
                 const char *album, const char *genre,
                 float duration, float rating)
{
    if (!lib) return -1;
    LibNode *node = (LibNode *)malloc(sizeof(LibNode));
    if (!node) { perror("lib_add_song"); return -1; }

    node->song = song_create(lib->next_id++, title, artist,
                             album, genre, duration, rating);
    node->prev = NULL;
    node->next = NULL;

    if (!lib->tail) {
        /* List was empty */
        lib->head = lib->tail = node;
    } else {
        /* Append at tail */
        node->prev       = lib->tail;
        lib->tail->next  = node;
        lib->tail        = node;
    }
    lib->size++;
    return node->song.id;
}

/* ── Remove song by ID — O(n) ───────────────── */
int lib_remove_song(Library *lib, int id)
{
    if (!lib) return 0;
    LibNode *cur = lib->head;
    while (cur) {
        if (cur->song.id == id) {
            /* Re-wire neighbors */
            if (cur->prev) cur->prev->next = cur->next;
            else           lib->head       = cur->next;

            if (cur->next) cur->next->prev = cur->prev;
            else           lib->tail       = cur->prev;

            free(cur);
            lib->size--;
            return 1;   /* success */
        }
        cur = cur->next;
    }
    return 0;   /* not found */
}

/* ── Find by ID — O(n) ───────────────────────── */
Song *lib_find_by_id(Library *lib, int id)
{
    LibNode *cur = lib->head;
    while (cur) {
        if (cur->song.id == id) return &cur->song;
        cur = cur->next;
    }
    return NULL;
}

/* ── Find by title (case-insensitive) — O(n) ── */
Song *lib_find_by_title(Library *lib, const char *title)
{
    LibNode *cur = lib->head;
    while (cur) {
        /* portable case-insensitive compare */
        const char *a = cur->song.title;
        const char *b = title;
        int match = 1;
        while (*a && *b) {
            char ca = (*a >= 'A' && *a <= 'Z') ? (*a + 32) : *a;
            char cb = (*b >= 'A' && *b <= 'Z') ? (*b + 32) : *b;
            if (ca != cb) { match = 0; break; }
            a++; b++;
        }
        if (match && *a == '\0' && *b == '\0') return &cur->song;
        cur = cur->next;
    }
    return NULL;
}

/* ── Display forward — O(n) ─────────────────── */
void lib_display(const Library *lib)
{
    if (!lib || !lib->head) {
        printf("  (Library is empty)\n");
        return;
    }
    song_print_header();
    const LibNode *cur = lib->head;
    while (cur) {
        song_print(&cur->song);
        cur = cur->next;
    }
    printf("  Total: %d song(s)\n\n", lib->size);
}

/* ── Display backward (DLL advantage) — O(n) ── */
void lib_display_reverse(const Library *lib)
{
    if (!lib || !lib->tail) {
        printf("  (Library is empty)\n");
        return;
    }
    printf("\n  [Reverse traversal — tail to head]\n");
    song_print_header();
    const LibNode *cur = lib->tail;
    while (cur) {
        song_print(&cur->song);
        cur = cur->prev;
    }
    printf("  Total: %d song(s)\n\n", lib->size);
}

/* ── Size ─────────────────────────────────────── */
int lib_size(const Library *lib)
{
    return lib ? lib->size : 0;
}

/* ── Stats ───────────────────────────────────── */
void lib_stats(const Library *lib)
{
    if (!lib || lib->size == 0) {
        printf("  No songs in library.\n");
        return;
    }
    int   total_plays = 0;
    float total_dur   = 0.0f;
    float max_rating  = 0.0f;
    const char *top_song = "";
    const LibNode *cur = lib->head;
    while (cur) {
        total_plays += cur->song.play_count;
        total_dur   += cur->song.duration;
        if (cur->song.rating > max_rating) {
            max_rating = cur->song.rating;
            top_song   = cur->song.title;
        }
        cur = cur->next;
    }
    int tot_min = (int)total_dur;
    int tot_sec = (int)((total_dur - tot_min) * 60);
    printf("\n  ╔══════════════════════════════╗\n");
    printf("  ║     Library Statistics       ║\n");
    printf("  ╠══════════════════════════════╣\n");
    printf("  ║  Songs       : %-13d ║\n", lib->size);
    printf("  ║  Total Time  : %d:%02d min      ║\n", tot_min, tot_sec);
    printf("  ║  Total Plays : %-13d ║\n", total_plays);
    printf("  ║  Top Rated   : %-13.13s ║\n", top_song);
    printf("  ║  Top Rating  : %-13.1f ║\n", max_rating);
    printf("  ╚══════════════════════════════╝\n\n");
}
