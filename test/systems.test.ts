// Unit tests for src/systems.ts — the shake camera and the FPS meter.
//
// This module had 0% coverage: no test imported it, so it did not appear in the
// coverage report at all. It is small, pure, and drives two things a player
// feels directly — screen shake on impact and the FPS readout — which makes the
// absence of any test the more surprising.
//
// Runs in Node, no DOM. Randomness is stubbed rather than tolerated, so the
// offset assertions are exact instead of merely bounded.

import test from 'node:test';
import assert from 'node:assert/strict';
import { ShakeCamera, FpsMeter, SpatialHash } from '../src/systems.ts';

/** Run `fn` with Math.random pinned to `value`, restoring it afterwards. */
function withRandom(value, fn) {
    const real = Math.random;
    Math.random = () => value;
    try {
        return fn();
    } finally {
        Math.random = real;
    }
}

// ---------------------------------------------------------------------------
// ShakeCamera
// ---------------------------------------------------------------------------

test('systems/ShakeCamera: starts at rest', () => {
    const cam = new ShakeCamera();
    assert.equal(cam.intensity, 0);
    assert.equal(cam.x, 0);
    assert.equal(cam.y, 0);
    assert.equal(cam.worldX, 0);
    assert.equal(cam.worldY, 0);
});

test('systems/ShakeCamera: shake takes the maximum, it does not accumulate', () => {
    const cam = new ShakeCamera();
    cam.shake(5);
    assert.equal(cam.intensity, 5);
    cam.shake(3);
    assert.equal(cam.intensity, 5, 'a weaker shake must not reduce the current one');
    cam.shake(9);
    assert.equal(cam.intensity, 9, 'a stronger shake must raise it');
});

test('systems/ShakeCamera: update with shake disabled zeroes the offset', () => {
    const cam = new ShakeCamera();
    cam.shake(10);
    cam.update(0.016, false);
    assert.equal(cam.x, 0);
    assert.equal(cam.y, 0);
    assert.equal(cam.intensity, 0, 'disabling shake must also drop the intensity');
});

test('systems/ShakeCamera: update at rest is a no-op', () => {
    const cam = new ShakeCamera();
    cam.update(0.016, true);
    assert.equal(cam.intensity, 0);
    assert.equal(cam.x, 0);
    assert.equal(cam.y, 0);
});

test('systems/ShakeCamera: intensity decays by 2 per second, floored at zero', () => {
    const cam = new ShakeCamera();
    cam.shake(1);
    cam.update(0.1, true);
    assert.ok(Math.abs(cam.intensity - 0.8) < 1e-9, `expected 0.8, got ${cam.intensity}`);

    cam.update(0.5, true);
    assert.equal(cam.intensity, 0, 'decay must floor at zero, never go negative');
});

test('systems/ShakeCamera: offset is exact for a pinned random value', () => {
    // i = intensity * 12; offset = (rand - 0.5) * i. With rand = 0.5 the offset
    // is exactly zero; with rand = 0 or 1 it is exactly half of i either way.
    const cam = new ShakeCamera();

    withRandom(0.5, () => {
        cam.shake(1);
        cam.update(0, true);
        assert.equal(cam.x, 0);
        assert.equal(cam.y, 0);
    });

    withRandom(0, () => {
        cam.shake(1);
        cam.update(0, true);
        assert.equal(cam.x, -6, 'rand=0 gives (0-0.5) * 1 * 12 = -6');
        assert.equal(cam.y, -6);
    });

    withRandom(1, () => {
        cam.shake(1);
        cam.update(0, true);
        assert.equal(cam.x, 6, 'rand=1 gives (1-0.5) * 1 * 12 = +6');
        assert.equal(cam.y, 6);
    });
});

test('systems/ShakeCamera: offset scales with intensity', () => {
    const cam = new ShakeCamera();
    withRandom(1, () => {
        cam.shake(2);
        cam.update(0, true);
        assert.equal(cam.x, 12, 'double the intensity, double the offset');
    });
});

test('systems/ShakeCamera: offset never exceeds half the shake magnitude', () => {
    // Bounded, not exact: real randomness. The bound is what matters visually —
    // an unbounded offset would throw the camera off the arena.
    const cam = new ShakeCamera();
    for (let i = 0; i < 500; i++) {
        cam.shake(1);
        const before = cam.intensity;
        cam.update(0, true);
        assert.ok(
            Math.abs(cam.x) <= before * 6 && Math.abs(cam.y) <= before * 6,
            `offset out of bounds: ${cam.x}, ${cam.y} at intensity ${before}`
        );
    }
});

test('systems/ShakeCamera: decays to rest over successive frames', () => {
    const cam = new ShakeCamera();
    cam.shake(1);
    let frames = 0;
    // 2 units per second at 60fps: ~30 frames to fall from 1 to 0.
    while (cam.intensity > 0 && frames < 1000) {
        cam.update(1 / 60, true);
        frames++;
    }
    assert.ok(frames > 0 && frames <= 31, `expected ~30 frames to settle, took ${frames}`);

    cam.update(1 / 60, true);
    assert.equal(cam.x, 0, 'once settled the camera must be still');
    assert.equal(cam.y, 0);
});

// ---------------------------------------------------------------------------
// FpsMeter
// ---------------------------------------------------------------------------

test('systems/FpsMeter: starts empty and reports zero', () => {
    const meter = new FpsMeter();
    assert.deepEqual(meter.samples, []);
    assert.equal(meter.fps, 0);
});

test('systems/FpsMeter: a single sample reports its reciprocal', () => {
    const meter = new FpsMeter();
    meter.tick(0.5);
    assert.equal(meter.fps, 2);
});

test('systems/FpsMeter: a steady 60fps reads as 60', () => {
    const meter = new FpsMeter();
    for (let i = 0; i < 60; i++) meter.tick(1 / 60);
    assert.ok(Math.abs(meter.fps - 60) < 1e-9, `expected 60, got ${meter.fps}`);
});

test('systems/FpsMeter: the rolling window holds at most 60 samples', () => {
    const meter = new FpsMeter();
    for (let i = 0; i < 200; i++) meter.tick(1 / 60);
    assert.equal(meter.samples.length, 60, 'the window must not grow without bound');
});

test('systems/FpsMeter: an old stall stops affecting the reading once it ages out', () => {
    const meter = new FpsMeter();
    meter.tick(1); // a one-second frame: 1 fps
    assert.equal(meter.fps, 1);

    // Push it out of the 60-sample window.
    for (let i = 0; i < 60; i++) meter.tick(1 / 60);
    assert.ok(meter.fps > 59, `the stall should have aged out, got ${meter.fps}`);
});

test('systems/FpsMeter: a zero delta does not produce Infinity', () => {
    // Two frames in the same millisecond is real on a fast machine, and 1/0
    // would put "Infinity fps" on the HUD.
    const meter = new FpsMeter();
    meter.tick(0);
    assert.equal(meter.fps, 0, 'a zero average must report 0, not Infinity');

    meter.tick(0);
    assert.equal(meter.fps, 0);
    assert.ok(Number.isFinite(meter.fps));
});

// ---------------------------------------------------------------------------
// re-export
// ---------------------------------------------------------------------------

test('systems: SpatialHash is re-exported as the same class, not a copy', async () => {
    const direct = await import('../src/spatial-hash.ts');
    assert.equal(
        SpatialHash,
        direct.SpatialHash,
        'the backwards-compatibility re-export must be the identical class'
    );
});
