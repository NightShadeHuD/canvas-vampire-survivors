// Unit tests for iter-15 — tutorial state machine + replay record/playback.
// Pure-Node tests; the storage layer falls back to its in-memory shim when
// `window` is missing, and the replay module's localStorage probe ditto.

import test from 'node:test';
import assert from 'node:assert/strict';

import { TUTORIAL_STEPS, TutorialState } from '../src/tutorial.ts';
import {
    REPLAY_VERSION,
    ReplayPlayer,
    ReplayRecorder,
    _resetReplayForTests,
    clearReplay,
    compressFrames,
    expandFrames,
    loadReplay,
    quantize,
    saveReplay
} from '../src/replay.ts';

test.beforeEach(() => {
    _resetReplayForTests();
});

// ---------------------------------------------------------------------------
// Tutorial state machine
// ---------------------------------------------------------------------------

test('iter15 tutorial: 5 steps in the documented order', () => {
    const ids = TUTORIAL_STEPS.map((s) => s.id);
    assert.deepEqual(ids, ['move', 'autoAttack', 'pickupExp', 'levelUp', 'pause']);
    assert.equal(TutorialState.TOTAL_STEPS, 5);
});

test('iter15 tutorial: starts inactive, currentStep is null', () => {
    const ts = new TutorialState();
    assert.equal(ts.active, false);
    assert.equal(ts.currentStep, null);
    assert.equal(ts.currentPrompt(), null);
});

test('iter15 tutorial: start() activates and points at step 0', () => {
    const ts = new TutorialState();
    ts.start();
    assert.equal(ts.active, true);
    assert.equal(ts.currentStep.id, 'move');
    const prompt = ts.currentPrompt();
    assert.ok(prompt && /Step 1/.test(prompt.title));
});

test('iter15 tutorial: move step advances after threshold of move-input time', () => {
    const ts = new TutorialState();
    ts.start();
    // Below the 0.4s threshold → still on the same step.
    ts.tick(0.1, { x: 1, y: 0 });
    ts.tick(0.1, { x: 1, y: 0 });
    assert.equal(ts.currentStep.id, 'move');
    // Crossing the threshold → advance to autoAttack.
    ts.tick(0.3, { x: 1, y: 0 });
    assert.equal(ts.currentStep.id, 'autoAttack');
});

test('iter15 tutorial: zero/near-zero movement does not advance step 1', () => {
    const ts = new TutorialState();
    ts.start();
    for (let i = 0; i < 20; i++) ts.tick(0.1, { x: 0.01, y: -0.02 });
    assert.equal(ts.currentStep.id, 'move', 'tiny inputs should be filtered');
});

test('iter15 tutorial: autoAttack auto-advances after 1.5s of gameplay', () => {
    const ts = new TutorialState();
    ts.start();
    ts.advance(); // skip past move
    assert.equal(ts.currentStep.id, 'autoAttack');
    for (let i = 0; i < 10; i++) ts.tick(0.1, { x: 0, y: 0 });
    // 1.0s elapsed — still here.
    assert.equal(ts.currentStep.id, 'autoAttack');
    for (let i = 0; i < 6; i++) ts.tick(0.1, { x: 0, y: 0 });
    assert.equal(ts.currentStep.id, 'pickupExp');
});

test('iter15 tutorial: orb / level-up / pause notifications advance the right step', () => {
    const ts = new TutorialState();
    ts.start();
    ts.advance(); // → autoAttack
    ts.advance(); // → pickupExp
    // Pickup notification must advance.
    ts.notifyOrbPickup();
    assert.equal(ts.currentStep.id, 'levelUp');
    ts.notifyLevelUp();
    assert.equal(ts.currentStep.id, 'pause');
    ts.notifyPause();
    assert.equal(ts.completed, true);
    assert.equal(ts.active, false);
});

test('iter15 tutorial: notifications on the wrong step are ignored', () => {
    const ts = new TutorialState();
    ts.start();
    // Step 0 is `move` — pause/orb/level should not skip ahead.
    ts.notifyPause();
    ts.notifyOrbPickup();
    ts.notifyLevelUp();
    assert.equal(ts.currentStep.id, 'move');
});

test('iter15 tutorial: skip() ends the tutorial without completing', () => {
    const ts = new TutorialState();
    ts.start();
    ts.skip();
    assert.equal(ts.active, false);
    assert.equal(ts.skipped, true);
    assert.equal(ts.completed, false);
    // Subsequent ticks/notifications are no-ops.
    ts.tick(1, { x: 1, y: 0 });
    ts.notifyOrbPickup();
});

// ---------------------------------------------------------------------------
// Replay: serialization helpers
// ---------------------------------------------------------------------------

test('iter15 replay: quantize rounds to 2 decimals and handles non-finite', () => {
    assert.equal(quantize(0.123456), 0.12);
    assert.equal(quantize(-0.4567), -0.46);
    assert.equal(quantize(1), 1);
    assert.equal(quantize(NaN), 0);
    assert.equal(quantize(Infinity), 0);
});

test('iter15 replay: compress / expand frames is lossless and RLE shrinks runs', () => {
    const flat = [
        [0, 0],
        [0, 0],
        [0, 0],
        [1, 0],
        [1, 0],
        [-1, 1],
        [0, 0]
    ];
    const rle = compressFrames(flat);
    assert.deepEqual(rle, [
        [0, 0, 3],
        [1, 0, 2],
        [-1, 1, 1],
        [0, 0, 1]
    ]);
    const back = expandFrames(rle);
    assert.deepEqual(back, flat);
});

test('iter15 replay: empty frames compress / expand to empty arrays', () => {
    assert.deepEqual(compressFrames([]), []);
    assert.deepEqual(expandFrames([]), []);
    assert.deepEqual(expandFrames(null), []);
});

// ---------------------------------------------------------------------------
// Replay recorder + roundtrip via storage
// ---------------------------------------------------------------------------

test('iter15 replay: recorder captures inputs and finalize() snapshots stats', () => {
    const r = new ReplayRecorder({
        seed: 12345,
        stage: 'tundra',
        difficulty: 'hard',
        dt: 1 / 60
    });
    for (let i = 0; i < 10; i++) r.record({ x: 0, y: 0 });
    for (let i = 0; i < 5; i++) r.record({ x: 1, y: 0 });
    r.finalize({ kills: 42, time: 123.4, level: 7 });
    const blob = r.serialize();
    assert.equal(blob.version, REPLAY_VERSION);
    assert.equal(blob.seed, 12345);
    assert.equal(blob.stage, 'tundra');
    assert.equal(blob.difficulty, 'hard');
    assert.equal(blob.finalKills, 42);
    assert.equal(blob.finalLevel, 7);
    // RLE: 10 zeros + 5 (1,0)s collapse to two entries.
    assert.equal(blob.frames.length, 2);
});

test('iter15 replay: saveReplay → loadReplay roundtrip preserves data', () => {
    const r = new ReplayRecorder({ seed: 7, stage: 'forest' });
    for (let i = 0; i < 6; i++) r.record({ x: 0.5, y: -0.5 });
    r.finalize({ kills: 1, time: 30, level: 2 });
    saveReplay(r.serialize());
    const loaded = loadReplay();
    assert.ok(loaded);
    assert.equal(loaded.seed, 7);
    assert.equal(loaded.stage, 'forest');
    const expanded = expandFrames(loaded.frames);
    assert.equal(expanded.length, 6);
    assert.deepEqual(expanded[0], [0.5, -0.5]);
});

test('iter15 replay: clearReplay drops the saved blob', () => {
    saveReplay({ version: REPLAY_VERSION, frames: [], finalKills: 0 });
    assert.ok(loadReplay());
    clearReplay();
    assert.equal(loadReplay(), null);
});

test('iter15 replay: loadReplay rejects mismatched version', () => {
    saveReplay({ version: 999, frames: [] });
    assert.equal(loadReplay(), null, 'future-version blob must not deserialize');
});

// ---------------------------------------------------------------------------
// Replay player
// ---------------------------------------------------------------------------

test('iter15 replay: ReplayPlayer.clampSpeed snaps to {1, 2, 4}', () => {
    assert.equal(ReplayPlayer.clampSpeed(1), 1);
    assert.equal(ReplayPlayer.clampSpeed(2), 2);
    assert.equal(ReplayPlayer.clampSpeed(4), 4);
    assert.equal(ReplayPlayer.clampSpeed(3), 2, 'midpoints round to lower legal speed');
    assert.equal(ReplayPlayer.clampSpeed(10), 4);
    assert.equal(ReplayPlayer.clampSpeed(0), 1, 'invalid → 1');
    assert.equal(ReplayPlayer.clampSpeed(NaN), 1);
});

test('iter15 replay: player ticks at 1× consume one frame each call', () => {
    const blob = {
        version: REPLAY_VERSION,
        frames: compressFrames([
            [1, 0],
            [0, 1],
            [-1, 0]
        ])
    };
    const p = new ReplayPlayer(blob, { speed: 1 });
    assert.equal(p.totalFrames, 3);
    assert.deepEqual(p.getMoveVector(), { x: 1, y: 0 });
    p.tick();
    assert.deepEqual(p.getMoveVector(), { x: 0, y: 1 });
    p.tick();
    assert.deepEqual(p.getMoveVector(), { x: -1, y: 0 });
    p.tick();
    assert.equal(p.done, true, 'ran out of frames after 3 ticks');
});

test('iter15 replay: player at 4× consumes 4 frames per tick (and signals done)', () => {
    const flat = [];
    for (let i = 0; i < 7; i++) flat.push([0, 0]);
    const blob = { version: REPLAY_VERSION, frames: compressFrames(flat) };
    const p = new ReplayPlayer(blob, { speed: 4 });
    p.tick(); // cursor 4
    assert.equal(p.done, false);
    p.tick(); // cursor 8 -> clamped to 7 → done
    assert.equal(p.done, true);
});

test('iter15 replay: empty frames → player is done immediately on first tick', () => {
    const blob = { version: REPLAY_VERSION, frames: [] };
    const p = new ReplayPlayer(blob);
    assert.equal(p.totalFrames, 0);
    assert.deepEqual(p.getMoveVector(), { x: 0, y: 0 });
    p.tick();
    assert.equal(p.done, true);
});
