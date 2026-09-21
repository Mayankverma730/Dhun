/*
 * heap.c — Top Charts (Max-Heap)
 * Music Management System (C + DSA)
 *
 * ┌──────────────────────────────────────────────────────────────┐
 * │ MAX-HEAP (binary heap stored in array)                       │
 * │                                                              │
 * │         [0] most played                                      │
 * │        /               \                                     │
 * │      [1]               [2]                                   │
 * │     /    \            /   \                                  │
 * │   [3]    [4]        [5]   [6]                                │
 * │                                                              │
 * │  Parent of i  = (i-1)/2                                      │
 * │  Left child   = 2*i + 1                                      │
 * │  Right child  = 2*i + 2                                      │
 * │                                                              │
 * │  Heap property: parent ≥ children (max at root)              │
 * └──────────────────────────────────────────────────────────────┘
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "heap.h"

/* ── Compare two songs per heap mode ─────────── */
static int heap_cmp(const Heap *h, int a, int b)
{
    if (h->mode == HEAP_BY_RATING)
        return (h->data[a].rating > h->data[b].rating) ? 1 : -1;
    return (h->data[a].play_count > h->data[b].play_count) ? 1 : -1;
}

/* ── Swap two elements ───────────────────────── */
static void swap(Song *a, Song *b)
{
    Song tmp = *a; *a = *b; *b = tmp;
}

/* ── Sift up (restore heap after insert) ─────── */
static void sift_up(Heap *h, int i)
{
    while (i > 0) {
        int parent = (i - 1) / 2;
        if (heap_cmp(h, i, parent) > 0) {
            swap(&h->data[i], &h->data[parent]);
            i = parent;
        } else break;
    }
}

/* ── Sift down (restore heap after extract) ──── */
static void sift_down(Heap *h, int i)
{
    while (1) {
        int largest = i;
        int left    = 2 * i + 1;
        int right   = 2 * i + 2;
        if (left  < h->size && heap_cmp(h, left,  largest) > 0) largest = left;
        if (right < h->size && heap_cmp(h, right, largest) > 0) largest = right;
        if (largest == i) break;
        swap(&h->data[i], &h->data[largest]);
        i = largest;
    }
}

/* ── Create ──────────────────────────────────── */
Heap *heap_create(HeapMode mode)
{
    Heap *h = (Heap *)malloc(sizeof(Heap));
    if (!h) { perror("heap_create"); return NULL; }
    h->size = 0;
    h->mode = mode;
    return h;
}

void heap_destroy(Heap *h) { free(h); }

/* ── Insert — O(log n) ───────────────────────── */
int heap_insert(Heap *h, Song song)
{
    if (!h || h->size >= HEAP_MAX_SIZE) {
        printf("  [Heap] Full! Cannot insert.\n");
        return 0;
    }
    h->data[h->size++] = song;
    sift_up(h, h->size - 1);
    return 1;
}

/* ── Extract max — O(log n) ──────────────────── */
int heap_extract_max(Heap *h, Song *out)
{
    if (!h || h->size == 0) return 0;
    if (out) *out = h->data[0];
    h->data[0] = h->data[--h->size];
    if (h->size > 0) sift_down(h, 0);
    return 1;
}

/* ── Peek max — O(1) ─────────────────────────── */
int heap_peek_max(const Heap *h, Song *out)
{
    if (!h || h->size == 0) return 0;
    if (out) *out = h->data[0];
    return 1;
}

/* ── Build heap from array — O(n) ────────────── */
void heap_build(Heap *h, Song *arr, int n)
{
    if (!h || !arr) return;
    int count = (n < HEAP_MAX_SIZE) ? n : HEAP_MAX_SIZE;
    for (int i = 0; i < count; i++) h->data[i] = arr[i];
    h->size = count;
    /* Floyd's algorithm: heapify from last non-leaf */
    for (int i = (count / 2) - 1; i >= 0; i--)
        sift_down(h, i);
}

/* ── Display top-k songs (destructive copy) ───── */
void heap_display_top(Heap *h, int k)
{
    if (!h || h->size == 0) { printf("  (No songs in charts)\n"); return; }
    /* Work on a copy so we don't destroy the heap */
    Heap copy = *h;
    int  limit = (k < copy.size) ? k : copy.size;
    const char *label = (h->mode == HEAP_BY_RATING) ? "Rating" : "Play Count";
    printf("\n  [Top %d Songs by %s]\n", limit, label);
    song_print_header();
    for (int rank = 1; rank <= limit; rank++) {
        Song top;
        if (!heap_extract_max(&copy, &top)) break;
        printf("  #%-2d", rank);
        song_print(&top);
    }
    printf("\n");
}

int heap_size(const Heap *h) { return h ? h->size : 0; }
