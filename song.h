/*
 * song.h — Song Structure Definition
 * Music Management System (C + DSA)
 *
 * Every data structure in this project operates
 * on the Song struct defined here.
 */

#ifndef SONG_H
#define SONG_H

#define MAX_TITLE    100
#define MAX_ARTIST   100
#define MAX_ALBUM    100
#define MAX_GENRE     50

/* ── Core Song Record ─────────────────────────── */
typedef struct Song {
    int   id;                    /* Unique song ID (used as hash key) */
    char  title[MAX_TITLE];
    char  artist[MAX_ARTIST];
    char  album[MAX_ALBUM];
    char  genre[MAX_GENRE];
    float duration;              /* Duration in minutes (e.g. 3.5 = 3m 30s) */
    int   play_count;            /* How many times played */
    float rating;                /* User rating: 1.0 – 5.0 */
} Song;

/* ── Utility ──────────────────────────────────── */
Song  song_create(int id, const char *title, const char *artist,
                  const char *album,  const char *genre,
                  float duration, float rating);
void  song_print(const Song *s);
void  song_print_header(void);
int   song_compare_title(const Song *a, const Song *b);
int   song_compare_artist(const Song *a, const Song *b);
int   song_compare_plays(const Song *a, const Song *b);
int   song_compare_rating(const Song *a, const Song *b);

#endif /* SONG_H */
