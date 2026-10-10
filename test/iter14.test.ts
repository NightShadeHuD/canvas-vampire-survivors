// Unit tests for iter-14 — tundra stage, gamepad input layer, new passives,
// evolution micro-tweaks, and the touch-button-scale persistence helper.
// Runs entirely in Node; the gamepad poller is exercised with an injected
// fake `getGamepads` accessor so the tests don't depend on a browser API.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
    DEFAULT_STAGE_ID,
    STAGES,
    getBackgroundFor,
    getBossesFor,
    getStage,
    getStageModifiers,
    listStages
} from '../src/stages.ts';
import { dailyChallenge, dailySeed } from '../src/daily.ts';
import { GAMEPAD_BUTTON, InputManager, applyGamepadDeadzone } from '../src/input.ts';
import { _resetStorageForTests, getTouchButtonScale, loadSave, resetSave } from '../src/storage.ts';
import { BOSSES, PASSIVES, WEAPONS } from '../src/data.ts';
import { Player } from '../src/entities.ts';
import { Weapon } from '../src/weapons.ts';
import { makeGameStub } from './helpers/game-stub.ts';

// ---------------------------------------------------------------------------
// Tundra stage
// ---------------------------------------------------------------------------
test('iter14 stages: tundra is registered and exposed by listStages', () => {
    const ids = listStages().map((s) => s.id);
    assert.deepEqual(ids, ['forest', 'crypt', 'tundra']);
    assert.ok(STAGES.TUNDRA, 'TUNDRA bucket must exist on STAGES');
    assert.equal(STAGES.TUNDRA.id, 'tundra');
});

test('iter14 stages: tundra background uses cool palette #2a3a4f', () => {
    const bg = getBackgroundFor('tundra');
    assert.equal(bg.fill.toLowerCase(), '#2a3a4f');
    assert.ok(bg.gridAlpha > 0 && bg.gridAlpha < 0.2);
});

test('iter14 stages: tundra modifiers carry the spec values', () => {
    const m = getStageModifiers('tundra');
    assert.equal(m.playerSpeedMult, 0.9, 'player should move 10% slower');
    assert.equal(m.enemyHpMult, 1.2, 'enemies should have 20% more HP');
    assert.equal(m.coldTickInterval, 10, 'cold tick fires every 10 s');
    assert.equal(m.coldTickDamage, 1, 'cold tick drains 1 HP');
    assert.equal(m.warmthSourceEnabled, false, 'warmth pickup disabled this iter');
});

test('iter14 stages: forest + crypt expose neutral modifiers', () => {
    const f = getStageModifiers('forest');
    const c = getStageModifiers('crypt');
    for (const m of [f, c]) {
        assert.equal(m.playerSpeedMult, 1);
        assert.equal(m.enemyHpMult, 1);
        assert.equal(m.coldTickInterval, 0);
    }
});

test('iter14 stages: tundra boss schedule swaps VoidLord → IceQueen at 10:00', () => {
    const bosses = getBossesFor('tundra');
    const iceQ = bosses.find((b) => b.id === 'ice_queen');
    const voidL = bosses.find((b) => b.id === 'void_lord');
    assert.ok(iceQ, 'IceQueen should appear on tundra');
    assert.equal(iceQ.spawnAt, BOSSES.VOID_LORD.spawnAt, 'IceQueen takes the 10:00 slot');
    assert.equal(voidL, undefined, 'tundra should not also spawn VoidLord');
});

test('iter14 stages: forest boss schedule still has VoidLord, no IceQueen', () => {
    const bosses = getBossesFor('forest');
    assert.ok(bosses.some((b) => b.id === 'void_lord'));
    assert.equal(
        bosses.find((b) => b.id === 'ice_queen'),
        undefined
    );
});

test('iter14 stages: getStageModifiers defaults for unknown id', () => {
    const m = getStageModifiers('does-not-exist');
    assert.equal(m.playerSpeedMult, 1);
    assert.equal(m.enemyHpMult, 1);
});

test('iter14 stages: tundra stage id constant + default unchanged', () => {
    assert.equal(getStage('tundra').id, 'tundra');
    assert.equal(DEFAULT_STAGE_ID, 'forest');
});

// ---------------------------------------------------------------------------
// Daily challenge rotation now includes tundra
// ---------------------------------------------------------------------------
test('iter14 daily: rotation includes tundra across a few seeds', () => {
    const seen = new Set();
    for (const date of ['2026-04-25', '2026-04-26', '2026-04-27', '2026-04-28', '2026-04-29']) {
        const c = dailyChallenge(date);
        assert.ok(['forest', 'crypt', 'tundra'].includes(c.stage), `bad stage for ${date}`);
        seen.add(c.stage);
        assert.equal(typeof dailySeed(date), 'number');
    }
    // Across 5 distinct seeds we expect at least 2 different stages — the
    // exact distribution is incidental, but the rotation must do *something*.
    assert.ok(seen.size >= 2, 'daily rotation should spread across multiple stages');
});

// ---------------------------------------------------------------------------
// Gamepad input layer (mocked — never touches the real navigator API)
// ---------------------------------------------------------------------------
// A deliberately partial Gamepad: enough for `pollGamepad`, which reads only
// axes and buttons. The cast is at the boundary, not spread through call sites.
function makePad({ axes = [0, 0, 0, 0], buttons = [] } = {}) {
    const pad = {
        axes,
        buttons: buttons.map((b) => ({ pressed: !!b }))
    };
    // A 4-slot pad list with the empty slots the API expects.
    return [pad, null, null, null] as unknown as Gamepad[];
}

test('iter14 gamepad: applyGamepadDeadzone clips small magnitudes to 0', () => {
    assert.equal(applyGamepadDeadzone(0), 0);
    assert.equal(applyGamepadDeadzone(0.05), 0);
    assert.equal(applyGamepadDeadzone(-0.1), 0);
    // Outside the deadzone band the response is monotonic in the input.
    assert.ok(Math.abs(applyGamepadDeadzone(0.9)) > Math.abs(applyGamepadDeadzone(0.5)));
    // Full press maps to ±1.
    assert.ok(Math.abs(applyGamepadDeadzone(1) - 1) < 1e-9);
    assert.ok(Math.abs(applyGamepadDeadzone(-1) + 1) < 1e-9);
});

test('iter14 gamepad: left stick drives the move vector when keyboard is idle', () => {
    const im = new InputManager();
    const pads = makePad({ axes: [0.8, -0.6, 0, 0] });
    im.pollGamepad(() => pads);
    const v = im.getMoveVector();
    // Magnitude never exceeds 1 after the diagonal renormalise.
    assert.ok(Math.hypot(v.x, v.y) <= 1.0001);
    // Direction preserved (positive x, negative y).
    assert.ok(v.x > 0);
    assert.ok(v.y < 0);
});

test('iter14 gamepad: right stick populates aimVec', () => {
    const im = new InputManager();
    const pads = makePad({ axes: [0, 0, -0.7, 0.4] });
    im.pollGamepad(() => pads);
    assert.ok(im.aimVec.x < 0);
    assert.ok(im.aimVec.y > 0);
});

test('iter14 gamepad: A button fires onGamepadConfirm exactly once per press', () => {
    const im = new InputManager();
    let count = 0;
    im.onGamepadConfirm = () => count++;
    // Press
    im.pollGamepad(() =>
        makePad({ buttons: [true, false, false, false, false, false, false, false, false, false] })
    );
    // Hold (no new edge)
    im.pollGamepad(() =>
        makePad({ buttons: [true, false, false, false, false, false, false, false, false, false] })
    );
    // Release
    im.pollGamepad(() =>
        makePad({ buttons: [false, false, false, false, false, false, false, false, false, false] })
    );
    // Press again
    im.pollGamepad(() =>
        makePad({ buttons: [true, false, false, false, false, false, false, false, false, false] })
    );
    assert.equal(count, 2, 'A should edge-trigger twice across two distinct presses');
});

test('iter14 gamepad: Start fires onTogglePause via the standard button index', () => {
    const im = new InputManager();
    let toggled = 0;
    im.onTogglePause = () => toggled++;
    const buttons = new Array(10).fill(false);
    buttons[GAMEPAD_BUTTON.START] = true;
    im.pollGamepad(() => makePad({ buttons }));
    assert.equal(toggled, 1);
});

test('iter14 gamepad: LB / RB cycle menu options', () => {
    const im = new InputManager();
    let next = 0,
        prev = 0;
    im.onGamepadCycleNext = () => next++;
    im.onGamepadCyclePrev = () => prev++;
    const rb = new Array(10).fill(false);
    rb[GAMEPAD_BUTTON.RB] = true;
    im.pollGamepad(() => makePad({ buttons: rb }));
    const lb = new Array(10).fill(false);
    lb[GAMEPAD_BUTTON.LB] = true;
    // Release RB first by polling a clear frame so RB edge resets.
    im.pollGamepad(() => makePad({ buttons: new Array(10).fill(false) }));
    im.pollGamepad(() => makePad({ buttons: lb }));
    assert.equal(next, 1);
    assert.equal(prev, 1);
});

test('iter14 gamepad: missing API → pollGamepad is a safe no-op', () => {
    const im = new InputManager();
    // Should not throw, and should leave vectors at zero.
    im.pollGamepad(() => null);
    assert.equal(im.gamepadVec.x, 0);
    assert.equal(im.gamepadVec.y, 0);
    assert.equal(im.aimVec.x, 0);
});

// ---------------------------------------------------------------------------
// New passives — registry shape + Player consumption
// ---------------------------------------------------------------------------
test('iter14 passives: Dodge, Magnet+, Damage Reduction are registered', () => {
    const ids = Object.values(PASSIVES).map((p) => p.id);
    for (const id of ['dodge', 'magnet_plus', 'damage_reduction']) {
        assert.ok(ids.includes(id), `${id} should be in PASSIVES`);
    }
});

test('iter14 passives: Player.getDamageReduction sums and caps at 0.6', () => {
    const p = new Player(0, 0);
    p.passives['damage_reduction'] = { def: PASSIVES.DAMAGE_REDUCTION, count: 3 };
    // 3 stacks × 0.08 = 0.24 (under cap).
    assert.ok(Math.abs(p.getDamageReduction() - 0.24) < 1e-9);
    p.passives['damage_reduction'].count = 50; // pretend stack
    assert.equal(p.getDamageReduction(), 0.6);
});

test('iter14 passives: Player.getDodgeChance sums and caps at 0.6', () => {
    const p = new Player(0, 0);
    p.passives['dodge'] = { def: PASSIVES.DODGE, count: 4 };
    assert.ok(Math.abs(p.getDodgeChance() - 0.2) < 1e-9);
    p.passives['dodge'].count = 100;
    assert.equal(p.getDodgeChance(), 0.6);
});

test('iter14 passives: Bulwark scales taken damage in takeDamage', () => {
    const p = new Player(0, 0);
    p.maxHp = 100;
    p.hp = 100;
    // 2 stacks × 0.08 = 0.16 reduction → 100 raw becomes 100 × 0.84 = 84.
    p.passives['damage_reduction'] = { def: PASSIVES.DAMAGE_REDUCTION, count: 2 };
    p.takeDamage(100, makeGameStub({ run: {} }));
    // Allow a 1 HP rounding fuzz from the Math.max(1, …) clamp.
    assert.ok(Math.abs(p.hp - 16) <= 1, `expected ~16 HP remaining, got ${p.hp}`);
});

test('iter14 passives: dodge prevents damage entirely when it triggers', () => {
    // Force the random to always dodge by stubbing Math.random.
    const p = new Player(0, 0);
    p.passives['dodge'] = { def: PASSIVES.DODGE, count: 12 }; // capped to 0.6
    const orig = Math.random;
    Math.random = () => 0; // always under the chance threshold
    try {
        p.takeDamage(50, makeGameStub({ run: {} }));
    } finally {
        Math.random = orig;
    }
    assert.equal(p.hp, p.maxHp, 'dodge must fully negate the hit');
});

// ---------------------------------------------------------------------------
// Evolution micro-tweaks
// ---------------------------------------------------------------------------
test('iter14 weapons: evolved Twin Arc cooldown shorter than the base curve', () => {
    const w = new Weapon(WEAPONS.BOOMERANG);
    const fakePlayer = {
        getDamageMult: () => 1,
        getCooldownMult: () => 1,
        getAreaMult: () => 1,
        getCritChance: () => 0,
        passives: {}
    };
    w.level = 4;
    const before = w.getCooldown(fakePlayer);
    w.level = 5; // crosses evolution threshold
    const after = w.getCooldown(fakePlayer);
    assert.ok(after < before, 'evolved boomerang must fire faster than its lvl-4 cooldown');
});

test('iter14 weapons: evolved Orbiter damage multiplied by evolveDamageMult', () => {
    const w = new Weapon(WEAPONS.ORBIT);
    const fakePlayer = { getDamageMult: () => 1, passives: {} };
    w.level = 4;
    const before = w.getDamage(fakePlayer);
    w.level = 5;
    const after = w.getDamage(fakePlayer);
    // Expected ratio: lvl-5 raw × 1.1, vs lvl-4 raw with no evolve bonus.
    // raw5 = base*(1+4*0.2) = base*1.8 ; raw4 = base*1.6
    // ratio = 1.8*1.1 / 1.6 = 1.2375
    assert.ok(after / before > 1.2);
});

test('iter14 weapons: evolution flags exist on the four tweaked weapons', () => {
    assert.equal(WEAPONS.KNIFE.evolveBonusCrit, 0.1);
    assert.equal(WEAPONS.LIGHTNING.evolveBonusCrit, 0.15);
    assert.equal(WEAPONS.ORBIT.evolveDamageMult, 1.1);
    assert.equal(WEAPONS.BOOMERANG.evolveCooldownMult, 0.95);
});

// ---------------------------------------------------------------------------
// Touch button scale storage helper
// ---------------------------------------------------------------------------
test('iter14 storage: touchButtonScale defaults to 1 on a fresh save', () => {
    _resetStorageForTests();
    resetSave();
    const save = loadSave();
    assert.equal(save.settings.touchButtonScale, 1);
    assert.equal(getTouchButtonScale(save), 1);
});

test('iter14 storage: getTouchButtonScale clamps to [0.8, 1.4]', () => {
    assert.equal(getTouchButtonScale({ settings: { touchButtonScale: 5 } }), 1.4);
    assert.equal(getTouchButtonScale({ settings: { touchButtonScale: 0.1 } }), 0.8);
    assert.equal(getTouchButtonScale({ settings: {} }), 1);
    assert.equal(getTouchButtonScale(null), 1);
});

test('iter14 storage: pwaPromptSeen defaults to false', () => {
    _resetStorageForTests();
    resetSave();
    const save = loadSave();
    assert.equal(save.flags.pwaPromptSeen, false);
});

// ---------------------------------------------------------------------------
// IceQueen boss visual flag
// ---------------------------------------------------------------------------
test('iter14 boss: IceQueen carries the iceQueen visual flag', () => {
    assert.ok(BOSSES.ICE_QUEEN);
    assert.equal(BOSSES.ICE_QUEEN.iceQueen, true);
    assert.equal(BOSSES.ICE_QUEEN.id, 'ice_queen');
});
