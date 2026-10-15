// Edge cases for the boundary validators themselves.
//
// `hostile-input.test.ts` proves each audit finding stops reproducing. This file
// asks the complementary question — does the validator do the RIGHT thing at the
// edges, in both directions? A check that rejects everything is as broken as one
// that rejects nothing, and only the second kind gets noticed.
//
// Runs in Node, no browser.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
    loadSave,
    loadSpeedrunScores,
    mergeDeep,
    recordHighScore,
    recordSpeedrunScore,
    resetSave,
    saveSave,
    sanitiseHighScoreEntry,
    sanitiseSpeedrunEntry,
    _resetSpeedrunForTests,
    _resetStorageForTests
} from '../src/storage.ts';
import {
    REPLAY_MAX_FRAMES,
    REPLAY_VERSION,
    ReplayPlayer,
    compressFrames,
    loadReplay,
    sanitiseReplay,
    saveReplay,
    clearReplay,
    _resetReplayForTests
} from '../src/replay.ts';

/** A localStorage whose every method can be made to fail on demand. */
function installStore(initial: Record<string, string> = {}): {
    store: Record<string, string>;
    break: () => void;
    ls: {
        getItem(k: string): string | null;
        setItem(k: string, v: string): void;
        removeItem(k: string): void;
    };
} {
    const store: Record<string, string> = {};
    let broken = false;
    const ls = {
        getItem(k: string) {
            if (broken) throw new Error('storage denied');
            return k in store ? store[k] : null;
        },
        setItem(k: string, v: string) {
            if (broken) throw new Error('quota exceeded');
            store[k] = String(v);
        },
        removeItem(k: string) {
            delete store[k];
        }
    };
    (globalThis as Record<string, unknown>).window = { localStorage: ls };
    // The resets run BEFORE the seed is copied in. They delete the daily,
    // keymap and replay slots, so seeding first is seeding into a bucket that
    // is about to be emptied -- which is exactly how the first version of this
    // helper made three tests pass for the wrong reason.
    _resetStorageForTests();
    _resetSpeedrunForTests();
    _resetReplayForTests();
    for (const key of Object.keys(initial)) store[key] = initial[key];
    return { store, break: () => (broken = true), ls };
}

function uninstallStore(): void {
    (globalThis as Record<string, unknown>).window = { localStorage: null };
    _resetStorageForTests();
    _resetSpeedrunForTests();
    _resetReplayForTests();
}

// ---------------------------------------------------------------------------
// loadSave at the edges
// ---------------------------------------------------------------------------

test('loadSave: a full save is adopted field by field', () => {
    const save = {
        highScore: { kills: 10, timeSurvived: 20, level: 2 },
        highScores: [
            { kills: 1, timeSurvived: 2, level: 3, date: 4, weapons: ['Whip'], noHit: true }
        ],
        stageHighScores: { crypt: [{ kills: 1, timeSurvived: 2, level: 3, date: 4 }] },
        totals: {
            kills: 5,
            timePlayed: 6,
            runs: 7,
            bossKills: 8,
            seenBuilds: ['whip'],
            uniqueBuilds: 1
        },
        achievements: { first: 12345 },
        settings: { masterVolume: 0.1, difficulty: 'hard', locale: 'de', stage: 'crypt' },
        runs: 3,
        flags: { howToSeen: true, pwaPromptSeen: true, tutorialDone: true }
    };
    installStore({ vs_clone_save_v2: JSON.stringify(save) });
    try {
        const out = loadSave();
        assert.equal(out.highScore.kills, 10);
        assert.equal(out.highScores.length, 1);
        assert.deepEqual(out.highScores[0].weapons, ['Whip']);
        assert.equal(out.highScores[0].noHit, true);
        assert.deepEqual(out.stageHighScores.crypt.length, 1);
        assert.deepEqual(out.totals.seenBuilds, ['whip']);
        assert.equal(out.achievements.first, 12345);
        assert.equal(out.settings.difficulty, 'hard');
        assert.equal(out.settings.locale, 'de');
        assert.equal(out.flags.tutorialDone, true);
        assert.equal(out.runs, 3);
    } finally {
        uninstallStore();
    }
});

test('loadSave: unknown keys survive, at the top level and one level down', () => {
    // The documented forwards-compatibility contract, re-asserted here because
    // the merge now type-checks: a key this build does not know must still be
    // carried through, as a COPY rather than the parsed object by reference.
    installStore({
        vs_clone_save_v2: '{"fromTheFuture":{"a":[1,2]},"settings":{"futureFlag":true}}'
    });
    try {
        const out = loadSave() as unknown as Record<string, unknown>;
        assert.deepEqual(out.fromTheFuture, { a: [1, 2] });
        const settings = out.settings as Record<string, unknown>;
        assert.equal(settings.futureFlag, true);
        assert.equal(settings.locale, 'en', 'the defaults must still be underneath');
    } finally {
        uninstallStore();
    }
});

test('loadSave: an unknown key cannot smuggle __proto__ in either', () => {
    installStore({
        vs_clone_save_v2: '{"totals":{"fromTheFuture":{"__proto__":{"polluted":"no"}}}}'
    });
    try {
        loadSave();
        assert.equal(({} as Record<string, unknown>).polluted, undefined);
    } finally {
        uninstallStore();
    }
});

test('loadSave: unreadable storage falls back to the defaults', () => {
    const env = installStore({ vs_clone_save_v2: '{"totals":{"kills":9}}' });
    try {
        env.break();
        const out = loadSave();
        assert.equal(out.totals.kills, 0, 'a read that throws must not half-apply');
    } finally {
        uninstallStore();
    }
});

test('loadSave: an oversized leaderboard is truncated to the cap, not rejected', () => {
    const rows: Array<Record<string, number>> = [];
    for (let i = 0; i < 500; i++) {
        rows.push({ kills: i, timeSurvived: i, level: 1, date: i });
    }
    installStore({ vs_clone_save_v2: JSON.stringify({ highScores: rows }) });
    try {
        const out = loadSave();
        assert.equal(out.highScores.length, 200, 'the cap is 200, not the whole array');
    } finally {
        uninstallStore();
    }
});

test('loadSave: bad elements are dropped and good ones kept', () => {
    installStore({
        vs_clone_save_v2: JSON.stringify({
            highScores: [
                { kills: 1, timeSurvived: 2, level: 3, date: 4 },
                { kills: 1, level: 3, date: 4 },
                'not an object',
                { kills: 1, timeSurvived: 'soon', level: 3, date: 4 }
            ]
        })
    });
    try {
        const out = loadSave();
        assert.equal(out.highScores.length, 1, 'only the well-formed entry survives');
    } finally {
        uninstallStore();
    }
});

test('loadSave: a string where a number belongs is refused, in every numeric field', () => {
    installStore({
        vs_clone_save_v2: JSON.stringify({
            highScore: { kills: 'many', timeSurvived: 'long', level: 'high' },
            totals: { kills: 'lots', runs: [], timePlayed: {}, bossKills: true },
            runs: 'several',
            settings: { masterVolume: 'loud', touchButtonScale: 'big', difficulty: 'insane' },
            flags: { howToSeen: 'yes' }
        })
    });
    try {
        const out = loadSave();
        assert.equal(out.highScore.kills, 0);
        assert.equal(out.totals.kills, 0);
        assert.equal(out.totals.runs, 0);
        assert.equal(out.runs, 0);
        assert.equal(out.settings.masterVolume, 0.6);
        assert.equal(out.settings.touchButtonScale, 1);
        assert.equal(
            out.settings.difficulty,
            'normal',
            'a string outside the allow-list is refused'
        );
        assert.equal(out.flags.howToSeen, false);
    } finally {
        uninstallStore();
    }
});

test('loadSave: out-of-range numbers are CLAMPED, not refused', () => {
    // A clamp and a refusal are different decisions, and both are deliberate: a
    // volume of 4 is a number and the player meant "loud", so it becomes 1.
    installStore({
        vs_clone_save_v2: JSON.stringify({ settings: { masterVolume: 4, sfxVolume: -2 } })
    });
    try {
        const out = loadSave();
        assert.equal(out.settings.masterVolume, 1);
        assert.equal(out.settings.sfxVolume, 0);
    } finally {
        uninstallStore();
    }
});

test('saveSave: a write that is refused reports false rather than throwing', () => {
    const env = installStore();
    try {
        env.break();
        const save = loadSave();
        assert.equal(saveSave(save), false);
    } finally {
        uninstallStore();
    }
});

test('resetSave: clears the slot and a reload returns the defaults', () => {
    installStore({ vs_clone_save_v2: '{"totals":{"kills":9}}' });
    try {
        assert.equal(loadSave().totals.kills, 9);
        resetSave();
        assert.equal(loadSave().totals.kills, 0);
    } finally {
        uninstallStore();
    }
});

// ---------------------------------------------------------------------------
// mergeDeep, directly
// ---------------------------------------------------------------------------

test('mergeDeep: a nested object is merged, not replaced', () => {
    const target = { settings: { a: 1, b: 2 } };
    mergeDeep(target, { settings: { b: 3 } });
    assert.deepEqual(target.settings, { a: 1, b: 3 });
});

test('mergeDeep: an array where an object belongs is refused, and vice versa', () => {
    const target: Record<string, unknown> = { settings: { a: 1 }, list: [1] };
    mergeDeep(target, { settings: [9], list: { 0: 9 } });
    assert.deepEqual(target.settings, { a: 1 });
    assert.deepEqual(target.list, [1]);
});

test('mergeDeep: a key whose target is absent is carried through safely', () => {
    const target: Record<string, unknown> = {};
    mergeDeep(target, { nested: { deep: [1, 2, 3] }, text: 'x', n: 1, b: true, z: null });
    assert.deepEqual(target.nested, { deep: [1, 2, 3] });
    assert.equal(target.text, 'x');
    assert.equal(target.n, 1);
    assert.equal(target.b, true);
    assert.equal(target.z, null);
});

// ---------------------------------------------------------------------------
// The per-entry sanitisers
// ---------------------------------------------------------------------------

test('sanitiseHighScoreEntry: refuses what is not an entry, accepts what is', () => {
    assert.equal(sanitiseHighScoreEntry(null), null);
    assert.equal(sanitiseHighScoreEntry('x'), null);
    assert.equal(sanitiseHighScoreEntry([]), null);
    assert.equal(sanitiseHighScoreEntry({ kills: 1 }), null, 'no time means not an entry');
    assert.equal(sanitiseHighScoreEntry({ timeSurvived: 'long' }), null);
    assert.equal(sanitiseHighScoreEntry({ timeSurvived: Infinity }), null);
    const ok = sanitiseHighScoreEntry({ timeSurvived: 10, kills: 2, level: 3, date: 4 });
    assert.ok(ok);
    assert.deepEqual(ok, { kills: 2, timeSurvived: 10, level: 3, date: 4 });
});

test('sanitiseHighScoreEntry: clamps the numbers and drops the fields it cannot use', () => {
    const out = sanitiseHighScoreEntry({
        timeSurvived: 99999999,
        kills: -5,
        level: 1.7e20,
        date: -1,
        stage: 'a'.repeat(200),
        weapons: ['Whip', '', 'x'.repeat(200), 7, null],
        noHit: 'yes'
    });
    assert.ok(out);
    assert.equal(out.timeSurvived, 604800, 'a run cannot last longer than the cap');
    assert.equal(out.kills, 0);
    assert.equal(out.level, 100000);
    assert.equal(out.date, 0);
    assert.equal(out.stage, undefined, 'an over-long stage id is not a stage id');
    assert.deepEqual(out.weapons, ['Whip']);
    assert.equal(out.noHit, undefined, 'only a real boolean marks a no-hit run');
});

test('sanitiseHighScoreEntry: keeps a benign entry byte-for-byte', () => {
    // The positive control for the sanitiser: it must not edit a legitimate run.
    const entry = {
        kills: 100,
        timeSurvived: 601,
        level: 12,
        date: 1700000000000,
        weapons: ['Whip', 'Axe'],
        noHit: true
    };
    assert.deepEqual(sanitiseHighScoreEntry(entry), entry);
});

test('sanitiseSpeedrunEntry: requires the sort key and keeps the splits', () => {
    assert.equal(sanitiseSpeedrunEntry({ level: 1 }), null, 'no timeMs means not a speedrun');
    assert.equal(sanitiseSpeedrunEntry({ timeMs: 'fast' }), null);
    const out = sanitiseSpeedrunEntry({
        timeMs: 12345,
        level: 2,
        kills: 3,
        date: 4,
        splits: [
            { mark: 10, realMs: 10000 },
            { mark: 'x', realMs: 1 },
            'nope',
            { mark: 20, realMs: 20000 }
        ]
    });
    assert.ok(out);
    assert.equal(out.timeMs, 12345);
    assert.deepEqual(out.splits, [
        { mark: 10, realMs: 10000 },
        { mark: 20, realMs: 20000 }
    ]);
    assert.equal(out.timeSurvived, 12.345, 'derived so the entry satisfies HighScore');
});

test('recordHighScore / recordSpeedrunScore: refuse a bad entry without disturbing the board', () => {
    const env = installStore();
    try {
        const save = {
            highScores: [] as Array<Record<string, unknown>>,
            highScore: { kills: 0, timeSurvived: 0, level: 0 }
        };
        assert.equal(recordHighScore(save, { kills: 1 }), 0);
        assert.equal(save.highScores.length, 0);
        assert.equal(recordSpeedrunScore({ kills: 1 }), 0);
        assert.deepEqual(loadSpeedrunScores(), []);
        void env;
    } finally {
        uninstallStore();
    }
});

test('loadSpeedrunScores: a non-array, or a list of junk, reads as empty', () => {
    for (const raw of ['{"a":1}', '"text"', '42', 'null', '[1,2,3]', '[{"kills":1}]']) {
        installStore({ speedrun_highscores: raw });
        try {
            assert.deepEqual(loadSpeedrunScores(), [], `not refused: ${raw}`);
        } finally {
            uninstallStore();
        }
    }
});

test('loadSpeedrunScores: a good list survives, capped', () => {
    const list: Array<Record<string, number>> = [];
    for (let i = 0; i < 40; i++) list.push({ timeMs: 1000 + i, level: 1, kills: i, date: i });
    installStore({ speedrun_highscores: JSON.stringify(list) });
    try {
        const out = loadSpeedrunScores();
        assert.ok(out.length > 0 && out.length <= 40, `unexpected length ${out.length}`);
        assert.equal(out[0].timeMs, 1000);
    } finally {
        uninstallStore();
    }
});

// ---------------------------------------------------------------------------
// The replay blob validator, at the edges
// ---------------------------------------------------------------------------

/** A structurally valid blob, with fields replaced per test. */
function blob(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return Object.assign(
        {
            version: REPLAY_VERSION,
            savedAt: 1,
            seed: 2,
            stage: 'forest',
            difficulty: 'normal',
            dt: 1 / 60,
            frames: [[0, 0, 3]],
            finalKills: 1,
            finalTime: 2,
            finalLevel: 3,
            truncated: false
        },
        overrides
    );
}

test('sanitiseReplay: refuses anything that is not this format', () => {
    const rejected: unknown[] = [
        null,
        'text',
        42,
        [],
        {},
        blob({ version: 99 }),
        blob({ frames: 'nope' }),
        blob({ frames: null })
    ];
    for (const bad of rejected) {
        assert.equal(sanitiseReplay(bad), null, `not refused: ${JSON.stringify(bad)}`);
    }
});

test('sanitiseReplay: replaces fields it cannot use and keeps the ones it can', () => {
    const out = sanitiseReplay(
        blob({
            stage: 'Not A Slug',
            difficulty: 'NORMAL!',
            dt: 0,
            savedAt: 'yesterday',
            seed: 'x',
            finalKills: -4,
            finalTime: 'a while',
            finalLevel: 0,
            truncated: 'yes'
        })
    );
    assert.ok(out);
    assert.equal(out.stage, 'forest');
    assert.equal(out.difficulty, 'normal');
    assert.equal(out.dt, 1 / 60);
    assert.equal(out.savedAt, 0);
    assert.equal(out.seed, 1);
    assert.equal(out.finalKills, 0);
    assert.equal(out.finalTime, 0);
    assert.equal(out.finalLevel, 1);
    assert.equal(out.truncated, false);
});

test('sanitiseReplay: an honest blob comes back unchanged', () => {
    const original = blob({
        frames: [
            [0, 0, 2],
            [1, -1, 1]
        ]
    });
    assert.deepEqual(sanitiseReplay(original), original);
});

test('sanitiseReplay: hostile frame runs are dropped, honest ones are kept', () => {
    const out = sanitiseReplay(
        blob({
            frames: [
                [0, 0, 2],
                [0, 0, -1],
                [0, 0, 1e9],
                ['x', 0, 2],
                [0, 0, 3],
                [5, 5, 1]
            ]
        })
    );
    assert.ok(out);
    assert.equal(out.frames.length, 4, 'two refused, four kept');
    assert.deepEqual(out.frames[1], [0, 0, REPLAY_MAX_FRAMES], 'an absurd count is clamped');
    assert.deepEqual(out.frames[3], [1, 1, 1], 'positions are clamped to the input space');
});

test('loadReplay: writes, reads and clears through the same slot', () => {
    installStore();
    try {
        const original = blob();
        assert.equal(saveReplay(original), true);
        const read = loadReplay();
        assert.ok(read);
        assert.equal(read.stage, 'forest');
        clearReplay();
        assert.equal(loadReplay(), null);
    } finally {
        uninstallStore();
    }
});

test('loadReplay: unreadable JSON is null, not a throw', () => {
    installStore({ vs_replay_last_v1: '{not json' });
    try {
        assert.equal(loadReplay(), null);
    } finally {
        uninstallStore();
    }
});

// ---------------------------------------------------------------------------
// Frame compression and playback
// ---------------------------------------------------------------------------

test('compressFrames: collapses runs and round-trips through expandFrames', () => {
    assert.deepEqual(compressFrames([]), []);
    const frames: Array<[number, number]> = [
        [0, 0],
        [0, 0],
        [1, 1]
    ];
    const rle = compressFrames(frames);
    assert.deepEqual(rle, [
        [0, 0, 2],
        [1, 1, 1]
    ]);
});

test('ReplayPlayer: reports progress, then finishes, and holds the last vector', () => {
    const player = new ReplayPlayer(
        blob({
            frames: [
                [0, 0, 1],
                [1, 1, 1]
            ]
        }),
        { speed: 1 }
    );
    assert.equal(player.totalFrames, 2);
    assert.equal(player.progress, 0);
    assert.deepEqual(player.getMoveVector(), { x: 0, y: 0 });
    player.tick();
    assert.deepEqual(player.getMoveVector(), { x: 1, y: 1 });
    player.tick();
    assert.equal(player.done, true);
    assert.equal(player.progress, 1);
    // Ticking a finished player is a no-op rather than an overflow.
    player.tick();
    assert.equal(player.progress, 1);
});

test('ReplayPlayer: an empty frame list is done and reads the origin', () => {
    const player = new ReplayPlayer(blob({ frames: [] }), { speed: 1 });
    assert.equal(player.totalFrames, 0);
    assert.equal(player.progress, 1);
    assert.deepEqual(player.getMoveVector(), { x: 0, y: 0 });
    player.tick();
    assert.equal(player.done, true);
});

test('ReplayPlayer: a blob with no frames array does not throw', () => {
    const player = new ReplayPlayer({}, { speed: 1 });
    assert.equal(player.totalFrames, 0);
    assert.deepEqual(player.getMoveVector(), { x: 0, y: 0 });
});
