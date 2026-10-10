// Tests for src/game-render.ts — the world and scenery pass.
//
// This module was at 0% function coverage: nothing called it. It draws the
// background, the camera transform, the grid, every entity in world space, and
// then the screen-space effects on top. A defect here is a defect the player
// sees, which is exactly what the register's rows 2 and 3 are about.
//
// The assertions are about the DRAW CALLS MADE, not about pixels: a recording
// context that logs every call is the only way to test a renderer without a
// browser, and it pins the things that actually went wrong or could — the order
// of the passes, the transform applied, and which colour a threshold picks.
//
// Runs in Node, no DOM.

import test from 'node:test';
import assert from 'node:assert/strict';
import { drawGrid, renderGame, renderEnemies } from '../src/game-render.ts';
import { CONFIG } from '../src/config.ts';

// ---------------------------------------------------------------------------
// a context that records what it was asked to draw
// ---------------------------------------------------------------------------

type Call = [string, ...unknown[]];

/** Every method a renderer in this module touches, each recording its name and args. */
function recorder() {
    const calls: Call[] = [];
    const gradient = { addColorStop: () => {} };
    const ctx: Record<string, unknown> = {};
    for (const name of [
        'save',
        'restore',
        'translate',
        'rotate',
        'beginPath',
        'moveTo',
        'lineTo',
        'stroke',
        'arc',
        'fill',
        'fillRect',
        'fillText',
        'drawImage',
        'clearRect',
        'closePath'
    ]) {
        ctx[name] = (...args: unknown[]) => calls.push([name, ...args]);
    }
    ctx.createRadialGradient = () => gradient;
    ctx.createLinearGradient = () => gradient;
    ctx.measureText = () => ({ width: 0 });
    for (const prop of [
        'strokeStyle',
        'fillStyle',
        'lineWidth',
        'globalAlpha',
        'font',
        'textAlign',
        'textBaseline',
        'shadowBlur',
        'shadowColor'
    ]) {
        ctx[prop] = '';
    }

    const named = (name: string) => calls.filter((c) => c[0] === name);
    return {
        ctx: ctx as unknown as CanvasRenderingContext2D,
        calls,
        named,
        /** The 1-based position of the first call with this name. */
        orderOf: (name: string) => calls.findIndex((c) => c[0] === name),
        get strokeStyle() {
            return ctx.strokeStyle as string;
        },
        get fillStyle() {
            return ctx.fillStyle as string;
        }
    };
}

/** The smallest game-shaped object the renderers read. */
function fakeGame(over: Record<string, unknown> = {}) {
    return {
        stageId: 'stage1',
        ctx: null,
        camera: { worldX: 0, worldY: 0, x: 0, y: 0 },
        expOrbs: [],
        mines: [],
        enemies: [],
        player: null,
        projectiles: [],
        enemyProjectiles: [],
        particles: [],
        floatingTexts: [],
        effects: { render: () => {} },
        ...over
    };
}

/** A minimal `document` whose canvases have a working 2D context. */
function installCanvasDocument() {
    const drawn: string[] = [];
    const context2d = new Proxy(
        {},
        {
            get: (_t, prop) =>
                typeof prop === 'string' &&
                /^(fill|stroke|begin|arc|move|line|save|restore)/.test(prop)
                    ? () => drawn.push(prop)
                    : undefined,
            set: () => true
        }
    );
    const canvas = { width: 0, height: 0, getContext: () => context2d };
    const previous = (globalThis as Record<string, unknown>).document;
    (globalThis as Record<string, unknown>).document = { createElement: () => canvas };
    return {
        drawn,
        restore: () => {
            if (previous === undefined) delete (globalThis as Record<string, unknown>).document;
            else (globalThis as Record<string, unknown>).document = previous;
        }
    };
}

// ---------------------------------------------------------------------------
// drawGrid
// ---------------------------------------------------------------------------

test('game-render/drawGrid: draws one line per grid interval across and down', () => {
    const r = recorder();
    drawGrid(r.ctx, fakeGame({ camera: { worldX: 0, worldY: 0, x: 0, y: 0 } }));

    const size = CONFIG.GRID_SIZE;
    const across = Math.floor(CONFIG.CANVAS_WIDTH / size) + 1;
    const down = Math.floor(CONFIG.CANVAS_HEIGHT / size) + 1;
    assert.equal(
        r.named('stroke').length,
        across + down,
        'a stroke per vertical and horizontal line'
    );
    assert.equal(r.named('beginPath').length, across + down, 'each line is its own path');
});

test('game-render/drawGrid: the grid is aligned to world space, not the viewport', () => {
    // Half a cell off origin, so the first line is behind the camera rather than
    // at 0 — this is what stops the grid sliding as the player moves.
    const r = recorder();
    const size = CONFIG.GRID_SIZE;
    drawGrid(r.ctx, fakeGame({ camera: { worldX: size / 2, worldY: size / 2, x: 0, y: 0 } }));

    const firstMove = r.named('moveTo')[0];
    assert.equal(firstMove[1], 0, 'floor(0.5 cells) * size is 0');
    assert.equal(firstMove[2], size / 2, 'the vertical line spans from the camera y');
});

test('game-render/drawGrid: the stroke colour carries the stage grid alpha', () => {
    const r = recorder();
    drawGrid(r.ctx, fakeGame());
    assert.match(
        r.strokeStyle,
        /^rgba\(255,255,255,0\.\d{3}\)$/,
        'three decimals, from toFixed(3)'
    );
    assert.equal(r.named('stroke').length > 0, true);
});

test('game-render/drawGrid: the line width is one pixel', () => {
    const r = recorder();
    drawGrid(r.ctx, fakeGame());
    // `lineWidth` is a property, not a call, so it is asserted through the stub.
    assert.equal((r.ctx as unknown as { lineWidth: number }).lineWidth, 1);
});

// ---------------------------------------------------------------------------
// renderGame — order and transform
// ---------------------------------------------------------------------------

test('game-render/renderGame: the background is filled before anything else', () => {
    // The comment in the source explains why: this guarantees the viewport is
    // cleared even when the camera sits flush against an arena edge and a sliver
    // would otherwise never be painted.
    const r = recorder();
    renderGame(r.ctx, fakeGame() as never);
    assert.equal(r.calls[0][0], 'fillRect', 'the very first call is the background fill');
    assert.deepEqual(r.calls[0].slice(1), [0, 0, CONFIG.CANVAS_WIDTH, CONFIG.CANVAS_HEIGHT]);
});

test('game-render/renderGame: the world pass is bracketed by save and restore', () => {
    const r = recorder();
    renderGame(r.ctx, fakeGame() as never);
    assert.equal(r.orderOf('save') < r.orderOf('translate'), true);
    assert.equal(r.orderOf('translate') < r.orderOf('restore'), true);
});

test('game-render/renderGame: the translate is minus the camera plus the shake', () => {
    const r = recorder();
    renderGame(r.ctx, fakeGame({ camera: { worldX: 100, worldY: 50, x: 3, y: -2 } }) as never);
    // -worldX + x = -100 + 3, and -worldY + y = -50 + -2.
    assert.deepEqual(r.named('translate')[0].slice(1), [-97, -52]);
});

test('game-render/renderGame: the effects pass runs last, in screen space', () => {
    // Screen-space effects must be on top and must not inherit the world
    // transform, so they run after restore(). The effects callback does not
    // touch ctx in this stub, so the ORDER is established by a shared sequence:
    // the ctx recorder and the callback both append to it.
    const r = recorder();
    const sequence: string[] = [];
    const traced = new Proxy(r.ctx as unknown as Record<string, unknown>, {
        get: (target, prop) => {
            const value = target[prop as string];
            if (typeof value !== 'function') return value;
            return (...args: unknown[]) => {
                sequence.push(String(prop));
                return (value as (...a: unknown[]) => unknown)(...args);
            };
        }
    }) as unknown as CanvasRenderingContext2D;

    const seen: number[][] = [];
    const game = fakeGame({
        effects: {
            render: (...args: unknown[]) => {
                sequence.push('effects.render');
                seen.push(args as number[]);
            }
        }
    });
    renderGame(traced, game as never);

    // The signature is render(ctx, width, height) — the context is the first
    // argument, so the dimensions are the tail.
    assert.equal(seen.length, 1, 'the effects pass runs exactly once per frame');
    assert.deepEqual(seen[0].slice(1), [CONFIG.CANVAS_WIDTH, CONFIG.CANVAS_HEIGHT]);
    assert.equal(
        sequence.indexOf('restore') < sequence.indexOf('effects.render'),
        true,
        'effects run after the world transform is popped'
    );
    assert.equal(sequence.at(-1), 'effects.render', 'and nothing is drawn after them');
});

test('game-render/renderGame: every entity collection is drawn inside the world pass', () => {
    const r = recorder();
    renderGame(
        r.ctx,
        fakeGame({
            particles: [{ x: 1, y: 1, color: '#fff', life: 1, decay: 1, size: 2, vx: 0, vy: 0 }],
            floatingTexts: [{ x: 1, y: 1, text: 'hi', life: 1, decay: 1, color: '#fff', size: 12 }]
        }) as never
    );
    const restoreAt = r.orderOf('restore');
    assert.equal(r.orderOf('arc') < restoreAt, true, 'particles draw before restore');
    assert.equal(r.orderOf('fillText') < restoreAt, true, 'floating text draws before restore');
});

test('game-render/renderGame: a null player is skipped without throwing', () => {
    const r = recorder();
    assert.doesNotThrow(() => renderGame(r.ctx, fakeGame({ player: null }) as never));
});

test('game-render/renderGame: each weapon gets its extras drawn', () => {
    // Orbit shards live on the weapon, so this is the only place they render.
    const r = recorder();
    let extras = 0;
    const player = {
        x: 0,
        y: 0,
        hp: 10,
        maxHp: 10,
        facing: 1,
        weapons: [{ renderExtras: () => extras++ }]
    };
    renderGame(r.ctx, fakeGame({ player }) as never);
    assert.equal(extras, 1);
});

test('game-render/renderGame: a weapon without renderExtras is not a crash', () => {
    const r = recorder();
    const player = { x: 0, y: 0, hp: 10, maxHp: 10, facing: 1, weapons: [{}] };
    assert.doesNotThrow(() => renderGame(r.ctx, fakeGame({ player }) as never));
});

// ---------------------------------------------------------------------------
// renderEnemies
// ---------------------------------------------------------------------------

const enemy = (over: Record<string, unknown> = {}) => ({
    x: 50,
    y: 50,
    size: 12,
    hp: 10,
    maxHp: 10,
    type: { id: 'slime', color: '#ff4444' },
    boss: false,
    flashTimer: 0,
    shielded: false,
    ...over
});

test('game-render/renderEnemies: a boss is drawn, never cached', () => {
    const r = recorder();
    renderEnemies(r.ctx, fakeGame({ enemies: [enemy({ boss: true })] }) as never);
    assert.equal(r.named('drawImage').length, 0, 'a boss must not use the sprite path');
    assert.equal(r.named('arc').length > 0, true, 'renderEnemy draws the body');
});

test('game-render/renderEnemies: a flashing enemy is drawn, never cached', () => {
    // The sprite cannot show a hit flash, so a flashing enemy takes the slow path.
    const r = recorder();
    renderEnemies(r.ctx, fakeGame({ enemies: [enemy({ flashTimer: 0.1 })] }) as never);
    assert.equal(r.named('drawImage').length, 0);
});

test('game-render/renderEnemies: a shielded enemy is drawn, never cached', () => {
    const r = recorder();
    renderEnemies(r.ctx, fakeGame({ enemies: [enemy({ shielded: true })] }) as never);
    assert.equal(r.named('drawImage').length, 0);
});

test('game-render/renderEnemies: with no document, every enemy falls back to drawing', () => {
    // The module guards `typeof document === 'undefined'` for SSR and tests, so
    // in plain Node the sprite path is unreachable and every enemy is drawn.
    const r = recorder();
    renderEnemies(r.ctx, fakeGame({ enemies: [enemy(), enemy(), enemy()] }) as never);
    assert.equal(r.named('drawImage').length, 0);
    assert.equal(r.named('arc').length > 0, true);
});

test('game-render/renderEnemies: an empty enemy list draws nothing', () => {
    const r = recorder();
    renderEnemies(r.ctx, fakeGame({ enemies: [] }) as never);
    assert.deepEqual(r.calls, []);
});

// ---------------------------------------------------------------------------
// the cached sprite path
// ---------------------------------------------------------------------------

test('game-render/sprites: with a document, a healthy enemy uses the cached sprite', () => {
    const doc = installCanvasDocument();
    try {
        const r = recorder();
        renderEnemies(r.ctx, fakeGame({ enemies: [enemy({ hp: 10, maxHp: 10 })] }) as never);
        assert.equal(r.named('drawImage').length, 1, 'the sprite is blitted');
        // Centred on the enemy: x - width/2, y - height/2.
        assert.deepEqual(r.named('drawImage')[0].slice(2), [50 - 16, 50 - 16]);
    } finally {
        doc.restore();
    }
});

test('game-render/sprites: a full-health enemy gets no HP bar', () => {
    const doc = installCanvasDocument();
    try {
        const r = recorder();
        renderEnemies(r.ctx, fakeGame({ enemies: [enemy({ hp: 10, maxHp: 10 })] }) as never);
        assert.equal(r.named('fillRect').length, 0, 'pct is 1, so nothing is drawn over it');
    } finally {
        doc.restore();
    }
});

test('game-render/sprites: a damaged enemy gets a two-part HP bar', () => {
    const doc = installCanvasDocument();
    try {
        const r = recorder();
        renderEnemies(r.ctx, fakeGame({ enemies: [enemy({ hp: 5, maxHp: 10 })] }) as never);
        const bars = r.named('fillRect');
        assert.equal(bars.length, 2, 'a dark backing and a coloured fill');
        assert.deepEqual(bars[0].slice(1), [35, 28, 30, 3], 'the backing is a full-width 30px bar');
        assert.deepEqual(bars[1].slice(1), [35, 28, 15, 3], 'the fill is 30 * pct wide');
    } finally {
        doc.restore();
    }
});

test('game-render/sprites: the HP bar colour steps at half and at a quarter', () => {
    const doc = installCanvasDocument();
    try {
        // >0.5 green, >0.25 orange, else red — pinned on the boundary and one past.
        const r6 = recorder();
        renderEnemies(
            r6.ctx,
            fakeGame({
                enemies: [enemy({ hp: 6, maxHp: 10, type: { id: 'a', color: '#f00' } })]
            }) as never
        );
        assert.equal(r6.fillStyle, '#44ff44', '0.6 is above a half, so green');

        const r5 = recorder();
        renderEnemies(
            r5.ctx,
            fakeGame({
                enemies: [enemy({ hp: 5, maxHp: 10, type: { id: 'b', color: '#f00' } })]
            }) as never
        );
        assert.equal(r5.fillStyle, '#ffaa33', 'exactly a half is NOT above a half, so orange');

        const r3 = recorder();
        renderEnemies(
            r3.ctx,
            fakeGame({
                enemies: [enemy({ hp: 3, maxHp: 10, type: { id: 'c', color: '#f00' } })]
            }) as never
        );
        assert.equal(r3.fillStyle, '#ffaa33', '0.3 is above a quarter, so orange');

        const r2 = recorder();
        renderEnemies(
            r2.ctx,
            fakeGame({
                enemies: [enemy({ hp: 2, maxHp: 10, type: { id: 'd', color: '#f00' } })]
            }) as never
        );
        assert.equal(r2.fillStyle, '#ff4444', 'exactly a quarter is NOT above a quarter, so red');
    } finally {
        doc.restore();
    }
});

test('game-render/sprites: the sprite is cached, so the second enemy reuses it', () => {
    const doc = installCanvasDocument();
    try {
        const r = recorder();
        const one = enemy({ type: { id: 'cached', color: '#f00' } });
        renderEnemies(r.ctx, fakeGame({ enemies: [one] }) as never);
        const drawsAfterFirst = doc.drawn.length;

        const r2 = recorder();
        renderEnemies(
            r2.ctx,
            fakeGame({ enemies: [enemy({ type: { id: 'cached', color: '#f00' } })] }) as never
        );
        assert.equal(r2.named('drawImage').length, 1, 'still blitted');
        assert.equal(doc.drawn.length, drawsAfterFirst, 'but the sprite was not rebuilt');
    } finally {
        doc.restore();
    }
});

test('game-render/sprites: a canvas refusing a 2D context falls back instead of throwing', () => {
    // A canvas may refuse `getContext('2d')`, and the type says so. Before the
    // guard this threw on `c.fillStyle`; now the renderer returns null and the
    // caller takes the same fallback path it already uses when `document` is
    // absent. Found by `strictNullChecks`, which is the argument for the flag:
    // the nullability was real and nothing had been checking for it.
    const previous = (globalThis as Record<string, unknown>).document;
    (globalThis as Record<string, unknown>).document = {
        createElement: () => ({ width: 0, height: 0, getContext: () => null })
    };
    try {
        const r = recorder();
        assert.doesNotThrow(() =>
            renderEnemies(
                r.ctx,
                fakeGame({
                    enemies: [enemy({ type: { id: 'refuses-context', color: '#f00' } })]
                }) as never
            )
        );
        assert.equal(r.named('drawImage').length, 0, 'no sprite was blitted');
        assert.equal(r.named('arc').length > 0, true, 'the enemy was drawn the slow way instead');
    } finally {
        if (previous === undefined) delete (globalThis as Record<string, unknown>).document;
        else (globalThis as Record<string, unknown>).document = previous;
    }
});
