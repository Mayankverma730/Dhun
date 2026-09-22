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

# Detect OS
ifeq ($(OS),Windows_NT)
    EXE_EXT = .exe
    RM      = del /Q
    SLASH   = \\
else
    EXE_EXT =
    RM      = rm -f
    SLASH   = /
endif

COMMON_SRCS = song.c library.c stack.c queue.c bst.c heap.c hash.c sort.c playlist.c
CLI_SRCS    = main.c   $(COMMON_SRCS)
SRV_SRCS    = server.c $(COMMON_SRCS)

CLI_OBJS = $(CLI_SRCS:.c=.o)
SRV_OBJS = $(SRV_SRCS:.c=.o)

# Default — build both
all: $(TARGET)$(EXE_EXT) $(SERVER)$(EXE_EXT)
	@echo ""
	@echo "  ✓ Build successful!"
	@echo "    CLI:    ./$(TARGET)$(EXE_EXT)"
	@echo "    Server: ./$(SERVER)$(EXE_EXT)  (then open index.html)"
	@echo ""

# CLI binary
$(TARGET)$(EXE_EXT): $(CLI_OBJS)
	$(CC) $(CFLAGS) -o $@ $^ -lm
	@echo "  ✓ CLI built: $(TARGET)$(EXE_EXT)"

# HTTP API server
$(SERVER)$(EXE_EXT): $(SRV_OBJS)
	$(CC) $(CFLAGS) -o $@ $^ -lws2_32 -lm
	@echo "  ✓ Server built: $(SERVER)$(EXE_EXT)"

%.o: %.c
	$(CC) $(CFLAGS) -c -o $@ $<

# Debug build (CLI only)
debug: CFLAGS += $(DBGFLAGS)
debug: $(TARGET)$(EXE_EXT)

# Run CLI
run: $(TARGET)$(EXE_EXT)
	./$(TARGET)$(EXE_EXT)

# Run API server
serve: $(SERVER)$(EXE_EXT)
	./$(SERVER)$(EXE_EXT)

# Clean
clean:
	$(RM) *.o $(TARGET)$(EXE_EXT) $(SERVER)$(EXE_EXT) 2>nul

.PHONY: all debug run serve clean
