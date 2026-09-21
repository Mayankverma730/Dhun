/*
 * library.h — Music Library (Doubly Linked List)
 * Music Management System (C + DSA)
 *
 * DSA: Doubly Linked List
 *   - Each node holds a Song and two pointers (prev, next).
 *   - Insert at head/tail: O(1)
 *   - Delete by ID:        O(n)
 *   - Traverse fwd/back:   O(n)
 */

#ifndef LIBRARY_H
#define LIBRARY_H

#include "song.h"

/* ── DLL Node ────────────────────────────────── */
typedef struct LibNode {
    Song          song;
    struct LibNode *prev;
    struct LibNode *next;
} LibNode;

/* ── DLL (Library) ───────────────────────────── */
typedef struct Library {
    LibNode *head;
    LibNode *tail;
    int      size;
    int      next_id;   /* Auto-increment song ID */
} Library;

/* ── API ─────────────────────────────────────── */
Library  *lib_create(void);
void      lib_destroy(Library *lib);

/* Insert */
int       lib_add_song(Library *lib, const char *title, const char *artist,
                       const char *album, const char *genre,
                       float duration, float rating);
/* Remove */
int       lib_remove_song(Library *lib, int id);

/* Access */
Song     *lib_find_by_id(Library *lib, int id);
Song     *lib_find_by_title(Library *lib, const char *title);

/* Display */
void      lib_display(const Library *lib);
void      lib_display_reverse(const Library *lib);    /* traverse backward */

/* Stats */
int       lib_size(const Library *lib);
void      lib_stats(const Library *lib);

#endif /* LIBRARY_H */
