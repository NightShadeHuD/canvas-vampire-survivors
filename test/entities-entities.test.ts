// Unit tests for the remaining entity classes in src/entities.ts:
// Enemy, ExpOrb, Particle, FloatingText, and the findEnemyDef helper.
//
// These are the entities the game spawns by the hundred, so their per-tick
// logic is the hottest code in the repository. It is also entirely
// deterministic apart from a few startup jitters, which are pinned to their
// documented ranges here rather than left to chance.
//
// Runs in Node, no DOM.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
    Enemy,
    ExpOrb,
    Particle,
    FloatingText,
    findEnemyDef,
    registerWeaponClass
} from '../src/entities.ts';
import { renderFloatingText, renderParticle } from '../src/entity-render.ts';
import { CONFIG } from '../src/config.ts';
import { ENEMIES } from '../src/data.ts';

/** Run `fn` with Math.random pinned, restoring it afterwards. */
function withRandom(value, fn) {
    const real = Math.random;
    Math.random = () => value;
    try {
        return fn();
    } finally {
        Math.random = real;
    }
}

/** A minimal enemy type definition. */
function makeType(overrides = {}) {
    return {
        id: 'test_dummy',
        size: 16,
        hp: 30,
        speed: 60,
        damage: 10,
        exp: 5,
        color: '#ff0000',
        ...overrides
    };
}

// ---------------------------------------------------------------------------
// Enemy — construction
// ---------------------------------------------------------------------------

test('enemy: constructor scales health and damage by the difficulty multipliers', () => {
    const e = new Enemy(10, 20, makeType(), 3, 2);
    assert.equal(e.x, 10);
    assert.equal(e.y, 20);
    assert.equal(e.maxHp, 90, '30 base hp at 3x');
    assert.equal(e.hp, e.maxHp, 'spawns at full health');
    assert.equal(e.damage, 20, '10 base damage at 2x');
    assert.equal(e.size, 16);
    assert.equal(e.speed, 60);
    assert.equal(e.expValue, 5);
    assert.equal(e.id, 'test_dummy');
});

test('enemy: archetype flags default to false for a plain chaser', () => {
    const e = new Enemy(0, 0, makeType(), 1, 1);
    assert.equal(e.archetype, 'chaser', 'the default archetype');
    for (const flag of ['ranged', 'splitter', 'dasher', 'shielded', 'bomber', 'illusionist']) {
        assert.equal(e[flag], false, `${flag} must default to false`);
    }
    assert.equal(e.boss, false);
    assert.equal(e.isClone, false, 'a spawned enemy is not a clone by default');
});

test('enemy: archetype flags are taken from the type definition', () => {
    const e = new Enemy(0, 0, makeType({ shielded: true, bomber: true, boss: true }), 1, 1);
    assert.equal(e.shielded, true);
    assert.equal(e.bomber, true);
    assert.equal(e.boss, true);
});

test('enemy: combat timers start in their documented jittered ranges', () => {
    // The jitter exists so a wave does not act in perfect unison. It must stay
    // inside the documented band — a timer that could reach 0 would let an
    // enemy fire or dash on the frame it spawns.
    const type = makeType({ fireCooldown: 2, dashInterval: 4, cloneCooldown: 5 });

    withRandom(0, () => {
        const low = new Enemy(0, 0, type, 1, 1);
        assert.equal(low.fireTimer, 1, '0.5x of a 2s cooldown');
        assert.equal(low.dashTimer, 1.2, '0.3x of a 4s interval');
        assert.equal(low.cloneTimer, 3, '0.6x of a 5s cooldown');
    });

    withRandom(0.999, () => {
        const high = new Enemy(0, 0, type, 1, 1);
        assert.ok(
            high.fireTimer <= 2,
            `fireTimer must not exceed the cooldown, got ${high.fireTimer}`
        );
        assert.ok(
            high.dashTimer <= 4,
            `dashTimer must not exceed the interval, got ${high.dashTimer}`
        );
        assert.ok(high.cloneTimer <= 7, `cloneTimer must stay within 1.4x, got ${high.cloneTimer}`);
    });
});

test('enemy: a type with no cooldowns gets zeroed timers, not NaN', () => {
    const e = new Enemy(0, 0, makeType(), 1, 1);
    assert.equal(e.fireTimer, 0);
    assert.equal(e.dashTimer, 0);
    assert.equal(e.cloneTimer, 0);
    assert.equal(e.shieldHp, 0);
});

test('enemy: shield health scales with the difficulty multiplier', () => {
    const e = new Enemy(0, 0, makeType({ shielded: true, shieldHp: 40 }), 2, 1);
    assert.equal(e.shieldHp, 80, 'shield must scale with hpMult, like health does');
});

// ---------------------------------------------------------------------------
// Enemy — damage and shielding
// ---------------------------------------------------------------------------

test('enemy/takeDamage: an unshielded enemy takes the full hit', () => {
    const e = new Enemy(0, 0, makeType(), 1, 1);
    e.takeDamage(12);
    assert.equal(e.hp, 18);
    assert.equal(e.flashTimer, 0.08, 'the hit flash must be armed for the renderer');
});

test('enemy/takeDamage: a shield absorbs half the damage by default', () => {
    const e = new Enemy(0, 0, makeType({ shielded: true, shieldHp: 100 }), 1, 1);
    e.takeDamage(20);
    assert.equal(e.hp, 30 - 10, 'only the unabsorbed half reaches health');
    assert.equal(e.shieldHp, 100 - 10, 'and the shield takes the rest');
    assert.equal(e.shielded, true, 'a healthy shield stays up');
});

test('enemy/takeDamage: an explicit damageReduction overrides the default', () => {
    const e = new Enemy(
        0,
        0,
        makeType({ shielded: true, shieldHp: 100, damageReduction: 0.8 }),
        1,
        1
    );
    e.takeDamage(50);
    assert.equal(e.hp, 30 - 10, '80% absorbed leaves 10 damage');
    assert.equal(e.shieldHp, 100 - 40);
});

test('enemy/takeDamage: breaking the shield drops it and stops absorbing', () => {
    const e = new Enemy(0, 0, makeType({ shielded: true, shieldHp: 10 }), 1, 1);

    e.takeDamage(100); // 50 absorbed, far more than the 10 shield hp

    assert.equal(e.shieldHp, 0, 'shield health must clamp at zero');
    assert.equal(e.shielded, false, 'and the shield must break');

    const hpAfterBreak = e.hp;
    e.takeDamage(5);
    assert.equal(e.hp, hpAfterBreak - 5, 'a broken shield must absorb nothing further');
});

test('enemy/takeDamage: damage can drive health below zero, and callers must handle that', () => {
    // Unlike Player, Enemy does not clamp — the caller removes it when hp <= 0.
    const e = new Enemy(0, 0, makeType(), 1, 1);
    e.takeDamage(999);
    assert.ok(e.hp < 0, 'the enemy must not clamp; removal is the caller’s job');
});

// ---------------------------------------------------------------------------
// ExpOrb
// ---------------------------------------------------------------------------

test('expOrb: a more valuable orb is drawn larger, on a log scale', () => {
    const small = new ExpOrb(0, 0, 1);
    const large = new ExpOrb(0, 0, 100);
    assert.ok(large.size > small.size, 'value must be visible at a glance');
    assert.equal(small.size, 4 + Math.log(2) * 1.5);
    assert.equal(small.life, CONFIG.EXP_ORB_LIFETIME);
    assert.equal(small.shouldRemove, false);
    assert.equal(small.magnetSpeed, 0);
});

test('expOrb/update: expires after its lifetime', () => {
    const orb = new ExpOrb(0, 0, 5);
    // Far from the player and out of magnet range, so only the lifetime matters.
    const game = {
        player: { x: 10_000, y: 10_000, getMagnetRange: () => 120 }
    };

    orb.update(CONFIG.EXP_ORB_LIFETIME - 1, game);
    assert.equal(orb.life, 1, 'one second of life left');
    assert.equal(orb.shouldRemove, false, 'still alive just before the deadline');

    orb.update(2, game);
    assert.equal(orb.shouldRemove, true, 'and gone once past it');
});

test('expOrb/update: an expired orb stops updating before touching the player', () => {
    // The early return matters: without it a dead orb would still be magnetised
    // and could be collected twice in the same frame.
    const orb = new ExpOrb(0, 0, 5);
    let touched = false;
    const game = {
        player: {
            x: 0,
            y: 0,
            getMagnetRange: () => 1000,
            gainExp: () => {
                touched = true;
            }
        }
    };
    orb.update(CONFIG.EXP_ORB_LIFETIME + 1, game);
    assert.equal(orb.shouldRemove, true);
    assert.equal(touched, false, 'an expired orb must not grant experience');
});

test('expOrb/update: collecting grants experience, feedback, sound and a counter', () => {
    const collected = [];
    const floaters = [];
    const sounds = [];
    const run: Record<string, any> = {};
    const orb = new ExpOrb(10, 10, 7);
    const game = {
        player: {
            x: 12,
            y: 10,
            getMagnetRange: () => 120,
            gainExp: (v) => collected.push(v)
        },
        createFloatingText: (...a) => floaters.push(a),
        audio: { pickup: () => sounds.push('pickup') },
        run
    };

    orb.update(0.016, game);

    assert.deepEqual(collected, [7], 'the player gains the orb’s value');
    assert.equal(floaters.length, 1);
    assert.equal(floaters[0][0], '+7XP');
    assert.deepEqual(sounds, ['pickup']);
    assert.equal(run.orbsCollected, 1, 'the achievement counter must advance');
    assert.equal(orb.shouldRemove, true);
});

test('expOrb/update: collection works without a run object', () => {
    const orb = new ExpOrb(0, 0, 3);
    const game = {
        player: { x: 1, y: 0, getMagnetRange: () => 120, gainExp: () => {} },
        createFloatingText: () => {},
        audio: { pickup: () => {} },
        run: null
    };
    assert.doesNotThrow(() => orb.update(0.016, game));
    assert.equal(orb.shouldRemove, true);
});

test('expOrb/update: an orb inside magnet range accelerates toward the player', () => {
    const orb = new ExpOrb(200, 0, 5);
    const game = { player: { x: 0, y: 0, getMagnetRange: () => 1000 } };
    const startX = orb.x;

    orb.update(0.016, game);
    assert.ok(orb.x < startX, 'the orb must move toward the player');
    assert.ok(orb.magnetSpeed > 0, 'and pick up speed');
});

test('expOrb/update: magnet speed is capped', () => {
    const orb = new ExpOrb(2000, 0, 5);
    // Player far enough away to stay outside PICKUP_DISTANCE for many ticks.
    const game = { player: { x: 0, y: 0, getMagnetRange: () => 5000 } };
    for (let i = 0; i < 200; i++) orb.update(0.016, game);
    assert.ok(orb.magnetSpeed <= 560, `magnet speed must cap at 560, got ${orb.magnetSpeed}`);
});

test('expOrb/update: an orb beyond magnet range sits still', () => {
    const orb = new ExpOrb(5000, 0, 5);
    const game = { player: { x: 0, y: 0, getMagnetRange: () => 120 } };
    orb.update(0.016, game);
    assert.equal(orb.x, 5000, 'out of range means stationary');
    assert.equal(orb.magnetSpeed, 0);
});

// ---------------------------------------------------------------------------
// Particle
// ---------------------------------------------------------------------------

test('particle: honours explicit options exactly', () => {
    const p = new Particle(5, 6, '#abc', {
        size: 3,
        life: 2,
        decay: 1,
        angle: 0,
        speed: 100,
        friction: 0.5
    });
    assert.equal(p.size, 3);
    assert.equal(p.life, 2);
    assert.equal(p.decay, 1);
    assert.equal(p.vx, 100, 'angle 0 points along +x');
    assert.ok(Math.abs(p.vy) < 1e-9);
    assert.equal(p.friction, 0.5);
});

test('particle: defaults stay inside their documented ranges', () => {
    withRandom(0, () => {
        const low = new Particle(0, 0, '#fff');
        assert.equal(low.size, 2);
        // Speed is decomposed into vx/vy rather than stored. Asserting the
        // decomposition is worth more than asserting a field is absent: with
        // random pinned to 0 the angle is 0 and the speed is 60, so the whole
        // vector is determined.
        assert.equal(low.vx, 60, 'vx is cosine(0) * 60');
        assert.equal(low.vy, 0, 'vy is sine(0) * 60');
        assert.equal(low.life, 1);
    });
    withRandom(0.999, () => {
        const high = new Particle(0, 0, '#fff');
        assert.ok(high.size <= 6, `default size must stay under 6, got ${high.size}`);
        assert.ok(high.decay <= 2.5, `default decay must stay under 2.5, got ${high.decay}`);
    });
});

test('particle/update: drifts, slows down, fades and shrinks', () => {
    const p = new Particle(0, 0, '#fff', {
        size: 10,
        life: 1,
        decay: 1,
        angle: 0,
        speed: 100,
        friction: 0.5
    });
    p.update(0.5);

    assert.equal(p.x, 50, 'travels speed * dt');
    assert.ok(p.vx < 100, 'friction must slow it');
    assert.equal(p.vx, 100 * Math.pow(0.5, 0.5));
    assert.equal(p.life, 0.5, 'life decays at the decay rate');
    assert.ok(p.size < 10, 'and the particle shrinks as it dies');
});

test('particle/render: draws nothing once expired', () => {
    const p = new Particle(0, 0, '#fff', { life: 0, decay: 1 });
    let calls = 0;
    const ctx = {
        beginPath: () => calls++,
        arc: () => {},
        fill: () => {}
    };
    // The stub implements only what renderParticle touches.
    renderParticle(ctx as unknown as CanvasRenderingContext2D, p);
    assert.equal(calls, 0, 'an expired particle must not issue draw calls');
});

// ---------------------------------------------------------------------------
// FloatingText
// ---------------------------------------------------------------------------

test('floatingText: honours options and coerces the crit flag', () => {
    const t = new FloatingText('42', 1, 2, '#f00', { life: 3, vy: -10, size: 20, crit: 1 });
    assert.equal(t.text, '42');
    assert.equal(t.life, 3);
    assert.equal(t.vy, -10);
    assert.equal(t.size, 20);
    assert.equal(t.crit, true, 'a truthy value must become a real boolean');
});

test('floatingText: defaults float upward and fade', () => {
    const t = new FloatingText('x', 0, 0, '#fff');
    assert.equal(t.vy, -60, 'negative vy means rising');
    assert.equal(t.size, 16);
    assert.equal(t.weight, 'bold');
    assert.equal(t.crit, false);

    t.update(0.5);
    assert.equal(t.y, -30);
    assert.ok(
        Math.abs(t.life - (1 - 1.2 * 0.5)) < 1e-9,
        'life decays at 1.2x, faster than a particle'
    );
});

test('floatingText/render: draws nothing once expired', () => {
    const t = new FloatingText('x', 0, 0, '#fff', { life: 0 });
    let drawn = 0;
    renderFloatingText({ fillText: () => drawn++ } as any, t);
    assert.equal(drawn, 0);
});

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

test('findEnemyDef: finds a real enemy by its runtime id', () => {
    const first = Object.values(ENEMIES)[0];
    const found = findEnemyDef(first.id);
    assert.equal(found, first, 'the lookup must return the same definition object');
});

test('findEnemyDef: returns null for an unknown id rather than throwing', () => {
    assert.equal(findEnemyDef('no_such_enemy'), null);
    assert.equal(findEnemyDef(''), null);
    assert.equal(findEnemyDef(undefined), null);
});

test('findEnemyDef: every shipped enemy is reachable by its own id', () => {
    // A duplicate or missing id would make one enemy unspawnable or shadow
    // another, and nothing else in the codebase would notice.
    const seen = new Set();
    for (const def of Object.values(ENEMIES)) {
        assert.equal(findEnemyDef(def.id), def, `${def.id} must be findable`);
        assert.ok(!seen.has(def.id), `duplicate enemy id: ${def.id}`);
        seen.add(def.id);
    }
});

test('registerWeaponClass: is a documented no-op kept for backwards compatibility', () => {
    assert.equal(registerWeaponClass.length, 1);
    assert.doesNotThrow(() => registerWeaponClass(class {}));
    assert.equal(registerWeaponClass(class {}), undefined);
});
