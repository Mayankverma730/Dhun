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

/* Merge two sorted halves into arr[lo..hi] */
static void merge(Song *arr, int lo, int mid, int hi, SongComparator cmp)
{
    int  left_size  = mid - lo + 1;
    int  right_size = hi - mid;

    /* Allocate temp arrays */
    Song *L = (Song *)malloc(left_size  * sizeof(Song));
    Song *R = (Song *)malloc(right_size * sizeof(Song));
    if (!L || !R) { free(L); free(R); return; }

    for (int i = 0; i < left_size;  i++) L[i] = arr[lo  + i];
    for (int j = 0; j < right_size; j++) R[j] = arr[mid + 1 + j];

    int i = 0, j = 0, k = lo;
    while (i < left_size && j < right_size) {
        if (cmp(&L[i], &R[j]) <= 0) arr[k++] = L[i++];
        else                         arr[k++] = R[j++];
    }
    while (i < left_size)  arr[k++] = L[i++];
    while (j < right_size) arr[k++] = R[j++];

    free(L);
    free(R);
}

static void merge_sort_rec(Song *arr, int lo, int hi, SongComparator cmp)
{
    if (lo >= hi) return;
    int mid = lo + (hi - lo) / 2;
    merge_sort_rec(arr, lo,      mid, cmp);
    merge_sort_rec(arr, mid + 1, hi,  cmp);
    merge(arr, lo, mid, hi, cmp);
}

void merge_sort(Song *arr, int n, SongComparator cmp)
{
    if (!arr || n <= 1) return;
    merge_sort_rec(arr, 0, n - 1, cmp);
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
    Library *lib = (Library *)lib_ptr;
    if (!lib || lib->size == 0) { *out = NULL; return 0; }

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
