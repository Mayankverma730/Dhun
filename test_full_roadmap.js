/**
 * test_full_roadmap.js
 * Comprehensive automated verification script across all 5 tiers of Dhun roadmap.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execSync, spawn } = require('child_process');

console.log('╔═══════════════════════════════════════════════════════╗');
console.log('║  DHUN FULL ROADMAP VALIDATION (TIERS 1 - 5)           ║');
console.log('╚═══════════════════════════════════════════════════════╝\n');

let passCount = 0;
let totalCount = 0;

function test(name, fn) {
    totalCount++;
    try {
        fn();
        console.log(`  ✓ [PASS] ${name}`);
        passCount++;
    } catch (err) {
        console.error(`  ✗ [FAIL] ${name}: ${err.message}`);
    }
}

// ──────────────────────────────────────────
// Tier 1: Security & Data Integrity
// ──────────────────────────────────────────
console.log('--- Tier 1: Security & Data Integrity ---');

const utils = require('./js/utils.js');
test('T1-02: escapeHTML escapes script tags and dangerous chars', () => {
    const raw = '<script>alert("xss")</script>&foo=\'bar\'';
    const escaped = utils.escapeHTML(raw);
    assert.strictEqual(escaped.includes('<script>'), false);
    assert.strictEqual(escaped.includes('&lt;script&gt;'), true);
    assert.strictEqual(escaped.includes('&quot;xss&quot;'), true);
});

test('T1-02: escapeAttribute escapes quotes', () => {
    const raw = 'pic.jpg" onmouseover="alert(1)';
    const escaped = utils.escapeAttribute(raw);
    assert.strictEqual(escaped.includes('"'), false);
    assert.strictEqual(escaped.includes('&quot;'), true);
});

test('T1-03: Content Security Policy exists in index.html', () => {
    const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
    assert.strictEqual(html.includes('Content-Security-Policy'), true);
});

// ──────────────────────────────────────────
// Tier 2: Code Architecture & Data Management
// ──────────────────────────────────────────
console.log('\n--- Tier 2: Code Architecture & Data Management ---');

const { CONFIG } = require('./js/config.js');
test('T2-07: CONFIG provides centralized constants', () => {
    assert.strictEqual(CONFIG.APP_NAME, 'Dhun');
    assert.strictEqual(CONFIG.DB_NAME, 'DhunUserDB');
    assert.strictEqual(CONFIG.DB_VERSION, 2);
    assert.strictEqual(CONFIG.SEARCH_DEBOUNCE_MS, 220);
});

const { SongModel, UserModel, PlaylistModel } = require('./js/models.js');
test('T2-03 & T3-16: SongModel creates structured song schema with metadata', () => {
    const song = new SongModel({
        title: '  Cruel Summer  ',
        artist: 'Taylor Swift',
        duration: 2.98,
        year: 2019,
        genre: 'Pop'
    });
    assert.strictEqual(song.title, 'Cruel Summer');
    assert.strictEqual(song.artist, 'Taylor Swift');
    assert.strictEqual(song.year, 2019);
    assert.strictEqual(typeof song.id, 'number');
    const json = song.toJSON();
    assert.strictEqual(json.year, 2019);
});

const { AppStore } = require('./js/state.js');
test('T2-04: AppStore implements reactive Pub/Sub', () => {
    const store = new AppStore();
    let heard = null;
    const unsub = store.subscribe('isPlaying', (val) => {
        heard = val;
    });
    store.setState('isPlaying', true);
    assert.strictEqual(heard, true);
    unsub();
    store.setState('isPlaying', false);
    assert.strictEqual(heard, true); // not updated after unsub
});

test('T2-06: VirtualScroller class is exported', () => {
    assert.strictEqual(typeof utils.VirtualScroller, 'function');
});

// ──────────────────────────────────────────
// Tier 4: Unit Testing & Performance Benchmarks
// ──────────────────────────────────────────
console.log('\n--- Tier 4 & 5: C DSA Validation & Benchmarks ---');

test('T4-01 & T5-01-T5-06: C DSA Unit Test Binary (test_dsa.exe)', () => {
    const output = execSync('.\\test_dsa.exe', { encoding: 'utf8' });
    assert.strictEqual(output.includes('29 / 29 TESTS PASSED'), true);
});

test('T4-04: C Performance Benchmarks (benchmark.exe)', () => {
    const output = execSync('.\\benchmark.exe', { encoding: 'utf8' });
    assert.strictEqual(output.includes('Benchmark successfully completed'), true);
});

// ──────────────────────────────────────────
// Summary
// ──────────────────────────────────────────
console.log('\n═══════════════════════════════════════════════════════');
console.log(`  VALIDATION SUMMARY: ${passCount} / ${totalCount} PASSED`);
console.log('═══════════════════════════════════════════════════════\n');

if (passCount === totalCount) {
    process.exit(0);
} else {
    process.exit(1);
}
