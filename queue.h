/*
 * queue.h — Play Queue (Circular Queue)
 * Music Management System (C + DSA)
 *
 * DSA: Circular Queue (array-based)
 *   - Enqueue: add next song to play       O(1)
 *   - Dequeue: play the front song         O(1)
 *   - Wraps around — no wasted space
 *   - FIFO: First In, First Out
 */

#ifndef QUEUE_H
#define QUEUE_H

#include "song.h"

#define QUEUE_MAX_SIZE 50

/* ── Circular Queue ──────────────────────────── */
typedef struct Queue {
    Song data[QUEUE_MAX_SIZE];
    int  front;     /* index of front element */
    int  rear;      /* index of rear element  */
    int  count;     /* number of elements     */
} Queue;

/* ── API ─────────────────────────────────────── */
Queue *queue_create(void);
void   queue_destroy(Queue *q);

int    queue_enqueue(Queue *q, Song song);      /* O(1) — add to play next */
int    queue_dequeue(Queue *q, Song *out);      /* O(1) — play next song   */
int    queue_front(const Queue *q, Song *out);  /* O(1) — peek at next     */

int    queue_is_empty(const Queue *q);
int    queue_is_full(const Queue *q);
int    queue_size(const Queue *q);
void   queue_display(const Queue *q);           /* show upcoming songs     */

#endif /* QUEUE_H */
