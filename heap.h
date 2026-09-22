/*
 * heap.h — Top Charts (Max-Heap by play count / rating)
 * Music Management System (C + DSA)
 *
 * DSA: Max-Heap (binary heap, array-based)
 *   - Insert:    O(log n)
 *   - Extract max (top song): O(log n)
 *   - Peek max:  O(1)
 *   - Build heap from array: O(n)
 *
 * The heap is keyed on play_count (most played = top).
 */

#ifndef HEAP_H
#define HEAP_H

#include "song.h"
#include "library.h"

#define HEAP_MAX_SIZE 1000

typedef enum { HEAP_BY_PLAYS, HEAP_BY_RATING } HeapMode;

/* ── Max-Heap ────────────────────────────────── */
typedef struct Heap {
    Song     data[HEAP_MAX_SIZE];
    int      size;
    HeapMode mode;
} Heap;

/* ── API ─────────────────────────────────────── */
Heap *heap_create(HeapMode mode);
void  heap_destroy(Heap *h);

int   heap_insert(Heap *h, Song song);          /* O(log n) */
int   heap_extract_max(Heap *h, Song *out);     /* O(log n) */
int   heap_peek_max(const Heap *h, Song *out);  /* O(1)     */

void  heap_build(Heap *h, Song *arr, int n);    /* O(n)     */
void  heap_rebuild_from_library(Heap *h, const Library *lib); /* O(n) rebuild from library */
void  heap_display_top(Heap *h, int k);         /* top-k songs */

int   heap_size(const Heap *h);
int   heap_is_full(const Heap *h);

#endif /* HEAP_H */
