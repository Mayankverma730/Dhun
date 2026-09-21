/*
 * bst.h — Search Index (Binary Search Tree)
 * Music Management System (C + DSA)
 *
 * DSA: Binary Search Tree (BST) by song title
 *   - Insert:  O(log n) average, O(n) worst
 *   - Search:  O(log n) average
 *   - Delete:  O(log n) average
 *   - In-order traversal gives alphabetically sorted songs
 */

#ifndef BST_H
#define BST_H

#include "song.h"

/* ── BST Node ────────────────────────────────── */
typedef struct BSTNode {
    Song          song;
    struct BSTNode *left;
    struct BSTNode *right;
} BSTNode;

/* ── BST ─────────────────────────────────────── */
typedef struct BST {
    BSTNode *root;
    int      size;
} BST;

/* ── API ─────────────────────────────────────── */
BST     *bst_create(void);
void     bst_destroy(BST *tree);

int      bst_insert(BST *tree, Song song);          /* O(log n) avg */
BSTNode *bst_search(BST *tree, const char *title);  /* O(log n) avg */
int      bst_delete(BST *tree, const char *title);  /* O(log n) avg */

/* Traversals */
void     bst_inorder(const BST *tree);      /* sorted alphabetically */
void     bst_preorder(const BST *tree);
void     bst_postorder(const BST *tree);

/* Utility */
int      bst_height(const BST *tree);
void     bst_update_song(BST *tree, int id, int play_count);

#endif /* BST_H */
