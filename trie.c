/*
 * trie.c — Trie Prefix Autocomplete Implementation
 * Dhun Music Management System (C + DSA)
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <ctype.h>
#include "trie.h"

static TrieNode *trie_create_node(void) {
    TrieNode *node = (TrieNode *)calloc(1, sizeof(TrieNode));
    return node;
}

Trie *trie_create(void) {
    Trie *trie = (Trie *)malloc(sizeof(Trie));
    if (!trie) return NULL;
    trie->root = trie_create_node();
    trie->word_count = 0;
    return trie;
}

static void trie_destroy_node(TrieNode *node) {
    if (!node) return;
    for (int i = 0; i < TRIE_ALPHABET; i++) {
        if (node->children[i]) {
            trie_destroy_node(node->children[i]);
        }
    }
    free(node);
}

void trie_destroy(Trie *trie) {
    if (!trie) return;
    trie_destroy_node(trie->root);
    free(trie);
}

void trie_insert(Trie *trie, const char *word, int song_id, const char *title) {
    if (!trie || !word || !word[0]) return;

    TrieNode *curr = trie->root;
    for (int i = 0; word[i]; i++) {
        unsigned char c = (unsigned char)tolower((unsigned char)word[i]);
        if (c >= TRIE_ALPHABET) c = ' ';
        if (!curr->children[c]) {
            curr->children[c] = trie_create_node();
        }
        curr = curr->children[c];
    }
    curr->is_end_of_word = 1;
    curr->song_id = song_id;
    if (title) {
        strncpy(curr->title, title, sizeof(curr->title) - 1);
        curr->title[sizeof(curr->title) - 1] = '\0';
    }
    trie->word_count++;
}

static void collect_suggestions(TrieNode *node, int out_ids[], char out_titles[][128], int max_results, int *count) {
    if (!node || *count >= max_results) return;

    if (node->is_end_of_word) {
        out_ids[*count] = node->song_id;
        strncpy(out_titles[*count], node->title, 127);
        out_titles[*count][127] = '\0';
        (*count)++;
    }

    for (int i = 0; i < TRIE_ALPHABET; i++) {
        if (node->children[i] && *count < max_results) {
            collect_suggestions(node->children[i], out_ids, out_titles, max_results, count);
        }
    }
}

int trie_autocomplete(const Trie *trie, const char *prefix, int out_ids[], char out_titles[][128], int max_results) {
    if (!trie || !prefix) return 0;

    TrieNode *curr = trie->root;
    for (int i = 0; prefix[i]; i++) {
        unsigned char c = (unsigned char)tolower((unsigned char)prefix[i]);
        if (c >= TRIE_ALPHABET) c = ' ';
        if (!curr->children[c]) return 0;
        curr = curr->children[c];
    }

    int count = 0;
    collect_suggestions(curr, out_ids, out_titles, max_results, &count);
    return count;
}
