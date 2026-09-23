/*
 * test_dsa.c — Comprehensive DSA Verification Suite
 * Dhun Music Management System (C + DSA)
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <assert.h>
#include "song.h"
#include "library.h"
#include "stack.h"
#include "queue.h"
#include "bst.h"
#include "heap.h"
#include "hash.h"
#include "avl.h"
#include "trie.h"
#include "graph.h"
#include "cache.h"

static int g_tests_passed = 0;
static int g_tests_total = 0;

#define TEST_ASSERT(cond, msg) do { \
    g_tests_total++; \
    if (cond) { \
        g_tests_passed++; \
        printf("  [PASS] %s\n", msg); \
    } else { \
        printf("  [FAIL] %s (Line %d)\n", msg, __LINE__); \
    } \
} while(0)

static void test_bst(void) {
    printf("\n=== Testing Binary Search Tree (BST) ===\n");
    BST *bst = bst_create();
    Song s1 = {1, "Believer", "Imagine Dragons", "Evolve", "Rock", 3.4f, 100, 4.8f};
    Song s2 = {2, "Astronaut", "Masked Wolf", "Single", "HipHop", 2.2f, 80, 4.2f};
    Song s3 = {3, "Closer", "Chainsmokers", "Collage", "Pop", 4.1f, 150, 4.5f};

    bst_insert(bst, s1);
    bst_insert(bst, s2);
    bst_insert(bst, s3);
    TEST_ASSERT(bst->size == 3, "BST size matches inserted count");

    BSTNode *found = bst_search(bst, "Believer");
    TEST_ASSERT(found && found->song.id == 1, "BST exact search by title");

    BSTNode *notFound = bst_search(bst, "NonExistentSong");
    TEST_ASSERT(notFound == NULL, "BST returns NULL for missing song");

    bst_delete(bst, "Astronaut");
    TEST_ASSERT(bst->size == 2, "BST delete decrements count");
    TEST_ASSERT(bst_search(bst, "Astronaut") == NULL, "BST deleted song no longer retrievable");

    bst_destroy(bst);
}

static void test_hash_table(void) {
    printf("\n=== Testing Hash Table with MurmurHash3 ===\n");
    HashTable *ht = hash_create();
    Song s1 = {10, "Starboy", "The Weeknd", "Starboy", "R&B", 3.8f, 50, 4.9f};
    Song s2 = {20, "Blinding Lights", "The Weeknd", "After Hours", "Synthwave", 3.3f, 300, 5.0f};

    hash_insert(ht, s1);
    hash_insert(ht, s2);
    TEST_ASSERT(ht->count == 2, "Hash table stores 2 entries");

    Song *lk = hash_lookup(ht, 10);
    TEST_ASSERT(lk && strcmp(lk->title, "Starboy") == 0, "Hash lookup by ID returns correct song");

    hash_update_plays(ht, 10);
    Song *lk2 = hash_lookup(ht, 10);
    TEST_ASSERT(lk2 && lk2->play_count == 51, "Hash table updates play count in place");

    hash_delete(ht, 20);
    TEST_ASSERT(hash_lookup(ht, 20) == NULL, "Hash table successfully deletes song ID");

    hash_destroy(ht);
}

static void test_heap(void) {
    printf("\n=== Testing Max-Heap for Charts ===\n");
    Heap *hp = heap_create(HEAP_BY_PLAYS);
    Song s1 = {1, "Song Low", "Artist A", "Alb", "Pop", 3.0f, 10, 4.0f};
    Song s2 = {2, "Song High", "Artist B", "Alb", "Pop", 3.0f, 500, 4.5f};
    Song s3 = {3, "Song Mid", "Artist C", "Alb", "Pop", 3.0f, 100, 4.2f};

    heap_insert(hp, s1);
    heap_insert(hp, s2);
    heap_insert(hp, s3);

    Song top;
    int ok1 = heap_extract_max(hp, &top);
    TEST_ASSERT(ok1 && top.id == 2 && top.play_count == 500, "Heap extracts highest play count first");

    Song next;
    int ok2 = heap_extract_max(hp, &next);
    TEST_ASSERT(ok2 && next.id == 3 && next.play_count == 100, "Heap extracts second highest next");

    heap_destroy(hp);
}

static void test_queue_and_stack(void) {
    printf("\n=== Testing Queue and History Stack ===\n");
    Queue *q = queue_create();
    Song s1 = {1, "Track 1", "Artist", "Alb", "Pop", 3.0f, 0, 4.0f};
    Song s2 = {2, "Track 2", "Artist", "Alb", "Pop", 3.0f, 0, 4.0f};

    queue_enqueue(q, s1);
    queue_enqueue(q, s2);
    TEST_ASSERT(queue_size(q) == 2, "Queue size is 2 after enqueues");

    Song out;
    int ok = queue_dequeue(q, &out);
    TEST_ASSERT(ok && out.id == 1, "Queue FIFO dequeue order verified");
    queue_destroy(q);

    Stack *st = stack_create();
    stack_push(st, s1);
    stack_push(st, s2);
    TEST_ASSERT(stack_size(st) == 2, "Stack size is 2 after pushes");

    Song popped;
    int pop_ok = stack_pop(st, &popped);
    TEST_ASSERT(pop_ok && popped.id == 2, "Stack LIFO pop order verified");
    stack_destroy(st);
}

static void test_avl_tree(void) {
    printf("\n=== Testing AVL Self-Balancing Tree ===\n");
    AVLTree *avl = avl_create();
    /* Insert in alphabetical ascending order to trigger rotations */
    Song s1 = {1, "A Song", "Artist", "Alb", "Pop", 3.0f, 10, 4.0f};
    Song s2 = {2, "B Song", "Artist", "Alb", "Pop", 3.0f, 20, 4.0f};
    Song s3 = {3, "C Song", "Artist", "Alb", "Pop", 3.0f, 30, 4.0f};
    Song s4 = {4, "D Song", "Artist", "Alb", "Pop", 3.0f, 40, 4.0f};
    Song s5 = {5, "E Song", "Artist", "Alb", "Pop", 3.0f, 50, 4.0f};

    avl_insert(avl, s1);
    avl_insert(avl, s2);
    avl_insert(avl, s3);
    avl_insert(avl, s4);
    avl_insert(avl, s5);

    TEST_ASSERT(avl_size(avl) == 5, "AVL tree contains 5 items");
    /* An unbalanced BST would have height 5; balanced AVL has height <= 3 */
    int h = avl_height(avl->root);
    TEST_ASSERT(h <= 3, "AVL tree automatically maintained balance height <= 3");

    AVLNode *found = avl_search(avl, "C Song");
    TEST_ASSERT(found && found->song.id == 3, "AVL fast logarithmic search finds item");

    avl_delete(avl, "C Song");
    TEST_ASSERT(avl_size(avl) == 4, "AVL delete updates size");
    TEST_ASSERT(avl_search(avl, "C Song") == NULL, "AVL deleted node no longer exists");

    avl_destroy(avl);
}

static void test_trie_autocomplete(void) {
    printf("\n=== Testing Trie Prefix Autocomplete ===\n");
    Trie *trie = trie_create();
    trie_insert(trie, "shape of you", 101, "Shape of You");
    trie_insert(trie, "shivers", 102, "Shivers");
    trie_insert(trie, "photograph", 103, "Photograph");
    trie_insert(trie, "perfect", 104, "Perfect");

    int out_ids[10];
    char out_titles[10][128];
    int count = trie_autocomplete(trie, "shi", out_ids, out_titles, 10);
    TEST_ASSERT(count == 1 && out_ids[0] == 102, "Trie matches prefix 'shi' to Shivers");

    count = trie_autocomplete(trie, "p", out_ids, out_titles, 10);
    TEST_ASSERT(count == 2, "Trie matches prefix 'p' to 2 songs (Photograph, Perfect)");

    trie_destroy(trie);
}

static void test_song_graph(void) {
    printf("\n=== Testing Song Similarity Graph ===\n");
    SongGraph *g = graph_create();
    Song s1 = {1, "Levitating", "Dua Lipa", "Future Nostalgia", "Pop", 3.5f, 100, 4.8f};
    Song s2 = {2, "Don't Start Now", "Dua Lipa", "Future Nostalgia", "Pop", 3.1f, 120, 4.9f};
    Song s3 = {3, "Physical", "Dua Lipa", "Future Nostalgia", "Pop", 3.3f, 90, 4.7f};
    Song s4 = {4, "Master of Puppets", "Metallica", "Puppets", "Metal", 8.5f, 80, 4.9f};

    graph_add_song(g, &s1);
    graph_add_song(g, &s2);
    graph_add_song(g, &s3);
    graph_add_song(g, &s4);

    int similar_ids[5];
    float scores[5];
    int count = graph_get_similar(g, 1, similar_ids, scores, 5);
    TEST_ASSERT(count >= 2, "Graph identifies recommendations based on artist/genre edge weights");
    TEST_ASSERT(similar_ids[0] == 2 || similar_ids[0] == 3, "Top recommendation shares artist Dua Lipa");

    graph_destroy(g);
}

static void test_lru_cache(void) {
    printf("\n=== Testing LRU Cache (Capacity = 2) ===\n");
    LRUCache *cache = cache_create(2);
    Song s1 = {1, "Song 1", "Artist", "Alb", "Pop", 3.0f, 0, 4.0f};
    Song s2 = {2, "Song 2", "Artist", "Alb", "Pop", 3.0f, 0, 4.0f};
    Song s3 = {3, "Song 3", "Artist", "Alb", "Pop", 3.0f, 0, 4.0f};

    cache_put(cache, 1, s1);
    cache_put(cache, 2, s2);
    TEST_ASSERT(cache_size(cache) == 2, "Cache size is 2 after two puts");

    /* Access Song 1 so Song 2 becomes Least Recently Used */
    Song *got = cache_get(cache, 1);
    TEST_ASSERT(got && got->id == 1, "Cache hit for Song 1");

    /* Put Song 3 -> should evict Song 2 */
    cache_put(cache, 3, s3);
    TEST_ASSERT(cache_get(cache, 2) == NULL, "LRU evicted Song 2 when capacity was exceeded");
    TEST_ASSERT(cache_get(cache, 1) != NULL, "Song 1 remains cached because it was recently used");
    TEST_ASSERT(cache_get(cache, 3) != NULL, "Newly added Song 3 is present in cache");

    cache_destroy(cache);
}

int main(void) {
    printf("\n========================================\n");
    printf("  DHUN DSA VALIDATION & TEST SUITE\n");
    printf("========================================\n");

    test_bst();
    test_hash_table();
    test_heap();
    test_queue_and_stack();
    test_avl_tree();
    test_trie_autocomplete();
    test_song_graph();
    test_lru_cache();

    printf("\n========================================\n");
    printf("  RESULTS: %d / %d TESTS PASSED\n", g_tests_passed, g_tests_total);
    printf("========================================\n\n");

    return (g_tests_passed == g_tests_total) ? 0 : 1;
}
