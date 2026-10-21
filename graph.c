/*
 * graph.c — Song Similarity Graph Implementation
 * Dhun Music Management System (C + DSA)
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <math.h>
#include "graph.h"

SongGraph *graph_create(void) {
    SongGraph *g = (SongGraph *)calloc(1, sizeof(SongGraph));
    return g;
}

void graph_destroy(SongGraph *g) {
    if (!g) return;
    for (int i = 0; i < g->count; i++) {
        if (g->nodes[i]) {
            GraphEdge *e = g->nodes[i]->edges;
            while (e) {
                GraphEdge *next = e->next;
                free(e);
                e = next;
            }
            free(g->nodes[i]);
        }
    }
    free(g);
}

static GraphNode *find_node(const SongGraph *g, int song_id) {
    if (!g) return NULL;
    for (int i = 0; i < g->count; i++) {
        if (g->nodes[i] && g->nodes[i]->song_id == song_id) {
            return g->nodes[i];
        }
    }
    return NULL;
}

int graph_add_song(SongGraph *g, const Song *song) {
    if (!g || !song || g->count >= MAX_GRAPH_SONGS) return 0;
    if (find_node(g, song->id)) return 1;

    GraphNode *n = (GraphNode *)calloc(1, sizeof(GraphNode));
    if (!n) return 0;
    n->song_id = song->id;
    strncpy(n->title, song->title, sizeof(n->title) - 1);
    strncpy(n->genre, song->genre, sizeof(n->genre) - 1);
    strncpy(n->artist, song->artist, sizeof(n->artist) - 1);

    g->nodes[g->count++] = n;

    /* Automatically compute similarity edges with all existing songs in the graph */
    for (int i = 0; i < g->count - 1; i++) {
        GraphNode *other = g->nodes[i];
        if (other) {
            float sim = 0.0f;
            /* Same artist = heavy weight (+0.55) */
            if (strcmp(n->artist, other->artist) == 0) sim += 0.55f;
            /* Same genre = medium weight (+0.35) */
            if (strcmp(n->genre, other->genre) == 0) sim += 0.35f;

            if (sim >= 0.3f) {
                graph_add_edge(g, n->song_id, other->song_id, sim);
            }
        }
    }
    return 1;
}

void graph_add_edge(SongGraph *g, int id1, int id2, float similarity) {
    if (!g || id1 == id2) return;
    GraphNode *n1 = find_node(g, id1);
    GraphNode *n2 = find_node(g, id2);
    if (!n1 || !n2) return;

    /* Fix L-03: Do not add duplicate edges */
    int already1 = 0, already2 = 0;
    for (GraphEdge *e = n1->edges; e; e = e->next)
        if (e->target_song_id == id2) { already1 = 1; break; }
    for (GraphEdge *e = n2->edges; e; e = e->next)
        if (e->target_song_id == id1) { already2 = 1; break; }

    /* Add directed edge n1 -> n2 */
    if (!already1) {
        GraphEdge *e1 = (GraphEdge *)malloc(sizeof(GraphEdge));
        if (e1) {
            e1->target_song_id = id2;
            e1->similarity = similarity;
            e1->next = n1->edges;
            n1->edges = e1;
        }
    }

    /* Add undirected counterpart n2 -> n1 */
    if (!already2) {
        GraphEdge *e2 = (GraphEdge *)malloc(sizeof(GraphEdge));
        if (e2) {
            e2->target_song_id = id1;
            e2->similarity = similarity;
            e2->next = n2->edges;
            n2->edges = e2;
        }
    }
}

float graph_calculate_similarity(const Song *s1, const Song *s2) {
    if (!s1 || !s2) return 0.0f;
    float sim = 0.0f;
    if (strcmp(s1->artist, s2->artist) == 0) sim += 0.55f;
    if (strcmp(s1->genre, s2->genre) == 0) sim += 0.35f;
    float dur_diff = fabsf(s1->duration - s2->duration);
    if (dur_diff < 0.5f) sim += 0.10f;
    return sim > 1.0f ? 1.0f : sim;
}

int graph_get_similar(const SongGraph *g, int song_id, int out_ids[], float out_scores[], int max_results) {
    if (!g || !out_ids || max_results <= 0) return 0;
    GraphNode *n = find_node(g, song_id);
    if (!n) return 0;

    /* Fix L-01: Collect and rank edges descending by similarity score */
    typedef struct { int id; float sim; } SimCandidate;
    SimCandidate candidates[MAX_GRAPH_SONGS];
    int total = 0;

    for (GraphEdge *e = n->edges; e && total < MAX_GRAPH_SONGS; e = e->next) {
        candidates[total].id = e->target_song_id;
        candidates[total].sim = e->similarity;
        total++;
    }

    /* Sort descending by similarity score */
    for (int i = 1; i < total; i++) {
        SimCandidate key = candidates[i];
        int j = i - 1;
        while (j >= 0 && candidates[j].sim < key.sim) {
            candidates[j + 1] = candidates[j];
            j--;
        }
        candidates[j + 1] = key;
    }

    int count = (total < max_results) ? total : max_results;
    for (int i = 0; i < count; i++) {
        out_ids[i] = candidates[i].id;
        if (out_scores) out_scores[i] = candidates[i].sim;
    }
    return count;
}
