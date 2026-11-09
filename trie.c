/*
 * trie.c — Trie Prefix Autocomplete Implementation
 * Dhun Music Management System (C + DSA)
 *
 * Fix N-H-01: collect_suggestions converted from recursive DFS to iterative
 * using an explicit stack to prevent stack overflow on long song titles.
 *
 * Fix N-L-01: Non-ASCII bytes use a reserved bucket and candidates are checked
 * against their original title to avoid collisions with other Unicode titles.
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

/* The compact trie shares one bucket for non-ASCII UTF-8 bytes; filter hits
 * against their original title so distinct Unicode prefixes never cross-match. */
static int title_has_prefix(const char *title, const char *prefix) {
    if (!title || !prefix) return 0;
    while (*prefix) {
        unsigned char a = (unsigned char)*title++;
        unsigned char b = (unsigned char)*prefix++;
        if (!a) return 0;
        if (a < 128 && b < 128) {
            if (tolower(a) != tolower(b)) return 0;
        } else if (a != b) return 0;
    }
    return 1;
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
    TrieSong *song = node->songs;
    while (song) {
        TrieSong *next = song->next;
        free(song);
        song = next;
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
    for (TrieSong *entry = curr->songs; entry; entry = entry->next) {
        if (entry->song_id == song_id) {
            snprintf(entry->title, sizeof(entry->title), "%s", title ? title : word);
            return;
        }
    }
    TrieSong *entry = (TrieSong *)calloc(1, sizeof(*entry));
    if (!entry) return;
    entry->song_id = song_id;
    snprintf(entry->title, sizeof(entry->title), "%s", title ? title : word);
    entry->next = curr->songs;
    if (!curr->songs) trie->word_count++;
    curr->songs = entry;
}

int trie_delete(Trie *trie, const char *word, int song_id) {
    if (!trie || !trie->root || !word || !word[0]) return 0;
    TrieNode *curr = trie->root;
    for (int i = 0; word[i]; i++) {
        unsigned int c = TRIE_VALID_INDEX((unsigned char)tolower((unsigned char)word[i]));
        if (!curr->children[c]) return 0;
        curr = curr->children[c];
    }
    TrieSong **entry = &curr->songs;
    while (*entry && (*entry)->song_id != song_id) entry = &(*entry)->next;
    if (!*entry) return 0;
    TrieSong *removed = *entry;
    *entry = removed->next;
    free(removed);
    if (!curr->songs) trie->word_count--;
    return 1;
}

/* ── Iterative DFS using an explicit stack ────────────────────────────────
 * Fix N-H-01: The recursive version could overflow the C call stack for
 * long song titles (up to MAX_TITLE = 100 chars, branching factor 128).
 * An explicit stack heap-allocated here removes that risk entirely.
 * --------------------------------------------------------------------------*/
typedef struct { TrieNode *node; } DfsFrame;

static void collect_suggestions(TrieNode *root,
                                const char *prefix,
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

        for (TrieSong *song = node->songs; song && *count < max_results; song = song->next) {
            if (!title_has_prefix(song->title, prefix)) continue;
            out_ids[*count] = song->song_id;
            snprintf(out_titles[*count], 128, "%s", song->title);
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
    collect_suggestions(curr, prefix, out_ids, out_titles, max_results, &count);
    return count;
}
