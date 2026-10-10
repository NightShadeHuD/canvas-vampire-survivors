// Unit tests for the generic object pool.

import test from 'node:test';
import assert from 'node:assert/strict';
import { EnemyProjectile, FloatingText, Particle } from '../src/entities.ts';
import { Pool, resetFloatingText, resetParticle, resetEnemyProjectile } from '../src/pool.ts';

class Box {
    declare reset: boolean;
    declare x: number;
    declare y: number;
    constructor() {
        this.reset = false;
        this.x = 0;
        this.y = 0;
    }
}

test('Pool: requires a factory function', () => {
    assert.throws(() => new Pool(null as unknown as () => object));
    assert.throws(() => new Pool('not a function' as unknown as () => object));
});

test('Pool: acquire creates fresh instances when empty', () => {
    const p = new Pool(() => new Box());
    const a = p.acquire();
    const b = p.acquire();
    assert.ok(a instanceof Box);
    assert.ok(b instanceof Box);
    assert.notStrictEqual(a, b);
    assert.equal(p.stats().created, 2);
    assert.equal(p.stats().acquired, 2);
});

test('Pool: release then acquire returns the same instance', () => {
    const p = new Pool(() => new Box());
    const a = p.acquire();
    p.release(a);
    const b = p.acquire();
    assert.strictEqual(a, b);
    // created should still be 1 even though we acquired twice.
    assert.equal(p.stats().created, 1);
});

test('Pool: reset callback runs on every acquire', () => {
    const factory = () => ({ touched: 0 });
    const reset = (obj, v) => {
        obj.touched = v;
    };
    const p = new Pool<Record<string, number>>(factory, reset);
    const a = p.acquire(42);
    assert.equal(a.touched, 42);
    p.release(a);
    const b = p.acquire(99);
    assert.strictEqual(a, b);
    assert.equal(b.touched, 99);
});

test('Pool: maxSize caps the free list', () => {
    const p = new Pool<Record<string, number>>(() => ({}), null, { maxSize: 2 });
    const items = [p.acquire(), p.acquire(), p.acquire()];
    for (const it of items) p.release(it);
    assert.equal(p.stats().free, 2);
});

test('Pool: prealloc fills the free list upfront', () => {
    const p = new Pool<Record<string, number>>(() => ({}), null, { prealloc: 5 });
    assert.equal(p.stats().free, 5);
    assert.equal(p.stats().created, 5);
});

test('Pool: prealloc is capped by maxSize', () => {
    const p = new Pool<Record<string, number>>(() => ({}), null, { prealloc: 100, maxSize: 10 });
    assert.equal(p.stats().free, 10);
});

test('Pool: clear empties the free list but leaves the pool usable', () => {
    const p = new Pool<Record<string, number>>(() => ({}), null, { prealloc: 4 });
    p.clear();
    assert.equal(p.stats().free, 0);
    const a = p.acquire();
    assert.ok(a);
});

test('Pool: release(null) is a no-op', () => {
    const p = new Pool(() => ({}));
    p.release(null);
    p.release(undefined);
    assert.equal(p.stats().free, 0);
});

test('resetFloatingText: applies all fields including defaults', () => {
    const obj = new FloatingText('', 0, 0, '#fff');
    resetFloatingText(obj, 'hello', 10, 20, '#fff');
    assert.equal((obj as any).text, 'hello');
    assert.equal((obj as any).x, 10);
    assert.equal((obj as any).y, 20);
    assert.equal((obj as any).color, '#fff');
    assert.equal((obj as any).weight, 'bold');
    assert.equal((obj as any).crit, false);
    assert.equal((obj as any).life, 1);
});

test('resetFloatingText: opts override defaults', () => {
    const obj = new FloatingText('', 0, 0, '#fff');
    resetFloatingText(obj, 'boom', 0, 0, '#f00', { crit: true, life: 2, vy: -100 });
    assert.equal((obj as any).crit, true);
    assert.equal((obj as any).life, 2);
    assert.equal((obj as any).vy, -100);
});

test('resetParticle: sets velocity components from angle+speed', () => {
    const obj = new Particle(0, 0, '#fff');
    resetParticle(obj, 5, 6, '#0f0', { angle: 0, speed: 100 });
    assert.equal((obj as any).x, 5);
    assert.equal((obj as any).y, 6);
    assert.ok(Math.abs(obj.vx - 100) < 1e-6);
    assert.ok(Math.abs(obj.vy - 0) < 1e-6);
});

test('resetEnemyProjectile: resets life + shouldRemove on re-use', () => {
    // A real projectile in a SPENT state, which is what "re-use" means here:
    // the point of the test is that the reset overwrites both fields.
    const obj = new EnemyProjectile(0, 0, 0, 100, 5);
    obj.life = 0;
    obj.shouldRemove = true;
    resetEnemyProjectile(obj, 100, 200, 0, 250, 7);
    assert.equal((obj as any).x, 100);
    assert.equal((obj as any).y, 200);
    assert.equal((obj as any).damage, 7);
    assert.equal((obj as any).life, 3);
    assert.equal((obj as any).shouldRemove, false);
    assert.equal((obj as any).size, 6);
});

test('Pool end-to-end: churn without creating unbounded objects', () => {
    const p = new Pool<Record<string, number>>(() => ({}), null, { maxSize: 16, prealloc: 0 });
    // Acquire 32 items, release them — we should only have created up to 32
    // once, and future acquires reuse the pooled instances.
    const acquired = [];
    for (let i = 0; i < 32; i++) acquired.push(p.acquire());
    for (const it of acquired) p.release(it);
    assert.equal(p.stats().created, 32);
    // Next 1000 acquires shouldn't grow `created` beyond 32.
    for (let i = 0; i < 1000; i++) {
        const a = p.acquire();
        p.release(a);
    }
    assert.equal(p.stats().created, 32);
});

test('Pool: acquired counter decrements on release but never goes negative', () => {
    const p = new Pool(() => ({}));
    const a = p.acquire();
    assert.equal(p.stats().acquired, 1);
    p.release(a);
    // An extra release (e.g. double-free bug) must not crash or go negative.
    p.release(a);
    assert.ok(p.stats().acquired >= 0);
});

test('Pool: default maxSize is 512', () => {
    const p = new Pool(() => ({}));
    assert.equal(p.stats().maxSize, 512);
});

test('resetParticle: zero speed keeps entity stationary', () => {
    const obj = new Particle(0, 0, '#fff');
    resetParticle(obj, 10, 20, '#fff', { angle: 0, speed: 0 });
    assert.equal((obj as any).vx, 0);
    assert.equal((obj as any).vy, 0);
});

test('resetFloatingText: empty opts leaves weight as default "bold"', () => {
    const obj = new FloatingText('', 0, 0, '#fff');
    resetFloatingText(obj, 'x', 0, 0, '#fff');
    assert.equal((obj as any).weight, 'bold');
});

test('resetEnemyProjectile: negative angles map to correct velocity signs', () => {
    const obj = new EnemyProjectile(0, 0, 0, 100, 5);
    resetEnemyProjectile(obj, 0, 0, -Math.PI / 2, 100, 5);
    assert.ok(Math.abs(obj.vx) < 1e-6);
    assert.ok(Math.abs(obj.vy + 100) < 1e-6);
});

test('Pool: reset callback argument forwarding is positional', () => {
    const factory = () => ({});
    const reset = (obj, a, b, c) => {
        obj.a = a;
        obj.b = b;
        obj.c = c;
    };
    const p = new Pool<Record<string, number>>(factory, reset);
    const o = p.acquire(1, 2, 3);
    assert.equal(o.a, 1);
    assert.equal(o.b, 2);
    assert.equal(o.c, 3);
});

test('Pool: release(undefined) is a no-op (no throw)', () => {
    const p = new Pool(() => ({}));
    assert.doesNotThrow(() => p.release(undefined));
    assert.equal(p.stats().free, 0);
});
