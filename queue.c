/*
 * queue.c — Play Queue (Circular Queue)
 * Music Management System (C + DSA)
 *
 * ┌──────────────────────────────────────────────────────────────┐
 * │ CIRCULAR QUEUE — FIFO (First In, First Out)                  │
 * │                                                              │
 * │  Indices wrap using modulo: (rear + 1) % MAX                 │
 * │                                                              │
 * │   front              rear                                    │
 * │     ↓                  ↓                                     │
 * │  [ S3 | S4 | S5 | S6 | S7 | __ | __ | S1 | S2 ]            │
 * │                              ↑               ↑              │
 * │                         empty slots     (already played)    │
 * │                                                              │
 * │  enqueue → add to rear    O(1)                               │
 * │  dequeue → remove front   O(1)                               │
 * └──────────────────────────────────────────────────────────────┘
 */

#include <stdio.h>
#include <stdlib.h>
#include "queue.h"

/* ── Create ──────────────────────────────────── */
Queue *queue_create(void)
{
    Queue *q = (Queue *)malloc(sizeof(Queue));
    if (!q) { perror("queue_create"); return NULL; }
    q->front = 0;
    q->rear  = -1;
    q->count = 0;
    return q;
}

/* ── Destroy ─────────────────────────────────── */
void queue_destroy(Queue *q)
{
    free(q);
}

/* ── Enqueue — O(1) ──────────────────────────── */
int queue_enqueue(Queue *q, Song song)
{
    if (!q || q->count >= QUEUE_MAX_SIZE) {
        printf("  [Queue] Play queue is full!\n");
        return 0;
    }
    q->rear          = (q->rear + 1) % QUEUE_MAX_SIZE;  /* wrap around */
    q->data[q->rear] = song;
    q->count++;
    return 1;
}

/* ── Dequeue — O(1) ──────────────────────────── */
int queue_dequeue(Queue *q, Song *out)
{
    if (!q || q->count == 0) {
        printf("  [Queue] Play queue is empty!\n");
        return 0;
    }
    if (out) *out = q->data[q->front];
    q->front = (q->front + 1) % QUEUE_MAX_SIZE;         /* wrap around */
    q->count--;
    return 1;
}

/* ── Front peek — O(1) ───────────────────────── */
int queue_front(const Queue *q, Song *out)
{
    if (!q || q->count == 0) return 0;
    if (out) *out = q->data[q->front];
    return 1;
}

/* ── Helpers ─────────────────────────────────── */
int queue_is_empty(const Queue *q) { return !q || q->count == 0; }
int queue_is_full(const Queue *q)  { return q && q->count >= QUEUE_MAX_SIZE; }
int queue_size(const Queue *q)     { return q ? q->count : 0; }

/* ── Display upcoming songs in order ─────────── */
void queue_display(const Queue *q)
{
    if (!q || q->count == 0) {
        printf("  (Play queue is empty)\n");
        return;
    }
    printf("\n  [Play Queue — upcoming songs]\n");
    song_print_header();
    int idx = q->front;
    for (int i = 0; i < q->count; i++) {
        printf("  #%-2d ", i + 1);
        song_print(&q->data[idx]);
        idx = (idx + 1) % QUEUE_MAX_SIZE;
    }
    printf("  %d song(s) in queue\n\n", q->count);
}
