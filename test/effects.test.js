// Unit tests for src/effects.ts — focuses on the v2.5 schedule queue, since
// the visual effects (flash/pulse/hit) are exercised via the gameplay loop.

import test from 'node:test';
import assert from 'node:assert/strict';
import { EffectLayer } from '../src/effects.ts';

test('EffectLayer.schedule: fires after the requested dt accumulates', () => {
    const fx = new EffectLayer();
    let fired = 0;
    fx.schedule(0.4, () => fired++);

    fx.update(0.1);
    fx.update(0.1);
    fx.update(0.1);
    assert.equal(fired, 0, 'should not fire before the time elapses');

    fx.update(0.15); // crosses 0.4 threshold
    assert.equal(fired, 1, 'should fire exactly once when t crosses zero');

    fx.update(1.0);
    assert.equal(fired, 1, 'should not re-fire once removed');
});

test('EffectLayer.schedule: respects pause (no update == no advance)', () => {
    const fx = new EffectLayer();
    let fired = 0;
    fx.schedule(0.4, () => fired++);

    // Simulate the game being paused for "wall-clock" time: we just don't
    // call update(). The queue should not have advanced at all.
    assert.equal(fired, 0);

    // Resume: tick enough dt to fire.
    fx.update(0.5);
    assert.equal(fired, 1, 'fires after sim resumes, not on wall clock');
});

test('EffectLayer.schedule: cancelled token never fires', () => {
    const fx = new EffectLayer();
    let fired = 0;
    const tok = fx.schedule(0.2, () => fired++);
    tok.cancelled = true;
    fx.update(0.5);
    assert.equal(fired, 0);
});

test('EffectLayer.schedule: fn that throws does not break the queue', () => {
    const fx = new EffectLayer();
    let after = 0;
    fx.schedule(0.1, () => {
        throw new Error('boom');
    });
    fx.schedule(0.1, () => after++);
    // Console.warn is fine; the second callback must still fire.
    fx.update(0.2);
    assert.equal(after, 1);
});

test('EffectLayer.update: drains multiple scheduled callbacks in one tick', () => {
    const fx = new EffectLayer();
    let n = 0;
    for (let i = 0; i < 5; i++) fx.schedule(0.1, () => n++);
    fx.update(0.5);
    assert.equal(n, 5);
    assert.equal(fx.delays.length, 0);
});
