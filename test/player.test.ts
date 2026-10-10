// Unit tests for the Player entity. The most critical invariant we test
// here is the arena clamp: in iter-9 the bound was the canvas (no camera);
// iter-10 introduced a scrolling camera that follows the player, so the
// bound moved to the arena (CONFIG.ARENA_*). Either way the player must
// never escape the playable region.

import test from 'node:test';
import assert from 'node:assert/strict';
import { Player } from '../src/entities.ts';
import { makeGameStub } from './helpers/game-stub.ts';
import { CONFIG } from '../src/config.ts';

// Minimal game scaffold that satisfies what Player.update touches.
function makeGame(moveVec: { x: number; y: number } = { x: 0, y: 0 }) {
    return makeGameStub({
        input: {
            getMoveVector: () => moveVec
        },
        run: { longestUnhit: 0 }
    });
}

test('Player: starts at the position passed to constructor', () => {
    const p = new Player(100, 200);
    assert.equal(p.x, 100);
    assert.equal(p.y, 200);
    assert.equal(p.hp, 100);
    assert.equal(p.maxHp, 100);
});

test('Player: stays inside arena when walking right at full speed', () => {
    // Start near the right arena edge and push right for 30 simulated seconds.
    // Arena is wider than the canvas viewport, so we need a longer simulation.
    const W = CONFIG.ARENA_WIDTH ?? CONFIG.CANVAS_WIDTH;
    const H = CONFIG.ARENA_HEIGHT ?? CONFIG.CANVAS_HEIGHT;
    const p = new Player(W - 50, H / 2);
    const game = makeGame({ x: 1, y: 0 });
    for (let i = 0; i < 1800; i++) p.update(0.016, game); // ~30 s at 60 fps
    assert.ok(p.x <= W - p.size, `player walked past right edge: x=${p.x}`);
});

test('Player: stays inside arena when walking down at full speed', () => {
    const W = CONFIG.ARENA_WIDTH ?? CONFIG.CANVAS_WIDTH;
    const H = CONFIG.ARENA_HEIGHT ?? CONFIG.CANVAS_HEIGHT;
    const p = new Player(W / 2, H - 50);
    const game = makeGame({ x: 0, y: 1 });
    for (let i = 0; i < 1800; i++) p.update(0.016, game);
    assert.ok(p.y <= H - p.size, `player walked past bottom edge: y=${p.y}`);
});

test('Player: stays inside arena when walking diagonally up-left', () => {
    const p = new Player(50, 50);
    const game = makeGame({ x: -1, y: -1 });
    for (let i = 0; i < 600; i++) p.update(0.016, game);
    assert.ok(p.x >= p.size, `player walked past left edge: x=${p.x}`);
    assert.ok(p.y >= p.size, `player walked past top edge: y=${p.y}`);
});

test('Player: clamp leaves position untouched when stationary inside arena', () => {
    const p = new Player(600, 400);
    const game = makeGame({ x: 0, y: 0 });
    p.update(0.016, game);
    assert.equal(p.x, 600);
    assert.equal(p.y, 400);
});
