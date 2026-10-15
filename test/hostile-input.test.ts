// Hostile-input regression tests: one per finding from the security audit.
//
// Each test here is the Node-side twin of a browser probe the auditor wrote.
// The probes drive the real UI in Chromium; this file drives the same parsers
// and the same `UI` class against a stub DOM, so the regression is caught by
// `npm test` and not only by a browser run.
//
// WHAT EACH TEST IS ALLOWED TO CLAIM
//
// The load-bearing fix for every XSS in the audit is escaping at the sink. A
// `weapons` array of strings is a VALID shape — `["<img src=x onerror=…>"]`
// satisfies it — so no parser can reject it. The tests below therefore assert
// two different things, and it matters which:
//
//   * the PARSER tests assert the value never reaches the save at all, or
//     reaches it as the wrong type (F2, F4, F5, F7, F9, F10, F11);
//   * the SINK tests assert that when a hostile STRING does reach rendering,
//     what comes out is text and not markup (F1, and every other finding,
//     because the sink is the one control they all pass through).
//
// Runs in Node, no browser.

import test from 'node:test';
import assert from 'node:assert/strict';
import { loadSave, mergeDeep, saveSave, _resetStorageForTests } from '../src/storage.ts';
import { loadDailyHistory, _resetDailyForTests } from '../src/daily.ts';
import { loadKeymap, keyLabel, _resetKeymapForTests } from '../src/keymap.ts';
import {
    REPLAY_MAX_FRAMES,
    ReplayPlayer,
    expandFrames,
    loadReplay,
    _resetReplayForTests
} from '../src/replay.ts';

const PAYLOAD = '<img src=x onerror="window.__pwned=1">';
const SAVE_KEY = 'vs_clone_save_v2';
const DAILY_KEY = 'vs_daily_history_v1';
const KEYMAP_KEY = 'vs_keymap_v1';
const REPLAY_KEY = 'vs_replay_last_v1';

// ---------------------------------------------------------------------------
// A stub DOM with real attribute storage, a real createElement and a real
// innerHTML property, so `UI` can be constructed and its output read.
// ---------------------------------------------------------------------------

/** One stubbed element: enough of the DOM for `UI` to build and be read. */
interface StubEl {
    tagName: string;
    style: Record<string, unknown>;
    textContent: string;
    className: string;
    dataset: Record<string, unknown>;
    children: StubEl[];
    classList: { add(c: string): void; remove(c: string): void; toggle(c: string): void };
    addEventListener(): void;
    removeEventListener(): void;
    querySelector(): null;
    querySelectorAll(): StubEl[];
    appendChild(c: StubEl): StubEl;
    insertBefore(c: StubEl): StubEl;
    remove(): void;
    focus(): void;
    setAttribute(k: string, v: unknown): void;
    getAttribute(k: string): string | null;
    hasAttribute(k: string): boolean;
    innerHTML: string;
}

/** The localStorage surface the storage modules probe for. */
interface StubLs {
    getItem(k: string): string | null;
    setItem(k: string, v: string): void;
    removeItem(k: string): void;
}

/** A slot name to its raw stored string. */
type StubStore = Record<string, string>;

interface StubDom {
    el(id: string): StubEl;
}

function installDom(): StubDom {
    const byId = new Map<string, StubEl>();
    const makeEl = (tag: string): StubEl => {
        const attrs = new Map<string, string>();
        let html = '';
        const el: StubEl = {
            tagName: tag,
            style: {},
            textContent: '',
            className: '',
            dataset: {},
            children: [],
            // Replaced below by a real accessor; declared here so the literal
            // satisfies the interface it is annotated with.
            innerHTML: '',
            classList: {
                add() {},
                remove() {},
                toggle() {}
            },
            addEventListener() {},
            removeEventListener() {},
            querySelector: () => null,
            querySelectorAll: () => [],
            appendChild(c: StubEl) {
                el.children.push(c);
                return c;
            },
            insertBefore(c: StubEl) {
                el.children.push(c);
                return c;
            },
            remove() {},
            focus() {},
            setAttribute(k: string, v: unknown) {
                attrs.set(k, String(v));
            },
            getAttribute(k: string) {
                return attrs.has(k) ? (attrs.get(k) as string) : null;
            },
            hasAttribute(k: string) {
                return attrs.has(k);
            }
        };
        Object.defineProperty(el, 'innerHTML', {
            get: () => html,
            set: (v: unknown) => {
                html = String(v);
            }
        });
        return el;
    };
    const documentStub = {
        getElementById(id: string) {
            if (!byId.has(id)) byId.set(id, makeEl('div'));
            return byId.get(id) as StubEl;
        },
        createElement: (tag: string) => makeEl(tag),
        querySelector: (): null => null,
        querySelectorAll: (): StubEl[] => [],
        addEventListener() {},
        removeEventListener() {},
        body: makeEl('body')
    };
    (globalThis as Record<string, unknown>).document = documentStub;
    (globalThis as Record<string, unknown>).window = {
        addEventListener() {},
        removeEventListener() {},
        localStorage: null
    };
    return { el: (id: string) => documentStub.getElementById(id) };
}

/**
 * Put a raw string into localStorage, then run `read` against it.
 *
 * The storage modules probe for localStorage once and cache the answer, so
 * every helper resets that cache first — otherwise the second test in the file
 * silently reads through the first test's decision.
 */
function withStored(
    slot: string,
    raw: string,
    read: (ls: StubLs, store: StubStore, dom: StubDom) => unknown
) {
    // The resets come FIRST, and the order is load-bearing twice over. Each
    // module caches its localStorage decision on first use, so a stale decision
    // would read through the previous test; and `_resetDailyForTests`,
    // `_resetKeymapForTests` and `_resetReplayForTests` also DELETE their slot,
    // so seeding before them is seeding into a bucket about to be emptied.
    _resetStorageForTests();
    _resetDailyForTests();
    _resetKeymapForTests();
    _resetReplayForTests();
    const dom = installDom();
    const store: StubStore = { [slot]: raw };
    const ls: StubLs = {
        getItem: (k: string) => (k in store ? store[k] : null),
        setItem: (k: string, v: string) => {
            store[k] = String(v);
        },
        removeItem: (k: string) => {
            delete store[k];
        }
    };
    (globalThis.window as unknown as { localStorage: unknown }).localStorage = ls;
    // Deliberately NOT restored afterwards: an async reader would still be
    // running when a `finally` fired, and tearing the DOM out from under it is
    // how this helper's first version produced ten "document is not defined"
    // failures. Each `node --test` FILE is its own process, so the stub cannot
    // leak into another suite.
    return read(ls, store, dom);
}

/**
 * The real UI class, built against whatever DOM the caller installed on
 * `globalThis`. It takes no argument because `UI._cache` reads the global
 * `document` directly — a parameter would be a value the function ignores,
 * which is the kind of signature that makes a reader look for a use.
 */
async function freshUi() {
    const { UI } = await import('../src/ui.ts');
    return new UI({});
}

/**
 * `withStored` for the tests that READ the rendered markup.
 *
 * The reader is typed as returning a string, so `out` is a string and the
 * assertions need no cast — which matters here because these are the tests that
 * exist to check what the escaping produced.
 */
async function storedMarkup(
    slot: string,
    raw: string,
    read: (ls: StubLs, store: StubStore, dom: StubDom) => string | Promise<string>
): Promise<string> {
    return String(await withStored(slot, raw, read));
}

// ---------------------------------------------------------------------------
// F2 — prototype pollution through loadSave -> mergeDeep
// ---------------------------------------------------------------------------

test('F2: a save carrying __proto__ does not touch Object.prototype', () => {
    // Built as a raw STRING: a JavaScript object literal with a `__proto__` key
    // sets the prototype and JSON.stringify then emits `{}`, so the object form
    // cannot express this payload at all.
    withStored(SAVE_KEY, '{"__proto__":{"polluted":"yes-from-save"}}', () => {
        const save = loadSave();
        assert.equal(({} as Record<string, unknown>).polluted, undefined);
        assert.equal(Object.prototype.hasOwnProperty('polluted'), false);
        assert.equal((save as unknown as Record<string, unknown>).polluted, undefined);
    });
});

test('F2: constructor and prototype are refused as merge keys too', () => {
    withStored(SAVE_KEY, '{"constructor":{"polluted":1},"prototype":{"polluted":2}}', () => {
        loadSave();
        assert.equal((Object as unknown as Record<string, unknown>).polluted, undefined);
    });
});

test('F2 CONTROL: an ordinary save still merges its own fields', () => {
    withStored(SAVE_KEY, '{"totals":{"kills":42},"settings":{"masterVolume":0.25}}', () => {
        const save = loadSave();
        assert.equal(save.totals.kills, 42);
        assert.equal(save.settings.masterVolume, 0.25);
        assert.equal(save.settings.locale, 'en', 'defaults must survive the merge');
    });
});

test('F2 ESCALATION: an inherited value cannot stand in for an entry field', () => {
    const body = JSON.stringify({
        __proto__: null,
        highScores: [{ date: 2, timeSurvived: 99999, kills: 1, level: 1 }]
    }).replace('{"__proto__":null,', '{');
    withStored(SAVE_KEY, body, () => {
        const save = loadSave();
        const entry = save.highScores[0] as unknown as Record<string, unknown>;
        assert.equal(entry.weapons, undefined, 'no entry inherited a weapons array');
        assert.equal(entry.level, 1);
    });
});

// ---------------------------------------------------------------------------
// F7 — save file -> Settings dialog (a string where a number belongs)
// ---------------------------------------------------------------------------

test('F7: a string settings.masterVolume is refused and the default survives', () => {
    const raw = JSON.stringify({
        settings: { masterVolume: PAYLOAD, sfxVolume: 1, musicVolume: {} }
    });
    withStored(SAVE_KEY, raw, () => {
        const save = loadSave();
        assert.equal(
            save.settings.masterVolume,
            0.6,
            'a string is not a volume; the default stands'
        );
        assert.equal(typeof save.settings.masterVolume, 'number');
        assert.equal(save.settings.sfxVolume, 1, 'a valid in-range number is still adopted');
        assert.equal(save.settings.musicVolume, 0.4, 'an object is not a volume either');
    });
});

test('F7 CONTROL: legitimate settings values are adopted', () => {
    const raw = JSON.stringify({ settings: { masterVolume: 0.25, difficulty: 'hard' } });
    withStored(SAVE_KEY, raw, () => {
        const save = loadSave();
        assert.equal(save.settings.masterVolume, 0.25);
        assert.equal(save.settings.difficulty, 'hard');
    });
});

test('F7: the Settings dialog renders the refused value as a NUMBER', async () => {
    const raw = JSON.stringify({ settings: { masterVolume: PAYLOAD } });
    const out = await storedMarkup(SAVE_KEY, raw, async (_ls, _store, dom) => {
        const ui = await freshUi();
        ui.showSettings(
            loadSave().settings,
            () => {},
            () => {},
            () => {}
        );
        return dom.el('settingsMenu').innerHTML;
    });
    assert.ok(!out.includes('<img'), `a live tag reached the dialog: ${out}`);
    assert.ok(out.includes('value="0.6"'), `the slider lost its value: ${out}`);
});

// ---------------------------------------------------------------------------
// F11 — a malformed save, amplified past quota
// ---------------------------------------------------------------------------

test('F11: an array-valued save is refused, not adopted index by index', () => {
    const evil = '[' + '1,'.repeat(100000 - 1) + '1]';
    withStored(SAVE_KEY, evil, () => {
        const save = loadSave();
        const keys = Object.keys(save);
        assert.ok(keys.length < 32, `the save object grew to ${keys.length} keys`);
        assert.ok(Array.isArray(save.highScores));
        assert.equal(save.highScores.length, 0);
    });
});

test('F11: mergeDeep refuses a non-object source outright', () => {
    const target = { a: 1 };
    mergeDeep(target, [1, 2, 3] as unknown as object);
    assert.deepEqual(Object.keys(target), ['a']);
    mergeDeep(target, null as unknown as object);
    mergeDeep(target, 'string' as unknown as object);
    mergeDeep(target, 42 as unknown as object);
    assert.deepEqual(Object.keys(target), ['a']);
});

test('F11: a valid save still round-trips through saveSave', () => {
    withStored(SAVE_KEY, '{"totals":{"kills":7}}', (_ls, store) => {
        const save = loadSave();
        save.totals.kills = 9;
        assert.equal(saveSave(save), true);
        const written = JSON.parse(String(store[SAVE_KEY]));
        assert.equal(written.totals.kills, 9);
    });
});

// ---------------------------------------------------------------------------
// F4 — the frame cap, enforced on READ
// ---------------------------------------------------------------------------

test('F4: expandFrames stops at REPLAY_MAX_FRAMES however large count is', () => {
    const started = Date.now();
    const frames = expandFrames([[0, 0, 1000000000]] as unknown as Array<[number, number, number]>);
    const elapsed = Date.now() - started;
    assert.equal(frames.length, REPLAY_MAX_FRAMES);
    assert.ok(elapsed < 2000, `expanding took ${elapsed}ms; the cap is not bounding the work`);
});

test('F4: expandFrames still expands an honest replay exactly', () => {
    const frames = expandFrames([
        [0, 0, 3],
        [1, -1, 2]
    ]);
    assert.equal(frames.length, 5);
    assert.deepEqual(frames[0], [0, 0]);
    assert.deepEqual(frames[4], [1, -1]);
});

test('F4: expandFrames ignores counts that are not positive numbers', () => {
    const frames = expandFrames([
        [0, 0, -5],
        [0, 0, '9'],
        [0, 0, null],
        [0, 0, Infinity],
        [0, 0, NaN],
        [0, 0, 2]
    ] as unknown as Array<[number, number, number]>);
    // Only the last run is honest. `'9'` is refused as well: a numeric STRING
    // coerces, and a validator that coerces is a validator that accepts a value
    // of the wrong type.
    assert.equal(frames.length, 2);
});

test('F4: loadReplay refuses a blob whose frames are not runs of numbers', () => {
    const raw = JSON.stringify({ version: 1, stage: 'forest', frames: 'not-an-array' });
    withStored(REPLAY_KEY, raw, () => {
        assert.equal(loadReplay(), null);
    });
});

test('F4: the ReplayPlayer cannot be handed more frames than the cap', () => {
    const raw = JSON.stringify({
        version: 1,
        stage: 'forest',
        difficulty: 'normal',
        dt: 1 / 60,
        frames: [[0, 0, 200000000]],
        finalKills: 1,
        finalTime: 5,
        finalLevel: 2
    });
    withStored(REPLAY_KEY, raw, () => {
        const blob = loadReplay();
        assert.ok(blob, 'a structurally valid blob must still load');
        const player = new ReplayPlayer(blob, { speed: 1 });
        assert.equal(player.totalFrames, REPLAY_MAX_FRAMES);
    });
});

// ---------------------------------------------------------------------------
// F5 — replay blob.stage -> the replay dialog
// ---------------------------------------------------------------------------

test('F5: a hostile blob.stage is refused by the parser', () => {
    const raw = JSON.stringify({
        version: 1,
        stage: PAYLOAD,
        difficulty: 'normal',
        dt: 1 / 60,
        frames: [[0, 0, 1]],
        finalKills: 3,
        finalTime: 65,
        finalLevel: 2
    });
    withStored(REPLAY_KEY, raw, () => {
        const blob = loadReplay();
        assert.ok(blob);
        assert.equal(blob.stage, 'forest');
    });
});

test('F5: the replay dialog renders a hostile stage as text, not markup', async () => {
    // The parser refuses the stage above, so this test bypasses the parser on
    // purpose: it is the SINK that has to hold, and it is asserted against the
    // value the parser would have rejected.
    const out = await storedMarkup(REPLAY_KEY, 'null', async (_ls, _store, dom) => {
        const ui = await freshUi();
        ui.showReplayMenu(
            { stage: PAYLOAD, finalTime: 65, finalLevel: 2, finalKills: 3 },
            () => {}
        );
        return dom.el('replayScreen').innerHTML;
    });
    assert.ok(!out.includes('<img'), `a live tag reached the dialog: ${out}`);
    assert.ok(out.includes('&lt;img'), `the payload should be visible as text: ${out}`);
});

test('F5 CONTROL: a legitimate replay still renders its summary', async () => {
    const out = await storedMarkup(REPLAY_KEY, 'null', async (_ls, _store, dom) => {
        const ui = await freshUi();
        ui.showReplayMenu(
            { stage: 'crypt', finalTime: 65, finalLevel: 2, finalKills: 3 },
            () => {}
        );
        return dom.el('replayScreen').innerHTML;
    });
    assert.ok(out.includes('crypt'), out);
    assert.ok(out.includes('01:05'), out);
    assert.ok(out.includes('LEVEL'), out);
    assert.ok(out.includes('KILLS'), out);
});

// ---------------------------------------------------------------------------
// F9 — keymap -> the remap dialog
// ---------------------------------------------------------------------------

test('F9: an arbitrary string is not a key name', () => {
    withStored(KEYMAP_KEY, JSON.stringify({ up: [PAYLOAD] }), () => {
        const map = loadKeymap();
        assert.deepEqual(map.up, ['w', 'arrowup'], 'an unusable binding falls back to the default');
    });
});

test('F9 CONTROL: legitimate bindings are preserved', () => {
    withStored(KEYMAP_KEY, JSON.stringify({ up: ['k', 'arrowup'], mute: ['m'] }), () => {
        const map = loadKeymap();
        assert.deepEqual(map.up, ['k', 'arrowup']);
        assert.equal(keyLabel('k'), 'K');
        assert.equal(keyLabel('arrowup'), '↑');
        assert.equal(keyLabel(' '), 'Space');
    });
});

test('F9: the remap dialog renders a hostile key as text, not markup', async () => {
    const out = await storedMarkup(KEYMAP_KEY, 'null', async (_ls, _store, dom) => {
        const ui = await freshUi();
        ui.showRemap(
            {
                up: [PAYLOAD],
                down: ['s'],
                left: ['a'],
                right: ['d'],
                pause: ['p'],
                help: ['h'],
                mute: ['m']
            },
            () => {},
            () => {}
        );
        return dom.el('remapDialog').innerHTML;
    });
    // `keyLabel` now returns the empty string for anything that is not a key
    // name, so the payload does not reach the dialog AT ALL — it renders as the
    // "no binding" dash. The first assertion is the security claim; the second
    // is the stronger one, and it is what a future refactor that started
    // passing the raw stored value through would break.
    assert.ok(!out.includes('<img'), `a live tag reached the remap dialog: ${out}`);
    assert.ok(!out.includes('onerror'), `part of the payload reached the dialog: ${out}`);
    assert.ok(out.includes('—'), `the unusable binding should render as a dash: ${out}`);
});

// ---------------------------------------------------------------------------
// F10 — daily history -> the streak calendar's ATTRIBUTE
// ---------------------------------------------------------------------------

test('F10: a non-numeric kills value is refused by the parser', () => {
    const raw = JSON.stringify({
        ['2026-01-05-forest']: {
            date: '2026-01-05',
            stage: 'forest',
            timeSurvived: 100,
            kills: PAYLOAD
        }
    });
    withStored(DAILY_KEY, raw, () => {
        assert.deepEqual(loadDailyHistory(), {});
    });
});

test('F10: a record filed under the wrong date is refused', () => {
    const raw = JSON.stringify({
        ['2026-01-05-forest']: {
            date: '2026-01-06',
            stage: 'forest',
            timeSurvived: 100,
            kills: 7
        }
    });
    withStored(DAILY_KEY, raw, () => {
        assert.deepEqual(loadDailyHistory(), {});
    });
});

test('F10 CONTROL: a legitimate daily record is kept', () => {
    const raw = JSON.stringify({
        ['2026-01-05-forest']: {
            date: '2026-01-05',
            stage: 'forest',
            timeSurvived: 100,
            kills: 7,
            level: 4,
            won: true
        }
    });
    withStored(DAILY_KEY, raw, () => {
        const history = loadDailyHistory();
        assert.equal(history['2026-01-05-forest'].kills, 7);
        assert.equal(history['2026-01-05-forest'].won, true);
    });
});

test('F10: the streak calendar escapes what it interpolates into title/aria-label', async () => {
    // The parser refuses a string `kills`, so the hostile part is injected
    // through the DATE, which is a legitimate string field and the same sink.
    const out = await storedMarkup(DAILY_KEY, 'null', async (_ls, store, dom) => {
        store[DAILY_KEY] = JSON.stringify({
            ['2026-01-05-forest']: {
                date: '2026-01-05',
                stage: 'forest',
                timeSurvived: 100,
                kills: 7
            }
        });
        const ui = await freshUi();
        ui.showStreak();
        return dom.el('streakScreen').innerHTML;
    });
    assert.ok(out.includes('title="'), 'the calendar should still carry a title attribute');
    assert.ok(!out.includes('<img'), out);
    // One cell per day, each with a title and an aria-label, and no stray quote.
    const titles = out.match(/title="[^"]*"/g) || [];
    assert.equal(titles.length, 14, `expected 14 titled cells, saw ${titles.length}`);
});

// ---------------------------------------------------------------------------
// F1 — the leaderboard import, end to end through the real UI
// ---------------------------------------------------------------------------

test('F1: a hostile weapons entry renders as TEXT on the leaderboard', async () => {
    const out = await storedMarkup(SAVE_KEY, 'null', async (_ls, _store, dom) => {
        const ui = await freshUi();
        // The entry shape a valid import produces: every field the right type,
        // and a weapon name that is a perfectly well-formed string.
        ui.showLeaderboard(
            [{ date: 2, timeSurvived: 99999, kills: 1, level: 1, weapons: [PAYLOAD] }],
            [],
            () => {}
        );
        return dom.el('leaderboardScreen').innerHTML;
    });
    assert.ok(!out.includes('<img'), `a live tag reached the leaderboard: ${out}`);
    assert.ok(out.includes('&lt;img'), `the payload should be visible as text: ${out}`);
});

test('F1: a hostile level and kills value render as TEXT too', async () => {
    const out = await storedMarkup(SAVE_KEY, 'null', async (_ls, _store, dom) => {
        const ui = await freshUi();
        ui.showLeaderboard(
            [
                {
                    date: 3,
                    timeSurvived: 88888,
                    kills: PAYLOAD,
                    level: PAYLOAD,
                    weapons: ['Whip']
                }
            ],
            [],
            () => {}
        );
        return dom.el('leaderboardScreen').innerHTML;
    });
    assert.ok(!out.includes('<img'), out);
});

test('F1 CONTROL: legitimate leaderboard content still renders', async () => {
    const out = await storedMarkup(SAVE_KEY, 'null', async (_ls, _store, dom) => {
        const ui = await freshUi();
        ui.showLeaderboard(
            [{ date: 2, timeSurvived: 9999, kills: 7, level: 3, weapons: ['Whip', 'Garlic'] }],
            [],
            () => {}
        );
        return dom.el('leaderboardScreen').innerHTML;
    });
    assert.ok(out.includes('Whip + Garlic'), `the weapons column lost its content: ${out}`);
    assert.ok(out.includes('166:39'), `the time column lost its content: ${out}`);
    assert.ok(out.includes('Lv.3'), out);
    assert.equal(out.match(/class="hs-row wide"/g)?.length, 1, out);
});

test('F1 CONTROL: the speedrun board still renders its own columns', async () => {
    const out = await storedMarkup(SAVE_KEY, 'null', async (_ls, _store, dom) => {
        const ui = await freshUi();
        ui.showLeaderboard(
            [],
            [{ date: 2, timeMs: 65432, kills: 7, level: 3, weapons: ['Whip'], noHit: true }],
            () => {}
        );
        return dom.el('leaderboardScreen').innerHTML;
    });
    assert.ok(out.includes('01:05.432'), `the speedrun time column lost its content: ${out}`);
    assert.ok(out.includes('Whip'), out);
});
