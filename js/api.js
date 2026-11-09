/**
 * js/api.js — Robust Network Client with Retry and Exponential Backoff
 * Dhun Music Management System [T2-05]
 */

async function apiWithRetry(endpoint, options = {}, retries = 3, baseDelay = 1000) {
    let lastError;
    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            const res = await fetch(endpoint, {
                ...options,
                headers: {
                    'Content-Type': 'application/json',
                    ...(options.headers || {})
                }
            });

            if (!res.ok) {
                let message = `HTTP ${res.status}: ${res.statusText}`;
                if (res.status >= 400 && res.status < 500 && res.status !== 429) {
                    const errBody = await res.json().catch(() => ({ error: res.statusText }));
                    message = errBody.error || `HTTP error ${res.status}`;
                }
                const error = new Error(message);
                error.status = res.status;
                throw error;
            }

            return await res.json();
        } catch (err) {
            lastError = err;
            // Client errors are final; only 429 is worth retrying.
            if (err.status >= 400 && err.status < 500 && err.status !== 429) throw err;
            if (attempt < retries) {
                const delay = baseDelay * Math.pow(2, attempt) + Math.random() * 200;
                console.warn(`[API] Retrying ${endpoint} in ${Math.round(delay)}ms (Attempt ${attempt + 1}/${retries})...`);
                await new Promise(r => setTimeout(r, delay));
            }
        }
    }
    throw lastError;
}

if (typeof window !== 'undefined') {
    window.apiWithRetry = apiWithRetry;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { apiWithRetry };
}

