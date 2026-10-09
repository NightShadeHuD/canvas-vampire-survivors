// iter-20 tests — easter-egg achievements, emoji-rain effect, tundra speed
// regression and the unlock pipeline for the Retro Blaster weapon.
//
// Pure-Node where possible: the Konami detector and the achievement catalogue
// are dependency-free, and EmojiRain's render path takes a canvas-2d-like ctx
// stub so we can exercise the math without a real <canvas>.

import test from 'node:test';
import assert from 'node:assert/strict';

import { AchievementTracker } from '../src/achievements.ts';
import { ACHIEVEMENTS, UNLOCKS, WEAPONS } from '../src/data.js';
import { EffectLayer, EmojiRain } from '../src/effects.ts';
import { KONAMI_SEQUENCE, KonamiDetector, normaliseKonamiKey } from '../src/konami.ts';
import { getStageModifiers } from '../src/stages.js';

// ---------------------------------------------------------------------------
// Konami detector — sequence matching, reset behaviour, idempotent unlock.
// ---------------------------------------------------------------------------
test('iter20 konami: full sequence fires the unlock callback exactly once', () => {
    let fired = 0;
    const det = new KonamiDetector(() => fired++);
    // Walk the canonical sequence (mixed case to prove normalisation works).
    const keys = [
        'ArrowUp',
        'ArrowUp',
        'ArrowDown',
        'ArrowDown',
        'ArrowLeft',
        'ArrowRight',
        'ArrowLeft',
        'ArrowRight',
        'B',
        'A'
    ];
    for (const k of keys) det.push(k);
    assert.equal(fired, 1, 'callback fires on the matching push');
    // Repeating the sequence is a no-op — the unlock is one-shot per detector.
    for (const k of keys) det.push(k);
    assert.equal(fired, 1, 'idempotent: never refires');
    assert.equal(det.hasFired(), true);
});

test('iter20 konami: KONAMI_SEQUENCE is the canonical 10-step pattern', () => {
    assert.equal(KONAMI_SEQUENCE.length, 10);
    assert.equal(KONAMI_SEQUENCE[0], 'arrowup');
    assert.equal(KONAMI_SEQUENCE[KONAMI_SEQUENCE.length - 2], 'b');
    assert.equal(KONAMI_SEQUENCE[KONAMI_SEQUENCE.length - 1], 'a');
});

test('iter20 konami: a wrong key resets progress', () => {
    let fired = 0;
    const det = new KonamiDetector(() => fired++);
    det.push('ArrowUp');
    det.push('ArrowUp');
    det.push('Escape'); // breaks the chain
    // Now finishing the rest of the sequence should NOT fire.
    for (const k of [
        'ArrowDown',
        'ArrowDown',
        'ArrowLeft',
        'ArrowRight',
        'ArrowLeft',
        'ArrowRight',
        'B',
        'A'
    ])
        det.push(k);
    assert.equal(fired, 0);
});

test('iter20 konami: a stray ArrowUp keeps step-1 progress', () => {
    // If the user spams ArrowUp, the detector should still recognise the
    // most recent press as a fresh step-0 match rather than zeroing out.
    const det = new KonamiDetector(() => {});
    det.push('ArrowDown'); // wrong (expected ArrowUp)
    assert.equal(det._idx, 0);
    det.push('ArrowUp'); // step 0 match
    assert.equal(det._idx, 1);
    det.push('ArrowLeft'); // wrong, but ArrowLeft != ArrowUp so resets to 0
    assert.equal(det._idx, 0);
});

test('iter20 konami: normaliseKonamiKey lowercases + rejects garbage', () => {
    assert.equal(normaliseKonamiKey('ArrowUp'), 'arrowup');
    assert.equal(normaliseKonamiKey('B'), 'b');
    assert.equal(normaliseKonamiKey(null), '');
    assert.equal(normaliseKonamiKey(undefined), '');
    assert.equal(normaliseKonamiKey(0), '');
});

test('iter20 konami: callback that throws does not propagate', () => {
    const det = new KonamiDetector(() => {
        throw new Error('boom');
    });
    const keys = [
        'ArrowUp',
        'ArrowUp',
        'ArrowDown',
        'ArrowDown',
        'ArrowLeft',
        'ArrowRight',
        'ArrowLeft',
        'ArrowRight',
        'B',
        'A'
    ];
    assert.doesNotThrow(() => {
        for (const k of keys) det.push(k);
    });
    assert.equal(det.hasFired(), true);
});

// ---------------------------------------------------------------------------
// Achievements — three new hidden unlocks land in the catalogue + UNLOCKS.
// ---------------------------------------------------------------------------
test('iter20 achievements: hidden trio is registered with the hidden flag', () => {
    const ids = new Set(ACHIEVEMENTS.map((a) => a.id));
    for (const id of ['konami_code', 'speedrun_plus', 'pacifist_provoked']) {
        assert.ok(ids.has(id), `${id} missing from ACHIEVEMENTS`);
        const def = ACHIEVEMENTS.find((a) => a.id === id);
        assert.equal(def.hidden, true, `${id} should be hidden until earned`);
    }
});

test('iter20 achievements: konami_code unlocks via run.konamiCode flag', () => {
    const save = { achievements: {} };
    const t = new AchievementTracker(save);
    t.check({ kills: 0, gameTime: 0, player: { level: 1 } });
    assert.ok(!save.achievements.konami_code);
    t.run.konamiCode = true;
    t.check({ kills: 0, gameTime: 0, player: { level: 1 } });
    assert.ok(save.achievements.konami_code);
});

test('iter20 achievements: speedrun_plus reads run.fastBossClear', () => {
    const save = { achievements: {} };
    const t = new AchievementTracker(save);
    t.check({ kills: 0, gameTime: 0, player: { level: 1 } });
    assert.ok(!save.achievements.speedrun_plus);
    t.run.fastBossClear = true;
    t.check({ kills: 0, gameTime: 0, player: { level: 1 } });
    assert.ok(save.achievements.speedrun_plus);
});

test('iter20 achievements: pacifist_provoked needs 60s AND zero kills', () => {
    const save = { achievements: {} };
    const t = new AchievementTracker(save);
    t.run.pacifistTimer = 60;
    // A single kill forfeits the achievement — the check guards on game.kills.
    t.check({ kills: 1, gameTime: 60, player: { level: 1 } });
    assert.ok(!save.achievements.pacifist_provoked);
    // Zero kills + the timer crossed 60 → unlock.
    t.check({ kills: 0, gameTime: 60, player: { level: 1 } });
    assert.ok(save.achievements.pacifist_provoked);
});

test('iter20 achievements: pacifist_provoked stays locked at 59s', () => {
    const save = { achievements: {} };
    const t = new AchievementTracker(save);
    t.run.pacifistTimer = 59.99;
    t.check({ kills: 0, gameTime: 60, player: { level: 1 } });
    assert.ok(!save.achievements.pacifist_provoked);
});

test('iter20 unlocks: konami_code → retro_blaster, cosmetics surface separately', () => {
    assert.equal(UNLOCKS.konami_code.weapon, 'retro_blaster');
    assert.equal(UNLOCKS.speedrun_plus.cosmetic, 'sprite_trail');
    assert.equal(UNLOCKS.pacifist_provoked.cosmetic, 'boss_title_pacifist');
    // Sanity: every cosmetic UNLOCKS row points at a real achievement id.
    const ids = new Set(ACHIEVEMENTS.map((a) => a.id));
    for (const k of Object.keys(UNLOCKS)) assert.ok(ids.has(k), `UNLOCKS.${k} orphaned`);
});

test('iter20 unlocks: AchievementTracker.unlockedCosmetics filters weapon entries', () => {
    const save = { achievements: { speedrun_plus: 1, konami_code: 1 } };
    const t = new AchievementTracker(save);
    const cos = t.unlockedCosmetics();
    assert.ok(cos.has('sprite_trail'));
    // Konami's weapon unlock does NOT leak into the cosmetic set.
    assert.ok(!cos.has('retro_blaster'));
    // And the legacy weapon helper still resolves the Konami starter.
    const wpns = t.unlockedStartingWeapons();
    assert.ok(wpns.has('retro_blaster'));
});

test('iter20 weapons: RETRO_BLASTER is registered in WEAPONS catalogue', () => {
    assert.ok(WEAPONS.RETRO_BLASTER, 'RETRO_BLASTER missing from WEAPONS');
    assert.equal(WEAPONS.RETRO_BLASTER.id, 'retro_blaster');
    assert.equal(WEAPONS.RETRO_BLASTER.evolveLevel, 5);
    assert.ok(WEAPONS.RETRO_BLASTER.baseDamage > 0);
});

test('iter20 achievements: resetRun zeroes konami + pacifist + fastBossClear', () => {
    const save = { achievements: {} };
    const t = new AchievementTracker(save);
    t.run.konamiCode = true;
    t.run.fastBossClear = true;
    t.run.pacifistTimer = 42;
    t.resetRun();
    assert.equal(t.run.konamiCode, false);
    assert.equal(t.run.fastBossClear, false);
    assert.equal(t.run.pacifistTimer, 0);
});

// ---------------------------------------------------------------------------
// Emoji rain — burst cap, gravity, render with stub ctx, capped life.
// ---------------------------------------------------------------------------
test('iter20 emoji rain: burst respects the max cap', () => {
    const r = new EmojiRain();
    r.burst(800, 600, 1000); // request way more than the cap
    assert.ok(r.drops.length <= r.max, 'never exceeds the per-instance cap');
    assert.ok(r.drops.length > 0, 'still spawns at least one drop');
});

test('iter20 emoji rain: drops fall and recycle when below the canvas', () => {
    const r = new EmojiRain();
    r.burst(800, 600, 6);
    const before = r.drops.length;
    // Force every drop way below the visible area in one big tick.
    for (const d of r.drops) d.y = 1000;
    r.update(0.016, 600);
    assert.ok(r.drops.length < before, 'recycled at least some drops past the bottom');
});

test('iter20 emoji rain: update without a height arg is still safe', () => {
    const r = new EmojiRain();
    r.burst(800, 600, 4);
    assert.doesNotThrow(() => r.update(0.016));
});

test('iter20 emoji rain: render is a no-op with no drops + null ctx', () => {
    const r = new EmojiRain();
    assert.doesNotThrow(() => r.render(null));
    assert.equal(r.isActive(), false);
});

test('iter20 emoji rain: render walks every drop through the stub ctx', () => {
    const r = new EmojiRain();
    r.burst(800, 600, 5);
    let fillCalls = 0;
    const ctx = {
        save: () => {},
        restore: () => {},
        translate: () => {},
        rotate: () => {},
        fillText: () => fillCalls++,
        set font(_v) {},
        set textAlign(_v) {},
        set textBaseline(_v) {}
    };
    r.render(ctx);
    assert.equal(fillCalls, r.drops.length);
});

test('iter20 EffectLayer.celebrate: triggers rain + a light flash', () => {
    const fx = new EffectLayer();
    assert.equal(fx.emojiRain.isActive(), false);
    fx.celebrate(1200, 800);
    assert.equal(fx.emojiRain.isActive(), true);
    assert.ok(fx.flash.alpha > 0, 'celebrate also fires a soft flash');
});

test('iter20 EffectLayer.update: still works without the viewport arg', () => {
    const fx = new EffectLayer();
    fx.celebrate(1200, 800);
    // Backwards-compat: existing callers passed only `dt`.
    assert.doesNotThrow(() => fx.update(0.016));
});

// ---------------------------------------------------------------------------
// Tundra regression — playerSpeedMult must stay at 0.9 (-10%).
// ---------------------------------------------------------------------------
test('iter20 stages: tundra still applies a -10% player speed modifier', () => {
    const mods = getStageModifiers('tundra');
    assert.equal(mods.playerSpeedMult, 0.9, 'tundra is supposed to ice-skate at 0.9x');
    assert.equal(mods.coldTickInterval, 10);
    assert.equal(mods.coldTickDamage, 1);
});

test('iter20 stages: forest defaults are still untouched', () => {
    const mods = getStageModifiers('forest');
    assert.equal(mods.playerSpeedMult, 1);
    assert.equal(mods.enemyHpMult, 1);
    assert.equal(mods.coldTickInterval, 0);
});
