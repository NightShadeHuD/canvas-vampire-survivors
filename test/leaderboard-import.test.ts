// The leaderboard IMPORT path, driven through the real `Game`.
//
// F1 is the only audit finding with a genuine cross-player delivery route: the
// game ships a "share this JSON" button, so anyone can hand anyone a payload
// and the Import box merges it into the save. The browser probe proves the
// payload no longer executes; this proves the same thing at the unit level, on
// the code path that does the merging, so `npm test` covers it too.
//
// Runs in Node, no browser.

import test from 'node:test';
import assert from 'node:assert/strict';
import { installBrowserStub } from './helpers/browser-stub.ts';
import { _resetSpeedrunForTests, _resetStorageForTests, resetSave } from '../src/storage.ts';
import { _resetReplayForTests } from '../src/replay.ts';

const SAVE_KEY = 'vs_clone_save_v2';
const PAYLOAD = '<img src=x onerror="window.__pwned=1">';

/** A `Game` inside a fresh stubbed browser, with its import listener captured. */
async function withGame(
    fn: (game: Record<string, unknown>, imports: Array<(e: unknown) => void>) => void
): Promise<void> {
    const env = installBrowserStub({ now: 1000 });
    try {
        const imports: Array<(e: unknown) => void> = [];
        // The stub's `window.addEventListener` records nothing, so it is
        // replaced BEFORE the constructor runs. The handler under test is then
        // the one `_bindLeaderboardImport` really registers — not a copy of it
        // re-bound by the test, which would prove nothing about the shipped
        // path.
        const win = globalThis.window as unknown as Record<string, unknown>;
        const realAdd = win.addEventListener as (ev: string, handler: unknown) => void;
        win.addEventListener = (ev: string, handler: unknown) => {
            if (ev === 'vs-leaderboard-import') imports.push(handler as (e: unknown) => void);
            else realAdd.call(win, ev, handler);
        };
        // The storage modules cache two things across the whole process: whether
        // localStorage is usable, and the in-memory fallback. A test that made a
        // write fail sets the first to `false` and it STAYS false, so without
        // this reset the save below lands in memory instead of the store and the
        // file passes alone but fails in a single process -- which is exactly
        // what `check:isolation` reported.
        _resetStorageForTests();
        _resetSpeedrunForTests();
        _resetReplayForTests();
        resetSave();
        const { Game } = await import('../src/main.ts');
        const game = new Game() as unknown as Record<string, unknown>;
        fn(game, imports);
    } finally {
        env.restore();
    }
}

test('main/import: a well-shaped hostile entry is merged as DATA', async () => {
    await withGame((game, imports) => {
        assert.equal(imports.length, 1, 'the constructor must bind exactly one listener');
        const handler = imports[0];

        handler({
            detail: {
                normal: [
                    {
                        date: 2,
                        timeSurvived: 99999,
                        kills: 1,
                        level: 1,
                        weapons: [PAYLOAD]
                    }
                ]
            }
        });

        const save = game.save as { highScores: Array<{ weapons?: string[] }> };
        assert.equal(save.highScores.length, 1, 'a well-shaped entry is merged');
        // The weapon name IS stored — it is a perfectly valid string, and no
        // type check can tell it from "Whip". What matters is that it is data.
        assert.deepEqual(save.highScores[0].weapons, [PAYLOAD]);
    });
});

test('main/import: a malformed entry is refused before it reaches the save', async () => {
    await withGame((game, imports) => {
        const handler = imports[0];
        handler({
            detail: {
                normal: [
                    { kills: 1, level: 2, date: 3 },
                    { timeSurvived: 'soon', kills: 1, level: 2, date: 3 },
                    'not an object',
                    { timeSurvived: 500, kills: 1, level: 2, date: 3 }
                ],
                speedrun: [{ level: 1 }, { timeMs: 'fast' }]
            }
        });
        const save = game.save as { highScores: unknown[] };
        assert.equal(save.highScores.length, 1, 'only the well-formed entry is kept');
    });
});

test('main/import: a thousand-entry paste is capped', async () => {
    await withGame((game, imports) => {
        const handler = imports[0];
        const flood: Array<Record<string, unknown>> = [];
        for (let i = 0; i < 1000; i++) {
            flood.push({ date: i + 1, timeSurvived: i + 1, kills: 1, level: 1, weapons: [] });
        }
        handler({ detail: { normal: flood } });
        const save = game.save as { highScores: unknown[] };
        // 200 is the import cap and CONFIG.HIGHSCORE_SLOTS is what survives it.
        assert.ok(save.highScores.length <= 200, `grew to ${save.highScores.length}`);
    });
});

test('main/import: a rejected payload leaves the save untouched', async () => {
    await withGame((game, imports) => {
        const handler = imports[0];
        const before = JSON.stringify(game.save);
        handler({ detail: { normal: 'not an array', speedrun: null } });
        handler({ detail: null });
        handler({});
        assert.equal(JSON.stringify(game.save), before);
    });
});

test('main/import: the save the game persists is the bounded one', async () => {
    await withGame((game, imports) => {
        const handler = imports[0];
        const flood: Array<Record<string, unknown>> = [];
        for (let i = 0; i < 500; i++) {
            flood.push({ date: i + 1, timeSurvived: i + 1, kills: 1, level: 1, weapons: [] });
        }
        handler({ detail: { normal: flood, speedrun: flood } });
        const raw = String(globalThis.localStorage.getItem(SAVE_KEY));
        assert.ok(raw.length > 100, `nothing was persisted (${raw.length} bytes)`);
        assert.ok(raw.length < 100000, `the persisted save grew to ${raw.length} bytes`);
        assert.ok(raw.includes('highScores'), raw.slice(0, 120));
    });
});
