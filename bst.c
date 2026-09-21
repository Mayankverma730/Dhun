/*
 * bst.c — Search Index (Binary Search Tree)
 * Music Management System (C + DSA)
 *
 * ┌──────────────────────────────────────────────────────────────┐
 * │ BINARY SEARCH TREE (BST) — keyed by song title               │
 * │                                                              │
 * │              "Neon Dreams"                                   │
 * │             /             \                                  │
 * │      "Electric Feel"   "Sundrop"                             │
 * │        /      \             \                                │
 * │  "Cosmic"  "Golden Hour"  "Thunder"                          │
 * │                                                              │
 * │  BST Property: left < root < right (alphabetically)         │
 * │  In-order traversal → alphabetical song list                 │
 * └──────────────────────────────────────────────────────────────┘
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "bst.h"

/* ── Internal helpers ─────────────────────────── */
static BSTNode *new_node(Song song)
{
    BSTNode *n = (BSTNode *)malloc(sizeof(BSTNode));
    if (!n) { perror("bst new_node"); return NULL; }
    n->song  = song;
    n->left  = NULL;
    n->right = NULL;
    return n;
}

static BSTNode *insert_rec(BSTNode *node, Song song, int *added)
{
    if (!node) { *added = 1; return new_node(song); }
    int cmp = strcmp(song.title, node->song.title);
    if (cmp < 0) node->left  = insert_rec(node->left,  song, added);
    else if (cmp > 0) node->right = insert_rec(node->right, song, added);
    /* duplicate titles: update in place */
    else node->song = song;
    return node;
}

static BSTNode *search_rec(BSTNode *node, const char *title)
{
    if (!node) return NULL;
    int cmp = strcmp(title, node->song.title);
    if (cmp == 0) return node;
    return (cmp < 0) ? search_rec(node->left, title)
                     : search_rec(node->right, title);
}

/* find in-order successor (smallest in right subtree) */
static BSTNode *min_node(BSTNode *node)
{
    while (node->left) node = node->left;
    return node;
}

static BSTNode *delete_rec(BSTNode *node, const char *title, int *deleted)
{
    if (!node) return NULL;
    int cmp = strcmp(title, node->song.title);
    if (cmp < 0) {
        node->left  = delete_rec(node->left,  title, deleted);
    } else if (cmp > 0) {
        node->right = delete_rec(node->right, title, deleted);
    } else {
        /* Found the node to delete */
        *deleted = 1;
        if (!node->left) {
            BSTNode *r = node->right;
            free(node);
            return r;
        }
        if (!node->right) {
            BSTNode *l = node->left;
            free(node);
            return l;
        }
        /* Two children: replace with in-order successor */
        BSTNode *succ = min_node(node->right);
        node->song    = succ->song;
        node->right   = delete_rec(node->right, succ->song.title, deleted);
    }
    return node;
}

static void free_rec(BSTNode *node)
{
    if (!node) return;
    free_rec(node->left);
    free_rec(node->right);
    free(node);
}

static int height_rec(const BSTNode *node)
{
    if (!node) return 0;
    int lh = height_rec(node->left);
    int rh = height_rec(node->right);
    return 1 + (lh > rh ? lh : rh);
}

static void inorder_rec(const BSTNode *node)
{
    if (!node) return;
    inorder_rec(node->left);
    song_print(&node->song);
    inorder_rec(node->right);
}

static void preorder_rec(const BSTNode *node)
{
    if (!node) return;
    song_print(&node->song);
    preorder_rec(node->left);
    preorder_rec(node->right);
}

static void postorder_rec(const BSTNode *node)
{
    if (!node) return;
    postorder_rec(node->left);
    postorder_rec(node->right);
    song_print(&node->song);
}

static void update_rec(BSTNode *node, int id, int play_count)
{
    if (!node) return;
    if (node->song.id == id) { node->song.play_count = play_count; return; }
    update_rec(node->left,  id, play_count);
    update_rec(node->right, id, play_count);
}

/* ── Public API ───────────────────────────────── */
BST *bst_create(void)
{
    BST *t = (BST *)malloc(sizeof(BST));
    if (!t) { perror("bst_create"); return NULL; }
    t->root = NULL;
    t->size = 0;
    return t;
}

void bst_destroy(BST *tree)
{
    if (!tree) return;
    free_rec(tree->root);
    free(tree);
}

int bst_insert(BST *tree, Song song)
{
    if (!tree) return 0;
    int added = 0;
    tree->root = insert_rec(tree->root, song, &added);
    if (added) tree->size++;
    return added;
}

BSTNode *bst_search(BST *tree, const char *title)
{
    if (!tree) return NULL;
    return search_rec(tree->root, title);
}

int bst_delete(BST *tree, const char *title)
{
    if (!tree) return 0;
    int deleted = 0;
    tree->root = delete_rec(tree->root, title, &deleted);
    if (deleted) tree->size--;
    return deleted;
}

/* ── Traversals ───────────────────────────────── */
void bst_inorder(const BST *tree)
{
    if (!tree || !tree->root) { printf("  (BST is empty)\n"); return; }
    printf("\n  [BST In-order — Alphabetical by Title]\n");
    song_print_header();
    inorder_rec(tree->root);
    printf("\n");
}

void bst_preorder(const BST *tree)
{
    if (!tree || !tree->root) { printf("  (BST is empty)\n"); return; }
    printf("\n  [BST Pre-order — Root, Left, Right]\n");
    song_print_header();
    preorder_rec(tree->root);
    printf("\n");
}

void bst_postorder(const BST *tree)
{
    if (!tree || !tree->root) { printf("  (BST is empty)\n"); return; }
    printf("\n  [BST Post-order — Left, Right, Root]\n");
    song_print_header();
    postorder_rec(tree->root);
    printf("\n");
}

int bst_height(const BST *tree)
{
    return tree ? height_rec(tree->root) : 0;
}

void bst_update_song(BST *tree, int id, int play_count)
{
    if (tree) update_rec(tree->root, id, play_count);
}
