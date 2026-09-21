/*
 * hash.c — Song Lookup Table (Hash Table with Chaining)
 * Music Management System (C + DSA)
 *
 * ┌──────────────────────────────────────────────────────────────┐
 * │ HASH TABLE — separate chaining                               │
 * │                                                              │
 * │  hash(id) = id % TABLE_SIZE                                  │
 * │                                                              │
 * │  Bucket 0: [Song(id=101)] → [Song(id=202)] → NULL           │
 * │  Bucket 1: [Song(id=1)]   → NULL                            │
 * │  Bucket 2: NULL                                              │
 * │  Bucket 3: [Song(id=3)]   → [Song(id=104)] → NULL           │
 * │  ...                                                         │
 * │                                                              │
 * │  Avg load factor kept < 0.75 for good performance           │
 * └──────────────────────────────────────────────────────────────┘
 */

#include <stdio.h>
#include <stdlib.h>
#include "hash.h"

/* ── Hash function ─────────────────────────────
 * Simple modulo — good for integer keys.
 * Using prime table size (101) reduces clustering. */
static int hash_fn(int id)
{
    return ((id % HASH_TABLE_SIZE) + HASH_TABLE_SIZE) % HASH_TABLE_SIZE;
}

/* ── Create ──────────────────────────────────── */
HashTable *hash_create(void)
{
    HashTable *ht = (HashTable *)calloc(1, sizeof(HashTable));
    if (!ht) { perror("hash_create"); return NULL; }
    /* calloc already zeros buckets to NULL */
    ht->count = 0;
    return ht;
}

/* ── Destroy ─────────────────────────────────── */
void hash_destroy(HashTable *ht)
{
    if (!ht) return;
    for (int i = 0; i < HASH_TABLE_SIZE; i++) {
        HashNode *cur = ht->buckets[i];
        while (cur) {
            HashNode *nxt = cur->next;
            free(cur);
            cur = nxt;
        }
    }
    free(ht);
}

/* ── Insert — O(1) avg ───────────────────────── */
int hash_insert(HashTable *ht, Song song)
{
    if (!ht) return 0;
    int idx = hash_fn(song.id);

    /* Check if ID already exists — update if so */
    HashNode *cur = ht->buckets[idx];
    while (cur) {
        if (cur->song.id == song.id) { cur->song = song; return 1; }
        cur = cur->next;
    }

    /* New node — prepend to chain (O(1)) */
    HashNode *node = (HashNode *)malloc(sizeof(HashNode));
    if (!node) { perror("hash_insert"); return 0; }
    node->song          = song;
    node->next          = ht->buckets[idx];
    ht->buckets[idx]    = node;
    ht->count++;
    return 1;
}

/* ── Lookup — O(1) avg ───────────────────────── */
Song *hash_lookup(HashTable *ht, int id)
{
    if (!ht) return NULL;
    int idx = hash_fn(id);
    HashNode *cur = ht->buckets[idx];
    while (cur) {
        if (cur->song.id == id) return &cur->song;
        cur = cur->next;
    }
    return NULL;
}

/* ── Delete — O(1) avg ───────────────────────── */
int hash_delete(HashTable *ht, int id)
{
    if (!ht) return 0;
    int idx = hash_fn(id);
    HashNode *cur  = ht->buckets[idx];
    HashNode *prev = NULL;
    while (cur) {
        if (cur->song.id == id) {
            if (prev) prev->next        = cur->next;
            else      ht->buckets[idx]  = cur->next;
            free(cur);
            ht->count--;
            return 1;
        }
        prev = cur;
        cur  = cur->next;
    }
    return 0;
}

/* ── Increment play count — O(1) avg ─────────── */
void hash_update_plays(HashTable *ht, int id)
{
    Song *s = hash_lookup(ht, id);
    if (s) s->play_count++;
}

/* ── Display bucket usage ─────────────────────── */
void hash_display_table(const HashTable *ht)
{
    if (!ht) return;
    printf("\n  [Hash Table — Bucket Usage]\n");
    printf("  Table size: %d  |  Songs stored: %d  |  Load factor: %.2f\n\n",
           HASH_TABLE_SIZE, ht->count, hash_load_factor(ht));
    int used = 0;
    for (int i = 0; i < HASH_TABLE_SIZE; i++) {
        if (ht->buckets[i]) {
            used++;
            printf("  Bucket[%3d]: ", i);
            HashNode *cur = ht->buckets[i];
            while (cur) {
                printf("→ [ID:%d \"%s\"] ", cur->song.id, cur->song.title);
                cur = cur->next;
            }
            printf("→ NULL\n");
        }
    }
    printf("\n  %d / %d buckets used\n\n", used, HASH_TABLE_SIZE);
}

/* ── Load factor ──────────────────────────────── */
float hash_load_factor(const HashTable *ht)
{
    return ht ? (float)ht->count / HASH_TABLE_SIZE : 0.0f;
}
