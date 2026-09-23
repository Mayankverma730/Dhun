/*
 * cache.c — LRU Cache Implementation (Doubly Linked List + Hash Table)
 * Dhun Music Management System (C + DSA)
 */

#include <stdio.h>
#include <stdlib.h>
#include "cache.h"

static int hash_id(int id) {
    return ((id % 128) + 128) % 128;
}

LRUCache *cache_create(int capacity) {
    if (capacity <= 0) capacity = LRU_CACHE_CAPACITY;
    LRUCache *c = (LRUCache *)calloc(1, sizeof(LRUCache));
    if (!c) return NULL;
    c->capacity = capacity;
    return c;
}

void cache_destroy(LRUCache *cache) {
    if (!cache) return;
    CacheEntry *cur = cache->head;
    while (cur) {
        CacheEntry *nxt = cur->next;
        free(cur);
        cur = nxt;
    }
    free(cache);
}

static void move_to_front(LRUCache *cache, CacheEntry *entry) {
    if (cache->head == entry) return;

    /* Detach */
    if (entry->prev) entry->prev->next = entry->next;
    if (entry->next) entry->next->prev = entry->prev;
    if (cache->tail == entry) cache->tail = entry->prev;

    /* Attach to head */
    entry->prev = NULL;
    entry->next = cache->head;
    if (cache->head) cache->head->prev = entry;
    cache->head = entry;
    if (!cache->tail) cache->tail = entry;
}

Song *cache_get(LRUCache *cache, int song_id) {
    if (!cache) return NULL;
    int bucket = hash_id(song_id);
    CacheEntry *cur = cache->hash_map[bucket];
    while (cur) {
        if (cur->song_id == song_id) {
            move_to_front(cache, cur);
            return &cur->song;
        }
        cur = cur->next;
    }
    return NULL;
}

void cache_put(LRUCache *cache, int song_id, Song song) {
    if (!cache) return;
    int bucket = hash_id(song_id);

    /* Check if already present */
    CacheEntry *cur = cache->hash_map[bucket];
    while (cur) {
        if (cur->song_id == song_id) {
            cur->song = song;
            move_to_front(cache, cur);
            return;
        }
        cur = cur->next;
    }

    /* Evict tail if full */
    if (cache->size >= cache->capacity && cache->tail) {
        CacheEntry *evict = cache->tail;
        int evict_b = hash_id(evict->song_id);

        /* Remove from hash map */
        CacheEntry **hp = &cache->hash_map[evict_b];
        while (*hp) {
            if (*hp == evict) {
                *hp = evict->next;
                break;
            }
            hp = &((*hp)->next);
        }

        /* Remove from tail */
        if (evict->prev) evict->prev->next = NULL;
        cache->tail = evict->prev;
        if (cache->head == evict) cache->head = NULL;
        free(evict);
        cache->size--;
    }

    /* Insert new node at head */
    CacheEntry *n = (CacheEntry *)calloc(1, sizeof(CacheEntry));
    if (!n) return;
    n->song_id = song_id;
    n->song = song;

    n->next = cache->head;
    if (cache->head) cache->head->prev = n;
    cache->head = n;
    if (!cache->tail) cache->tail = n;

    /* Add to hash map */
    n->next = cache->hash_map[bucket];
    cache->hash_map[bucket] = n;
    cache->size++;
}

int cache_size(const LRUCache *cache) {
    return cache ? cache->size : 0;
}
