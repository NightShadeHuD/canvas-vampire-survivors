// Unit tests for iter-13 finishing-touches: stage chip, daily streak summary,
// help/how-to-play overlay state, and settings persistence shape. Runs in
// Node without a DOM where possible; the UI overlay tests stub a tiny
// document so we can exercise innerHTML/show/hide without pulling in jsdom.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
    _resetDailyForTests,
    dailyStreakSummary,
    saveDailyResult,
    todayKey
} from '../src/daily.ts';
import { _resetStorageForTests, loadSave, resetSave } from '../src/storage.ts';

// A fixed instant used as "now" wherever a test both writes and reads daily
// history. `saveDailyResult` prunes anything older than 14 days relative to
// `now`, so a test that stores a hardcoded date without pinning the clock is a
// time bomb: it passes until the literal ages out of the window, then deletes
// its own entry mid-write. (This is not hypothetical — that is exactly how the
// '2026-04-25' literal below began failing on 2026-05-10.) Always pass this
// explicitly; never let these tests read the wall clock.
const PINNED_NOW = new Date(Date.UTC(2026, 3, 25, 12, 0));

// ---------------------------------------------------------------------------
// daily.dailyStreakSummary
// ---------------------------------------------------------------------------
test('streak: empty history yields current=0, best=0, 14 missed days', () => {
    _resetDailyForTests();
    const s = dailyStreakSummary({}, new Date(Date.UTC(2026, 3, 25)));
    assert.equal(s.current, 0);
    assert.equal(s.best, 0);
    assert.equal(s.days.length, 14);
    assert.equal(
        s.days.every((d) => !d.played && !d.won),
        true
    );
});

test('streak: 3 consecutive days ending today gives current=3, best=3', () => {
    _resetDailyForTests();
    const today = new Date(Date.UTC(2026, 3, 25));
    const dayKey = (offset) => todayKey(new Date(today.getTime() - offset * 86400 * 1000));
    const history = {};
    for (const off of [0, 1, 2]) {
        history[`${dayKey(off)}-forest`] = {
            date: dayKey(off),
            stage: 'forest',
            timeSurvived: 200 + off * 10,
            kills: 100,
            level: 8,
            won: off === 0,
            noHit: false,
            seed: 1
        };
    }
    const s = dailyStreakSummary(history, today);
    assert.equal(s.current, 3, 'three trailing consecutive days');
    assert.equal(s.best, 3);
    // First three calendar cells (newest -> oldest) should all be played.
    const newestThree = s.days.slice(0, 3);
    assert.ok(newestThree.every((d) => d.played));
    // The newest cell encodes the win flag.
    assert.equal(s.days[0].won, true);
});

test('streak: a gap stops the current streak but does not reset best', () => {
    _resetDailyForTests();
    const today = new Date(Date.UTC(2026, 3, 25));
    const k = (off) => todayKey(new Date(today.getTime() - off * 86400 * 1000));
    // Played 5 in a row a week ago, then missed, then played today only.
    const history = {};
    for (const off of [0, 7, 8, 9, 10, 11]) {
        history[`${k(off)}-forest`] = {
            date: k(off),
            stage: 'forest',
            timeSurvived: 100,
            kills: 10,
            level: 3,
            won: false,
            noHit: false,
            seed: 1
        };
    }
    const s = dailyStreakSummary(history, today);
    assert.equal(s.current, 1, 'only today is consecutive');
    assert.equal(s.best, 5, 'longest historical run');
});

test('streak: collapses multiple stages on the same date to one played day', () => {
    _resetDailyForTests();
    const today = new Date(Date.UTC(2026, 3, 25));
    const date = todayKey(today);
    const history = {
        [`${date}-forest`]: {
            date,
            stage: 'forest',
            timeSurvived: 100,
            kills: 10,
            level: 3,
            won: false
        },
        [`${date}-crypt`]: {
            date,
            stage: 'crypt',
            timeSurvived: 250,
            kills: 80,
            level: 9,
            won: true
        }
    };
    const s = dailyStreakSummary(history, today);
    assert.equal(s.current, 1, 'one day even with two stage entries');
    // Best timeSurvived/won wins when collapsing duplicate-date entries.
    assert.equal(s.days[0].timeSurvived, 250);
    assert.equal(s.days[0].won, true);
});

test('streak: saveDailyResult round-trips into the streak summary', () => {
    _resetDailyForTests();
    // Pin the clock on the write AND the read so the prune window and the
    // summary agree on what "today" is, whatever the wall clock says.
    saveDailyResult(
        {
            date: todayKey(PINNED_NOW),
            stage: 'forest',
            timeSurvived: 480,
            kills: 320,
            level: 14,
            weapons: ['whip'],
            won: true,
            noHit: false,
            seed: 1
        },
        PINNED_NOW
    );
    const s = dailyStreakSummary(undefined, PINNED_NOW);
    // Today is played, won.
    assert.equal(s.days[0].played, true);
    assert.equal(s.days[0].won, true);
    assert.equal(s.current, 1);
});

// ---------------------------------------------------------------------------
// storage: settings persistence shape (the new fields must round-trip)
// ---------------------------------------------------------------------------
test('persistence: every iter-13 setting key has a default and survives load', () => {
    _resetStorageForTests();
    resetSave();
    const save = loadSave();
    // Every key the Settings panel + hotkeys read from must be present so a
    // fresh save behaves identically to one written by a v2.5 client.
    const keys = [
        'masterVolume',
        'sfxVolume',
        'musicVolume',
        'musicEnabled',
        'difficulty',
        'showFps',
        'screenShake',
        'reducedMotion',
        'colorblind',
        'damageNumbers',
        'locale',
        'stage',
        'muted'
    ];
    for (const k of keys) {
        assert.ok(k in save.settings, `settings.${k} should default-present`);
    }
    assert.equal(save.settings.muted, false);
    assert.equal(save.settings.stage, 'forest');
    // Also: the new flags slot for the how-to-play one-time overlay.
    assert.ok(save.flags && typeof save.flags === 'object');
    assert.equal(save.flags.howToSeen, false);
});

// ---------------------------------------------------------------------------
// UI overlays: stage chip, streak, help, how-to-play. We stub a minimal DOM
// shim instead of depending on jsdom — only the ids the UI module touches
// need to exist, and we just exercise the show/hide branches for content.
// ---------------------------------------------------------------------------
function makeStubDoc() {
    const els = new Map();
    const make = (id) => {
        const e = {
            id,
            style: {},
            innerHTML: '',
            textContent: '',
            dataset: {},
            classList: {
                add() {},
                remove() {},
                toggle() {}
            },
            children: [],
            _listeners: {},
            addEventListener(ev, fn) {
                this._listeners[ev] = this._listeners[ev] || [];
                this._listeners[ev].push(fn);
            },
            removeEventListener() {},
            querySelector(sel) {
                if (sel.startsWith('#')) {
                    const found = make(sel.slice(1));
                    found.click = () => (found._listeners.click || []).forEach((fn) => fn());
                    return found;
                }
                return null;
            },
            querySelectorAll() {
                return [];
            },
            appendChild(c) {
                this.children.push(c);
            },
            insertBefore(c) {
                this.children.push(c);
            },
            setAttribute() {},
            focus() {}
        };
        els.set(id, e);
        return e;
    };
    // Pre-populate every id the UI module caches.
    for (const id of [
        'hp',
        'maxHp',
        'hpBar',
        'level',
        'expBar',
        'time',
        'kills',
        'weaponIcons',
        'startScreen',
        'gameOver',
        'finalTime',
        'finalKills',
        'finalLevel',
        'levelUpMenu',
        'upgradeOptions',
        'pauseMenu',
        'settingsMenu',
        'fpsCounter',
        'bossBanner',
        'highScore',
        'passiveIcons',
        'achievementToasts',
        'highScoreList',
        'waveLabel',
        'achievementsScreen',
        'leaderboardScreen',
        'stagePickerScreen',
        'streakScreen',
        'helpScreen',
        'howToPlayScreen',
        'btnStageChip'
    ]) {
        make(id);
    }
    return {
        getElementById: (id) => els.get(id) || null,
        body: { classList: { add() {}, remove() {}, toggle() {} } },
        documentElement: { lang: 'en' },
        createElement: () => make('div')
    };
}

test('ui.updateStageChip: writes icon + name into the chip element', async () => {
    // Stub the global document so UI._cache works.
    globalThis.document = makeStubDoc();
    const { UI } = await import('../src/ui.js');
    const ui = new UI({});
    ui.updateStageChip('crypt');
    const chip = globalThis.document.getElementById('btnStageChip');
    assert.match(chip.textContent, /Sunken Crypt/);
    assert.equal(chip.dataset.stage, 'crypt');
    ui.updateStageChip('forest');
    assert.match(chip.textContent, /Whisperwood/);
    assert.equal(chip.dataset.stage, 'forest');
    delete globalThis.document;
});

test('ui.showStreak: renders 14 calendar cells and current/best stats', async () => {
    globalThis.document = makeStubDoc();
    globalThis.window = { localStorage: undefined };
    _resetDailyForTests();
    saveDailyResult({
        date: todayKey(),
        stage: 'forest',
        timeSurvived: 222,
        kills: 50,
        level: 6,
        weapons: ['whip'],
        won: false,
        noHit: false,
        seed: 1
    });
    const { UI } = await import('../src/ui.js');
    const ui = new UI({});
    ui.showStreak();
    const m = globalThis.document.getElementById('streakScreen');
    assert.equal(m.style.display, 'flex');
    // 14 streak cells render in the grid.
    const cellMatches = m.innerHTML.match(/class="streak-cell/g) || [];
    assert.equal(cellMatches.length, 14);
    // Current/best pills are present.
    assert.match(m.innerHTML, /streak-pill/);
    delete globalThis.document;
    delete globalThis.window;
});

test('ui.showHelp: lists at least 6 keyboard shortcut rows and a close button', async () => {
    globalThis.document = makeStubDoc();
    const { UI } = await import('../src/ui.js');
    const ui = new UI({});
    ui.showHelp();
    const m = globalThis.document.getElementById('helpScreen');
    assert.equal(m.style.display, 'flex');
    const rows = m.innerHTML.match(/class="help-row"/g) || [];
    assert.ok(rows.length >= 6, `expected >=6 help rows, got ${rows.length}`);
    assert.match(m.innerHTML, /helpClose/);
    delete globalThis.document;
});

test('ui.showHowToPlay: renders the four onboarding paragraphs', async () => {
    globalThis.document = makeStubDoc();
    const { UI } = await import('../src/ui.js');
    const ui = new UI({});
    ui.showHowToPlay();
    const m = globalThis.document.getElementById('howToPlayScreen');
    assert.equal(m.style.display, 'flex');
    const items = m.innerHTML.match(/<li>/g) || [];
    assert.equal(items.length, 4);
    assert.match(m.innerHTML, /howtoClose/);
    delete globalThis.document;
});
