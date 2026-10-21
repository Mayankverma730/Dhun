/*
 * cache.h — LRU Cache for Frequently Accessed Songs
 * Dhun Music Management System (C + DSA)
 */

#ifndef CACHE_H
#define CACHE_H

#include "song.h"

#define LRU_CACHE_CAPACITY 64

typedef struct CacheEntry {
    int song_id;
    Song song;
    struct CacheEntry *prev;      /* DLL prev (LRU order) */
    struct CacheEntry *next;      /* DLL next (LRU order) */
    struct CacheEntry *hash_next; /* Hash-map bucket chain — SEPARATE from DLL */
} CacheEntry;

typedef struct {
    int capacity;
    int size;
    CacheEntry *head; /* Most recently used */
    CacheEntry *tail; /* Least recently used */
    CacheEntry *hash_map[128]; /* Bucket array for O(1) key lookup */
} LRUCache;

LRUCache   *cache_create(int capacity);
void        cache_destroy(LRUCache *cache);
Song       *cache_get(LRUCache *cache, int song_id);
void        cache_put(LRUCache *cache, int song_id, Song song);
void        cache_remove(LRUCache *cache, int song_id);
int         cache_size(const LRUCache *cache);

#endif /* CACHE_H */
