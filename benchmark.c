/*
 * benchmark.c — High Precision DSA Benchmarking Tool
 * Dhun Music Management System (C + DSA)
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include "song.h"
#include "bst.h"
#include "avl.h"
#include "hash.h"
#include "trie.h"

#define BENCH_OPERATIONS 2500

static double get_time_sec(void) {
    return (double)clock() / CLOCKS_PER_SEC;
}

int main(void) {
    printf("\n╔════════════════════════════════════════════════════════════╗\n");
    printf("║   DHUN DSA BENCHMARK — %d Operations per Structure      ║\n", BENCH_OPERATIONS);
    printf("╚════════════════════════════════════════════════════════════╝\n\n");

    /* 1. BST Benchmark */
    {
        BST *bst = bst_create();
        double start = get_time_sec();
        for (int i = 0; i < BENCH_OPERATIONS; i++) {
            char title[32];
            int key = (i * 997) % BENCH_OPERATIONS;
            snprintf(title, sizeof(title), "Track_%05d", key);
            Song s = {key + 1, "", "Artist", "Album", "Pop", 3.2f, 10, 4.5f};
            strncpy(s.title, title, sizeof(s.title) - 1);
            bst_insert(bst, s);
        }
        double insert_time = get_time_sec() - start;

        start = get_time_sec();
        for (int i = 0; i < BENCH_OPERATIONS; i++) {
            char title[32];
            int key = (i * 997) % BENCH_OPERATIONS;
            snprintf(title, sizeof(title), "Track_%05d", key);
            bst_search(bst, title);
        }
        double search_time = get_time_sec() - start;
        printf("  [BST]         Insert: %7.4f s  |  Search: %7.4f s\n", insert_time, search_time);
        bst_destroy(bst);
    }

    /* 2. AVL Tree Benchmark */
    {
        AVLTree *avl = avl_create();
        double start = get_time_sec();
        for (int i = 0; i < BENCH_OPERATIONS; i++) {
            char title[32];
            int key = (i * 997) % BENCH_OPERATIONS;
            snprintf(title, sizeof(title), "Track_%05d", key);
            Song s = {key + 1, "", "Artist", "Album", "Pop", 3.2f, 10, 4.5f};
            strncpy(s.title, title, sizeof(s.title) - 1);
            avl_insert(avl, s);
        }
        double insert_time = get_time_sec() - start;

        start = get_time_sec();
        for (int i = 0; i < BENCH_OPERATIONS; i++) {
            char title[32];
            int key = (i * 997) % BENCH_OPERATIONS;
            snprintf(title, sizeof(title), "Track_%05d", key);
            avl_search(avl, title);
        }
        double search_time = get_time_sec() - start;
        printf("  [AVL Tree]    Insert: %7.4f s  |  Search: %7.4f s (Auto-balanced)\n", insert_time, search_time);
        avl_destroy(avl);
    }

    /* 3. Hash Table Benchmark */
    {
        HashTable *ht = hash_create();
        double start = get_time_sec();
        for (int i = 0; i < BENCH_OPERATIONS; i++) {
            Song s = {i + 1, "BenchSong", "Artist", "Album", "Rock", 3.0f, 15, 4.0f};
            hash_insert(ht, s);
        }
        double insert_time = get_time_sec() - start;

        start = get_time_sec();
        for (int i = 0; i < BENCH_OPERATIONS; i++) {
            int target_id = ((i * 37) % BENCH_OPERATIONS) + 1;
            hash_lookup(ht, target_id);
        }
        double search_time = get_time_sec() - start;
        printf("  [Hash Table]  Insert: %7.4f s  |  Search: %7.4f s (O(1) MurmurHash3)\n", insert_time, search_time);
        hash_destroy(ht);
    }

    /* 4. Trie Autocomplete Benchmark */
    {
        Trie *trie = trie_create();
        double start = get_time_sec();
        for (int i = 0; i < BENCH_OPERATIONS; i++) {
            char title[32];
            snprintf(title, sizeof(title), "song_%05d", i);
            trie_insert(trie, title, i + 1, title);
        }
        double insert_time = get_time_sec() - start;

        start = get_time_sec();
        int dummy_ids[10];
        char dummy_titles[10][128];
        for (int i = 0; i < BENCH_OPERATIONS; i++) {
            trie_autocomplete(trie, "song_0", dummy_ids, dummy_titles, 10);
        }
        double search_time = get_time_sec() - start;
        printf("  [Trie Prefix] Insert: %7.4f s  |  Prefix Search: %7.4f s (O(prefix))\n", insert_time, search_time);
        trie_destroy(trie);
    }

    printf("\n  ✓ Benchmark successfully completed.\n\n");
    return 0;
}
