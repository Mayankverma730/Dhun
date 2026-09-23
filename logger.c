/*
 * logger.c — Structured Logging Implementation
 * Dhun Music Management System (C + DSA)
 */

#include <stdio.h>
#include <stdlib.h>
#include <stdarg.h>
#include <time.h>
#include <string.h>
#include "logger.h"

static LogLevel g_min_level = LOG_LEVEL_INFO;
static FILE *g_log_file = NULL;

static const char *level_to_string(LogLevel level) {
    switch (level) {
        case LOG_LEVEL_DEBUG: return "DEBUG";
        case LOG_LEVEL_INFO:  return "INFO ";
        case LOG_LEVEL_WARN:  return "WARN ";
        case LOG_LEVEL_ERROR: return "ERROR";
        default:              return "LOG  ";
    }
}

void log_init(LogLevel min_level, const char *log_file_path) {
    g_min_level = min_level;
    if (log_file_path) {
        g_log_file = fopen(log_file_path, "a");
        if (!g_log_file) {
            perror("Failed to open log file");
        }
    }
}

void log_close(void) {
    if (g_log_file && g_log_file != stdout && g_log_file != stderr) {
        fclose(g_log_file);
        g_log_file = NULL;
    }
}

void log_set_level(LogLevel level) {
    g_min_level = level;
}

void log_message(LogLevel level, const char *file, int line, const char *fmt, ...) {
    if (level < g_min_level) return;

    time_t now = time(NULL);
    struct tm tm_buf;
#if defined(_WIN32) || defined(_WIN64)
    localtime_s(&tm_buf, &now);
#else
    localtime_r(&now, &tm_buf);
#endif

    char time_str[32];
    strftime(time_str, sizeof(time_str), "%Y-%m-%d %H:%M:%S", &tm_buf);

    /* Strip directories from filename for concise logs */
    const char *base_file = strrchr(file, '/');
    if (!base_file) base_file = strrchr(file, '\\');
    base_file = base_file ? base_file + 1 : file;

    char msg[1024];
    va_list args;
    va_start(args, fmt);
    vsnprintf(msg, sizeof(msg), fmt, args);
    va_end(args);

    /* Format: [YYYY-MM-DD HH:MM:SS] [LEVEL] [file:line] message */
    fprintf(stdout, "[%s] [%s] [%s:%d] %s\n", time_str, level_to_string(level), base_file, line, msg);
    fflush(stdout);

    if (g_log_file) {
        fprintf(g_log_file, "[%s] [%s] [%s:%d] %s\n", time_str, level_to_string(level), base_file, line, msg);
        fflush(g_log_file);
    }
}
