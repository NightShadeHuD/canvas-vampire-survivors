// Performance budget tests.
//
// The point of these is to fail when a change makes the game slow, without
// being flaky. So the assertions are mostly *deterministic* properties —
// allocation counts, instance identity, candidate-set size — because those are
// exactly what the perf mechanisms in this codebase exist to control, and they
// are identical on every machine.
//
// Only one test asserts wall-clock time. Its budget is deliberately ~17x the
// measured cost so it cannot flake on a slow shared CI runner, while still
// catching the class of regression it exists for: an accidental return to the
// O(n^2) pairwise scan that v1.x used. See docs/ENGINEERING-STANDARDS.md §4.
//
// Runs in Node, no DOM.

import test from 'node:test';
import assert from 'node:assert/strict';
import { Pool, resetParticle } from '../src/pool.ts';
import { SpatialHash } from '../src/spatial-hash.ts';

// ---------------------------------------------------------------------------
// Object pool — the GC-pressure budget
// ---------------------------------------------------------------------------

test('perf/pool: steady-state acquire/release allocates nothing', () => {
    const pool = new Pool(
        () => ({ v: 0 }),
        (o, v) => (o.v = v),
        { maxSize: 128 }
    );

    // Warm up: one instance is created, then recycled forever.
    const warm = pool.acquire(0);
    pool.release(warm);

    for (let i = 0; i < 100000; i++) {
        const o = pool.acquire(i);
        pool.release(o);
    }

    assert.equal(pool.stats().created, 1, '100k cycles must not allocate a second instance');
});

test('perf/pool: acquire hands back the same instance after release', () => {
    const pool = new Pool(() => ({}), null, { maxSize: 4 });
    const first = pool.acquire();
    pool.release(first);
    const second = pool.acquire();
    assert.equal(second, first, 'a freed instance must be reused, not replaced');
});

test('perf/pool: the free list never grows past maxSize', () => {
    const pool = new Pool(() => ({}), null, { maxSize: 4 });
    const handedOut = [];
    for (let i = 0; i < 10; i++) handedOut.push(pool.acquire());
    for (const o of handedOut) pool.release(o);

    assert.equal(pool.stats().free, 4, 'memory must stay bounded under a late-game spawn burst');
});

test('perf/pool: a simulated 60s run at 60fps stays within a fixed object count', () => {
    // The real workload: dozens of particles spawned and discarded every frame.
    // With pooling, the total number of objects ever created must depend on the
    // per-frame peak, not on how long the player survives.
    const PARTICLES_PER_FRAME = 24;
    const FRAMES = 60 * 60; // 60 seconds at 60fps
    const pool = new Pool(() => ({}), resetParticle, { maxSize: 512 });

    for (let frame = 0; frame < FRAMES; frame++) {
        const live = [];
        for (let i = 0; i < PARTICLES_PER_FRAME; i++) live.push(pool.acquire(i, i, '#fff'));
        for (const p of live) pool.release(p);
    }

    const { created } = pool.stats();
    assert.ok(
        created <= PARTICLES_PER_FRAME,
        `expected at most ${PARTICLES_PER_FRAME} objects for ${FRAMES} frames, created ${created}`
    );
});

test('perf/pool: reset is applied on every reuse, so stale state cannot leak', () => {
    const pool = new Pool(() => ({}), resetParticle, { maxSize: 8 });
    const a = pool.acquire(10, 20, '#f00', { life: 5, size: 9 });
    assert.equal(a.life, 5);
    pool.release(a);

    const b = pool.acquire(1, 2, '#0f0', { life: 1, size: 2 });
    assert.equal(b, a, 'same instance reused');
    assert.equal(b.life, 1, 'reset must overwrite the previous run’s life');
    assert.equal(b.size, 2, 'reset must overwrite the previous run’s size');
    assert.equal(b.x, 1, 'reset must overwrite the previous position');
});

// ---------------------------------------------------------------------------
// Spatial hash — the broad-phase budget
// ---------------------------------------------------------------------------

test('perf/spatial-hash: a local query touches a small fraction of entities', () => {
    const hash = new SpatialHash<{ x: number; y: number; id: string }>(64);
    const N = 5000;
    const items = [];
    for (let i = 0; i < N; i++) {
        items.push({ x: (i % 100) * 64, y: Math.floor(i / 100) * 64 });
    }
    hash.insertAll(items);

    const candidates = hash.queryRect(0, 0, 64);
    assert.ok(candidates.length > 0, 'the query must find the entities that are actually there');
    assert.ok(
        candidates.length < N / 50,
        `broad phase must cull: got ${candidates.length} candidates out of ${N}`
    );
});

test('perf/spatial-hash: querying never misses a genuinely nearby entity', () => {
    // Culling is only useful if it is correct. Every entity inside the radius
    // must appear in the candidate set.
    const hash = new SpatialHash<{ x: number; y: number; id: string }>(32);
    const items = [
        { id: 'inside-a', x: 10, y: 10 },
        { id: 'inside-b', x: 15, y: 12 },
        { id: 'inside-c', x: 0, y: 0 },
        { id: 'far-away', x: 9000, y: 9000 }
    ];
    hash.insertAll(items);

    const found = new Set(hash.queryRect(10, 10, 16).map((e) => e.id));
    assert.ok(found.has('inside-a'));
    assert.ok(found.has('inside-b'));
    assert.ok(found.has('inside-c'));
    assert.ok(!found.has('far-away'), 'distant entities must not be returned');
});

test('perf/spatial-hash: findNearest picks the true closest within range', () => {
    const hash = new SpatialHash<{ x: number; y: number; id: string }>(64);
    hash.insertAll([
        { id: 'near', x: 20, y: 0 },
        { id: 'mid', x: 60, y: 0 },
        { id: 'out-of-range', x: 5000, y: 0 }
    ]);
    assert.equal(hash.findNearest(0, 0, 100).id, 'near');
    assert.equal(hash.findNearest(0, 0, 10), null, 'nothing inside a tiny radius');
});

test('perf/spatial-hash: 20k entities x 20k queries stays inside the time budget', () => {
    // Budget rationale, measured on an M-series laptop: 172ms.
    // The budget is 3000ms — roughly 17x headroom, so a slow shared CI runner
    // cannot fail it. A naive O(n) scan per query would be 400M distance
    // checks (~2-10s), so the regression this guards is still caught.
    const BUDGET_MS = 3000;

    const hash = new SpatialHash<{ x: number; y: number; id: string }>(64);
    const N = 20000;
    const items = [];
    for (let i = 0; i < N; i++) {
        items.push({ x: (i % 200) * 64, y: Math.floor(i / 200) * 64 });
    }
    hash.insertAll(items);

    // Warm up so the measurement is not dominated by first-call JIT.
    for (let i = 0; i < 1000; i++) hash.findNearest(5000, 5000, 400);

    const QUERIES = 20000;
    const started = performance.now();
    let hits = 0;
    for (let i = 0; i < QUERIES; i++) {
        if (hash.findNearest((i % 200) * 64, 3000, 400)) hits++;
    }
    const elapsed = performance.now() - started;

    assert.equal(hits, QUERIES, 'every query should have found something in this fixture');
    assert.ok(
        elapsed < BUDGET_MS,
        `broad phase took ${elapsed.toFixed(1)}ms for ${QUERIES} queries, budget ${BUDGET_MS}ms`
    );
});
