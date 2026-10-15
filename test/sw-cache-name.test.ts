/**
 * @file test/sw-cache-name.test.ts
 * @description Tests for the derived service-worker cache name.
 *
 * The property under test is the one whose absence cost 146 releases their
 * delivery: **the name a cache-first worker stores under must be a function of
 * what it caches.** Every test here is a way of asking "would this name change
 * if that byte changed?", and the ones that read the real tree are the ones that
 * would have caught the input set being too narrow — which it was: deriving the
 * inputs from the worker's own `ASSETS` list left the defect alive for the twelve
 * modules that are imported but not precached, and `check:sw-cache` stayed green
 * through an edit to `src/pool.ts` until a test of this shape existed.
 *
 * Runs in Node, no DOM, no browser.
 *
 * @module test/sw-cache-name
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
    cacheNameFromDigest,
    cacheLines,
    digestOf,
    expectedForRepo,
    normalizeWorker,
    precachedAssets,
    precacheInputs,
    readCacheName,
    renderWorker,
    resolveAsset
} from '../scripts/lib/sw-cache-name.mjs';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const workerPath = new URL('../service-worker.js', import.meta.url);
const committed = readFileSync(workerPath, 'utf8');

/** A minimal worker source, so the pure functions can be driven without the filesystem. */
const workerWith = (name: string) => `const CACHE = '${name}';\nconst ASSETS = ['./index.html'];\n`;

const entry = (path: string, bytes: string) => ({ path, bytes });

// ---------------------------------------------------------------------------
// the digest
// ---------------------------------------------------------------------------

test('sw-cache-name: the digest does not depend on the order inputs are read in', () => {
    const a = [entry('a.js', 'one'), entry('b.js', 'two')];
    const b = [entry('b.js', 'two'), entry('a.js', 'one')];
    assert.equal(digestOf(a), digestOf(b));
});

test('sw-cache-name: changed content changes the digest', () => {
    const before = digestOf([entry('a.js', 'one')]);
    assert.notEqual(digestOf([entry('a.js', 'two')]), before);
});

test('sw-cache-name: a rename changes the digest even when the bytes do not', () => {
    // The path is part of the input, because `dist/a.js` and `dist/b.js` are
    // different requests even when they hold identical bytes.
    assert.notEqual(digestOf([entry('a.js', 'same')]), digestOf([entry('b.js', 'same')]));
});

test('sw-cache-name: adding or removing a file changes the digest', () => {
    const one = digestOf([entry('a.js', 'one')]);
    const two = digestOf([entry('a.js', 'one'), entry('b.js', 'two')]);
    assert.notEqual(two, one);
});

test('sw-cache-name: an empty input set is refused rather than hashed', () => {
    // A name derived from nothing would be the same name forever, which is the
    // original defect with extra steps.
    assert.throws(() => digestOf([]), /empty input set/);
});

// ---------------------------------------------------------------------------
// the name
// ---------------------------------------------------------------------------

test('sw-cache-name: the name is a prefixed slice of the digest', () => {
    const digest = 'a'.repeat(64);
    assert.equal(cacheNameFromDigest(digest), `survivor-${'a'.repeat(16)}`);
});

test('sw-cache-name: a name that is not a digest is refused', () => {
    // `survivor-v3.0.1` is the hand-maintained string this replaced. It is not a
    // digest, so it can never be produced by the generator.
    assert.throws(() => cacheNameFromDigest('survivor-v3.0.1'), /not a sha256 digest/);
});

// ---------------------------------------------------------------------------
// normalization and rendering
// ---------------------------------------------------------------------------

test('sw-cache-name: normalizing removes the name so it cannot hash itself', () => {
    const result = normalizeWorker(workerWith('survivor-0123456789abcdef'));
    assert.equal(result.ok, true);
    assert.equal(result.name, 'survivor-0123456789abcdef');
    assert.equal(result.text?.includes('survivor-0123456789abcdef'), false);
    assert.equal(result.text?.split('__SURVIVOR_CACHE_NAME__').length, 2);
});

test('sw-cache-name: normalizing refuses a worker with no cache-name line', () => {
    const result = normalizeWorker("const ASSETS = ['./index.html'];\n");
    assert.equal(result.ok, false);
    assert.match(String(result.reason), /no `const CACHE/);
});

test('sw-cache-name: normalizing refuses TWO cache-name lines', () => {
    // Rewriting every match when one was meant is the `sed` failure in miniature,
    // and it is what this refusal exists for.
    const result = normalizeWorker(`${workerWith('a')}const CACHE = 'b';\n`);
    assert.equal(result.ok, false);
    assert.match(String(result.reason), /2 `const CACHE/);
});

test('sw-cache-name: a placeholder mentioned in prose as well is refused', () => {
    // Otherwise the render would substitute into the comment too, and the worker
    // would ship with a name in a sentence that nothing reads.
    const source = `${workerWith('a')}// the __SURVIVOR_CACHE_NAME__ is substituted here\n`;
    const result = normalizeWorker(source);
    assert.equal(result.ok, false);
    assert.match(String(result.reason), /appears 2 time/);
});

test('sw-cache-name: rendering substitutes the name and reports whether it changed', () => {
    const rendered = renderWorker(workerWith('survivor-v3.0.1'), 'survivor-0123456789abcdef');
    assert.equal(rendered.ok, true);
    assert.equal(rendered.changed, true);
    assert.match(String(rendered.text), /^const CACHE = 'survivor-0123456789abcdef';$/m);
    assert.equal(readCacheName(String(rendered.text)), 'survivor-0123456789abcdef');
});

test('sw-cache-name: rendering is idempotent', () => {
    const once = renderWorker(workerWith('survivor-v3.0.1'), 'survivor-0123456789abcdef');
    const twice = renderWorker(String(once.text), 'survivor-0123456789abcdef');
    assert.equal(twice.changed, false);
    assert.equal(twice.text, once.text);
});

test('sw-cache-name: rendering refuses a hand-written name', () => {
    const rendered = renderWorker(workerWith('survivor-v3.0.1'), 'survivor-v3.0.2');
    assert.equal(rendered.ok, false);
    assert.match(String(rendered.reason), /not a generated cache name/);
});

// ---------------------------------------------------------------------------
// the real tree
// ---------------------------------------------------------------------------

test('sw-cache-name: the committed worker IS what its inputs generate', () => {
    // The drift check, at unit-test speed and against the real file. If this
    // fails, `npm run check:sw-cache` fails, and the fix is `npm run gen:sw-cache`.
    const expected = expectedForRepo(repoRoot);
    assert.equal(expected.ok, true, String(expected.reason));
    assert.equal(
        expected.changed,
        false,
        `service-worker.js carries ${readCacheName(committed)}, but its inputs derive ${expected.name}`
    );
});

test('sw-cache-name: the committed name is a digest, not a version string', () => {
    // The regression guard. `survivor-v3.0.1` was the shipped name for 146
    // commits while `src/` moved under it.
    assert.match(String(readCacheName(committed)), /^survivor-[0-9a-f]{16}$/);
});

test('sw-cache-name: every tracked source under src/ is in the input set', () => {
    // THIS IS THE ASSERTION THE NARROW INPUT SET FAILED. The worker's fetch
    // handler is cache-first for any same-origin GET it has already seen, so an
    // imported-but-not-precached module such as `dist/pool.js` is served stale
    // exactly like a precached one. Deriving the inputs from `ASSETS` left those
    // modules out and the name did not move when `src/pool.ts` changed.
    const tracked = execFileSync('git', ['ls-files'], { cwd: repoRoot, encoding: 'utf8' })
        .split('\n')
        .filter((f) => f.startsWith('src/'));
    const inputs = precacheInputs(repoRoot);
    assert.equal(inputs.ok, true);
    const covered = new Set(inputs.entries.map((e) => e.path));
    assert.deepEqual(
        tracked.filter((f) => !covered.has(f)),
        []
    );
});

test('sw-cache-name: the input set covers the worker and the toolchain as well', () => {
    const inputs = precacheInputs(repoRoot);
    const covered = new Set(inputs.entries.map((e) => e.path));
    for (const rel of [
        'service-worker.js',
        'tsconfig.json',
        'tsconfig.build.json',
        'package-lock.json'
    ]) {
        assert.equal(covered.has(rel), true, `${rel} is not an input`);
    }
});

test('sw-cache-name: every asset the worker precaches resolves in this tree', () => {
    // `cache.addAll` rejects as a whole if ANY request fails, so one entry that
    // 404s means the worker never installs and offline support silently does not
    // exist. The list is checked against the real tree, not against itself.
    const inputs = precacheInputs(repoRoot);
    assert.deepEqual(inputs.unresolved, []);
    const assets = precachedAssets(committed);
    assert.equal(assets.ok, true);
    assert.ok((assets.entries?.length ?? 0) >= 5);
});

test('sw-cache-name: changing one byte of one input changes the name', () => {
    const inputs = precacheInputs(repoRoot);
    const before = cacheNameFromDigest(digestOf(inputs.entries));
    const mutated = inputs.entries.map((e) =>
        e.path === 'src/main.ts'
            ? { path: e.path, bytes: Buffer.concat([e.bytes, Buffer.from('\n// one byte\n')]) }
            : e
    );
    assert.notEqual(cacheNameFromDigest(digestOf(mutated)), before);
});

test('sw-cache-name: deriving the name twice gives the same answer', () => {
    // Purity, stated because the whole gate rests on it: the same tree must
    // produce the same name on a machine that is not this one.
    const first = expectedForRepo(repoRoot);
    const second = expectedForRepo(repoRoot);
    assert.equal(first.name, second.name);
    assert.equal(first.rendered, second.rendered);
});

// ---------------------------------------------------------------------------
// asset resolution
// ---------------------------------------------------------------------------

test('sw-cache-name: ./ is the directory index', () => {
    const tracked = new Set(['index.html']);
    assert.deepEqual(resolveAsset('/nowhere', tracked, './'), { kind: 'file', path: 'index.html' });
});

test('sw-cache-name: a dist entry is covered by the source it is compiled from', () => {
    const tracked = new Set(['src/main.ts']);
    assert.deepEqual(resolveAsset('/nowhere', tracked, './dist/main.js'), {
        kind: 'module',
        path: './dist/main.js',
        source: 'src/main.ts'
    });
});

test('sw-cache-name: a precached module with no source is reported, not ignored', () => {
    const tracked = new Set(['src/main.ts']);
    const resolved = resolveAsset('/nowhere', tracked, './dist/ghost.js');
    assert.equal(resolved.kind, 'unresolved');
    assert.match(String(resolved.reason), /nothing under src\/ compiles/);
});

test('sw-cache-name: a precached file that is not tracked is reported, not ignored', () => {
    const resolved = resolveAsset('/nowhere', new Set(['index.html']), './docs/missing.svg');
    assert.equal(resolved.kind, 'unresolved');
    assert.match(String(resolved.reason), /not a tracked file/);
});

test('sw-cache-name: the cache-name anchor is read from the file, not assumed', () => {
    const lines = cacheLines("const CACHE = 'survivor-0000000000000000';\n");
    assert.equal(lines.length, 1);
    assert.equal(lines[0].name, 'survivor-0000000000000000');
});
