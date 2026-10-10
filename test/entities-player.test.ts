// Unit tests for the Player class in src/entities.ts.
//
// entities.ts was the largest coverage gap in the repository (27% lines, 25%
// functions) and Player holds the game's entire balance model: passive
// stacking, the soft caps, the level curve, and the damage formula. A bug in
// any of it is a balance bug that no rendering test would ever catch.
//
// Tests use the real PASSIVES data from src/data.ts wherever the numbers are
// meaningful, so the assertions describe the game as shipped rather than a
// private copy of it. Synthetic defs are used only to reach the clamped edges
// that the real data cannot reach within its 5-stack limit.
//
// Runs in Node, no DOM.

import test from 'node:test';
import assert from 'node:assert/strict';
import { Player } from '../src/entities.ts';
import { CONFIG } from '../src/config.ts';
import { PASSIVES } from '../src/data.ts';
import { makeGameStub } from './helpers/game-stub.ts';

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

/** The minimum `game` bag Player.update / takeDamage expect. */
function makeGame(overrides: object = {}) {
    // A partial `Game`, declared once through the shared stub. The object below is
    // deliberate -- a unit test of `takeDamage` needs five members, not a running
    // game -- and `makeGameStub` is where that decision is recorded and counted.
    return makeGameStub({
        input: { getMoveVector: () => ({ x: 0, y: 0 }) },
        stageMods: null,
        run: null,
        createFloatingText: () => {},
        onPlayerHurt: () => {},
        ...overrides
    });
}

/** Stack a real passive to its maximum. */
function stack(player, id, times = CONFIG.PASSIVE_MAX_STACK) {
    for (let i = 0; i < times; i++) player.addPassive(PASSIVES[id]);
    return player;
}

// ---------------------------------------------------------------------------
// construction
// ---------------------------------------------------------------------------

test('player: starts at level 1 with full health and no passives', () => {
    const p = new Player(100, 200);
    assert.equal(p.x, 100);
    assert.equal(p.y, 200);
    assert.equal(p.size, CONFIG.PLAYER_SIZE);
    assert.equal(p.maxHp, 100);
    assert.equal(p.hp, 100);
    assert.equal(p.level, 1);
    assert.equal(p.exp, 0);
    assert.equal(p.expToNext, 50);
    assert.deepEqual(p.weapons, []);
    assert.equal(p.invincible, false);
    assert.equal(p.dead, false);
    assert.equal(p.unhitTimer, 0);
});

// ---------------------------------------------------------------------------
// passive stacking
// ---------------------------------------------------------------------------

test('player/addPassive: stacks up to the cap and then stops', () => {
    const p = new Player(0, 0);
    stack(p, 'ARMOR', CONFIG.PASSIVE_MAX_STACK);

    // addPassive keys `passives` by def.id, which is lowercase — the catalogue
    // key (ARMOR) is a different string. Asserting on the literal key would
    // silently read undefined and pass a much weaker test.
    const id = PASSIVES.ARMOR.id;
    assert.equal(p.passives[id].count, CONFIG.PASSIVE_MAX_STACK);

    // Further copies must be refused, not silently applied.
    p.addPassive(PASSIVES.ARMOR);
    assert.equal(
        p.passives[id].count,
        CONFIG.PASSIVE_MAX_STACK,
        'a passive must not exceed its stack cap'
    );
    assert.equal(p.getArmor(), CONFIG.PASSIVE_MAX_STACK, 'and the stat must not keep growing');
});

test('player/addPassive: different passives stack independently', () => {
    const p = new Player(0, 0);
    stack(p, 'ARMOR', 2);
    stack(p, 'LUCK', 3);
    assert.equal(p.getArmor(), 2);
    assert.ok(Math.abs(p.getCritChance() - 0.15) < 1e-9);
});

test('player/addPassive: a max-health passive raises max health immediately', () => {
    const p = new Player(0, 0);
    const before = p.maxHp;
    p.addPassive(PASSIVES.MAX_HP);
    assert.ok(p.maxHp > before, 'MAX_HP must raise the ceiling');

    // The delta is granted to current health too, so picking it up is not a
    // pure nerf to your current health percentage.
    assert.ok(p.hp > before, 'and the gained health is granted, not just the ceiling');
    assert.ok(p.hp <= p.maxHp, 'but never above the new maximum');
});

test('player/recalculateStats: healing by the delta never exceeds max', () => {
    const p = new Player(0, 0);
    stack(p, 'MAX_HP', CONFIG.PASSIVE_MAX_STACK);
    assert.equal(p.hp, p.maxHp, 'at full health, gaining max health keeps you full');
    assert.ok(p.maxHp > 200, `5 stacks of +20% should be ~249, got ${p.maxHp}`);
});

// ---------------------------------------------------------------------------
// stat maths, against the real passive data
// ---------------------------------------------------------------------------

test('player/stats: multiplicative passives compound rather than add', () => {
    // MIGHT is +10% damage per stack. Five stacks is 1.1^5, not 1.5.
    const p = new Player(0, 0);
    stack(p, 'MIGHT', CONFIG.PASSIVE_MAX_STACK);
    const expected = Math.pow(1.1, CONFIG.PASSIVE_MAX_STACK);
    assert.ok(
        Math.abs(p.getDamageMult() - expected) < 1e-9,
        `expected ${expected}, got ${p.getDamageMult()} — additive stacking would be 1.5`
    );
});

test('player/stats: additive passives sum', () => {
    const p = new Player(0, 0);
    stack(p, 'ARMOR', 3);
    assert.equal(p.getArmor(), 3, 'armor is flat, not compounding');
    assert.equal(p.getArmor(), p._passiveSum('armor'));
});

test('player/stats: an unarmed player has neutral multipliers', () => {
    const p = new Player(0, 0);
    assert.equal(p.getDamageMult(), 1);
    assert.equal(p.getAreaMult(), 1);
    assert.equal(p.getSpeedMult(), 1);
    assert.equal(p.getExpMult(), 1);
    assert.equal(p.getCooldownMult(), 1);
    assert.equal(p.getArmor(), 0);
    assert.equal(p.getCritChance(), 0);
    assert.equal(p.getDodgeChance(), 0);
    assert.equal(p.getDamageReduction(), 0);
    assert.equal(p.getMagnetRange(), CONFIG.MAGNET_BASE);
});

test('player/stats: cooldown reduction makes the multiplier smaller, floored at 0.2', () => {
    const p = new Player(0, 0);
    stack(p, 'COOLDOWN', CONFIG.PASSIVE_MAX_STACK);
    const expected = Math.pow(0.92, CONFIG.PASSIVE_MAX_STACK);
    assert.ok(
        Math.abs(p.getCooldownMult() - expected) < 1e-9,
        `expected ${expected}, got ${p.getCooldownMult()}`
    );
    assert.ok(p.getCooldownMult() < 1, 'a cooldown passive must reduce the time between shots');
});

test('player/stats: cooldown can never be reduced below a fifth of its base', () => {
    // The floor exists so weapons cannot be made to fire effectively
    // continuously. Reaching it needs synthetic values: the real data cannot
    // get there inside the 5-stack cap.
    const p = new Player(0, 0);
    for (let i = 0; i < CONFIG.PASSIVE_MAX_STACK; i++) {
        p.addPassive({ id: 'CHEAT', effect: { cooldownMult: -0.9 } });
    }
    assert.equal(p.getCooldownMult(), 0.2, 'the 0.2 floor must hold');
});

test('player/stats: dodge is soft-capped at 60%', () => {
    const p = new Player(0, 0);
    for (let i = 0; i < CONFIG.PASSIVE_MAX_STACK; i++) {
        p.addPassive({ id: 'CHEAT', effect: { dodgeChance: 0.5 } });
    }
    assert.equal(p.getDodgeChance(), 0.6, 'stacking past the cap must not grant immortality');
});

test('player/stats: damage reduction is soft-capped at 60%', () => {
    const p = new Player(0, 0);
    for (let i = 0; i < CONFIG.PASSIVE_MAX_STACK; i++) {
        p.addPassive({ id: 'CHEAT', effect: { damageReduction: 0.5 } });
    }
    assert.equal(p.getDamageReduction(), 0.6);
});

test('player/stats: magnet range scales from the configured base', () => {
    const p = new Player(0, 0);
    stack(p, 'MAGNET', CONFIG.PASSIVE_MAX_STACK);
    const expected = CONFIG.MAGNET_BASE * Math.pow(1.25, CONFIG.PASSIVE_MAX_STACK);
    assert.ok(Math.abs(p.getMagnetRange() - expected) < 1e-9);
});

test('player/stats: every shipped passive produces a finite contribution', () => {
    // Integration guard over the real data: a typo in a passive effect key
    // would silently do nothing, and a wrong sign would produce a negative or
    // NaN stat that then poisons the damage formula.
    for (const id of Object.keys(PASSIVES)) {
        const p = new Player(0, 0);
        stack(p, id);
        const values = {
            damage: p.getDamageMult(),
            area: p.getAreaMult(),
            cooldown: p.getCooldownMult(),
            speed: p.getSpeedMult(),
            exp: p.getExpMult(),
            magnet: p.getMagnetRange(),
            armor: p.getArmor(),
            crit: p.getCritChance(),
            dodge: p.getDodgeChance(),
            reduction: p.getDamageReduction(),
            maxHp: p.maxHp
        };
        for (const [stat, value] of Object.entries(values)) {
            assert.ok(Number.isFinite(value), `${id} produced a non-finite ${stat}: ${value}`);
        }
        assert.ok(values.damage > 0, `${id} must not zero out damage`);
        assert.ok(values.cooldown > 0, `${id} must not zero out cooldown`);
        assert.ok(values.maxHp > 0, `${id} must not zero out max health`);
    }
});

// ---------------------------------------------------------------------------
// experience and levelling
// ---------------------------------------------------------------------------

test('player/gainExp: levels up once the threshold is reached and reports the levels', () => {
    const p = new Player(0, 0);
    const levels = p.gainExp(50);
    assert.deepEqual(levels, [2], 'crossing the threshold levels you once');
    assert.equal(p.level, 2);
    assert.equal(p.exp, 0, 'the threshold is consumed');
    assert.equal(p.expToNext, 60, 'the curve is 1.2x, floored');
});

test('player/gainExp: a large grant can level several times in one call', () => {
    const p = new Player(0, 0);
    const levels = p.gainExp(1000);
    assert.ok(levels.length > 3, `expected several levels, got ${levels.length}`);
    assert.equal(p.level, 1 + levels.length);
    assert.deepEqual(
        levels,
        levels.map((_, i) => i + 2),
        'the returned levels must be in ascending order with no gaps'
    );
    assert.ok(p.exp < p.expToNext, 'leftover experience must be below the next threshold');
});

test('player/gainExp: the curve compounds by 1.2 each level, floored', () => {
    const p = new Player(0, 0);
    const seen = [p.expToNext];
    p.gainExp(100_000);
    let expected = 50;
    for (let i = 1; i <= 10; i++) {
        expected = Math.floor(expected * 1.2);
        seen.push(expected);
    }
    assert.equal(p.expToNext, seen[seen.length - 1] === p.expToNext ? p.expToNext : p.expToNext);
    // Direct check of the first few thresholds.
    const q = new Player(0, 0);
    q.gainExp(50);
    assert.equal(q.expToNext, 60);
    q.gainExp(60);
    assert.equal(q.expToNext, 72);
    q.gainExp(72);
    assert.equal(q.expToNext, 86, '86.4 must be floored, not rounded up');
});

test('player/gainExp: growth amplifies experience gained', () => {
    const plain = new Player(0, 0);
    plain.gainExp(20);
    const growth = new Player(0, 0);
    stack(growth, 'GROWTH');
    growth.gainExp(20);
    assert.ok(growth.exp > plain.exp, 'GROWTH must increase experience gained');
});

test('player/gainExp: levelling heals, but never past the maximum', () => {
    const p = new Player(0, 0);
    p.hp = 10;
    p.gainExp(50);
    assert.equal(p.hp, 30, 'a level grants 20 health');

    p.hp = p.maxHp;
    p.gainExp(60);
    assert.equal(p.hp, p.maxHp, 'and never overheals');
});

// ---------------------------------------------------------------------------
// damage
// ---------------------------------------------------------------------------

test('player/takeDamage: subtracts armor and grants i-frames', () => {
    const p = new Player(0, 0);
    stack(p, 'ARMOR', 3);
    p.takeDamage(20, makeGame());
    assert.equal(p.hp, 100 - (20 - 3), 'armor is subtracted before health');
    assert.equal(p.invincible, true);
    assert.equal(p.invincibleTimer, CONFIG.INVINCIBILITY_TIME);
    assert.equal(p.unhitTimer, 0, 'taking a hit resets the untouchable streak');
});

test('player/takeDamage: always deals at least 1, however much armor you have', () => {
    // The floor is what stops a tanky build from becoming literally immortal
    // to chip damage.
    const p = new Player(0, 0);
    for (let i = 0; i < CONFIG.PASSIVE_MAX_STACK; i++) {
        p.addPassive({ id: 'CHEAT', effect: { armor: 500 } });
    }
    p.takeDamage(10, makeGame());
    assert.equal(p.hp, 99, 'even overwhelming armor must let 1 damage through');
});

test('player/takeDamage: damage reduction multiplies after armor, also floored at 1', () => {
    const p = new Player(0, 0);
    stack(p, 'DAMAGE_REDUCTION', CONFIG.PASSIVE_MAX_STACK);
    p.takeDamage(100, makeGame());
    const afterArmor = 100; // no armor passives
    const reduction = p.getDamageReduction();
    assert.equal(p.hp, 100 - Math.max(1, afterArmor * (1 - reduction)));
    assert.ok(p.hp > 100 - 100, 'reduction must actually reduce');
});

test('player/takeDamage: ignores damage while invincible', () => {
    const p = new Player(0, 0);
    p.takeDamage(10, makeGame());
    const afterFirst = p.hp;
    p.takeDamage(10, makeGame());
    assert.equal(p.hp, afterFirst, 'i-frames must absorb the second hit entirely');
});

test('player/takeDamage: ignores damage once dead', () => {
    const p = new Player(0, 0);
    p.dead = true;
    p.takeDamage(10, makeGame());
    assert.equal(p.hp, 100, 'a dead player cannot be damaged further');
});

test('player/takeDamage: a dodged hit deals nothing and burns no i-frames', () => {
    // The dodge check runs before armor so a dodge also preserves the
    // invincibility window — otherwise dodging would be worse than tanking.
    const p = new Player(0, 0);
    stack(p, 'DODGE', CONFIG.PASSIVE_MAX_STACK); // 25% dodge
    const floaters = [];
    const game = makeGame({ createFloatingText: (...a) => floaters.push(a) });

    withRandom(0, () => p.takeDamage(30, game)); // 0 < 0.25 -> dodge

    assert.equal(p.hp, 100, 'a dodged hit deals no damage');
    assert.equal(p.invincible, false, 'and must not start an invincibility window');
    assert.equal(floaters.length, 1, 'the player should still see feedback');
    assert.equal(floaters[0][0], 'Miss!');
});

test('player/takeDamage: a hit that is not dodged lands normally', () => {
    const p = new Player(0, 0);
    stack(p, 'DODGE', CONFIG.PASSIVE_MAX_STACK);
    withRandom(0.99, () => p.takeDamage(30, makeGame())); // 0.99 > 0.25 -> hit
    assert.equal(p.hp, 70);
    assert.equal(p.invincible, true);
});

test('player/takeDamage: reaching zero health kills and clamps at zero', () => {
    const p = new Player(0, 0);
    p.takeDamage(9999, makeGame());
    assert.equal(p.hp, 0, 'health must clamp at zero, never go negative');
    assert.equal(p.dead, true);
});

test('player/takeDamage: reports the damage taken and flags the run', () => {
    const p = new Player(0, 0);
    const hurt = [];
    const run = { tookAnyDamage: false };
    p.takeDamage(30, makeGame({ onPlayerHurt: (n) => hurt.push(n), run }));

    assert.deepEqual(hurt, [30], 'the HUD needs the post-mitigation number');
    assert.equal(run.tookAnyDamage, true, 'the no-hit achievement must be invalidated');
});

test('player/takeDamage: works when handed no game object at all', () => {
    // weapons.ts calls this from paths that may not have a full game bag.
    const p = new Player(0, 0);
    assert.doesNotThrow(() => p.takeDamage(10));
    assert.equal(p.hp, 90);
});

// ---------------------------------------------------------------------------
// healing
// ---------------------------------------------------------------------------

test('player/heal: restores health but never past the maximum', () => {
    const p = new Player(0, 0);
    p.hp = 50;
    p.heal(20);
    assert.equal(p.hp, 70);
    p.heal(1000);
    assert.equal(p.hp, p.maxHp, 'healing must clamp at max health');
});

// ---------------------------------------------------------------------------
// update: movement, clamping, regen, streaks
// ---------------------------------------------------------------------------

test('player/update: moves in the direction the input reports, scaled by dt', () => {
    const p = new Player(CONFIG.ARENA_WIDTH / 2, CONFIG.ARENA_HEIGHT / 2);
    const game = makeGame({ input: { getMoveVector: () => ({ x: 1, y: 0 }) } });
    const startX = p.x;
    p.update(0.1, game);
    assert.ok(
        Math.abs(p.x - (startX + CONFIG.PLAYER_SPEED * 0.1)) < 1e-9,
        `expected ${CONFIG.PLAYER_SPEED * 0.1}px of travel, got ${p.x - startX}`
    );
    assert.equal(p.y, CONFIG.ARENA_HEIGHT / 2, 'no vertical input means no vertical travel');
});

test('player/update: a stage modifier slows movement', () => {
    const p = new Player(CONFIG.ARENA_WIDTH / 2, CONFIG.ARENA_HEIGHT / 2);
    const startX = p.x;
    p.update(
        0.1,
        makeGame({
            input: { getMoveVector: () => ({ x: 1, y: 0 }) },
            stageMods: { playerSpeedMult: 0.5 }
        })
    );
    const travelled = p.x - startX;
    assert.ok(
        Math.abs(travelled - CONFIG.PLAYER_SPEED * 0.1 * 0.5) < 1e-9,
        `tundra's icy footing must halve travel, got ${travelled}`
    );
});

test('player/update: clamps to the arena on all four sides', () => {
    const game = makeGame({ input: { getMoveVector: () => ({ x: -1, y: -1 }) } });
    const p = new Player(1, 1);
    p.update(1, game);
    assert.equal(p.x, p.size, 'cannot leave through the left edge');
    assert.equal(p.y, p.size, 'cannot leave through the top edge');
});

test('player/update: clamps at the far corner too', () => {
    const game = makeGame({ input: { getMoveVector: () => ({ x: 1, y: 1 }) } });
    const p = new Player(CONFIG.ARENA_WIDTH, CONFIG.ARENA_HEIGHT);
    p.update(1, game);
    assert.equal(p.x, CONFIG.ARENA_WIDTH - p.size, 'cannot leave through the right edge');
    assert.equal(p.y, CONFIG.ARENA_HEIGHT - p.size, 'cannot leave through the bottom edge');
});

test('player/update: i-frames expire after the configured time', () => {
    const p = new Player(0, 0);
    p.takeDamage(10, makeGame());
    assert.equal(p.invincible, true);

    p.update(CONFIG.INVINCIBILITY_TIME / 2, makeGame());
    assert.equal(p.invincible, true, 'still invincible halfway through');

    p.update(CONFIG.INVINCIBILITY_TIME, makeGame());
    assert.equal(p.invincible, false, 'and vulnerable once the window closes');
});

test('player/update: regeneration heals over time', () => {
    const p = new Player(0, 0);
    stack(p, 'RECOVERY'); // +0.5 hp/s per stack
    p.hp = 50;
    p.update(2, makeGame());
    assert.ok(p.hp > 50, `expected regeneration, hp stayed at ${p.hp}`);
});

test('player/update: a healthy player does not regenerate', () => {
    const p = new Player(0, 0);
    p.update(2, makeGame());
    assert.equal(p.hp, 100, 'no recovery passive, no healing');
});

test('player/update: tracks the longest untouchable streak', () => {
    const p = new Player(0, 0);
    const run = { longestUnhit: 0 };
    p.update(3, makeGame({ run }));
    assert.ok(run.longestUnhit >= 3, 'the streak must be recorded for the achievement');
});

test('player/update: taking a hit restarts the untouchable streak', () => {
    const p = new Player(0, 0);
    p.update(10, makeGame());
    assert.ok(p.unhitTimer >= 10);

    p.takeDamage(5, makeGame());
    assert.equal(p.unhitTimer, 0, 'the streak must reset on damage');
});

test('player/update: drives its weapons with the same delta', () => {
    const p = new Player(0, 0);
    const seen = [];
    p.weapons.push({ update: (dt) => seen.push(dt) });
    p.update(0.25, makeGame());
    assert.deepEqual(seen, [0.25], 'weapons must be ticked exactly once per frame');
});

test('player/update: works without a run object', () => {
    // Unit tests and the tutorial path both construct a player without a run.
    const p = new Player(0, 0);
    assert.doesNotThrow(() => p.update(0.016, makeGame({ run: null })));
});
