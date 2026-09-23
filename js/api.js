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
                // Do not retry client errors (4xx) except 429 Too Many Requests
                if (res.status >= 400 && res.status < 500 && res.status !== 429) {
                    const errBody = await res.json().catch(() => ({ error: res.statusText }));
                    throw new Error(errBody.error || `HTTP error ${res.status}`);
                }
                throw new Error(`HTTP ${res.status}: ${res.statusText}`);
            }

            return await res.json();
        } catch (err) {
            lastError = err;
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

