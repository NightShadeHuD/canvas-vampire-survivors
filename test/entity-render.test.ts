// Tests for src/entity-render.ts — the nine entity renderers.
//
// The register's row 2. These draw the player, enemies, and every effect in the
// game, and the module sat at 18.98% lines / 22.22% functions with nothing
// asserting what it draws. A defect here is a defect the player sees: the crash
// this module shipped once (a bare `this` in the garlic aura) threw a TypeError
// every frame a player held garlic, and no gate could see it.
//
// Same method as `test/game-render.test.ts`: a recording context that logs every
// call, because that is the only way to assert a renderer's output without a
// browser. The assertions are about the DRAW CALLS MADE and the ORDER they are
// made in, which is where real defects live.
//
// Runs in Node, no DOM.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
    renderEnemyProjectile,
    renderProjectile,
    renderOrbitShard,
    renderMine,
    renderExpOrb,
    renderParticle,
    renderFloatingText,
    renderPlayer,
    renderEnemy
} from '../src/entity-render.ts';

// ---------------------------------------------------------------------------
// recording context
// ---------------------------------------------------------------------------

type Call = [string, ...unknown[]];

function recorder() {
    const calls: Call[] = [];
    const stops: string[] = [];
    const gradient = { addColorStop: (at: number, color: string) => stops.push(`${at}:${color}`) };
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
        'strokeText',
        'drawImage'
    ]) {
        ctx[name] = (...args: unknown[]) => calls.push([name, ...args]);
    }
    ctx.createRadialGradient = (...args: unknown[]) => {
        calls.push(['createRadialGradient', ...args]);
        return gradient;
    };
    ctx.createLinearGradient = () => gradient;
    ctx.measureText = () => ({ width: 0 });
    for (const prop of [
        'strokeStyle',
        'fillStyle',
        'lineWidth',
        'globalAlpha',
        'font',
        'textAlign',
        'textBaseline'
    ]) {
        ctx[prop] = '';
    }

    const proxy = new Proxy(ctx, {
        get: (target, prop) => target[prop as string],
        set: (target, prop, value) => {
            if (prop === 'fillStyle' || prop === 'strokeStyle' || prop === 'globalAlpha') {
                calls.push([`${String(prop)}=`, value]);
            }
            target[prop as string] = value;
            return true;
        }
    });

    return {
        ctx: proxy as unknown as CanvasRenderingContext2D,
        calls,
        stops,
        named: (name: string) => calls.filter((c) => c[0] === name),
        /** Every value assigned to a style property, in order. */
        styles: (prop: 'fillStyle' | 'strokeStyle') =>
            calls.filter((c) => c[0] === `${prop}=`).map((c) => c[1] as string),
        /** Every value assigned to globalAlpha, in order. */
        alphas: () => calls.filter((c) => c[0] === 'globalAlpha=').map((c) => c[1] as number),
        value: (prop: string) => (ctx as Record<string, unknown>)[prop]
    };
}

/** Pin `performance.now()` so pulse and blink branches are deterministic. */
function withNow(value: number, body: () => void) {
    const real = globalThis.performance;
    Object.defineProperty(globalThis, 'performance', {
        value: { now: () => value },
        configurable: true,
        writable: true
    });
    try {
        body();
    } finally {
        Object.defineProperty(globalThis, 'performance', {
            value: real,
            configurable: true,
            writable: true
        });
    }
}

// ---------------------------------------------------------------------------
// renderEnemyProjectile
// ---------------------------------------------------------------------------

test('entity-render/enemyProjectile: draws a body and a smaller highlight', () => {
    const r = recorder();
    renderEnemyProjectile(r.ctx, { x: 10, y: 20, size: 8 } as never);

    const arcs = r.named('arc');
    assert.equal(arcs.length, 2, 'a body and a highlight');
    assert.deepEqual(arcs[0].slice(1), [10, 20, 8, 0, Math.PI * 2]);
    assert.deepEqual(
        arcs[1].slice(1),
        [10, 20, 8 * 0.45, 0, Math.PI * 2],
        'the highlight is 45% of the body'
    );
    assert.deepEqual(r.styles('fillStyle'), ['#ff44aa', 'rgba(255,255,255,0.6)']);
});

test('entity-render/enemyProjectile: saves and restores the context', () => {
    const r = recorder();
    renderEnemyProjectile(r.ctx, { x: 0, y: 0, size: 1 } as never);
    assert.deepEqual(
        r.calls.map((c) => c[0]),
        [
            'save',
            'fillStyle=',
            'beginPath',
            'arc',
            'fill',
            'fillStyle=',
            'beginPath',
            'arc',
            'fill',
            'restore'
        ]
    );
});

// ---------------------------------------------------------------------------
// renderProjectile — one branch per weapon id
// ---------------------------------------------------------------------------

const projectile = (id: string) => ({ id, x: 100, y: 50, angle: Math.PI / 2, size: 6 });

test('entity-render/projectile: every projectile is drawn at its position, rotated', () => {
    const r = recorder();
    renderProjectile(r.ctx, projectile('knife') as never);
    assert.deepEqual(r.named('translate')[0].slice(1), [100, 50]);
    assert.deepEqual(r.named('rotate')[0].slice(1), [Math.PI / 2]);
});

test('entity-render/projectile: a knife is a 24x4 blade', () => {
    const r = recorder();
    renderProjectile(r.ctx, projectile('knife') as never);
    assert.deepEqual(
        r.named('fillRect')[0].slice(1),
        [-12, -2, 24, 4],
        'centred on the origin it translated to'
    );
});

test('entity-render/projectile: a magic wand is a violet orb with a glint', () => {
    const r = recorder();
    renderProjectile(r.ctx, projectile('magic_wand') as never);
    assert.deepEqual(r.styles('fillStyle'), ['#aa66ff', 'rgba(255,255,255,0.6)']);
    assert.deepEqual(
        r.named('arc')[1].slice(1),
        [-2, -2, 2.2, 0, Math.PI * 2],
        'the glint is offset up-left'
    );
});

test('entity-render/projectile: an axe is filled then stroked with a dark rim', () => {
    const r = recorder();
    renderProjectile(r.ctx, projectile('axe') as never);
    assert.equal(r.named('fill').length, 1);
    assert.equal(r.named('stroke').length, 1, 'the rim is a second pass over the same circle');
    assert.equal(r.styles('strokeStyle')[0], '#555');
    assert.equal(r.value('lineWidth'), 2);
});

test('entity-render/projectile: a cross is two crossed bars', () => {
    const r = recorder();
    renderProjectile(r.ctx, projectile('cross') as never);
    const bars = r.named('fillRect').map((c) => c.slice(1));
    assert.deepEqual(bars, [
        [-10, -3, 20, 6],
        [-3, -10, 6, 20]
    ]);
});

test('entity-render/projectile: a fire wand is an orange core inside a yellow ring', () => {
    const r = recorder();
    renderProjectile(r.ctx, projectile('fire_wand') as never);
    assert.deepEqual(r.styles('fillStyle'), ['#ff6600', '#ffcc00']);
    assert.deepEqual(r.named('arc')[0].slice(1), [0, 0, 9, 0, Math.PI * 2]);
    assert.deepEqual(r.named('arc')[1].slice(1), [0, 0, 5, 0, Math.PI * 2]);
});

test('entity-render/projectile: an unknown id falls back to a white dot', () => {
    // The default arm matters: a new weapon added to the catalogue without a
    // renderer must still draw something rather than nothing.
    const r = recorder();
    renderProjectile(r.ctx, projectile('something_new') as never);
    assert.deepEqual(r.styles('fillStyle'), ['#ffffff']);
    assert.deepEqual(r.named('arc')[0].slice(1), [0, 0, 5, 0, Math.PI * 2]);
});

test('entity-render/projectile: the context is restored on every branch', () => {
    for (const id of ['knife', 'magic_wand', 'axe', 'cross', 'fire_wand', 'unknown']) {
        const r = recorder();
        renderProjectile(r.ctx, projectile(id) as never);
        assert.equal(r.calls.at(-1)?.[0], 'restore', `${id} must restore the context`);
    }
});

// ---------------------------------------------------------------------------
// renderOrbitShard
// ---------------------------------------------------------------------------

test('entity-render/orbitShard: a soft glow behind a bright core', () => {
    const r = recorder();
    renderOrbitShard(r.ctx, { x: 5, y: 6 } as never);

    assert.deepEqual(r.named('createRadialGradient')[0].slice(1), [5, 6, 0, 5, 6, 14]);
    assert.deepEqual(r.stops, ['0:rgba(255,240,180,0.85)', '1:rgba(255,240,180,0)']);
    assert.equal(r.named('arc').length, 2);
    assert.deepEqual(r.named('arc')[0].slice(1), [5, 6, 14, 0, Math.PI * 2], 'glow radius');
    assert.deepEqual(r.named('arc')[1].slice(1), [5, 6, 5, 0, Math.PI * 2], 'core radius');
});

// ---------------------------------------------------------------------------
// renderMine
// ---------------------------------------------------------------------------

const mine = (fuse: number, maxFuse = 2) => ({ x: 30, y: 40, radius: 25, fuse, maxFuse });

test('entity-render/mine: an armed mine pulses and turns red', () => {
    // armed is fuse < maxFuse * 0.5, so 0.9 against 2 is armed.
    withNow(0, () => {
        const r = recorder();
        renderMine(r.ctx, mine(0.9) as never);
        assert.equal(r.styles('fillStyle')[1], '#ff4444', 'armed is the bright red');
    });
});

test('entity-render/mine: an unarmed mine is dim and holds a steady alpha', () => {
    // 1.5 against a 2s fuse is NOT below half, so it is unarmed.
    withNow(0, () => {
        const r = recorder();
        renderMine(r.ctx, mine(1.5) as never);
        assert.equal(r.styles('fillStyle')[1], '#aa4444', 'unarmed is the muted red');
        assert.equal(r.styles('fillStyle')[0], 'rgba(255,80,80,0.355)', '0.25 + 0.3 * 0.35');
    });
});

test('entity-render/mine: the fuse boundary is exactly at half', () => {
    // fuse === maxFuse * 0.5 is NOT armed, because the test is `<`.
    withNow(0, () => {
        const boundary = recorder();
        renderMine(boundary.ctx, mine(1) as never);
        assert.equal(boundary.styles('fillStyle')[1], '#aa4444', 'exactly half is unarmed');
    });
    // One step below the boundary IS armed.
    withNow(0, () => {
        const below = recorder();
        renderMine(below.ctx, mine(0.999) as never);
        assert.equal(below.styles('fillStyle')[1], '#ff4444', 'just under half is armed');
    });
});

test('entity-render/mine: the pulse swings with the clock', () => {
    // sin(0) is 0, so pulse is exactly 0.5 and the alpha is 0.25 + 0.175.
    withNow(0, () => {
        const r = recorder();
        renderMine(r.ctx, mine(0.1) as never);
        assert.equal(r.styles('fillStyle')[0], 'rgba(255,80,80,0.425)');
    });
});

test('entity-render/mine: the warning ring is stroked at the blast radius', () => {
    const r = recorder();
    renderMine(r.ctx, mine(0.5) as never);
    assert.deepEqual(
        r.named('arc')[0].slice(1),
        [30, 40, 25, 0, Math.PI * 2],
        'the radius, not a constant'
    );
    assert.equal(r.named('stroke').length, 1);
    assert.equal(r.value('lineWidth'), 1.5);
});

// ---------------------------------------------------------------------------
// renderExpOrb
// ---------------------------------------------------------------------------

test('entity-render/expOrb: a fresh orb is fully opaque', () => {
    const r = recorder();
    renderExpOrb(r.ctx, { x: 1, y: 2, size: 4, life: 5 } as never);
    // life of 5 is not below 2, so it is drawn at full alpha. There is exactly
    // one assignment: this renderer uses save/restore rather than resetting the
    // field, so restore() puts it back and no second write is recorded.
    assert.deepEqual(r.alphas(), [1]);
});

test('entity-render/expOrb: a fading orb dims as its life runs out', () => {
    const r = recorder();
    renderExpOrb(r.ctx, { x: 1, y: 2, size: 4, life: 1 } as never);
    assert.deepEqual(r.alphas(), [0.5], 'life / 2, and restore() handles putting it back');
});

test('entity-render/expOrb: the fade boundary is exactly two seconds', () => {
    const atBoundary = recorder();
    renderExpOrb(atBoundary.ctx, { x: 0, y: 0, size: 1, life: 2 } as never);
    assert.equal(atBoundary.alphas()[0], 1, 'exactly 2 is not below 2');

    const below = recorder();
    renderExpOrb(below.ctx, { x: 0, y: 0, size: 1, life: 1.999 } as never);
    assert.equal(below.alphas()[0], 0.9995, 'just under 2 has begun to fade');
});

test('entity-render/expOrb: the halo is 2.2x the orb', () => {
    const r = recorder();
    renderExpOrb(r.ctx, { x: 0, y: 0, size: 5, life: 5 } as never);
    assert.equal(r.named('createRadialGradient')[0][6], 11, '5 * 2.2');
    assert.deepEqual(r.named('arc')[0].slice(1), [0, 0, 11, 0, Math.PI * 2]);
    assert.deepEqual(
        r.named('arc')[1].slice(1),
        [0, 0, 5, 0, Math.PI * 2],
        'the core is the orb size'
    );
});

// ---------------------------------------------------------------------------
// renderParticle
// ---------------------------------------------------------------------------

test('entity-render/particle: an expired particle issues no draw calls', () => {
    const r = recorder();
    renderParticle(r.ctx, { x: 0, y: 0, color: '#fff', life: 0, size: 3 } as never);
    assert.deepEqual(r.calls, [], 'the early return must come before everything');
});

test('entity-render/particle: a live particle fades by its remaining life', () => {
    const r = recorder();
    renderParticle(r.ctx, { x: 7, y: 8, color: '#abcdef', life: 0.4, size: 3 } as never);
    // The renderer sets the fade and then restores alpha to 1, so the value it
    // SET is the assertion — reading the field afterwards only sees the reset.
    assert.deepEqual(r.alphas(), [0.4, 1], 'faded for the draw, then restored');
    assert.deepEqual(r.styles('fillStyle'), ['#abcdef'], 'the particle carries its own colour');
    assert.deepEqual(r.named('arc')[0].slice(1), [7, 8, 3, 0, Math.PI * 2]);
});

test('entity-render/particle: alpha is restored so the next draw is unaffected', () => {
    // A leaked globalAlpha would dim everything drawn afterwards.
    const r = recorder();
    renderParticle(r.ctx, { x: 0, y: 0, color: '#fff', life: 0.2, size: 1 } as never);
    assert.equal(r.value('globalAlpha'), 1);
});

// ---------------------------------------------------------------------------
// renderFloatingText
// ---------------------------------------------------------------------------

test('entity-render/floatingText: an expired label issues no draw calls', () => {
    const r = recorder();
    renderFloatingText(r.ctx, { x: 0, y: 0, text: 'x', life: 0, size: 12, color: '#fff' } as never);
    assert.deepEqual(r.calls, []);
});

test('entity-render/floatingText: plain text is filled, not stroked', () => {
    const r = recorder();
    renderFloatingText(r.ctx, {
        x: 3,
        y: 4,
        text: '12',
        life: 1,
        size: 14,
        color: '#fff',
        weight: 600
    } as never);
    assert.equal(r.named('fillText').length, 1);
    assert.equal(r.named('strokeText').length, 0, 'no outline without a crit');
    assert.deepEqual(r.named('fillText')[0].slice(1), ['12', 3, 4]);
    assert.equal(r.value('font'), '600 14px system-ui, sans-serif');
    assert.equal(r.value('textAlign'), 'center');
});

test('entity-render/floatingText: a crit is larger and outlined in black', () => {
    // The outline is what makes a crit readable over a busy background, so it is
    // drawn BEFORE the fill.
    const r = recorder();
    renderFloatingText(r.ctx, {
        x: 0,
        y: 0,
        text: '99',
        life: 1,
        size: 10,
        color: '#ff0',
        weight: 700,
        crit: true
    } as never);
    assert.equal(r.value('font'), '700 16px system-ui, sans-serif', '10 * 1.6 for a crit');
    assert.equal(r.styles('strokeStyle')[0], '#000');
    assert.equal(r.value('lineWidth'), 3);
    assert.equal(
        r.calls.findIndex((c) => c[0] === 'strokeText') <
            r.calls.findIndex((c) => c[0] === 'fillText'),
        true,
        'the outline goes down first'
    );
});

// ---------------------------------------------------------------------------
// renderPlayer
// ---------------------------------------------------------------------------

const player = (over: Record<string, unknown> = {}) => ({
    x: 50,
    y: 60,
    size: 10,
    invincible: false,
    weapons: [],
    ...over
});

test('entity-render/player: a normal player is opaque', () => {
    const r = recorder();
    renderPlayer(r.ctx, player() as never);
    assert.equal(r.value('globalAlpha'), 1);
});

test('entity-render/player: invincibility strobes the alpha, never to zero', () => {
    // The comment in the source is explicit: the player must not fully vanish
    // during i-frames. It alternates between 0.4 and 1.
    withNow(0, () => {
        const r = recorder();
        renderPlayer(r.ctx, player({ invincible: true }) as never);
        assert.equal(r.value('globalAlpha'), 0.4, 'the first 60ms window is the dim one');
    });
    withNow(60, () => {
        const r = recorder();
        renderPlayer(r.ctx, player({ invincible: true }) as never);
        assert.equal(r.value('globalAlpha'), 1, 'the next window is full');
    });
});

test('entity-render/player: the strobe never reaches zero', () => {
    // A regression guard on the comment's actual promise.
    for (const t of [0, 30, 60, 90, 120, 150, 600, 12345]) {
        withNow(t, () => {
            const r = recorder();
            renderPlayer(r.ctx, player({ invincible: true }) as never);
            const alpha = r.value('globalAlpha') as number;
            assert.equal(alpha > 0, true, `alpha must stay visible at t=${t}, got ${alpha}`);
        });
    }
});

test('entity-render/player: the body is a disc with a lighter core', () => {
    const r = recorder();
    renderPlayer(r.ctx, player() as never);
    const arcs = r.named('arc').map((c) => c.slice(1));
    assert.deepEqual(arcs[0], [50, 60, 22, 0, Math.PI * 2], 'the aura is 2.2x the size');
    assert.deepEqual(arcs[1], [50, 60, 10, 0, Math.PI * 2]);
    assert.deepEqual(arcs[2], [50, 60, 5.5, 0, Math.PI * 2], 'the core is 55% of the body');
});

test('entity-render/player: a player without garlic draws no aura ring', () => {
    const r = recorder();
    renderPlayer(r.ctx, player() as never);
    assert.equal(r.named('stroke').length, 0, 'nothing is stroked without garlic');
});

test('entity-render/player: a player holding garlic draws an aura ring at its range', () => {
    // This is the regression. `garlic.getRange(this)` passed the MODULE as the
    // player, so getRange called undefined.getAreaMult() and threw a TypeError
    // every frame the player was drawn. `noImplicitThis` found it.
    const r = recorder();
    let asked = 0;
    const garlic = {
        id: 'garlic',
        getRange: (target: unknown) => {
            asked += 1;
            assert.equal(
                target !== undefined,
                true,
                'getRange must receive the player, not undefined'
            );
            assert.equal((target as { x: number }).x, 50, 'and it must be THIS player');
            return 120;
        }
    };
    renderPlayer(r.ctx, player({ weapons: [garlic] }) as never);

    assert.equal(asked, 1, 'the range is asked for exactly once');
    assert.equal(r.named('stroke').length, 1, 'one ring is stroked');
    assert.deepEqual(
        r.named('arc').at(-1)?.slice(1),
        [50, 60, 120, 0, Math.PI * 2],
        'at the range, not the body size'
    );
    assert.match(r.styles('strokeStyle').at(-1) ?? '', /^rgba\(160,255,160,0\.\d+\)$/);
});

test('entity-render/player: the aura ring is the last thing drawn before restore', () => {
    const r = recorder();
    const garlic = { id: 'garlic', getRange: () => 100 };
    renderPlayer(r.ctx, player({ weapons: [garlic] }) as never);
    assert.equal(r.calls.at(-1)?.[0], 'restore');
    assert.equal(r.calls.at(-2)?.[0], 'stroke', 'the ring is stroked immediately before restoring');
});

test('entity-render/player: a weapon that is not garlic is ignored', () => {
    const r = recorder();
    renderPlayer(r.ctx, player({ weapons: [{ id: 'knife' }, { id: 'axe' }] }) as never);
    assert.equal(r.named('stroke').length, 0);
});

// ---------------------------------------------------------------------------
// renderEnemy
// ---------------------------------------------------------------------------

const enemy = (over: Record<string, unknown> = {}) => ({
    x: 10,
    y: 20,
    size: 12,
    hp: 10,
    maxHp: 10,
    color: '#ff4444',
    flashTimer: 0,
    slowTimer: 0,
    bomber: false,
    fuseArmed: false,
    shielded: false,
    shieldHp: 0,
    boss: false,
    type: {},
    ...over
});

test('entity-render/enemy: a healthy foe wears its own colour', () => {
    const r = recorder();
    renderEnemy(r.ctx, enemy() as never);
    assert.equal(r.styles('fillStyle')[0], '#ff4444');
});

test('entity-render/enemy: a flashing foe is white', () => {
    const r = recorder();
    renderEnemy(r.ctx, enemy({ flashTimer: 0.1 }) as never);
    assert.equal(r.styles('fillStyle')[0], '#ffffff');
});

test('entity-render/enemy: a slowed foe is iced blue', () => {
    const r = recorder();
    renderEnemy(r.ctx, enemy({ slowTimer: 1 }) as never);
    assert.equal(r.styles('fillStyle')[0], '#88ccff');
});

test('entity-render/enemy: a flash takes precedence over a slow', () => {
    // The branches are ordered; a foe that is both flashing and slowed flashes.
    const r = recorder();
    renderEnemy(r.ctx, enemy({ flashTimer: 0.1, slowTimer: 1 }) as never);
    assert.equal(r.styles('fillStyle')[0], '#ffffff');
});

test('entity-render/enemy: an armed bomber blinks between white and its colour', () => {
    withNow(0, () => {
        const r = recorder();
        renderEnemy(r.ctx, enemy({ bomber: true, fuseArmed: true }) as never);
        assert.equal(r.styles('fillStyle')[0], '#ffffff', 'the first 120ms window is white');
    });
    withNow(120, () => {
        const r = recorder();
        renderEnemy(r.ctx, enemy({ bomber: true, fuseArmed: true }) as never);
        assert.equal(r.styles('fillStyle')[0], '#ff4444', 'the next window is the enemy colour');
    });
});

test('entity-render/enemy: a bomber whose fuse is not armed keeps its colour', () => {
    withNow(0, () => {
        const r = recorder();
        renderEnemy(r.ctx, enemy({ bomber: true, fuseArmed: false }) as never);
        assert.equal(r.styles('fillStyle')[0], '#ff4444');
    });
});

test('entity-render/enemy: a shield ring is stroked only while shield HP remains', () => {
    const withShield = recorder();
    renderEnemy(withShield.ctx, enemy({ shielded: true, shieldHp: 5 }) as never);
    assert.equal(withShield.named('stroke').length, 1);
    assert.deepEqual(withShield.named('arc')[2].slice(1), [10, 20, 16, 0, Math.PI * 2], 'size + 4');

    const broken = recorder();
    renderEnemy(broken.ctx, enemy({ shielded: true, shieldHp: 0 }) as never);
    assert.equal(broken.named('stroke').length, 0, 'a broken shield draws no ring');

    const unshielded = recorder();
    renderEnemy(unshielded.ctx, enemy({ shielded: false, shieldHp: 5 }) as never);
    assert.equal(unshielded.named('stroke').length, 0);
});

test('entity-render/enemy: the HP bar is a backing plus a proportional fill', () => {
    const r = recorder();
    renderEnemy(r.ctx, enemy({ hp: 5, maxHp: 10, size: 12 }) as never);
    const bars = r.named('fillRect').map((c) => c.slice(1));
    assert.deepEqual(bars[0], [10 - 15, 20 - 12 - 10, 30, 4], 'a 30px backing for a normal foe');
    assert.deepEqual(bars[1], [10 - 15, 20 - 12 - 10, 15, 4], 'the fill is 30 * 0.5');
});

test('entity-render/enemy: a boss HP bar is 80 wide, not 30', () => {
    const r = recorder();
    renderEnemy(r.ctx, enemy({ boss: true, hp: 5, maxHp: 10 }) as never);
    assert.equal(r.named('fillRect')[0][3], 80);
});

test('entity-render/enemy: the HP bar colour steps at exactly a half and a quarter', () => {
    const colourFor = (hp: number) => {
        const r = recorder();
        renderEnemy(r.ctx, enemy({ hp, maxHp: 10 }) as never);
        return r.styles('fillStyle').at(-1);
    };
    assert.equal(colourFor(6), '#44ff44', '0.6 is above a half');
    assert.equal(colourFor(5), '#ffaa33', 'exactly a half is NOT above a half');
    assert.equal(colourFor(3), '#ffaa33', '0.3 is above a quarter');
    assert.equal(colourFor(2), '#ff4444', 'exactly a quarter is NOT above a quarter');
});

test('entity-render/enemy: negative HP clamps the bar to zero width', () => {
    // hp can go below zero within a frame; a negative width would draw backwards.
    const r = recorder();
    renderEnemy(r.ctx, enemy({ hp: -5, maxHp: 10 }) as never);
    assert.equal(r.named('fillRect')[1][3], 0, 'clamped by Math.max(0, ...)');
});

test('entity-render/enemy: an ordinary boss wears a magenta crown', () => {
    const r = recorder();
    renderEnemy(r.ctx, enemy({ boss: true }) as never);
    assert.equal(r.named('stroke').length, 1);
    assert.equal(r.styles('strokeStyle').at(-1), '#ff33aa');
    assert.deepEqual(r.named('arc').at(-1)?.slice(1), [10, 20, 16, 0, Math.PI * 2], 'size + 4');
});

test('entity-render/enemy: the ice queen wears two cyan rings instead', () => {
    // iter-14: she has to read as "the ice variant" from across the arena, so she
    // gets a halo AND an inner ring rather than the shared crown.
    const r = recorder();
    renderEnemy(r.ctx, enemy({ boss: true, type: { iceQueen: true } }) as never);
    assert.equal(r.named('stroke').length, 2, 'two rings, not one');
    assert.deepEqual(r.styles('strokeStyle').slice(-2), [
        'rgba(170,220,255,0.85)',
        'rgba(220,240,255,0.45)'
    ]);
    const arcs = r.named('arc').map((c) => c.slice(1));
    assert.deepEqual(arcs.at(-2), [10, 20, 16, 0, Math.PI * 2], 'size + 4');
    assert.deepEqual(arcs.at(-1), [10, 20, 22, 0, Math.PI * 2], 'size + 10 for the halo');
    assert.equal(
        r.styles('strokeStyle').includes('#ff33aa'),
        false,
        'the magenta crown is not drawn'
    );
});

test('entity-render/enemy: a non-boss never gets a crown', () => {
    const r = recorder();
    renderEnemy(r.ctx, enemy({ boss: false }) as never);
    assert.equal(r.styles('strokeStyle').includes('#ff33aa'), false);
});

test('entity-render/enemy: a missing type object does not throw', () => {
    // `self.type?.iceQueen` is optional-chained, so a boss without a type is legal.
    const r = recorder();
    assert.doesNotThrow(() => renderEnemy(r.ctx, enemy({ boss: true, type: undefined }) as never));
});

test('entity-render/enemy: every branch restores the context', () => {
    for (const over of [
        {},
        { flashTimer: 1 },
        { slowTimer: 1 },
        { bomber: true, fuseArmed: true },
        { shielded: true, shieldHp: 5 },
        { boss: true },
        { boss: true, type: { iceQueen: true } }
    ]) {
        withNow(0, () => {
            const r = recorder();
            renderEnemy(r.ctx, enemy(over) as never);
            assert.equal(r.calls[0]?.[0], 'save', `${JSON.stringify(over)} must save first`);
            assert.equal(r.calls.at(-1)?.[0], 'restore', `${JSON.stringify(over)} must restore`);
        });
    }
});
