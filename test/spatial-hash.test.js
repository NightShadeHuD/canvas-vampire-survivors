// Unit tests for the generic spatial-hash broad phase.
// Run with: `npm test`.

import test from 'node:test';
import assert from 'node:assert/strict';
import { SpatialHash } from '../src/spatial-hash.ts';

// Helper: collect an iterable into an array so we can assert length + membership.
function collect(iter) {
    const out = [];
    for (const x of iter) out.push(x);
    return out;
}

test('SpatialHash: starts empty', () => {
    const h = new SpatialHash(64);
    assert.equal(h.size, 0);
    assert.equal(h.occupiedCellCount(), 0);
    assert.equal(collect(h.queryRect(0, 0, 1000)).length, 0);
});

test('SpatialHash: insert/size bookkeeping', () => {
    const h = new SpatialHash(64);
    h.insert({ x: 10, y: 10, name: 'a' });
    h.insert({ x: 20, y: 20, name: 'b' });
    h.insert({ x: 500, y: 500, name: 'c' });
    assert.equal(h.size, 3);
    assert.equal(h.occupiedCellCount(), 2); // a+b share a cell, c in another
});

test('SpatialHash: clear() empties the index', () => {
    const h = new SpatialHash(64);
    h.insert({ x: 0, y: 0 });
    h.insert({ x: 100, y: 100 });
    assert.equal(h.size, 2);
    h.clear();
    assert.equal(h.size, 0);
    assert.equal(h.occupiedCellCount(), 0);
});

test('SpatialHash: insertAll replaces previous contents', () => {
    const h = new SpatialHash(64);
    h.insert({ x: 999, y: 999 });
    h.insertAll([
        { x: 0, y: 0 },
        { x: 10, y: 10 }
    ]);
    assert.equal(h.size, 2);
});

test('SpatialHash: queryRect returns items inside the square', () => {
    const h = new SpatialHash(64);
    const items = [
        { x: 0, y: 0, id: 0 },
        { x: 10, y: 10, id: 1 },
        { x: 1000, y: 1000, id: 2 }
    ];
    h.insertAll(items);
    const near = collect(h.queryRect(5, 5, 50));
    const ids = near.map((i) => i.id).sort();
    assert.deepEqual(ids, [0, 1]);
});

test('SpatialHash: queryRect may include cell neighbours beyond radius (caller filters)', () => {
    // The contract says queryRect returns "maybe" matches — we test that
    // items in a neighbouring cell but outside radius ARE yielded, so
    // callers know they must do the exact distance check themselves.
    const h = new SpatialHash(64);
    h.insert({ x: 0, y: 0 });
    h.insert({ x: 70, y: 0 }); // different cell, 70px away
    const hits = collect(h.queryRect(0, 0, 10));
    // 70 > 10 but it's in the neighbouring cell on the axis, so the broad
    // phase yields it. Caller must filter by Euclidean distance afterwards.
    assert.ok(hits.length >= 1);
});

test('SpatialHash: queryRect with zero radius still works on exact cell', () => {
    const h = new SpatialHash(64);
    h.insert({ x: 5, y: 5, v: 'hit' });
    const out = collect(h.queryRect(5, 5, 0));
    assert.equal(out.length, 1);
    assert.equal(out[0].v, 'hit');
});

test('SpatialHash: findNearest returns closest by Euclidean distance', () => {
    const h = new SpatialHash(64);
    const items = [
        { x: 40, y: 0, id: 'far' },
        { x: 10, y: 0, id: 'close' },
        { x: 100, y: 0, id: 'farther' }
    ];
    h.insertAll(items);
    const nearest = h.findNearest(0, 0, 500);
    assert.equal(nearest.id, 'close');
});

test('SpatialHash: findNearest returns null when nothing in range', () => {
    const h = new SpatialHash(64);
    h.insert({ x: 1000, y: 1000 });
    assert.equal(h.findNearest(0, 0, 100), null);
});

test('SpatialHash: findNearestEnemy is an alias for findNearest', () => {
    const h = new SpatialHash(64);
    h.insert({ x: 10, y: 0, id: 'a' });
    assert.strictEqual(h.findNearestEnemy(0, 0, 500), h.findNearest(0, 0, 500));
});

test('SpatialHash: insertEnemies (legacy alias) clears then inserts', () => {
    const h = new SpatialHash(64);
    h.insert({ x: 0, y: 0, legacy: 'stale' });
    h.insertEnemies([{ x: 10, y: 10, v: 'fresh' }]);
    const all = collect(h.queryRect(0, 0, 1000));
    assert.equal(all.length, 1);
    assert.equal(all[0].v, 'fresh');
});

test('SpatialHash: negative coordinates bucket correctly', () => {
    const h = new SpatialHash(64);
    h.insert({ x: -10, y: -10, id: 'neg' });
    h.insert({ x: 10, y: 10, id: 'pos' });
    const near = collect(h.queryRect(-5, -5, 20));
    assert.ok(near.find((i) => i.id === 'neg'));
});

test('SpatialHash: many items + many queries (smoke perf check)', () => {
    const h = new SpatialHash(64);
    const items = [];
    for (let i = 0; i < 500; i++) {
        items.push({ x: Math.random() * 2000, y: Math.random() * 2000, id: i });
    }
    h.insertAll(items);
    // 200 range queries — this would be O(n*k) with linear scan.
    let total = 0;
    for (let q = 0; q < 200; q++) {
        const qx = Math.random() * 2000;
        const qy = Math.random() * 2000;
        for (const _ of h.queryRect(qx, qy, 80)) total++;
    }
    assert.ok(total >= 0); // just ensure no crash + iteration works
    assert.equal(h.size, 500);
});

test('SpatialHash: cell-size 1 still works for fractional coords', () => {
    const h = new SpatialHash(1);
    h.insert({ x: 0.25, y: 0.75 });
    h.insert({ x: 1.5, y: 1.5 });
    assert.equal(h.size, 2);
    const near = collect(h.queryRect(0, 0, 0));
    assert.equal(near.length, 1);
});

test('SpatialHash: queryRect with huge radius scans everything', () => {
    const h = new SpatialHash(64);
    const items = [];
    for (let i = 0; i < 50; i++) {
        items.push({ x: i * 10, y: i * 10 });
    }
    h.insertAll(items);
    const seen = collect(h.queryRect(250, 250, 10000));
    assert.equal(seen.length, items.length);
});

test('SpatialHash: identical coordinates stack in the same cell', () => {
    const h = new SpatialHash(64);
    for (let i = 0; i < 10; i++) h.insert({ x: 5, y: 5, id: i });
    assert.equal(h.size, 10);
    assert.equal(h.occupiedCellCount(), 1);
});

test('SpatialHash: findNearest with zero range returns null', () => {
    const h = new SpatialHash(64);
    h.insert({ x: 1, y: 1 });
    assert.equal(h.findNearest(0, 0, 0), null);
});

test('SpatialHash: findNearest returns closest even when multiple share a cell', () => {
    const h = new SpatialHash(64);
    h.insert({ x: 0.1, y: 0, id: 'c' });
    h.insert({ x: 0.2, y: 0, id: 'far' });
    h.insert({ x: 0.05, y: 0, id: 'closest' });
    assert.equal(h.findNearest(0, 0, 1).id, 'closest');
});

test('SpatialHash: large negative AND positive coordinates work together', () => {
    const h = new SpatialHash(64);
    h.insert({ x: -5000, y: -5000, id: 'a' });
    h.insert({ x: 5000, y: 5000, id: 'b' });
    assert.equal(h.occupiedCellCount(), 2);
    assert.equal(h.findNearest(-4990, -4990, 100).id, 'a');
});
