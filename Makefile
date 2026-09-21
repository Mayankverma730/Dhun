# Makefile — Vibe Music Management System (C + DSA)
# Usage:
#   make          → build CLI binary (music_mgr)
#   make server   → build HTTP API server (vibe_server)
#   make all      → build both
#   make debug    → build CLI with debug symbols
#   make clean    → remove built files
#   make run      → build CLI and run it
#   make serve    → build and start API server on :3000

CC      = gcc
CFLAGS  = -Wall -Wextra -std=c99 -pedantic
DBGFLAGS= -g -DDEBUG
TARGET  = music_mgr
SERVER  = vibe_server

COMMON_SRCS = song.c library.c stack.c queue.c bst.c heap.c hash.c sort.c playlist.c
CLI_SRCS    = main.c   $(COMMON_SRCS)
SRV_SRCS    = server.c $(COMMON_SRCS)

CLI_OBJS = $(CLI_SRCS:.c=.o)
SRV_OBJS = $(SRV_SRCS:.c=.o)

# Default — build both
all: $(TARGET) $(SERVER)
	@echo ""
	@echo "  ✓ Build successful!"
	@echo "    CLI:    ./$(TARGET).exe"
	@echo "    Server: ./$(SERVER).exe  (then open index.html)"
	@echo ""

# CLI binary
$(TARGET): $(CLI_OBJS)
	$(CC) $(CFLAGS) -o $@ $^ -lm
	@echo "  ✓ CLI built: $(TARGET).exe"

# HTTP API server
$(SERVER): $(SRV_OBJS)
	$(CC) $(CFLAGS) -o $@ $^ -lws2_32 -lm
	@echo "  ✓ Server built: $(SERVER).exe"

%.o: %.c
	$(CC) $(CFLAGS) -c -o $@ $<

# Debug build (CLI only)
debug: CFLAGS += $(DBGFLAGS)
debug: $(TARGET)

# Run CLI
run: $(TARGET)
	./$(TARGET).exe

# Run API server
serve: $(SERVER)
	./$(SERVER).exe

# Windows
run-win: $(TARGET)
	$(TARGET).exe

# Clean
clean:
	del /Q *.o $(TARGET).exe $(SERVER).exe 2>nul || rm -f *.o $(TARGET) $(SERVER)

.PHONY: all debug run run-win serve clean
