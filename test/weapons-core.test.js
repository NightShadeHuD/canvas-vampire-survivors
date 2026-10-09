// Unit tests for the Weapon class in src/weapons.ts.
//
// weapons.ts was 43.84% covered. The Weapon class is the whole combat model:
// damage, cooldown, range, crit and evolution scaling. It is pure arithmetic
// over the player's passive-derived multipliers, which makes it both easy to
// test and easy to break silently — a wrong exponent here is a balance change
// nobody would notice until the game felt wrong.
//
// The seven `_fire*` implementations need a full game bag (enemies, pools,
// projectiles) and are covered separately; this file pins the shared core and
// the dispatch that routes to them.
//
// Runs in Node, no DOM.

import test from 'node:test';
import assert from 'node:assert/strict';
import { Weapon } from '../src/weapons.ts';
import { WEAPONS } from '../src/data.ts';

/** A weapon definition with every field the class reads. */
function makeDef(overrides = {}) {
    return {
        id: 'test_weapon',
        name: 'Test',
        icon: 'T',
        type: 'projectile',
        baseDamage: 10,
        baseCooldown: 1,
        baseRange: 100,
        projectileCount: 1,
        ...overrides
    };
}

/** A player exposing only what Weapon reads. */
function makePlayer(overrides = {}) {
    return {
        getDamageMult: () => 1,
        getCritChance: () => 0,
        getCooldownMult: () => 1,
        getAreaMult: () => 1,
        passives: {},
        ...overrides
    };
}

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

/** A game bag that records floating text and can be spied on. */
function makeGame() {
    const floaters = [];
    return {
        floaters,
        createFloatingText: (...args) => floaters.push(args)
    };
}

// ---------------------------------------------------------------------------
// construction and levelling
// ---------------------------------------------------------------------------

test('weapon: construction copies identity and starts at level 1 with no cooldown', () => {
    const w = new Weapon(makeDef());
    assert.equal(w.id, 'test_weapon');
    assert.equal(w.name, 'Test');
    assert.equal(w.icon, 'T');
    assert.equal(w.level, 1);
    assert.equal(w.cooldown, 0, 'a new weapon is ready to fire');
    assert.equal(w._shards, null, 'shards are created lazily by orbit weapons');
});

test('weapon/levelUp: increments the level', () => {
    const w = new Weapon(makeDef());
    w.levelUp();
    assert.equal(w.level, 2);
});

test('weapon/isEvolved: requires both an evolve level and reaching it', () => {
    const plain = new Weapon(makeDef());
    assert.equal(plain.isEvolved(), false, 'a weapon with no evolve level never evolves');

    const evolvable = new Weapon(makeDef({ evolveLevel: 3 }));
    assert.equal(evolvable.isEvolved(), false, 'level 1 is below the evolve level');
    evolvable.levelUp();
    assert.equal(evolvable.isEvolved(), false, 'level 2 is still below');
    evolvable.levelUp();
    assert.equal(evolvable.isEvolved(), true, 'level 3 reaches it');

    evolvable.levelUp();
    assert.equal(evolvable.isEvolved(), true, 'and it stays evolved');
});

// ---------------------------------------------------------------------------
// damage
// ---------------------------------------------------------------------------

test('weapon/getDamage: level scaling is +20% of base per level', () => {
    const w = new Weapon(makeDef({ baseDamage: 10 }));
    assert.equal(w.getDamage(makePlayer()), 10);
    w.levelUp();
    assert.equal(w.getDamage(makePlayer()), 12);
    w.levelUp();
    assert.equal(w.getDamage(makePlayer()), 14);
});

test('weapon/getDamage: multiplies by the player damage multiplier', () => {
    const w = new Weapon(makeDef({ baseDamage: 10 }));
    const player = makePlayer({ getDamageMult: () => 2.5 });
    assert.equal(w.getDamage(player), 25);
});

test('weapon/getDamage: an evolved weapon applies its evolution scalar', () => {
    const w = new Weapon(makeDef({ baseDamage: 10, evolveLevel: 2, evolveDamageMult: 3 }));
    assert.equal(w.getDamage(makePlayer()), 10, 'not evolved yet');
    w.levelUp();
    assert.equal(w.getDamage(makePlayer()), 36, '12 base at level 2, then tripled');
});

test('weapon/getDamage: an evolved weapon without a scalar is unchanged', () => {
    const w = new Weapon(makeDef({ baseDamage: 10, evolveLevel: 1 }));
    assert.equal(w.isEvolved(), true, 'level 1 already meets an evolve level of 1');
    assert.equal(w.getDamage(makePlayer()), 10);
});

// ---------------------------------------------------------------------------
// cooldown and range
// ---------------------------------------------------------------------------

test('weapon/getCooldown: level scaling is 0.92 per level', () => {
    const w = new Weapon(makeDef({ baseCooldown: 1 }));
    assert.equal(w.getCooldown(makePlayer()), 1);
    w.levelUp();
    assert.ok(Math.abs(w.getCooldown(makePlayer()) - 0.92) < 1e-9);
    w.levelUp();
    assert.ok(Math.abs(w.getCooldown(makePlayer()) - 0.92 ** 2) < 1e-9);
});

test('weapon/getCooldown: multiplies by the player cooldown multiplier', () => {
    const w = new Weapon(makeDef({ baseCooldown: 2 }));
    const player = makePlayer({ getCooldownMult: () => 0.5 });
    assert.equal(w.getCooldown(player), 1);
});

test('weapon/getCooldown: an evolved weapon applies its evolution multiplier', () => {
    const w = new Weapon(makeDef({ baseCooldown: 1, evolveLevel: 1, evolveCooldownMult: 0.5 }));
    assert.equal(w.getCooldown(makePlayer()), 0.5);
});

test('weapon/getRange: grows 10% per level and follows the area multiplier', () => {
    const w = new Weapon(makeDef({ baseRange: 100 }));
    const close = (a, b) => Math.abs(a - b) < 1e-9;

    assert.equal(w.getRange(makePlayer()), 100);
    w.levelUp();
    // 100 * 1.1 is 110.00000000000001 in binary floating point, so this needs a
    // tolerance where the integer assertions elsewhere do not.
    assert.ok(
        close(w.getRange(makePlayer()), 110),
        `expected 110, got ${w.getRange(makePlayer())}`
    );

    const wide = makePlayer({ getAreaMult: () => 2 });
    assert.ok(close(w.getRange(wide), 220), `expected 220, got ${w.getRange(wide)}`);
});

// ---------------------------------------------------------------------------
// orbit shards
// ---------------------------------------------------------------------------

test('weapon/getOrbitShardCount: a shard per two levels', () => {
    const w = new Weapon(makeDef({ projectileCount: 2 }));
    const player = makePlayer();
    assert.equal(w.getOrbitShardCount(player), 2);
    w.levelUp();
    assert.equal(w.getOrbitShardCount(player), 2, 'level 2 still rounds down');
    w.levelUp();
    assert.equal(w.getOrbitShardCount(player), 3, 'level 3 adds the first extra shard');
});

test('weapon/getOrbitShardCount: evolution doubles the count', () => {
    const w = new Weapon(makeDef({ projectileCount: 2, evolveLevel: 1 }));
    assert.equal(w.getOrbitShardCount(makePlayer()), 4);
});

test('weapon/getOrbitShardCount: cooldown passives grant a synergy shard per two stacks', () => {
    const w = new Weapon(makeDef({ projectileCount: 1 }));
    const player = makePlayer({ passives: { cooldown: { count: 3 } } });
    assert.equal(w.getOrbitShardCount(player), 2, 'three stacks rounds down to one bonus shard');
});

test('weapon/getOrbitShardCount: is capped at 12 however much you stack', () => {
    const w = new Weapon(makeDef({ projectileCount: 10, evolveLevel: 1 }));
    const player = makePlayer({ passives: { cooldown: { count: 5 } } });
    assert.equal(w.getOrbitShardCount(player), 12, 'the cap must hold');
});

test('weapon/getOrbitShardCount: works without a passives object at all', () => {
    const w = new Weapon(makeDef({ projectileCount: 1 }));
    assert.doesNotThrow(() => w.getOrbitShardCount(makePlayer({ passives: undefined })));
});

test('weapon/_ensureShards: builds shards and then updates them in place', () => {
    const w = new Weapon(makeDef({ type: 'orbit', projectileCount: 2 }));
    const player = makePlayer();

    w._ensureShards(player);
    const first = w._shards;
    assert.equal(first.length, 2, 'one shard per projectile count');
    assert.ok(first[0].radius > 0 && first[0].damage > 0);

    // Same count: the array must be reused, not rebuilt, because these run
    // every frame and reallocating them would churn the heap.
    w._ensureShards(player);
    assert.equal(w._shards, first, 'shards must be updated in place, not recreated');

    // Count changes: now it must rebuild.
    w.levelUp();
    w.levelUp();
    w._ensureShards(player);
    assert.equal(w._shards.length, 3);
    assert.notEqual(w._shards, first, 'a new count needs a new set');
});

// ---------------------------------------------------------------------------
// critical strikes
// ---------------------------------------------------------------------------

test('weapon/_rollCrit: with no crit chance it never crits', () => {
    const w = new Weapon(makeDef());
    const game = makeGame();
    // Even a random of 0 must not crit when the chance is 0 — the guard is
    // `chance > 0 && random < chance`, and 0 < 0 is false.
    const dmg = withRandom(0, () => w._rollCrit(makePlayer(), game, 10, 0, 0, '#fff'));
    assert.equal(dmg, 10);
    assert.equal(game.floaters.length, 1);
    assert.equal(game.floaters[0][0], 10);
    assert.equal(game.floaters[0][3], '#fff', 'a normal hit uses the caller’s colour');
});

test('weapon/_rollCrit: landing a crit doubles damage and marks the floater', () => {
    const w = new Weapon(makeDef());
    const game = makeGame();
    const player = makePlayer({ getCritChance: () => 0.5 });

    const dmg = withRandom(0.1, () => w._rollCrit(player, game, 10, 0, 0, '#fff'));
    assert.equal(dmg, 20, 'a crit doubles the damage');
    assert.equal(game.floaters[0][3], '#ffee44', 'and is drawn in the crit colour');
    assert.equal(game.floaters[0][4].crit, true, 'and flagged so it renders larger');
});

test('weapon/_rollCrit: missing the roll deals normal damage', () => {
    const w = new Weapon(makeDef());
    const game = makeGame();
    const player = makePlayer({ getCritChance: () => 0.5 });

    const dmg = withRandom(0.9, () => w._rollCrit(player, game, 10, 0, 0, '#fff'));
    assert.equal(dmg, 10);
    assert.equal(game.floaters[0][4], undefined, 'no crit flag on a normal hit');
});

test('weapon/_rollCrit: an evolved weapon adds its flat crit bonus', () => {
    const w = new Weapon(makeDef({ evolveLevel: 1, evolveBonusCrit: 0.4 }));
    const game = makeGame();
    const player = makePlayer({ getCritChance: () => 0.1 });

    // 0.3 is above the player's 0.1 but below the evolved 0.5.
    const dmg = withRandom(0.3, () => w._rollCrit(player, game, 10, 0, 0, '#fff'));
    assert.equal(dmg, 20, 'the evolution bonus must be added to the passive crit chance');
});

test('weapon/_rollCrit: rounds the displayed number but returns the raw value', () => {
    // The floater must not show "12.6 damage", but the damage actually dealt
    // must not be silently rounded down either.
    const w = new Weapon(makeDef());
    const game = makeGame();
    const dmg = w._rollCrit(makePlayer(), game, 12.6, 0, 0, '#fff');
    assert.equal(dmg, 12.6, 'the returned damage stays precise');
    assert.equal(game.floaters[0][0], 13, 'the displayed number is rounded');
});

// ---------------------------------------------------------------------------
// update and firing
// ---------------------------------------------------------------------------

test('weapon/update: fires when the cooldown elapses and then resets it', () => {
    const w = new Weapon(makeDef({ baseCooldown: 1 }));
    const player = makePlayer();
    const fired = [];
    w.fire = () => fired.push('fire');

    // A new weapon starts with cooldown 0, so it is ready immediately — it does
    // not have to charge up first. That is why the first tick fires.
    w.update(0.5, player, makeGame());
    assert.equal(fired.length, 1, 'a fresh weapon fires on its first update');
    assert.equal(w.cooldown, 1, 'and is then set to its full cooldown');

    w.update(0.5, player, makeGame());
    assert.equal(fired.length, 1, 'still charging — half a second of a one second cooldown');

    w.update(0.6, player, makeGame());
    assert.equal(fired.length, 2, 'the cooldown elapsed');
    assert.equal(w.cooldown, 1, 'and it was reset again');
});

test('weapon/update: a weapon starting at zero cooldown fires on its first frame', () => {
    const w = new Weapon(makeDef());
    let fires = 0;
    w.fire = () => fires++;
    w.update(0.016, makePlayer(), makeGame());
    assert.equal(fires, 1);
});

test('weapon/update: orbit weapons tick their shards instead of using a cooldown', () => {
    const w = new Weapon(makeDef({ type: 'orbit', projectileCount: 1 }));
    const ticked = [];
    w.fire = () => assert.fail('an orbit weapon must not use the cooldown fire path');

    w._ensureShards = (_player) => {
        w._shards = [{ update: (dt) => ticked.push(dt) }];
    };

    w.update(0.25, makePlayer(), makeGame());

    assert.deepEqual(ticked, [0.25], 'every shard is ticked with the frame delta');
    assert.equal(w.cooldown, 0, 'and the cooldown is left alone');
});

test('weapon/fire: routes each type to its own implementation', () => {
    const expected = {
        melee: '_fireMelee',
        projectile: '_fireProjectile',
        instant: '_fireInstant',
        aura: '_fireAura',
        mine: '_fireMine',
        nova: '_fireNova',
        drain: '_fireDrain'
    };

    for (const [type, handler] of Object.entries(expected)) {
        const w = new Weapon(makeDef({ type }));
        let called = null;
        w[handler] = () => {
            called = handler;
        };
        w.fire(makePlayer(), makeGame());
        assert.equal(called, handler, `type "${type}" must route to ${handler}()`);
    }
});

test('weapon/fire: an unrecognised type returns quietly instead of throwing', () => {
    // A typo in the weapon catalogue must not crash a run mid-frame.
    const w = new Weapon(makeDef({ type: 'not_a_real_type' }));
    assert.equal(w.fire(makePlayer(), makeGame()), undefined);
});

// ---------------------------------------------------------------------------
// integration over the shipped catalogue
// ---------------------------------------------------------------------------

test('weapon: every shipped weapon computes finite stats at every level', () => {
    // The catalogue and the class are edited independently, so a new weapon
    // with a mistyped field would produce NaN damage and nothing else in the
    // codebase would complain.
    const player = makePlayer({ getDamageMult: () => 1.5, getCooldownMult: () => 0.8 });
    for (const def of Object.values(WEAPONS)) {
        const w = new Weapon(def);
        for (let level = 1; level <= 8; level++) {
            const damage = w.getDamage(player);
            const cooldown = w.getCooldown(player);
            const range = w.getRange(player);
            assert.ok(
                Number.isFinite(damage) && damage > 0,
                `${def.id} L${level} damage: ${damage}`
            );
            assert.ok(
                Number.isFinite(cooldown) && cooldown > 0,
                `${def.id} L${level} cooldown: ${cooldown}`
            );
            assert.ok(Number.isFinite(range) && range > 0, `${def.id} L${level} range: ${range}`);
            w.levelUp();
        }
    }
});

test('weapon: every shipped weapon has a reachable fire implementation', () => {
    // Guards the dispatch table against a new type being added to the data
    // without a matching case in fire().
    const known = new Set([
        'melee',
        'projectile',
        'instant',
        'aura',
        'mine',
        'nova',
        'drain',
        'orbit'
    ]);
    for (const def of Object.values(WEAPONS)) {
        assert.ok(known.has(def.type), `${def.id} has unhandled fire type "${def.type}"`);
    }
});
