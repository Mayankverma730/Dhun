/*
 * sort.c — Sorting Algorithms (Merge Sort + Quick Sort)
 * Music Management System (C + DSA)
 *
 * ┌──────────────────────────────────────────────────────────────┐
 * │ MERGE SORT (stable, O(n log n))                              │
 * │  Divide array in half recursively, then merge sorted halves  │
 * │                                                              │
 * │  [N D B E A C] → [N D B] [E A C]                            │
 * │               → [N D][B] [E A][C]                           │
 * │               → Merge → [B D N] [A C E]                     │
 * │               → Merge → [A B C D E N]   ✓                   │
 * │                                                              │
 * │ QUICK SORT (in-place, O(n log n) avg)                        │
 * │  Pick pivot, partition around it, recurse on sub-arrays      │
 * │                                                              │
 * │  [3 6 8 10 1 2 1] pivot=1                                    │
 * │  → [1 1 | 2 3 6 8 10] → recurse on each side                │
 * └──────────────────────────────────────────────────────────────┘
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "sort.h"
#include "library.h"

/* ════════════════════════════════════════════
   MERGE SORT
   ════════════════════════════════════════════ */

/* Merge two sorted halves into one shared scratch array. */
static void merge(Song *arr, Song *scratch, int lo, int mid, int hi,
                  SongComparator cmp)
{
    int left = lo, right = mid + 1, out = lo;
    while (left <= mid && right <= hi) {
        if (cmp(&arr[left], &arr[right]) <= 0) scratch[out++] = arr[left++];
        else                                    scratch[out++] = arr[right++];
    }
    while (left <= mid)  scratch[out++] = arr[left++];
    while (right <= hi)  scratch[out++] = arr[right++];
    for (int i = lo; i <= hi; i++) arr[i] = scratch[i];
}

static void merge_sort_rec(Song *arr, Song *scratch, int lo, int hi,
                           SongComparator cmp)
{
    if (lo >= hi) return;
    int mid = lo + (hi - lo) / 2;
    merge_sort_rec(arr, scratch, lo,      mid, cmp);
    merge_sort_rec(arr, scratch, mid + 1, hi,  cmp);
    merge(arr, scratch, lo, mid, hi, cmp);
}

void merge_sort(Song *arr, int n, SongComparator cmp)
{
    if (!arr || !cmp || n <= 1) return;
    /* One buffer replaces per-merge allocations and leaves input untouched on OOM. */
    Song *scratch = (Song *)malloc((size_t)n * sizeof(*scratch));
    if (!scratch) return;
    merge_sort_rec(arr, scratch, 0, n - 1, cmp);
    free(scratch);
}

/* ════════════════════════════════════════════
   QUICK SORT
   ════════════════════════════════════════════ */

static void swap_song(Song *a, Song *b)
{
    Song tmp = *a; *a = *b; *b = tmp;
}

/* Lomuto partition scheme — pivot = arr[hi] */
static int partition(Song *arr, int lo, int hi, SongComparator cmp)
{
    Song *pivot = &arr[hi];
    int   i     = lo - 1;
    for (int j = lo; j < hi; j++) {
        if (cmp(&arr[j], pivot) <= 0) {
            i++;
            swap_song(&arr[i], &arr[j]);
        }
    }
    swap_song(&arr[i + 1], &arr[hi]);
    return i + 1;
}

void quick_sort(Song *arr, int lo, int hi, SongComparator cmp)
{
    if (!arr || lo >= hi) return;
    int p = partition(arr, lo, hi, cmp);
    quick_sort(arr, lo,    p - 1, cmp);
    quick_sort(arr, p + 1, hi,    cmp);
}

/* ════════════════════════════════════════════
   BINARY SEARCH (on sorted array by title)
   ════════════════════════════════════════════ */
int binary_search_title(Song *arr, int n, const char *title)
{
    if (!arr || n <= 0 || !title) return -1;
    int lo = 0, hi = n - 1;
    while (lo <= hi) {
        int mid = lo + (hi - lo) / 2;
        int cmp = strcmp(arr[mid].title, title);
        if      (cmp == 0) return mid;   /* found */
        else if (cmp  < 0) lo = mid + 1;
        else               hi = mid - 1;
    }
    return -1;   /* not found */
}

/* ════════════════════════════════════════════
   CONVENIENCE WRAPPERS
   ════════════════════════════════════════════ */
void sort_by_title(Song  *arr, int n) { merge_sort(arr, n, song_compare_title);  }
void sort_by_artist(Song *arr, int n) { merge_sort(arr, n, song_compare_artist); }
void sort_by_plays(Song  *arr, int n) { merge_sort(arr, n, song_compare_plays);  }
void sort_by_rating(Song *arr, int n) { merge_sort(arr, n, song_compare_rating); }

/* ── Convert library DLL to flat array ───────── */
int lib_to_array(void *lib_ptr, Song **out)
{
    /* A missing output pointer is a caller error; avoid dereferencing it. */
    if (!out) return 0;
    *out = NULL;
    Library *lib = (Library *)lib_ptr;
    if (!lib || lib->size == 0) return 0;

    *out = (Song *)malloc(lib->size * sizeof(Song));
    if (!*out) { perror("lib_to_array"); return 0; }

    LibNode *cur = lib->head;
    int i = 0;
    while (cur && i < lib->size) {
        (*out)[i++] = cur->song;
        cur = cur->next;
    }
    return i;
}
