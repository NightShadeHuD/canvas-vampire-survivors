// Unit tests for src/stages.js + src/daily.ts (iter-12). Runs in Node, no DOM.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
    DEFAULT_STAGE_ID,
    STAGES,
    getBackgroundFor,
    getBossesFor,
    getStage,
    getWavesFor,
    listStages,
    pickWeighted
} from '../src/stages.js';
import {
    _resetDailyForTests,
    buildShareText,
    cyrb53,
    dailyChallenge,
    dailySeed,
    loadDailyHistory,
    saveDailyResult,
    todayKey
} from '../src/daily.ts';
import { BOSSES } from '../src/data.js';
import {
    _resetStorageForTests,
    getStageHighScores,
    loadSave,
    recordHighScore,
    resetSave
} from '../src/storage.js';

// A fixed instant used as "now" wherever a test both writes and reads daily
// history. `saveDailyResult` prunes anything older than 14 days relative to
// `now`, so storing a hardcoded date without pinning the clock is a time bomb:
// it passes until the literal ages out of the window, then deletes its own
// entry mid-write. Always pass this explicitly; never read the wall clock.
// Noon, not midnight, so subtracting whole days can never straddle a date
// boundary and make the assertions below depend on the time of day.
const PINNED_NOW = new Date(Date.UTC(2026, 3, 25, 12, 0));

/** A minimal valid daily entry; override any field per test. */
function dailyEntry(date, overrides = {}) {
    return {
        date,
        stage: 'forest',
        timeSurvived: 123,
        kills: 45,
        level: 7,
        weapons: ['whip'],
        won: false,
        noHit: false,
        seed: 1,
        ...overrides
    };
}

/** 'YYYY-MM-DD' for `days` before PINNED_NOW (UTC). */
function daysBeforePinned(days) {
    return todayKey(new Date(PINNED_NOW.getTime() - days * 86400 * 1000));
}

// ---------------------------------------------------------------------------
// stages.js
// ---------------------------------------------------------------------------
test('stages: forest is the default and exposes balanced background', () => {
    assert.equal(DEFAULT_STAGE_ID, 'forest');
    const f = getStage('forest');
    assert.equal(f.id, 'forest');
    const bg = getBackgroundFor('forest');
    assert.ok(bg.fill.startsWith('#'));
    assert.ok(bg.gridAlpha >= 0 && bg.gridAlpha <= 1);
});

test('stages: unknown id falls back to forest (no throw)', () => {
    const s = getStage('does-not-exist');
    assert.equal(s.id, 'forest');
});

test('stages: crypt pulls Reaper in and biases toward ranged enemies', () => {
    const c = getStage('crypt');
    assert.equal(c.id, 'crypt');
    // Boss schedule: Reaper should arrive earlier than the base 300s.
    const bosses = getBossesFor('crypt');
    const reaper = bosses.find((b) => b.id === 'reaper');
    assert.ok(reaper, 'crypt should still spawn the reaper');
    assert.ok(reaper.spawnAt < BOSSES.REAPER.spawnAt, 'reaper must arrive earlier on crypt');
    // Pool: every wave should now include at least one ranged caster.
    const waves = getWavesFor('crypt');
    for (const w of waves) {
        assert.ok(
            w.pool.includes('mage') || w.pool.includes('illusionist'),
            `wave "${w.label}" should contain a ranged enemy on crypt`
        );
    }
});

test('stages: getWavesFor never mutates the original WAVES catalogue', () => {
    const a = getWavesFor('crypt');
    const b = getWavesFor('forest');
    assert.notEqual(a, b);
    // Forest pool shouldn't contain the appended mage from crypt.
    const opening = b.find((w) => w.label === 'Opening');
    assert.ok(opening, 'forest must still have Opening wave');
    assert.ok(!opening.pool.includes('mage'), 'forest opening wave must remain mage-free');
});

test('stages: pickWeighted respects pool overrides on crypt', () => {
    // Run pickWeighted many times with a fixed pool; mage-weighted should
    // dominate over zombie even though both are present.
    const pool = ['mage', 'zombie'];
    const counts = { mage: 0, zombie: 0 };
    let i = 0;
    const rnd = () => {
        // deterministic-ish: walk through a fixed sequence of fractions
        const seq = [0.05, 0.15, 0.25, 0.35, 0.45, 0.55, 0.65, 0.75, 0.85, 0.95];
        return seq[i++ % seq.length];
    };
    for (let n = 0; n < 1000; n++) {
        const id = pickWeighted(pool, 'crypt', rnd);
        counts[id]++;
    }
    assert.ok(counts.mage > counts.zombie, 'crypt should bias picks toward mage');
});

test('stages: listStages returns at least the two shipped maps in order', () => {
    const ids = listStages().map((s) => s.id);
    assert.deepEqual(ids.slice(0, 2), ['forest', 'crypt']);
    assert.equal(Object.keys(STAGES).length, ids.length);
});

// ---------------------------------------------------------------------------
// daily.ts
// ---------------------------------------------------------------------------
test('daily: cyrb53 is deterministic and != for distinct inputs', () => {
    assert.equal(cyrb53('2026-04-25'), cyrb53('2026-04-25'));
    assert.notEqual(cyrb53('2026-04-25'), cyrb53('2026-04-26'));
});

test('daily: todayKey returns YYYY-MM-DD in UTC', () => {
    const k = todayKey(new Date(Date.UTC(2026, 3, 25, 23, 59)));
    assert.equal(k, '2026-04-25');
});

test('daily: dailyChallenge is deterministic per date and pins a stage', () => {
    const a = dailyChallenge('2026-04-25');
    const b = dailyChallenge('2026-04-25');
    assert.equal(a.seed, b.seed);
    assert.equal(a.stage, b.stage);
    assert.ok(['forest', 'crypt', 'tundra'].includes(a.stage));
    assert.equal(typeof dailySeed('2026-04-26'), 'number');
});

test('daily: saveDailyResult persists and prunes old days (>14d)', () => {
    _resetDailyForTests();
    // Derived from the pinned clock so the write and the prune window agree.
    const recent = daysBeforePinned(0);
    saveDailyResult(dailyEntry(recent, { timeSurvived: 600, won: true }), PINNED_NOW);

    // Comfortably outside the 14-day window relative to PINNED_NOW.
    const ancient = '2024-01-01';
    saveDailyResult(dailyEntry(ancient), PINNED_NOW);

    const h = loadDailyHistory();
    assert.ok(h[`${recent}-forest`], 'entry inside the 14-day window should be present');
    assert.equal(h[`${ancient}-forest`], undefined, 'entries older than 14 days should be pruned');
});

// --- prune-window boundary -------------------------------------------------
// The prune is `storedDate < cutoff`, so the cutoff day itself must survive.
// These two pins are what stop an off-by-one from silently eating a real
// player's most recent result.
test('daily: saveDailyResult keeps an entry exactly on the 14-day boundary', () => {
    _resetDailyForTests();
    const boundary = daysBeforePinned(14);
    saveDailyResult(dailyEntry(boundary), PINNED_NOW);
    assert.ok(
        loadDailyHistory()[`${boundary}-forest`],
        'the boundary day is inside the window and must not be pruned'
    );
});

test('daily: saveDailyResult prunes an entry one day past the boundary', () => {
    _resetDailyForTests();
    const justOut = daysBeforePinned(15);
    saveDailyResult(dailyEntry(justOut), PINNED_NOW);
    assert.equal(
        loadDailyHistory()[`${justOut}-forest`],
        undefined,
        'one day past the window must be pruned'
    );
});

// --- input contract --------------------------------------------------------
test('daily: saveDailyResult ignores entries with no date or no stage', () => {
    _resetDailyForTests();
    saveDailyResult({ stage: 'forest' }, PINNED_NOW);
    saveDailyResult({ date: daysBeforePinned(0) }, PINNED_NOW);
    saveDailyResult(null, PINNED_NOW);
    saveDailyResult(undefined, PINNED_NOW);
    assert.deepEqual(loadDailyHistory(), {}, 'no malformed entry may be persisted');
});

test('daily: saveDailyResult overwrites the same (date, stage) slot', () => {
    _resetDailyForTests();
    const date = daysBeforePinned(0);
    saveDailyResult(dailyEntry(date, { kills: 10 }), PINNED_NOW);
    saveDailyResult(dailyEntry(date, { kills: 99 }), PINNED_NOW);
    const h = loadDailyHistory();
    assert.equal(Object.keys(h).length, 1, 'same date+stage must collapse to one slot');
    assert.equal(h[`${date}-forest`].kills, 99, 'the most recent write wins');
});

// --- production default path ----------------------------------------------
test('daily: saveDailyResult defaults to the wall clock and stamps savedAt', () => {
    _resetDailyForTests();
    const date = todayKey();
    const before = Date.now();
    saveDailyResult(dailyEntry(date)); // no `now` -> must use the real clock
    const after = Date.now();

    const entry = loadDailyHistory()[`${date}-forest`];
    assert.ok(entry, 'entry written with the default clock should persist');
    assert.ok(
        entry.savedAt >= before && entry.savedAt <= after,
        `savedAt should come from the wall clock (got ${entry.savedAt})`
    );
});

test('daily: buildShareText contains stage label, time, and a 7-tile grid', () => {
    _resetDailyForTests();
    const entry = {
        date: '2026-04-25',
        stage: 'crypt',
        timeSurvived: 305,
        kills: 222,
        level: 14,
        won: false
    };
    const text = buildShareText(entry, {});
    assert.ok(text.includes('Crypt'), 'share should label the stage');
    assert.ok(text.includes('05:05'), 'share should encode 5:05 mm:ss');
    // 7 tiles on the grid line.
    const lines = text.split('\n');
    const grid = lines.find((l) => /^[\u{1F7E9}\u{1F7E8}\u{1F7EB}⬛]+$/u.test(l));
    assert.ok(grid, 'share should include an emoji grid line');
    assert.equal([...grid].length, 7, 'grid should be exactly 7 tiles');
});

// ---------------------------------------------------------------------------
// storage: per-stage leaderboard
// ---------------------------------------------------------------------------
test('storage: recordHighScore writes a per-stage bucket alongside the global one', () => {
    _resetStorageForTests();
    resetSave();
    const save = loadSave();
    recordHighScore(save, {
        kills: 100,
        timeSurvived: 200,
        level: 10,
        date: Date.now(),
        weapons: ['whip'],
        stage: 'crypt'
    });
    recordHighScore(save, {
        kills: 50,
        timeSurvived: 400,
        level: 12,
        date: Date.now(),
        weapons: ['orbit'],
        stage: 'forest'
    });
    const crypt = getStageHighScores(save, 'crypt');
    const forest = getStageHighScores(save, 'forest');
    assert.equal(crypt.length, 1, 'crypt bucket should hold one entry');
    assert.equal(forest.length, 1, 'forest bucket should hold one entry');
    assert.equal(crypt[0].timeSurvived, 200);
    assert.equal(forest[0].timeSurvived, 400);
    // Global view still reflects both, sorted by timeSurvived desc.
    assert.equal(save.highScores[0].timeSurvived, 400);
});

test('storage: damageNumbers default is true on a fresh save', () => {
    _resetStorageForTests();
    resetSave();
    const save = loadSave();
    assert.equal(save.settings.damageNumbers, true);
    assert.equal(save.settings.stage, 'forest');
});
