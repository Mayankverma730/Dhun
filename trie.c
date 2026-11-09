/*
 * trie.c — Trie Prefix Autocomplete Implementation
 * Dhun Music Management System (C + DSA)
 *
 * Fix N-H-01: collect_suggestions converted from recursive DFS to iterative
 * using an explicit stack to prevent stack overflow on long song titles.
 *
 * Fix N-L-01: Non-ASCII characters (c >= 128) are now mapped to index 0
 * (a reserved "other" bucket) instead of being silently aliased to space
 * (ASCII 32), preventing incorrect autocomplete collisions.
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <ctype.h>
#include "trie.h"

/* Index 0 is reserved for all non-ASCII / out-of-range characters.
 * Valid ASCII printable chars occupy indices 1..127. */
#define TRIE_VALID_INDEX(c) (((unsigned)(c) < TRIE_ALPHABET) ? (unsigned)(c) : 0u)

static TrieNode *trie_create_node(void) {
    TrieNode *node = (TrieNode *)calloc(1, sizeof(TrieNode));
    return node;
}

Trie *trie_create(void) {
    Trie *trie = (Trie *)malloc(sizeof(Trie));
    if (!trie) return NULL;
    trie->root = trie_create_node();
    /* A trie without a root cannot accept inserts or autocomplete requests. */
    if (!trie->root) { free(trie); return NULL; }
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
        /* Fix N-L-01: Use TRIE_VALID_INDEX so non-ASCII maps to index 0,
         * not to a collision with a valid printable character like space. */
        unsigned int c = TRIE_VALID_INDEX((unsigned char)tolower((unsigned char)word[i]));
        if (!curr->children[c]) {
            curr->children[c] = trie_create_node();
            if (!curr->children[c]) return; /* OOM — abort gracefully */
        }
        curr = curr->children[c];
    }
    /* Re-inserting a word updates its song but not the unique-word count. */
    if (!curr->is_end_of_word) trie->word_count++;
    curr->is_end_of_word = 1;
    curr->song_id = song_id;
    if (title) {
        strncpy(curr->title, title, sizeof(curr->title) - 1);
        curr->title[sizeof(curr->title) - 1] = '\0';
    }
}

/* ── Iterative DFS using an explicit stack ────────────────────────────────
 * Fix N-H-01: The recursive version could overflow the C call stack for
 * long song titles (up to MAX_TITLE = 100 chars, branching factor 128).
 * An explicit stack heap-allocated here removes that risk entirely.
 * --------------------------------------------------------------------------*/
typedef struct { TrieNode *node; } DfsFrame;

static void collect_suggestions(TrieNode *root,
                                int       out_ids[],
                                char      out_titles[][128],
                                int       max_results,
                                int      *count)
{
    if (!root || !count || *count >= max_results) return;

    size_t capacity = 128;
    DfsFrame *stack = (DfsFrame *)malloc(capacity * sizeof(*stack));
    if (!stack) return; /* OOM — return what we have so far */

    size_t top = 0;
    stack[top++].node = root;

    while (top > 0 && *count < max_results) {
        TrieNode *node = stack[--top].node;

        if (node->is_end_of_word) {
            out_ids[*count] = node->song_id;
            snprintf(out_titles[*count], 128, "%s", node->title);
            (*count)++;
        }

        /* Push children in reverse order so we explore in alphabetical order */
        for (int i = TRIE_ALPHABET - 1; i >= 0; i--) {
            if (node->children[i]) {
                if (top == capacity) {
                    size_t new_capacity = capacity * 2;
                    DfsFrame *grown = (DfsFrame *)realloc(stack, new_capacity * sizeof(*stack));
                    if (!grown) { free(stack); return; }
                    stack = grown;
                    capacity = new_capacity;
                }
                stack[top++].node = node->children[i];
            }
        }
    }

    free(stack);
}

int trie_autocomplete(const Trie *trie, const char *prefix,
                      int out_ids[], char out_titles[][128], int max_results)
{
    if (!trie || !trie->root || !prefix || !out_ids || !out_titles || max_results <= 0) return 0;

    TrieNode *curr = trie->root;
    for (int i = 0; prefix[i]; i++) {
        /* Fix N-L-01: consistent index mapping with trie_insert */
        unsigned int c = TRIE_VALID_INDEX((unsigned char)tolower((unsigned char)prefix[i]));
        if (!curr->children[c]) return 0;
        curr = curr->children[c];
    }

    int count = 0;
    collect_suggestions(curr, out_ids, out_titles, max_results, &count);
    return count;
}
