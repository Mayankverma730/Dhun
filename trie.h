/*
 * trie.h — Trie for Prefix Autocomplete Search
 * Dhun Music Management System (C + DSA)
 */

#ifndef TRIE_H
#define TRIE_H

#define TRIE_ALPHABET 128
#define TRIE_MAX_RESULTS 20

typedef struct TrieNode {
    struct TrieNode *children[TRIE_ALPHABET];
    int is_end_of_word;
    int song_id;
    char title[128];
} TrieNode;

typedef struct {
    TrieNode *root;
    int word_count;
} Trie;

Trie *trie_create(void);
void  trie_destroy(Trie *trie);
void  trie_insert(Trie *trie, const char *word, int song_id, const char *title);
int   trie_autocomplete(const Trie *trie, const char *prefix, int out_ids[], char out_titles[][128], int max_results);

#endif /* TRIE_H */
