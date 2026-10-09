// Unit tests for src/main.js — the Game class.
//
// This module is 1,887 LOC, the largest in the repository, and had 0% coverage:
// `boot()` throws "document is not defined", so no test could get near it. The
// harness in test/helpers/browser-stub.js fixes that, and these tests drive the
// real state machine rather than a copy of it.
//
// Priority was given to logic that has actually gone wrong before. The
// pause-time accounting is the clearest example: iter-16 fixed a bug where
// seconds spent in the pause menu were counted against the player's speedrun
// time. That is arithmetic on wall-clock readings, so it needs a clock that can
// be moved by a known amount — which is why the harness fakes `performance.now`
// instead of racing real timers.
//
// Runs in Node, no browser.

import test from 'node:test';
import assert from 'node:assert/strict';
import { installBrowserStub } from './helpers/browser-stub.js';
import { CONFIG } from '../src/config.js';

/** Build a Game inside a fresh stubbed browser. */
async function withGame(fn, { now = 1000 } = {}) {
    const env = installBrowserStub({ now });
    try {
        const { Game } = await import('../src/main.js');
        const game = new Game();
        return await fn(game, env);
    } finally {
        env.restore();
    }
}

const COLLECTIONS = [
    'enemies',
    'projectiles',
    'enemyProjectiles',
    'expOrbs',
    'particles',
    'floatingTexts',
    'mines'
];

// ---------------------------------------------------------------------------
// construction and the run lifecycle
// ---------------------------------------------------------------------------

test('game: constructs into the menu state with empty run state', async () => {
    await withGame((game) => {
        assert.equal(game.state, 'menu');
        assert.equal(game.gameTime, 0);
        assert.equal(game.kills, 0);
        assert.equal(game.player, null, 'no player exists until a run starts');
    });
});

test('game/start: enters the playing state and clears every run collection', async () => {
    await withGame((game) => {
        game.start();
        assert.equal(game.state, 'playing');
        assert.equal(game.gameTime, 0);
        assert.equal(game.kills, 0);
        assert.ok(game.player, 'starting a run must create the player');
        for (const key of COLLECTIONS) {
            assert.deepEqual(game[key], [], `${key} should start empty`);
        }
    });
});

test('game/start: discards the previous run entirely', async () => {
    await withGame((game) => {
        game.start();
        game.kills = 42;
        game.gameTime = 300;
        game.enemies.push({ x: 0, y: 0 });
        game._bossesSpawned.add('big_bat');
        game._lastAnnouncedWave = 'wave-3';
        game._pauseStartedAt = 12345;

        game.start();

        assert.equal(game.kills, 0, 'kills must reset');
        assert.equal(game.gameTime, 0, 'time must reset');
        assert.deepEqual(game.enemies, [], 'enemies must be cleared');
        assert.equal(game._bossesSpawned.size, 0, 'boss bookkeeping must be cleared');
        assert.equal(game._lastAnnouncedWave, null);
        assert.equal(
            game._pauseStartedAt,
            0,
            'a stale pause anchor from a previous run must not leak into a new one'
        );
    });
});

test('game: starting twice in a row is safe and still resets', async () => {
    await withGame((game) => {
        game.start();
        game.kills = 7;
        assert.doesNotThrow(() => game.start());
        assert.equal(game.state, 'playing');
        assert.equal(game.kills, 0);
    });
});

test('game/gameOver: stops the run and cancels the frame loop', async () => {
    await withGame((game, env) => {
        game.start();
        // Starting a run schedules a frame; game over must cancel it or the
        // loop keeps ticking against a dead run.
        assert.ok(env.raf.requested > 0, 'the run should have scheduled frames');

        const cancelledBefore = env.raf.cancelled;
        game.gameOver();

        assert.equal(game.state, 'gameover');
        assert.ok(
            env.raf.cancelled > cancelledBefore,
            'game over must cancel the pending animation frame'
        );
    });
});

// ---------------------------------------------------------------------------
// pause accounting — the iter-16 regression
// ---------------------------------------------------------------------------

test('game/pause: pausing stamps the pause moment', async () => {
    await withGame((game, env) => {
        game.start();
        env.clock.set(5000);
        game.togglePause();
        assert.equal(game.state, 'paused');
        assert.equal(game._pauseStartedAt, 5000, 'the pause instant must be recorded');
    });
});

test('game/pause: resuming excludes the paused seconds from the run wall clock', async () => {
    // The bug this pins: paused seconds used to be counted against the player,
    // so reading a level-up dialog cost you leaderboard time.
    await withGame((game, env) => {
        game.start();
        const before = game._runStartWallClock;

        env.clock.set(10_000);
        game.togglePause();

        env.clock.advance(2_500); // two and a half seconds in the pause menu
        game.togglePause();

        assert.equal(game.state, 'playing');
        assert.equal(
            game._runStartWallClock - before,
            2_500,
            'the run anchor must move forward by exactly the paused duration'
        );
        assert.equal(game._pauseStartedAt, 0, 'the pause anchor must be cleared');
    });
});

test('game/pause: a speedrun anchor is shifted too', async () => {
    await withGame((game, env) => {
        game.startSpeedrun();
        assert.ok(game.speedrunStart, 'a speedrun must record its start');

        const before = game.speedrunStart;
        env.clock.set(20_000);
        game.togglePause();
        env.clock.advance(1_000);
        game.togglePause();

        assert.equal(game.speedrunStart - before, 1_000);
    });
});

test('game/pause: a normal run leaves the speedrun anchor alone', async () => {
    // A normal run has no speedrunStart, so the guard must skip it rather than
    // shifting `undefined` into NaN.
    await withGame((game, env) => {
        game.start();
        assert.ok(!game.speedrunStart, 'a normal run has no speedrun anchor');

        env.clock.set(10_000);
        game.togglePause();
        env.clock.advance(1_000);
        game.togglePause();

        assert.equal(game.speedrunStart, 0, 'must stay 0, not become NaN');
    });
});

test('game/pause: resuming without a valid pause anchor changes nothing', async () => {
    await withGame((game) => {
        game.start();
        const before = game._runStartWallClock;
        game._pauseStartedAt = 0; // as if the pause stamp was lost
        game.state = 'paused';

        game.togglePause();

        assert.equal(game.state, 'playing');
        assert.equal(game._runStartWallClock, before, 'no anchor, no shift');
    });
});

test('game/pause: a clock that did not advance does not shift the anchor', async () => {
    // Guarded by `paused > 0`. A frozen or non-monotonic clock must not corrupt
    // the timer in either direction.
    await withGame((game, env) => {
        game.start();
        const before = game._runStartWallClock;

        env.clock.set(7_000);
        game.togglePause();
        game.togglePause(); // resumed at the same instant

        assert.equal(game._runStartWallClock, before, 'a zero-length pause shifts nothing');
    });
});

test('game/pause: toggling from the menu or game over is a no-op', async () => {
    await withGame((game) => {
        assert.equal(game.state, 'menu');
        game.togglePause();
        assert.equal(game.state, 'menu', 'pause from the menu must do nothing');

        game.start();
        game.gameOver();
        game.togglePause();
        assert.equal(game.state, 'gameover', 'pause after death must do nothing');
    });
});

test('game/pause: pause and resume are symmetric over many cycles', async () => {
    await withGame((game, env) => {
        game.start();
        const before = game._runStartWallClock;
        let pausedTotal = 0;

        for (let i = 0; i < 5; i++) {
            env.clock.set(1_000 + i * 10_000);
            game.togglePause();
            const gap = 137 * (i + 1);
            env.clock.advance(gap);
            pausedTotal += gap;
            game.togglePause();
        }

        assert.equal(
            game._runStartWallClock - before,
            pausedTotal,
            'the anchor must absorb exactly the total paused time, with no drift'
        );
        assert.equal(game.state, 'playing');
    });
});

// ---------------------------------------------------------------------------
// camera clamping
// ---------------------------------------------------------------------------

test('game/camera: clamps to the arena origin', async () => {
    await withGame((game) => {
        game.start();
        game.player.x = 0;
        game.player.y = 0;
        game._updateCamera();
        assert.equal(game.camera.worldX, 0, 'the view must not scroll past the top-left');
        assert.equal(game.camera.worldY, 0);
    });
});

test('game/camera: clamps to the far corner', async () => {
    await withGame((game) => {
        game.start();
        game.player.x = CONFIG.ARENA_WIDTH;
        game.player.y = CONFIG.ARENA_HEIGHT;
        game._updateCamera();
        assert.equal(game.camera.worldX, CONFIG.ARENA_WIDTH - CONFIG.CANVAS_WIDTH);
        assert.equal(game.camera.worldY, CONFIG.ARENA_HEIGHT - CONFIG.CANVAS_HEIGHT);
    });
});

test('game/camera: follows the player away from the edges', async () => {
    await withGame((game) => {
        game.start();
        game.player.x = CONFIG.ARENA_WIDTH / 2;
        game.player.y = CONFIG.ARENA_HEIGHT / 2;
        game._updateCamera();
        assert.equal(game.camera.worldX, CONFIG.ARENA_WIDTH / 2 - CONFIG.CANVAS_WIDTH / 2);
        assert.equal(game.camera.worldY, CONFIG.ARENA_HEIGHT / 2 - CONFIG.CANVAS_HEIGHT / 2);
    });
});

test('game/camera: does nothing before a run exists', async () => {
    await withGame((game) => {
        assert.equal(game.player, null);
        assert.doesNotThrow(() => game._updateCamera());
    });
});

// ---------------------------------------------------------------------------
// effect plumbing — must stay inside the pools
// ---------------------------------------------------------------------------

test('game/effects: shake delegates to the camera without throwing', async () => {
    await withGame((game) => {
        game.start();
        assert.doesNotThrow(() => game.shake(5));
        assert.ok(game.camera.intensity > 0, 'the shake should register on the camera');
    });
});

test('game/effects: combat effects respect the reduced-motion setting', async () => {
    // reducedMotion is an accessibility setting, and it is the difference
    // between a calm screen and a screen full of flying numbers.
    await withGame((game) => {
        game.start();

        game.save.settings.reducedMotion = false;
        game.particles = [];
        game.floatingTexts = [];
        game.createParticles(10, 20, '#fff', 5);
        game.createFloatingText('12', 10, 20, '#fff');
        assert.equal(game.particles.length, 5, 'the full particle count when motion is allowed');
        assert.equal(game.floatingTexts.length, 1, 'damage numbers when motion is allowed');

        game.save.settings.reducedMotion = true;
        game.particles = [];
        game.floatingTexts = [];
        game.createParticles(10, 20, '#fff', 5);
        game.createFloatingText('12', 10, 20, '#fff');
        assert.ok(
            game.particles.length <= 2,
            `reduced motion must cap particles, got ${game.particles.length}`
        );
        assert.equal(game.floatingTexts.length, 0, 'no damage numbers under reduced motion');
    });
});

test('game/effects: shake delegates to the camera and does not accumulate', async () => {
    await withGame((game) => {
        game.start();
        game.shake(5);
        assert.equal(game.camera.intensity, 5);
        game.shake(2);
        assert.equal(game.camera.intensity, 5, 'a weaker shake must not reduce the current one');
    });
});
