/*
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║          VIBE — Music Management System in C                    ║
 * ║                                                                  ║
 * ║  Data Structures Used:                                           ║
 * ║   • Doubly Linked List  → Music Library (library.h)             ║
 * ║   • Stack               → Play History  (stack.h)               ║
 * ║   • Circular Queue      → Play Queue    (queue.h)               ║
 * ║   • Binary Search Tree  → Song Search   (bst.h)                 ║
 * ║   • Max-Heap            → Top Charts    (heap.h)                ║
 * ║   • Hash Table          → Fast Lookup   (hash.h)                ║
 * ║   • Merge Sort          → Sorting       (sort.h)                ║
 * ║   • Binary Search       → Sorted Search (sort.h)                ║
 * ╚══════════════════════════════════════════════════════════════════╝
 *
 * main.c — Entry Point & Interactive Menu
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "song.h"
#include "library.h"
#include "stack.h"
#include "queue.h"
#include "bst.h"
#include "heap.h"
#include "hash.h"
#include "sort.h"
#include "playlist.h"

/* ─────────────────────────────────────────────
   Global state (all DSA instances)
───────────────────────────────────────────── */
static Library        *g_lib;    /* Doubly Linked List */
static Stack          *g_history;/* Stack              */
static Queue          *g_queue;  /* Circular Queue     */
static BST            *g_bst;    /* Binary Search Tree */
static Heap           *g_heap_plays;  /* Max-Heap (plays)  */
static Heap           *g_heap_rating; /* Max-Heap (rating) */
static HashTable      *g_hash;   /* Hash Table         */
static PlaylistManager*g_pm;     /* Playlist Manager   */

/* ─────────────────────────────────────────────
   Utilities
───────────────────────────────────────────── */
static void clear_input(void)
{
    int c;
    while ((c = getchar()) != '\n' && c != EOF);
}

static void print_banner(void)
{
    printf("\n");
    printf("  ╔══════════════════════════════════════════════════╗\n");
    printf("  ║  🎵  VIBE — Music Management System (C + DSA)   ║\n");
    printf("  ╠══════════════════════════════════════════════════╣\n");
    printf("  ║  Library: DLL  |  Search: BST  |  Lookup: Hash  ║\n");
    printf("  ║  Queue   : CQ  |  History: Stack | Rank: Heap   ║\n");
    printf("  ╚══════════════════════════════════════════════════╝\n\n");
}

static void print_divider(void)
{
    printf("  ─────────────────────────────────────────────────\n");
}

/* ─────────────────────────────────────────────
   Add song to ALL data structures atomically
───────────────────────────────────────────── */
static int add_song_all(const char *title, const char *artist,
                         const char *album,  const char *genre,
                         float duration,     float rating)
{
    /* 1. Doubly Linked List (master store) */
    int id = lib_add_song(g_lib, title, artist, album, genre, duration, rating);
    if (id < 0) return -1;

    Song *s = lib_find_by_id(g_lib, id);
    if (!s) return -1;

    /* 2. BST — search index */
    bst_insert(g_bst, *s);

    /* 3. Hash Table — O(1) lookup */
    hash_insert(g_hash, *s);

    /* 4. Heap — ranking (built on demand, skip here) */

    return id;
}

/* ─────────────────────────────────────────────
   Remove song from ALL data structures
───────────────────────────────────────────── */
static void remove_song_all(int id)
{
    Song *s = lib_find_by_id(g_lib, id);
    if (!s) { printf("  Song ID %d not found.\n", id); return; }

    char title[MAX_TITLE];
    strncpy(title, s->title, MAX_TITLE - 1);

    lib_remove_song(g_lib, id);
    bst_delete(g_bst, title);
    hash_delete(g_hash, id);
    printf("  Song ID %d removed from library, BST, and hash table.\n", id);
}

/* ─────────────────────────────────────────────
   "Play" a song: push history, dequeue, update
───────────────────────────────────────────── */
static void play_song(int id)
{
    Song *s = hash_lookup(g_hash, id);   /* O(1) lookup */
    if (!s) {
        printf("  Song ID %d not found in hash table.\n", id);
        return;
    }
    /* Increment play count */
    s->play_count++;
    /* Update DLL node */
    Song *lib_s = lib_find_by_id(g_lib, id);
    if (lib_s) lib_s->play_count = s->play_count;
    /* Update BST node */
    bst_update_song(g_bst, id, s->play_count);

    /* Push to history stack */
    stack_push(g_history, *s);

    printf("\n  ▶  Now Playing: \"%s\" by %s\n", s->title, s->artist);
    printf("     Play count: %d\n\n", s->play_count);
}

/* ─────────────────────────────────────────────
   Rebuild heaps from current library state
───────────────────────────────────────────── */
static void rebuild_heaps(void)
{
    Song *arr = NULL;
    int   n   = lib_to_array(g_lib, &arr);
    if (n > 0) {
        heap_build(g_heap_plays,  arr, n);
        heap_build(g_heap_rating, arr, n);
    }
    free(arr);
}

/* ─────────────────────────────────────────────
   Pre-load demo songs
───────────────────────────────────────────── */
static void load_demo_songs(void)
{
    /* Check if local audio file tujhko.mp3 is available */
    FILE *f = fopen("tujhko.mp3", "rb");
    if (f) {
        fclose(f);
        int id = add_song_all("Tujhko Jo Paaya", "Mohit Chauhan / Pritam", "Crook",
                              "Bollywood", 5.72f, 4.9f);
        Song *s = lib_find_by_id(g_lib, id);
        if (s) {
            s->play_count = 1;
            hash_insert(g_hash, *s);
            bst_update_song(g_bst, id, s->play_count);
        }
        rebuild_heaps();
        printf("  Real track Tujhko Jo Paaya loaded!\n\n");
    }
}

/* ══════════════════════════════════════════════
   MENUS
══════════════════════════════════════════════ */

/* ── 1. Library Menu (Doubly Linked List) ────── */
static void menu_library(void)
{
    int choice;
    do {
        print_divider();
        printf("  [1] Doubly Linked List — Music Library\n");
        printf("    1. View all songs (forward)\n");
        printf("    2. View all songs (reverse) ← DLL advantage\n");
        printf("    3. Add a song\n");
        printf("    4. Remove a song by ID\n");
        printf("    5. Library statistics\n");
        printf("    0. Back\n");
        printf("  Choice: ");
        if (scanf("%d", &choice) != 1) { clear_input(); choice = -1; }
        clear_input();

        char t[MAX_TITLE], ar[MAX_ARTIST], al[MAX_ALBUM], g[MAX_GENRE];
        float dur, rat;
        int   id;

        switch (choice) {
            case 1: lib_display(g_lib); break;
            case 2: lib_display_reverse(g_lib); break;
            case 3:
                printf("  Title   : "); fgets(t,  sizeof(t),  stdin); t[strcspn(t,"\n")]  = '\0';
                printf("  Artist  : "); fgets(ar, sizeof(ar), stdin); ar[strcspn(ar,"\n")]= '\0';
                printf("  Album   : "); fgets(al, sizeof(al), stdin); al[strcspn(al,"\n")]= '\0';
                printf("  Genre   : "); fgets(g,  sizeof(g),  stdin); g[strcspn(g,"\n")]  = '\0';
                printf("  Duration (mins, e.g. 3.5): "); scanf("%f", &dur); clear_input();
                printf("  Rating  (1-5): ");             scanf("%f", &rat); clear_input();
                id = add_song_all(t, ar, al, g, dur, rat);
                rebuild_heaps();
                printf("  ✓ Added song with ID %d\n", id);
                break;
            case 4:
                printf("  Song ID to remove: "); scanf("%d", &id); clear_input();
                remove_song_all(id);
                break;
            case 5: lib_stats(g_lib); break;
            case 0: break;
            default: printf("  Invalid choice.\n");
        }
    } while (choice != 0);
}

/* ── 2. Search Menu (BST + Hash Table) ─────── */
static void menu_search(void)
{
    int choice;
    do {
        print_divider();
        printf("  [2] Search\n");
        printf("    1. Search by Title (BST — O(log n))\n");
        printf("    2. Search by ID    (Hash Table — O(1))\n");
        printf("    3. BST In-order  (alphabetical listing)\n");
        printf("    4. BST Pre-order  traversal\n");
        printf("    5. BST Post-order traversal\n");
        printf("    6. BST Height\n");
        printf("    7. Show Hash Table structure\n");
        printf("    0. Back\n");
        printf("  Choice: ");
        if (scanf("%d", &choice) != 1) { clear_input(); choice = -1; }
        clear_input();

        char title[MAX_TITLE];
        int  id;
        BSTNode *node;
        Song    *song;

        switch (choice) {
            case 1:
                printf("  Song title: "); fgets(title, sizeof(title), stdin);
                title[strcspn(title, "\n")] = '\0';
                node = bst_search(g_bst, title);
                if (node) { printf("  Found:\n"); song_print_header(); song_print(&node->song); printf("\n"); }
                else       printf("  Not found in BST.\n");
                break;
            case 2:
                printf("  Song ID: "); scanf("%d", &id); clear_input();
                song = hash_lookup(g_hash, id);
                if (song) { printf("  Found:\n"); song_print_header(); song_print(song); printf("\n"); }
                else       printf("  Not found in hash table.\n");
                break;
            case 3: bst_inorder(g_bst);   break;
            case 4: bst_preorder(g_bst);  break;
            case 5: bst_postorder(g_bst); break;
            case 6: printf("  BST Height: %d\n", bst_height(g_bst)); break;
            case 7: hash_display_table(g_hash); break;
            case 0: break;
            default: printf("  Invalid choice.\n");
        }
    } while (choice != 0);
}

/* ── 3. Play Queue Menu (Circular Queue) ─────── */
static void menu_queue(void)
{
    int choice;
    do {
        print_divider();
        printf("  [3] Play Queue (Circular Queue)\n");
        printf("    Queue size: %d / %d\n", queue_size(g_queue), QUEUE_MAX_SIZE);
        printf("    1. Enqueue song (add to play next)\n");
        printf("    2. Dequeue & play next song\n");
        printf("    3. Peek at next song\n");
        printf("    4. View full queue\n");
        printf("    0. Back\n");
        printf("  Choice: ");
        if (scanf("%d", &choice) != 1) { clear_input(); choice = -1; }
        clear_input();

        int  id;
        Song deq, peek_song;
        Song *s;

        switch (choice) {
            case 1:
                printf("  Song ID to enqueue: "); scanf("%d", &id); clear_input();
                s = hash_lookup(g_hash, id);
                if (s) { queue_enqueue(g_queue, *s); printf("  ✓ \"%s\" added to queue.\n", s->title); }
                else    printf("  Song ID %d not found.\n", id);
                break;
            case 2:
                if (queue_dequeue(g_queue, &deq)) {
                    printf("  ▶ Playing: \"%s\"\n", deq.title);
                    play_song(deq.id);
                }
                break;
            case 3:
                if (queue_front(g_queue, &peek_song))
                    printf("  Next up: \"%s\" by %s\n", peek_song.title, peek_song.artist);
                else
                    printf("  Queue is empty.\n");
                break;
            case 4: queue_display(g_queue); break;
            case 0: break;
            default: printf("  Invalid choice.\n");
        }
    } while (choice != 0);
}

/* ── 4. History Menu (Stack) ────────────────── */
static void menu_history(void)
{
    int choice;
    do {
        print_divider();
        printf("  [4] Play History (Stack — LIFO)\n");
        printf("    History size: %d\n", stack_size(g_history));
        printf("    1. View full history\n");
        printf("    2. Go back (pop previous song)\n");
        printf("    3. Peek current (top of stack)\n");
        printf("    0. Back\n");
        printf("  Choice: ");
        if (scanf("%d", &choice) != 1) { clear_input(); choice = -1; }
        clear_input();

        Song popped, top;

        switch (choice) {
            case 1: stack_display(g_history); break;
            case 2:
                if (stack_pop(g_history, &popped))
                    printf("  ◀ Going back. \"%s\" removed from history.\n\n", popped.title);
                break;
            case 3:
                if (stack_peek(g_history, &top))
                    printf("  Current: \"%s\" by %s\n\n", top.title, top.artist);
                else
                    printf("  History is empty.\n");
                break;
            case 0: break;
            default: printf("  Invalid choice.\n");
        }
    } while (choice != 0);
}

/* ── 5. Top Charts Menu (Heap) ──────────────── */
static void menu_charts(void)
{
    int choice;
    do {
        print_divider();
        printf("  [5] Top Charts (Max-Heap)\n");
        printf("    1. Top-5  most played songs\n");
        printf("    2. Top-10 most played songs\n");
        printf("    3. Top-5  highest rated songs\n");
        printf("    4. Top-10 highest rated songs\n");
        printf("    5. Rebuild charts from library\n");
        printf("    0. Back\n");
        printf("  Choice: ");
        if (scanf("%d", &choice) != 1) { clear_input(); choice = -1; }
        clear_input();

        switch (choice) {
            case 1: rebuild_heaps(); heap_display_top(g_heap_plays,  5);  break;
            case 2: rebuild_heaps(); heap_display_top(g_heap_plays,  10); break;
            case 3: rebuild_heaps(); heap_display_top(g_heap_rating, 5);  break;
            case 4: rebuild_heaps(); heap_display_top(g_heap_rating, 10); break;
            case 5: rebuild_heaps(); printf("  ✓ Charts rebuilt from library.\n"); break;
            case 0: break;
            default: printf("  Invalid choice.\n");
        }
    } while (choice != 0);
}

/* ── 6. Sort Menu (Merge Sort + Quick Sort) ─── */
static void menu_sort(void)
{
    int choice;
    do {
        print_divider();
        printf("  [6] Sort Library (Merge Sort / Quick Sort)\n");
        printf("    1. Sort by Title   (Merge Sort — stable)\n");
        printf("    2. Sort by Artist  (Merge Sort — stable)\n");
        printf("    3. Sort by Plays   (Merge Sort — descending)\n");
        printf("    4. Sort by Rating  (Merge Sort — descending)\n");
        printf("    5. Quick Sort by Title (in-place)\n");
        printf("    6. Binary Search on sorted array\n");
        printf("    0. Back\n");
        printf("  Choice: ");
        if (scanf("%d", &choice) != 1) { clear_input(); choice = -1; }
        clear_input();

        Song *arr = NULL;
        int   n   = lib_to_array(g_lib, &arr);
        char  title[MAX_TITLE];
        int   found;

        switch (choice) {
            case 1:
                if (n > 0) { sort_by_title(arr, n);  song_print_header(); for(int i=0;i<n;i++) song_print(&arr[i]); }
                break;
            case 2:
                if (n > 0) { sort_by_artist(arr, n); song_print_header(); for(int i=0;i<n;i++) song_print(&arr[i]); }
                break;
            case 3:
                if (n > 0) { sort_by_plays(arr, n);  song_print_header(); for(int i=0;i<n;i++) song_print(&arr[i]); }
                break;
            case 4:
                if (n > 0) { sort_by_rating(arr, n); song_print_header(); for(int i=0;i<n;i++) song_print(&arr[i]); }
                break;
            case 5:
                if (n > 0) {
                    quick_sort(arr, 0, n - 1, song_compare_title);
                    printf("  (Quick sorted by title)\n");
                    song_print_header();
                    for (int i = 0; i < n; i++) song_print(&arr[i]);
                }
                break;
            case 6:
                if (n > 0) {
                    sort_by_title(arr, n);  /* must be sorted first */
                    printf("  Search title: "); fgets(title, sizeof(title), stdin);
                    title[strcspn(title, "\n")] = '\0';
                    found = binary_search_title(arr, n, title);
                    if (found >= 0) { printf("  Found at index %d:\n", found); song_print_header(); song_print(&arr[found]); }
                    else             printf("  Not found.\n");
                }
                break;
            case 0: break;
            default: printf("  Invalid choice.\n");
        }
        free(arr);
        printf("\n");
    } while (choice != 0);
}

/* ── 7. Playlist Menu ───────────────────────── */
static void menu_playlists(void)
{
    int choice;
    do {
        print_divider();
        printf("  [7] Playlist Manager\n");
        printf("    1. List all playlists\n");
        printf("    2. Create new playlist\n");
        printf("    3. Delete playlist\n");
        printf("    4. Add song to playlist\n");
        printf("    5. Remove song from playlist\n");
        printf("    6. View playlist\n");
        printf("    0. Back\n");
        printf("  Choice: ");
        if (scanf("%d", &choice) != 1) { clear_input(); choice = -1; }
        clear_input();

        char name[MAX_PLAYLIST_NAME];
        int  pid, sid;
        Playlist *pl;

        switch (choice) {
            case 1: pm_list_all(g_pm); break;
            case 2:
                printf("  Playlist name: "); fgets(name, sizeof(name), stdin);
                name[strcspn(name, "\n")] = '\0';
                pl = pm_create_playlist(g_pm, name);
                if (pl) printf("  ✓ Playlist \"%s\" created (ID: %d)\n", pl->name, pl->id);
                break;
            case 3:
                printf("  Playlist ID to delete: "); scanf("%d", &pid); clear_input();
                pm_delete_playlist(g_pm, pid)
                    ? printf("  ✓ Deleted playlist %d\n", pid)
                    : printf("  Playlist %d not found.\n", pid);
                break;
            case 4:
                printf("  Playlist ID: "); scanf("%d", &pid); clear_input();
                printf("  Song ID    : "); scanf("%d", &sid); clear_input();
                pm_add_song(g_pm, pid, sid)
                    ? printf("  ✓ Song %d added to playlist %d\n", sid, pid)
                    : printf("  Failed to add song.\n");
                break;
            case 5:
                printf("  Playlist ID: "); scanf("%d", &pid); clear_input();
                printf("  Song ID    : "); scanf("%d", &sid); clear_input();
                pm_remove_song(g_pm, pid, sid)
                    ? printf("  ✓ Song %d removed from playlist %d\n", sid, pid)
                    : printf("  Song not found in playlist.\n");
                break;
            case 6:
                printf("  Playlist ID: "); scanf("%d", &pid); clear_input();
                pm_display_playlist(g_pm, pid, g_lib);
                break;
            case 0: break;
            default: printf("  Invalid choice.\n");
        }
    } while (choice != 0);
}

/* ── 8. Play a song directly ─────────────────── */
static void menu_play(void)
{
    printf("  Song ID to play: ");
    int id;
    if (scanf("%d", &id) != 1) { clear_input(); return; }
    clear_input();
    play_song(id);
    rebuild_heaps();
}

/* ══════════════════════════════════════════════
   MAIN MENU
══════════════════════════════════════════════ */
static void main_menu(void)
{
    int choice;
    do {
        print_banner();
        printf("  Songs in library: %d\n\n", lib_size(g_lib));
        printf("  ┌─ Data Structures ──────────────────────────┐\n");
        printf("  │  1. Library (Doubly Linked List)            │\n");
        printf("  │  2. Search  (BST + Hash Table)             │\n");
        printf("  │  3. Play Queue (Circular Queue)            │\n");
        printf("  │  4. Play History (Stack)                   │\n");
        printf("  │  5. Top Charts (Max-Heap)                  │\n");
        printf("  │  6. Sort (Merge Sort + Quick Sort)         │\n");
        printf("  │  7. Playlists (Linked List)                │\n");
        printf("  ├─ Actions ──────────────────────────────────┤\n");
        printf("  │  8. Play a Song                            │\n");
        printf("  │  9. Load demo songs                        │\n");
        printf("  │  0. Exit                                   │\n");
        printf("  └────────────────────────────────────────────┘\n");
        printf("  Choice: ");

        if (scanf("%d", &choice) != 1) { clear_input(); choice = -1; }
        clear_input();

        switch (choice) {
            case 1: menu_library();   break;
            case 2: menu_search();    break;
            case 3: menu_queue();     break;
            case 4: menu_history();   break;
            case 5: menu_charts();    break;
            case 6: menu_sort();      break;
            case 7: menu_playlists(); break;
            case 8: menu_play();      break;
            case 9: load_demo_songs(); break;
            case 0: printf("\n  Goodbye! 🎵\n\n"); break;
            default: printf("  Invalid choice. Try again.\n\n");
        }
    } while (choice != 0);
}

/* ══════════════════════════════════════════════
   MAIN
══════════════════════════════════════════════ */
int main(void)
{
    /* Initialise all DSA structures */
    g_lib          = lib_create();
    g_history      = stack_create();
    g_queue        = queue_create();
    g_bst          = bst_create();
    g_heap_plays   = heap_create(HEAP_BY_PLAYS);
    g_heap_rating  = heap_create(HEAP_BY_RATING);
    g_hash         = hash_create();
    g_pm           = pm_create();

    if (!g_lib || !g_history || !g_queue || !g_bst ||
        !g_heap_plays || !g_heap_rating || !g_hash || !g_pm) {
        fprintf(stderr, "Fatal: failed to allocate data structures.\n");
        return 1;
    }

    /* Load demo songs on startup */
    load_demo_songs();

    /* Run interactive menu */
    main_menu();

    /* Clean up all DSA */
    lib_destroy(g_lib);
    stack_destroy(g_history);
    queue_destroy(g_queue);
    bst_destroy(g_bst);
    heap_destroy(g_heap_plays);
    heap_destroy(g_heap_rating);
    hash_destroy(g_hash);
    pm_destroy(g_pm);

    return 0;
}
