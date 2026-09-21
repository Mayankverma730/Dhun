/*
 * sort.h — Sorting Algorithms (Merge Sort + Quick Sort)
 * Music Management System (C + DSA)
 *
 * DSA:
 *   Merge Sort — O(n log n) guaranteed, stable
 *   Quick Sort — O(n log n) avg, O(n²) worst, in-place
 *
 * Sort keys: title, artist, duration, play_count, rating
 */

#ifndef SORT_H
#define SORT_H

#include "song.h"

typedef int (*SongComparator)(const Song *, const Song *);

/* ── Merge Sort — O(n log n) stable ─────────── */
void merge_sort(Song *arr, int n, SongComparator cmp);

/* ── Quick Sort — O(n log n) avg, in-place ──── */
void quick_sort(Song *arr, int lo, int hi, SongComparator cmp);

/* ── Binary Search on sorted array — O(log n) ─ */
int  binary_search_title(Song *arr, int n, const char *title);

/* ── Convenience wrappers ────────────────────── */
void sort_by_title(Song *arr, int n);
void sort_by_artist(Song *arr, int n);
void sort_by_plays(Song *arr, int n);
void sort_by_rating(Song *arr, int n);

/* ── Copy library into flat array for sorting ── */
int  lib_to_array(void *lib, Song **out);   /* returns count */

#endif /* SORT_H */
