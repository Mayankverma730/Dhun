/*
 * graph.h — Song Similarity Graph for Recommendations
 * Dhun Music Management System (C + DSA)
 */

#ifndef GRAPH_H
#define GRAPH_H

#include "song.h"

#define MAX_GRAPH_SONGS 500

typedef struct GraphEdge {
    int target_song_id;
    float similarity; /* 0.0 to 1.0 */
    struct GraphEdge *next;
} GraphEdge;

typedef struct {
    int song_id;
    char title[128];
    char genre[64];
    char artist[128];
    GraphEdge *edges;
} GraphNode;

typedef struct {
    GraphNode *nodes[MAX_GRAPH_SONGS];
    int count;
} SongGraph;

SongGraph *graph_create(void);
void       graph_destroy(SongGraph *g);
int        graph_add_song(SongGraph *g, const Song *song);
void       graph_add_edge(SongGraph *g, int id1, int id2, float similarity);
float      graph_calculate_similarity(const Song *s1, const Song *s2);
int        graph_get_similar(const SongGraph *g, int song_id, int out_ids[], float out_scores[], int max_results);

#endif /* GRAPH_H */
