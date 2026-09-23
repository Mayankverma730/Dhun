/*
 * avl.h — Self-Balancing Binary Search Tree (AVL Tree)
 * Dhun Music Management System (C + DSA)
 */

#ifndef AVL_H
#define AVL_H

#include "song.h"

typedef struct AVLNode {
    Song song;
    struct AVLNode *left;
    struct AVLNode *right;
    int height;
} AVLNode;

typedef struct {
    AVLNode *root;
    int size;
} AVLTree;

AVLTree *avl_create(void);
void     avl_destroy(AVLTree *tree);
int      avl_insert(AVLTree *tree, Song song);
int      avl_delete(AVLTree *tree, const char *title);
AVLNode *avl_search(const AVLTree *tree, const char *title);
int      avl_height(const AVLNode *node);
int      avl_size(const AVLTree *tree);

#endif /* AVL_H */
