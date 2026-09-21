/*
 * stack.h — Play History (Stack)
 * Music Management System (C + DSA)
 *
 * DSA: Stack (array-based)
 *   - Push when a song is played
 *   - Pop  to go back to previous song
 *   - Peek to see current song
 *   - LIFO: Last In, First Out
 *   - All operations: O(1)
 */

#ifndef STACK_H
#define STACK_H

#include "song.h"

#define STACK_MAX_SIZE 100

/* ── Stack ───────────────────────────────────── */
typedef struct Stack {
    Song data[STACK_MAX_SIZE];
    int  top;       /* index of top element, -1 if empty */
} Stack;

/* ── API ─────────────────────────────────────── */
Stack *stack_create(void);
void   stack_destroy(Stack *s);

int    stack_push(Stack *s, Song song);    /* O(1) — push on play */
int    stack_pop(Stack *s, Song *out);     /* O(1) — go back */
int    stack_peek(const Stack *s, Song *out); /* O(1) — current song */

int    stack_is_empty(const Stack *s);
int    stack_is_full(const Stack *s);
int    stack_size(const Stack *s);
void   stack_display(const Stack *s);      /* show history */

#endif /* STACK_H */
