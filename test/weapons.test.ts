// Unit tests for the Weapon class. We import the real Weapon, then stub the
// minimal player/game scaffolding each scenario needs.

import test from 'node:test';
import assert from 'node:assert/strict';
import { Weapon } from '../src/weapons.ts';
import { WEAPONS } from '../src/data.ts';
import { CONFIG } from '../src/config.ts';
import { makeEnemyStub, makePlayerStub } from './helpers/game-stub.ts';
import type { Game } from '../src/main.ts';

// Minimal player that satisfies every getter Weapon touches.
function makePlayer({
    crit = 0,
    dmgMult = 1,
    cdMult = 1,
    areaMult = 1
}: Record<string, number> = {}) {
    return makePlayerStub({
        x: 0,
        y: 0,
        passives: {},
        getDamageMult: () => dmgMult,
        getCooldownMult: () => cdMult,
        getAreaMult: () => areaMult,
        getCritChance: () => crit,
        weapons: []
    });
}

// Minimal game that records floating-text calls.
function makeGame() {
    const texts: any[] = [];
    const game = {
        texts,
        createFloatingText(text, x, y, color, opts) {
            texts.push({ text, x, y, color, opts });
        },
        createParticles() {},
        audio: { shoot() {}, explosion() {} },
        projectiles: [],
        enemies: [],
        mines: [],
        player: undefined
    };
    return game as unknown as Game & { texts: any[] };
}

test('Weapon: starts at level 1', () => {
    const w = new Weapon(WEAPONS.WHIP);
    assert.equal(w.level, 1);
    assert.equal(w.id, 'whip');
});

test('Weapon: levelUp increments', () => {
    const w = new Weapon(WEAPONS.WHIP);
    w.levelUp();
    assert.equal(w.level, 2);
    w.levelUp();
    assert.equal(w.level, 3);
});

test('Weapon: isEvolved is false below evolveLevel', () => {
    const w = new Weapon(WEAPONS.WHIP);
    for (let i = 1; i < WEAPONS.WHIP.evolveLevel; i++) {
        assert.equal(w.isEvolved(), false, `lvl ${w.level}`);
        w.levelUp();
    }
});

test('Weapon: isEvolved becomes true at exactly evolveLevel', () => {
    const w = new Weapon(WEAPONS.WHIP);
    for (let i = 1; i < WEAPONS.WHIP.evolveLevel; i++) w.levelUp();
    assert.equal(w.level, WEAPONS.WHIP.evolveLevel);
    assert.equal(w.isEvolved(), true);
});

test('Weapon: isEvolved stays true past evolveLevel', () => {
    const w = new Weapon(WEAPONS.WHIP);
    for (let i = 1; i < 10; i++) w.levelUp();
    assert.equal(w.isEvolved(), true);
});

test('Weapon: isEvolved false when def has no evolveLevel', () => {
    const w = new Weapon({ id: 'no_evo', baseDamage: 1, baseCooldown: 1, baseRange: 1 });
    assert.equal(w.isEvolved(), false);
    w.level = 100;
    assert.equal(w.isEvolved(), false);
});

test('Weapon: damage scales +20% per level', () => {
    const w = new Weapon(WEAPONS.WHIP);
    const p = makePlayer();
    const lvl1 = w.getDamage(p);
    w.levelUp(); // level 2
    const lvl2 = w.getDamage(p);
    w.levelUp();
    w.levelUp();
    w.levelUp(); // level 5 (evolved)
    const lvl5 = w.getDamage(p);
    assert.ok(Math.abs(lvl2 / lvl1 - 1.2) < 1e-6);
    assert.ok(Math.abs(lvl5 / lvl1 - (1 + 4 * 0.2)) < 1e-6);
});

test('Weapon: damage multiplier from player is respected', () => {
    const w = new Weapon(WEAPONS.WHIP);
    const base = w.getDamage(makePlayer({ dmgMult: 1 }));
    const buffed = w.getDamage(makePlayer({ dmgMult: 2 }));
    assert.equal(buffed, base * 2);
});

test('Weapon: cooldown shrinks by 8% per level', () => {
    const w = new Weapon(WEAPONS.WHIP);
    const p = makePlayer();
    const cd1 = w.getCooldown(p);
    w.levelUp();
    const cd2 = w.getCooldown(p);
    assert.ok(cd2 < cd1);
    assert.ok(Math.abs(cd2 / cd1 - 0.92) < 1e-6);
});

test('Weapon: range grows +10% per level with areaMult', () => {
    const w = new Weapon(WEAPONS.WHIP);
    const r1 = w.getRange(makePlayer());
    w.levelUp();
    const r2 = w.getRange(makePlayer());
    assert.ok(Math.abs(r2 / r1 - 1.1) < 1e-6);
    // AreaMult stacks multiplicatively.
    const rBig = w.getRange(makePlayer({ areaMult: 2 }));
    assert.ok(Math.abs(rBig / r2 - 2) < 1e-6);
});

test('Weapon: crit chance 0 never produces a crit', () => {
    const w = new Weapon(WEAPONS.WHIP);
    const p = makePlayer({ crit: 0 });
    const g = makeGame();
    // Repeat so we'd catch any leakage.
    for (let i = 0; i < 200; i++) {
        const dmg = w._rollCrit(p, g, 100, 0, 0, '#fff');
        assert.equal(dmg, 100);
    }
    for (const t of g.texts) assert.notEqual(t.opts?.crit, true);
});

test('Weapon: crit chance 1 always produces a 2× crit', () => {
    const w = new Weapon(WEAPONS.WHIP);
    const p = makePlayer({ crit: 1 });
    const g = makeGame();
    for (let i = 0; i < 100; i++) {
        const dmg = w._rollCrit(p, g, 50, 0, 0, '#fff');
        assert.equal(dmg, 100);
    }
    for (const t of g.texts) assert.equal(t.opts?.crit, true);
});

test('Weapon: crit chance ~0.5 lands inside 30–70% band over 5000 rolls', () => {
    const w = new Weapon(WEAPONS.WHIP);
    const p = makePlayer({ crit: 0.5 });
    const g = makeGame();
    let crits = 0;
    for (let i = 0; i < 5000; i++) {
        const dmg = w._rollCrit(p, g, 100, 0, 0, '#fff');
        if (dmg === 200) crits++;
    }
    const ratio = crits / 5000;
    assert.ok(ratio > 0.3 && ratio < 0.7, `ratio=${ratio}`);
});

test('Weapon: orbit shard count starts at projectileCount and scales', () => {
    const w = new Weapon(WEAPONS.ORBIT);
    const p = makePlayer();
    assert.equal(w.getOrbitShardCount(p), WEAPONS.ORBIT.projectileCount);
    w.levelUp();
    w.levelUp(); // level 3 → +1 shard
    assert.equal(w.getOrbitShardCount(p), WEAPONS.ORBIT.projectileCount + 1);
});

test('Weapon: orbit shard count doubles after evolve', () => {
    const w = new Weapon(WEAPONS.ORBIT);
    for (let i = 1; i < WEAPONS.ORBIT.evolveLevel; i++) w.levelUp();
    assert.ok(w.isEvolved());
    const p = makePlayer();
    const count = w.getOrbitShardCount(p);
    assert.ok(count >= WEAPONS.ORBIT.projectileCount * 2);
});

test('Weapon: orbit shard count is clamped to 12', () => {
    const w = new Weapon(WEAPONS.ORBIT);
    for (let i = 0; i < 20; i++) w.levelUp();
    const p = makePlayer();
    p.passives = { cooldown: { count: 10, def: { effect: {} } } };
    assert.ok(w.getOrbitShardCount(p) <= 12);
});

test('Weapon: config WEAPON_MAX_LEVEL + evolveLevel agree on 5', () => {
    // Regression: make sure the CONFIG cap and the data.ts evolveLevel don't
    // drift apart — the UI relies on them matching to show the evolve tag.
    assert.equal(CONFIG.WEAPON_MAX_LEVEL, 5);
    for (const w of Object.values(WEAPONS)) {
        if (w.evolveLevel) assert.equal(w.evolveLevel, 5, `weapon ${w.id}`);
    }
});

test('Weapon: nova fire applies damage + slow to nearby enemies', () => {
    const w = new Weapon(WEAPONS.FROST_NOVA);
    const p = makePlayer();
    const enemy = makeEnemyStub({
        x: 50,
        y: 0,
        hp: 100,
        takeDamage(d) {
            this.hp -= d;
        },
        slowTimer: 0,
        slowPct: 0
    });
    const farEnemy = makeEnemyStub({
        x: 9999,
        y: 0,
        hp: 100,
        takeDamage(d) {
            this.hp -= d;
        },
        slowTimer: 0,
        slowPct: 0
    });
    const g = makeGame();
    g.enemies = [enemy, farEnemy];
    g.player = p;
    g.createParticles = () => {};
    // Manually invoke via the dispatcher.
    w.fire(p, g);
    assert.ok(enemy.hp < 100, 'nearby enemy should be hit');
    assert.ok(enemy.slowTimer > 0, 'nearby enemy should be slowed');
    assert.equal(farEnemy.hp, 100, 'distant enemy should be untouched');
});

test('Weapon: drain heals the player via lifesteal', () => {
    const w = new Weapon(WEAPONS.SOUL_DRAIN);
    let healed = 0;
    const p = makePlayerStub({
        ...makePlayer(),
        heal(n) {
            healed += n;
        }
    });
    const enemy = makeEnemyStub({
        x: 10,
        y: 0,
        hp: 200,
        takeDamage(d) {
            this.hp -= d;
        }
    });
    const g = makeGame();
    g.enemies = [enemy];
    g.player = p;
    w.fire(p, g);
    assert.ok(enemy.hp < 200, 'enemy took damage');
    assert.ok(healed > 0, 'player should have been healed by lifesteal');
});

test('Weapon: drain does nothing when no enemies in range', () => {
    const w = new Weapon(WEAPONS.SOUL_DRAIN);
    const p = makePlayerStub({
        ...makePlayer(),
        heal() {
            throw new Error('should not heal without a target');
        }
    });
    const g = makeGame();
    g.enemies = [makeEnemyStub({ x: 99999, y: 0, hp: 100, takeDamage() {} })];
    g.player = p;
    assert.doesNotThrow(() => w.fire(p, g));
});

test('Weapon: boomerang projectile def has type=projectile + boomerang flag', () => {
    assert.equal(WEAPONS.BOOMERANG.type, 'projectile');
    assert.equal(WEAPONS.BOOMERANG.boomerang, true);
});

test('Weapon: getDamage returns 0 when baseDamage is 0', () => {
    const w = new Weapon({
        id: 'null',
        baseDamage: 0,
        baseCooldown: 1,
        baseRange: 100,
        type: 'projectile'
    });
    assert.equal(w.getDamage(makePlayer()), 0);
});

test('Weapon: getCooldown is strictly positive even at very high level', () => {
    const w = new Weapon(WEAPONS.WHIP);
    for (let i = 0; i < 50; i++) w.levelUp();
    assert.ok(w.getCooldown(makePlayer()) > 0);
});

test('Weapon: range with areaMult=0 still returns a finite number', () => {
    const w = new Weapon(WEAPONS.WHIP);
    const r = w.getRange(makePlayer({ areaMult: 0 }));
    assert.equal(r, 0);
});

test('Weapon: orbit shard damage scales with player damageMult', () => {
    const w = new Weapon(WEAPONS.ORBIT);
    const low = w.getDamage(makePlayer({ dmgMult: 1 }));
    const high = w.getDamage(makePlayer({ dmgMult: 3 }));
    assert.ok(Math.abs(high / low - 3) < 1e-6);
});
