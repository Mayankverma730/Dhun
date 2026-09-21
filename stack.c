/*
 * stack.c — Play History (Stack)
 * Music Management System (C + DSA)
 *
 * ┌──────────────────────────────────────────────────────────────┐
 * │ STACK — LIFO (Last In, First Out)                            │
 * │                                                              │
 * │  top → [ Song 5 ]  ← most recently played                   │
 * │         [ Song 4 ]                                           │
 * │         [ Song 3 ]                                           │
 * │         [ Song 2 ]                                           │
 * │         [ Song 1 ]  ← first played                          │
 * │                                                              │
 * │  push(song) → play a song, add to history  O(1)             │
 * │  pop()      → go back to previous song     O(1)             │
 * │  peek()     → see currently played song    O(1)             │
 * └──────────────────────────────────────────────────────────────┘
 */

#include <stdio.h>
#include <stdlib.h>
#include "stack.h"

/* ── Create ──────────────────────────────────── */
Stack *stack_create(void)
{
    Stack *s = (Stack *)malloc(sizeof(Stack));
    if (!s) { perror("stack_create"); return NULL; }
    s->top = -1;
    return s;
}

/* ── Destroy ─────────────────────────────────── */
void stack_destroy(Stack *s)
{
    free(s);
}

/* ── Push — O(1) ─────────────────────────────── */
int stack_push(Stack *s, Song song)
{
    if (!s || s->top >= STACK_MAX_SIZE - 1) {
        printf("  [Stack] History is full! Oldest entry dropped.\n");
        /* Shift everything down to make room (oldest dropped) */
        for (int i = 0; i < STACK_MAX_SIZE - 1; i++)
            s->data[i] = s->data[i + 1];
        s->top = STACK_MAX_SIZE - 2;
    }
    s->data[++(s->top)] = song;
    return 1;
}

/* ── Pop — O(1) ──────────────────────────────── */
int stack_pop(Stack *s, Song *out)
{
    if (!s || s->top < 0) {
        printf("  [Stack] No play history.\n");
        return 0;
    }
    if (out) *out = s->data[(s->top)--];
    return 1;
}

/* ── Peek (top without removing) — O(1) ─────── */
int stack_peek(const Stack *s, Song *out)
{
    if (!s || s->top < 0) return 0;
    if (out) *out = s->data[s->top];
    return 1;
}

/* ── Helpers ─────────────────────────────────── */
int stack_is_empty(const Stack *s) { return !s || s->top < 0; }
int stack_is_full(const Stack *s)  { return s && s->top >= STACK_MAX_SIZE - 1; }
int stack_size(const Stack *s)     { return s ? s->top + 1 : 0; }

/* ── Display full history (top → bottom) ─────── */
void stack_display(const Stack *s)
{
    if (!s || s->top < 0) {
        printf("  (Play history is empty)\n");
        return;
    }
    printf("\n  [Play History — most recent first]\n");
    song_print_header();
    for (int i = s->top; i >= 0; i--)
        song_print(&s->data[i]);
    printf("  %d song(s) in history\n\n", s->top + 1);
}
