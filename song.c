/*
 * song.c — Song Utilities
 * Music Management System (C + DSA)
 */

#include <stdio.h>
#include <string.h>
#include "song.h"

/* ── Create a song ───────────────────────────── */
Song song_create(int id, const char *title, const char *artist,
                 const char *album,  const char *genre,
                 float duration, float rating)
{
    Song s;
    s.id         = id;
    s.play_count = 0;
    s.duration   = duration;
    s.rating     = (rating < 1.0f) ? 1.0f : (rating > 5.0f) ? 5.0f : rating;
    strncpy(s.title,  title,  MAX_TITLE  - 1); s.title[MAX_TITLE-1]   = '\0';
    strncpy(s.artist, artist, MAX_ARTIST - 1); s.artist[MAX_ARTIST-1] = '\0';
    strncpy(s.album,  album,  MAX_ALBUM  - 1); s.album[MAX_ALBUM-1]   = '\0';
    strncpy(s.genre,  genre,  MAX_GENRE  - 1); s.genre[MAX_GENRE-1]   = '\0';
    return s;
}

/* ── Print a single song row ─────────────────── */
void song_print(const Song *s)
{
    int min = (int)s->duration;
    int sec = (int)((s->duration - min) * 60);
    printf("  [%3d] %-28s %-22s %-16s %-10s %d:%02d  x%-4d  %.1f★\n",
           s->id, s->title, s->artist, s->album,
           s->genre, min, sec, s->play_count, s->rating);
}

/* ── Table header ────────────────────────────── */
void song_print_header(void)
{
    printf("\n  %-5s %-28s %-22s %-16s %-10s %-6s %-6s %s\n",
           "ID", "Title", "Artist", "Album", "Genre",
           "Time", "Plays", "Rating");
    printf("  %s\n",
           "-----------------------------------------------------------------------"
           "-------------------");
}

/* ── Comparators ─────────────────────────────── */
int song_compare_title(const Song *a, const Song *b)
{
    return strcmp(a->title, b->title);
}

int song_compare_artist(const Song *a, const Song *b)
{
    return strcmp(a->artist, b->artist);
}

int song_compare_plays(const Song *a, const Song *b)
{
    return b->play_count - a->play_count;   /* descending */
}

int song_compare_rating(const Song *a, const Song *b)
{
    if (b->rating > a->rating) return  1;
    if (b->rating < a->rating) return -1;
    return 0;
}
