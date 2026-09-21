/*
 * hash.h — Song Lookup Table (Hash Table)
 * Music Management System (C + DSA)
 *
 * DSA: Hash Table with chaining (separate chaining using linked lists)
 *   - Key:    Song ID (integer)
 *   - Value:  Song pointer
 *   - Insert: O(1) average
 *   - Lookup: O(1) average
 *   - Delete: O(1) average
 *   - Collision resolution: chaining (linked list per bucket)
 */

#ifndef HASH_H
#define HASH_H

#include "song.h"

#define HASH_TABLE_SIZE 101   /* prime number reduces collisions */

/* ── Chain node ──────────────────────────────── */
typedef struct HashNode {
    Song            song;
    struct HashNode *next;   /* next in chain */
} HashNode;

/* ── Hash Table ──────────────────────────────── */
typedef struct HashTable {
    HashNode *buckets[HASH_TABLE_SIZE];
    int       count;
} HashTable;

/* ── API ─────────────────────────────────────── */
HashTable *hash_create(void);
void       hash_destroy(HashTable *ht);

int        hash_insert(HashTable *ht, Song song);      /* O(1) avg */
Song      *hash_lookup(HashTable *ht, int id);         /* O(1) avg */
int        hash_delete(HashTable *ht, int id);         /* O(1) avg */
void       hash_update_plays(HashTable *ht, int id);   /* increment play count */

void       hash_display_table(const HashTable *ht);    /* show bucket usage */
float      hash_load_factor(const HashTable *ht);

#endif /* HASH_H */
