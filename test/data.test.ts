// Unit tests for the static catalogue in src/data.ts. These guard the
// shape of the data layer so cross-module assumptions don't drift.

import test from 'node:test';
import assert from 'node:assert/strict';
import { ACHIEVEMENTS, BOSSES, ENEMIES, UNLOCKS, WAVES, WEAPONS, PASSIVES } from '../src/data.ts';

test('data: every weapon has the required fields', () => {
    for (const w of Object.values(WEAPONS)) {
        assert.equal(typeof w.id, 'string');
        assert.equal(typeof w.name, 'string');
        assert.equal(typeof w.icon, 'string');
        assert.equal(typeof w.baseDamage, 'number');
        assert.equal(typeof w.baseCooldown, 'number');
        assert.equal(typeof w.baseRange, 'number');
        assert.equal(typeof w.type, 'string');
    }
});

test('data: weapon type is one of the known dispatch tags', () => {
    const known = new Set([
        'melee',
        'projectile',
        'instant',
        'aura',
        'mine',
        'orbit',
        'nova',
        'drain'
    ]);
    for (const w of Object.values(WEAPONS)) {
        assert.ok(known.has(w.type), `${w.id} has unknown type ${w.type}`);
    }
});

test('data: every passive has an effect object', () => {
    for (const p of Object.values(PASSIVES)) {
        assert.equal(typeof p.id, 'string');
        assert.equal(typeof p.effect, 'object');
        assert.ok(p.effect && Object.keys(p.effect).length > 0);
    }
});

test('data: v2.4 weapons are registered', () => {
    const ids = new Set(Object.values(WEAPONS).map((w) => w.id));
    assert.ok(ids.has('frost_nova'));
    assert.ok(ids.has('soul_drain'));
    assert.ok(ids.has('boomerang'));
});

test('data: v2.4 enemies are registered', () => {
    const ids = new Set(Object.values(ENEMIES).map((e) => e.id));
    assert.ok(ids.has('bomber'));
    assert.ok(ids.has('illusionist'));
});

test('data: v2.4 bosses are on a strictly increasing timeline', () => {
    const spawns = Object.values(BOSSES)
        .map((b) => b.spawnAt)
        .sort((a, b) => a - b);
    // Assert there are no duplicates and they are strictly ascending.
    for (let i = 1; i < spawns.length; i++) {
        assert.ok(spawns[i] > spawns[i - 1], `duplicate spawn ${spawns[i]}`);
    }
    // Reaper 300, Necromancer 450, Void Lord 600, IceQueen 660 (iter-14
    // tundra-only), Chrono Lich 720.
    assert.deepEqual(spawns, [300, 450, 600, 660, 720]);
});

test('data: every boss has hp/damage/exp/size/color and boss flag', () => {
    for (const b of Object.values(BOSSES)) {
        assert.equal(b.boss, true);
        assert.ok(b.hp > 0);
        assert.ok(b.damage > 0);
        assert.ok(b.exp > 0);
        assert.ok(b.size > 0);
        assert.equal(typeof b.color, 'string');
    }
});

test('data: waves cover 0..infinity with no gaps', () => {
    let cursor = 0;
    for (const w of WAVES) {
        assert.equal(w.from, cursor, `gap before wave ${w.label}`);
        cursor = w.to;
    }
    assert.equal(cursor, Infinity);
});

test('data: every wave pool references a real enemy id', () => {
    const ids = new Set(Object.values(ENEMIES).map((e) => e.id));
    for (const w of WAVES) {
        for (const pick of w.pool) {
            assert.ok(ids.has(pick), `wave "${w.label}" references unknown enemy ${pick}`);
        }
    }
});

test('data: ACHIEVEMENTS has unique ids and v2.4 new ones exist', () => {
    const ids = ACHIEVEMENTS.map((a) => a.id);
    assert.equal(new Set(ids).size, ids.length);
    for (const req of [
        'speed_demon',
        'no_hit_boss',
        'max_all',
        'early_evolve',
        'triple_build',
        'zen_5min'
    ]) {
        assert.ok(ids.includes(req), `missing achievement ${req}`);
    }
    // Total should hit 18 with the v2.4 additions (12 from v2.3 + 6 new).
    assert.ok(ACHIEVEMENTS.length >= 18);
});

test('data: every UNLOCKS weapon id exists in WEAPONS', () => {
    const weaponIds = new Set(Object.values(WEAPONS).map((w) => w.id));
    for (const [ach, unlock] of Object.entries(UNLOCKS)) {
        // iter-20: cosmetic-only unlocks (no `weapon` field) are intentional
        // and skipped by this regression — see UNLOCKS for sprite_trail etc.
        if (!unlock.weapon) continue;
        assert.ok(weaponIds.has(unlock.weapon), `unlock for ${ach} → ${unlock.weapon} missing`);
    }
});

test('data: SLIME.splitInto points to a real enemy', () => {
    const ids = new Set(Object.values(ENEMIES).map((e) => e.id));
    assert.ok(ids.has(ENEMIES.SLIME.splitInto));
});

test('data: Bomber has defensive defaults', () => {
    const b = ENEMIES.BOMBER;
    assert.ok(b.fuseTime > 0);
    assert.ok(b.blastRadius > 0);
    assert.ok(b.blastDamage > 0);
});

test('data: Illusionist clone params are reasonable', () => {
    const i = ENEMIES.ILLUSIONIST;
    assert.ok(i.cloneCount >= 1);
    assert.ok(i.cloneCooldown >= 1);
});

test('data: evolution names are present on every weapon that declares evolveLevel', () => {
    for (const w of Object.values(WEAPONS)) {
        if (w.evolveLevel) {
            assert.equal(w.evolveLevel, 5);
            assert.equal(typeof w.evolveName, 'string');
            assert.ok(w.evolveName.length > 0, `${w.id} missing evolveName`);
        }
    }
});
