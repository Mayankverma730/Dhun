/**
 * js/config.js — Central Configuration Management
 * Dhun Music Management System [T2-01, T2-07]
 */

const CONFIG = {
    APP_NAME: 'Dhun',
    VERSION: '2.5.0',
    API_BASE_URL: (typeof window !== 'undefined' && (window.location.origin.includes('localhost') || window.location.origin.includes('127.0.0.1')))
        ? window.location.origin
        : '',
    FALLBACK_API_PORT: 3000,
    MQTT_BROKERS: [
        'wss://broker.emqx.io:8084/mqtt',
        'wss://broker.hivemq.com:8884/mqtt'
    ],
    DB_NAME: 'DhunUserDB',
    DB_VERSION: 2,
    DEFAULT_VOLUME: 0.85,
    VISUALIZER_FPS: 60,
    SEARCH_DEBOUNCE_MS: 220,
    JAM_HEARTBEAT_INTERVAL_MS: 3000,
    JAM_STALE_HOST_TIMEOUT_MS: 15000,
    MAX_HISTORY_ITEMS: 50,
    CACHE_EXPIRY_MS: 10 * 60 * 1000 // 10 minutes
};

if (typeof window !== 'undefined') {
    window.CONFIG = CONFIG;
    window.DHUN_CONFIG = CONFIG;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { CONFIG };
}
