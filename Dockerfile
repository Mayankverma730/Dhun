# Stage 1: Build the C backend using GCC
FROM gcc:12-bookworm AS builder

WORKDIR /build
COPY . /build

RUN make server CC=gcc CFLAGS="-Wall -Wextra -std=c99 -pedantic -D_POSIX_C_SOURCE=200809L" \
    || gcc -Wall -Wextra -std=c99 -pedantic -o vibe_server server.c song.c library.c stack.c queue.c bst.c heap.c hash.c sort.c playlist.c avl.c trie.c graph.c cache.c logger.c -lm

# Stage 2: Minimal runtime image
FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=builder /build/vibe_server /app/vibe_server
COPY index.html style.css app.js presentation.html logo.svg /app/
COPY js/ /app/js/
COPY *.jpg *.png /app/ 2>/dev/null || true

EXPOSE 3000

ENV DHUN_PORT=3000
CMD ["/app/vibe_server"]
