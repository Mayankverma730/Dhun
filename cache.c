/*
 * cache.c — LRU Cache Implementation (Doubly Linked List + Hash Table)
 * Dhun Music Management System (C + DSA)
 *
 * Fix H-03: CacheEntry now has TWO separate chain pointers:
 *   next / prev   → doubly-linked list for LRU ordering
 *   hash_next     → singly-linked list for hash-map bucket chaining
 * Previously both used `next`, corrupting the DLL on every cache_put.
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
    /* Traverse the DLL — every live node is reachable from head */
    CacheEntry *cur = cache->head;
    while (cur) {
        CacheEntry *nxt = cur->next; /* DLL next */
        free(cur);
        cur = nxt;
    }
    free(cache);
}

/* ── Move an existing entry to the MRU (head) position ── */
static void move_to_front(LRUCache *cache, CacheEntry *entry) {
    if (cache->head == entry) return;

    /* Detach from current DLL position */
    if (entry->prev) entry->prev->next = entry->next;
    if (entry->next) entry->next->prev = entry->prev;
    if (cache->tail == entry) cache->tail = entry->prev;

    /* Attach at DLL head */
    entry->prev = NULL;
    entry->next = cache->head;
    if (cache->head) cache->head->prev = entry;
    cache->head = entry;
    if (!cache->tail) cache->tail = entry;
}

Song *cache_get(LRUCache *cache, int song_id) {
    if (!cache) return NULL;
    int bucket = hash_id(song_id);
    /* Walk hash-map chain using hash_next */
    CacheEntry *cur = cache->hash_map[bucket];
    while (cur) {
        if (cur->song_id == song_id) {
            move_to_front(cache, cur);
            return &cur->song;
        }
        cur = cur->hash_next; /* hash-map chain, NOT DLL next */
    }
    return NULL;
}

void cache_put(LRUCache *cache, int song_id, Song song) {
    if (!cache) return;
    int bucket = hash_id(song_id);

    /* Check if already present in hash map */
    CacheEntry *cur = cache->hash_map[bucket];
    while (cur) {
        if (cur->song_id == song_id) {
            cur->song = song;
            move_to_front(cache, cur);
            return;
        }
        cur = cur->hash_next;
    }

    /* Evict LRU tail if at capacity */
    if (cache->size >= cache->capacity && cache->tail) {
        CacheEntry *evict = cache->tail;
        int evict_b = hash_id(evict->song_id);

        /* Remove evicted entry from its hash-map bucket chain */
        CacheEntry **hp = &cache->hash_map[evict_b];
        while (*hp) {
            if (*hp == evict) {
                *hp = evict->hash_next; /* unlink via hash_next */
                break;
            }
            hp = &((*hp)->hash_next);
        }

        /* Remove from DLL tail */
        if (evict->prev) evict->prev->next = NULL;
        cache->tail = evict->prev;
        if (cache->head == evict) cache->head = NULL;
        free(evict);
        cache->size--;
    }

    /* Allocate new node */
    CacheEntry *n = (CacheEntry *)calloc(1, sizeof(CacheEntry));
    if (!n) return;
    n->song_id   = song_id;
    n->song      = song;
    n->hash_next = NULL;
    n->prev      = NULL;
    n->next      = NULL;

    /* Insert at DLL head */
    n->next = cache->head;
    if (cache->head) cache->head->prev = n;
    cache->head = n;
    if (!cache->tail) cache->tail = n;

    /* Insert at front of hash-map bucket (uses hash_next, NOT next) */
    n->hash_next = cache->hash_map[bucket];
    cache->hash_map[bucket] = n;

    cache->size++;
}

void cache_remove(LRUCache *cache, int song_id) {
    if (!cache || cache->size == 0) return;
    int bucket = hash_id(song_id);

    /* Unlink from hash-map bucket chain */
    CacheEntry **hp = &cache->hash_map[bucket];
    CacheEntry *target = NULL;
    while (*hp) {
        if ((*hp)->song_id == song_id) {
            target = *hp;
            *hp = target->hash_next;
            break;
        }
        hp = &((*hp)->hash_next);
    }

    if (!target) return;

    /* Detach from doubly linked list */
    if (target->prev) target->prev->next = target->next;
    else cache->head = target->next;

    if (target->next) target->next->prev = target->prev;
    else cache->tail = target->prev;

    free(target);
    cache->size--;
}

int cache_size(const LRUCache *cache) {
    return cache ? cache->size : 0;
}
