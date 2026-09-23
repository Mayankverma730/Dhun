/*
 * avl.c — Self-Balancing Binary Search Tree (AVL Tree) Implementation
 * Dhun Music Management System (C + DSA)
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <ctype.h>
#include "avl.h"

static int max_val(int a, int b) {
    return (a > b) ? a : b;
}

int avl_height(const AVLNode *node) {
    return node ? node->height : 0;
}

static int get_balance(const AVLNode *node) {
    return node ? avl_height(node->left) - avl_height(node->right) : 0;
}

static AVLNode *create_node(Song song) {
    AVLNode *n = (AVLNode *)malloc(sizeof(AVLNode));
    if (!n) return NULL;
    n->song = song;
    n->left = NULL;
    n->right = NULL;
    n->height = 1;
    return n;
}

static AVLNode *rotate_right(AVLNode *y) {
    AVLNode *x = y->left;
    AVLNode *t2 = x->right;

    x->right = y;
    y->left = t2;

    y->height = max_val(avl_height(y->left), avl_height(y->right)) + 1;
    x->height = max_val(avl_height(x->left), avl_height(x->right)) + 1;

    return x;
}

static AVLNode *rotate_left(AVLNode *x) {
    AVLNode *y = x->right;
    AVLNode *t2 = y->left;

    y->left = x;
    x->right = t2;

    x->height = max_val(avl_height(x->left), avl_height(x->right)) + 1;
    y->height = max_val(avl_height(y->left), avl_height(y->right)) + 1;

    return y;
}

static int song_title_cmp(const char *t1, const char *t2) {
#ifdef _WIN32
    return _stricmp(t1, t2);
#else
    return strcasecmp(t1, t2);
#endif
}

static AVLNode *insert_rec(AVLNode *node, Song song, int *inserted) {
    if (!node) {
        *inserted = 1;
        return create_node(song);
    }

    int cmp = song_title_cmp(song.title, node->song.title);
    if (cmp < 0) {
        node->left = insert_rec(node->left, song, inserted);
    } else if (cmp > 0) {
        node->right = insert_rec(node->right, song, inserted);
    } else {
        /* Duplicate title — update song */
        node->song = song;
        *inserted = 0;
        return node;
    }

    node->height = 1 + max_val(avl_height(node->left), avl_height(node->right));
    int balance = get_balance(node);

    /* Left-Left Case */
    if (balance > 1 && song_title_cmp(song.title, node->left->song.title) < 0)
        return rotate_right(node);

    /* Right-Right Case */
    if (balance < -1 && song_title_cmp(song.title, node->right->song.title) > 0)
        return rotate_left(node);

    /* Left-Right Case */
    if (balance > 1 && song_title_cmp(song.title, node->left->song.title) > 0) {
        node->left = rotate_left(node->left);
        return rotate_right(node);
    }

    /* Right-Left Case */
    if (balance < -1 && song_title_cmp(song.title, node->right->song.title) < 0) {
        node->right = rotate_right(node->right);
        return rotate_left(node);
    }

    return node;
}

AVLTree *avl_create(void) {
    AVLTree *tree = (AVLTree *)calloc(1, sizeof(AVLTree));
    return tree;
}

static void destroy_rec(AVLNode *node) {
    if (!node) return;
    destroy_rec(node->left);
    destroy_rec(node->right);
    free(node);
}

void avl_destroy(AVLTree *tree) {
    if (!tree) return;
    destroy_rec(tree->root);
    free(tree);
}

int avl_insert(AVLTree *tree, Song song) {
    if (!tree) return 0;
    int inserted = 0;
    tree->root = insert_rec(tree->root, song, &inserted);
    if (inserted) tree->size++;
    return inserted;
}

static AVLNode *min_node(AVLNode *node) {
    AVLNode *cur = node;
    while (cur && cur->left) cur = cur->left;
    return cur;
}

static AVLNode *delete_rec(AVLNode *root, const char *title, int *deleted) {
    if (!root) return NULL;

    int cmp = song_title_cmp(title, root->song.title);
    if (cmp < 0) {
        root->left = delete_rec(root->left, title, deleted);
    } else if (cmp > 0) {
        root->right = delete_rec(root->right, title, deleted);
    } else {
        *deleted = 1;
        if (!root->left || !root->right) {
            AVLNode *temp = root->left ? root->left : root->right;
            if (!temp) {
                temp = root;
                root = NULL;
            } else {
                *root = *temp;
            }
            free(temp);
        } else {
            AVLNode *temp = min_node(root->right);
            root->song = temp->song;
            root->right = delete_rec(root->right, temp->song.title, deleted);
        }
    }

    if (!root) return NULL;

    root->height = 1 + max_val(avl_height(root->left), avl_height(root->right));
    int balance = get_balance(root);

    if (balance > 1 && get_balance(root->left) >= 0)
        return rotate_right(root);

    if (balance > 1 && get_balance(root->left) < 0) {
        root->left = rotate_left(root->left);
        return rotate_right(root);
    }

    if (balance < -1 && get_balance(root->right) <= 0)
        return rotate_left(root);

    if (balance < -1 && get_balance(root->right) > 0) {
        root->right = rotate_right(root->right);
        return rotate_left(root);
    }

    return root;
}

int avl_delete(AVLTree *tree, const char *title) {
    if (!tree || !title) return 0;
    int deleted = 0;
    tree->root = delete_rec(tree->root, title, &deleted);
    if (deleted) tree->size--;
    return deleted;
}

AVLNode *avl_search(const AVLTree *tree, const char *title) {
    if (!tree || !title) return NULL;
    AVLNode *cur = tree->root;
    while (cur) {
        int cmp = song_title_cmp(title, cur->song.title);
        if (cmp == 0) return cur;
        cur = (cmp < 0) ? cur->left : cur->right;
    }
    return NULL;
}

int avl_size(const AVLTree *tree) {
    return tree ? tree->size : 0;
}
