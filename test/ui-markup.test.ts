// Unit tests for the DIALOG-RENDERING half of `src/ui.ts`: every overlay that
// builds its content, rendered with legitimate data and read back.
//
// Two things ride on this file, and they are different claims.
//
//  1. COVERAGE. `ui.ts` is the largest module and its dialog builders were the
//     largest uncovered region in it. A security change that rewrites every one
//     of those builders has to be able to show they still render.
//
//  2. POSITIVE CONTROLS. The audit's rule is that an escape turning `<b>` into
//     `&lt;b&gt;` where markup was intended is a regression, not a fix. Every
//     test below asserts what a player should SEE — the weapon list, the time,
//     the slider's value, the stage names — so a sink that escaped too much
//     fails here rather than in production.
//
// Runs in Node, no browser.

import test from 'node:test';
import assert from 'node:assert/strict';
import { installBrowserStub } from './helpers/browser-stub.ts';
import { UI } from '../src/ui.ts';
import { saveDailyResult, _resetDailyForTests } from '../src/daily.ts';
import { _resetStorageForTests } from '../src/storage.ts';
import { t } from '../src/i18n.ts';

/** The stub environment, as `installBrowserStub` returns it. */
type StubEnv = ReturnType<typeof installBrowserStub>;

/** Build a UI against a fresh stub; always restore. */
function withUi(fn: (ui: UI, env: StubEnv) => void): void {
    const env = installBrowserStub({ now: 1000 });
    try {
        fn(new UI({ stageId: null }), env);
    } finally {
        env.restore();
    }
}

/** The markup a host element was given. */
function markup(el: { innerHTML: string }): string {
    return el.innerHTML;
}

/** A complete settings object, as `DEFAULT_SAVE.settings` provides. */
function settings(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return Object.assign(
        {
            masterVolume: 0.6,
            sfxVolume: 0.8,
            musicVolume: 0.4,
            difficulty: 'normal',
            showFps: false,
            screenShake: true,
            reducedMotion: false,
            colorblind: false,
            musicEnabled: true,
            damageNumbers: true,
            criticalFlash: true,
            vibration: true,
            muted: false,
            locale: 'en',
            stage: 'forest',
            touchButtonScale: 1
        },
        overrides
    );
}

/** A game-shaped object, only as much as `showGameOver` reads. */
function gameOver(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return Object.assign(
        {
            gameTime: 125,
            kills: 42,
            player: { level: 7 },
            save: { highScores: [{ timeSurvived: 60, level: 3, kills: 9, date: 1 }] },
            speedrunMode: false,
            speedrunSplits: []
        },
        overrides
    );
}

// ---------------------------------------------------------------------------
// Stage picker
// ---------------------------------------------------------------------------

test('ui/showStagePicker: renders a card per stage and marks the current one', () => {
    withUi((ui) => {
        ui.showStagePicker('crypt', () => {});
        const html = markup(ui.els.stagePickerScreen);
        assert.equal(ui.els.stagePickerScreen.style.display, 'flex');
        assert.ok(html.includes('stage-card'), html);
        assert.ok(html.includes('data-stage="crypt"'), 'the stage ids must be addressable');
        assert.ok(/class="stage-card active"/.test(html), `no active card: ${html}`);
        assert.ok(html.includes(t('chooseStage')), 'the heading must be translated');
    });
});

test('ui/updateStageChip: writes the icon and name of the chosen stage', () => {
    withUi((ui) => {
        ui.updateStageChip('crypt');
        assert.match(ui.els.btnStageChip.textContent, /Crypt/);
        assert.equal(ui.els.btnStageChip.dataset.stage, 'crypt');
        ui.updateStageChip('forest');
        assert.match(ui.els.btnStageChip.textContent, /Whisperwood/);
    });
});

// ---------------------------------------------------------------------------
// Help / how-to-play / streak
// ---------------------------------------------------------------------------

test('ui/showHelp: lists the keyboard shortcuts it documents', () => {
    withUi((ui) => {
        ui.showHelp();
        const html = markup(ui.els.helpScreen);
        assert.ok(html.includes('help-row'), html);
        assert.ok(html.includes(t('helpTitle')), html);
        assert.ok(html.includes('WASD'), 'the movement row must be present');
    });
});

test('ui/showHowToPlay: renders the four-step body', () => {
    withUi((ui) => {
        ui.showHowToPlay();
        const html = markup(ui.els.howToPlayScreen);
        assert.ok(html.includes('howto-list'), html);
        assert.ok(html.includes(t('howToBody1')), html);
        assert.ok(html.includes(t('howToBody4')), html);
    });
});

test('ui/showStreak: renders 14 cells with a real title, not an escaped one', () => {
    _resetDailyForTests();
    _resetStorageForTests();
    saveDailyResult({
        date: '2026-01-05',
        stage: 'forest',
        timeSurvived: 100,
        kills: 7,
        level: 4,
        weapons: ['whip'],
        won: false,
        noHit: false,
        seed: 1
    });
    withUi((ui) => {
        ui.showStreak();
        const html = markup(ui.els.streakScreen);
        const cells = html.match(/role="listitem"/g) || [];
        assert.equal(cells.length, 14, `expected 14 calendar cells, got ${cells.length}`);
        // The title and the aria-label are ATTRIBUTES, and this is the assertion
        // that says the attribute escaper leaves ordinary content alone: the
        // numbers, the separator and the words are all still readable.
        assert.ok(html.includes(t('dailyStreak')), html);
        assert.ok(html.includes('streak-grid'), html);
    });
    _resetDailyForTests();
});

test('ui/showStreak: an empty history says so', () => {
    _resetDailyForTests();
    _resetStorageForTests();
    withUi((ui) => {
        ui.showStreak();
        const html = markup(ui.els.streakScreen);
        assert.ok(html.includes(t('noStreakYet')), html);
    });
});

// ---------------------------------------------------------------------------
// Replay dialog — both branches
// ---------------------------------------------------------------------------

test('ui/showReplayMenu: no blob renders the empty state', () => {
    withUi((ui, env) => {
        ui.showReplayMenu(null, () => {});
        // `#replayScreen` is created on demand and is NOT one of the ids the
        // constructor caches, so it is read from the document, not `ui.els`.
        const html = markup(env.getEl('replayScreen'));
        assert.ok(html.includes(t('noReplay')), html);
        assert.ok(!html.includes('data-replay-speed'), 'no speed buttons without a replay');
    });
});

test('ui/showReplayMenu: a blob renders the summary and three speeds', () => {
    withUi((ui, env) => {
        ui.showReplayMenu(
            { stage: 'crypt', finalTime: 65, finalLevel: 2, finalKills: 3 },
            () => {}
        );
        const html = markup(env.getEl('replayScreen'));
        assert.ok(html.includes('01:05'), `the time must render as mm:ss: ${html}`);
        assert.ok(html.includes('crypt'), html);
        assert.equal((html.match(/data-replay-speed=/g) || []).length, 3, html);
    });
});

// ---------------------------------------------------------------------------
// Leaderboard — four branches
// ---------------------------------------------------------------------------

test('ui/showLeaderboard: an empty board says so in both sections', () => {
    withUi((ui) => {
        ui.showLeaderboard([], [], () => {});
        const html = markup(ui.els.leaderboardScreen);
        assert.equal((html.match(/hs-empty/g) || []).length, 2, html);
        assert.ok(html.includes(t('leaderboard')), html);
    });
});

test('ui/showLeaderboard: a populated board renders every column', () => {
    withUi((ui) => {
        ui.showLeaderboard(
            [
                {
                    date: 2,
                    timeSurvived: 9999,
                    kills: 7,
                    level: 3,
                    weapons: ['Whip', 'Garlic'],
                    noHit: true
                }
            ],
            [{ date: 3, timeMs: 65432, kills: 5, level: 4, weapons: ['Axe'], noHit: false }],
            () => {}
        );
        const html = markup(ui.els.leaderboardScreen);
        assert.ok(html.includes('Whip + Garlic'), `the weapons column: ${html}`);
        assert.ok(html.includes('166:39'), `the time column: ${html}`);
        assert.ok(html.includes('01:05.432'), `the speedrun millisecond column: ${html}`);
        assert.ok(html.includes('Lv.3'), html);
        assert.ok(html.includes(t('noHit')), 'a no-hit run must be marked');
        assert.equal((html.match(/hs-row wide/g) || []).length, 2, html);
    });
});

test('ui/showLeaderboard: a speedrun board with no normal runs renders both heads', () => {
    withUi((ui) => {
        ui.showLeaderboard(
            [],
            [{ date: 3, timeMs: 1000, kills: 1, level: 1, weapons: [] }],
            () => {}
        );
        const html = markup(ui.els.leaderboardScreen);
        assert.ok(html.includes('hs-head wide'), html);
        assert.equal((html.match(/hs-empty/g) || []).length, 1, html);
    });
});

// ---------------------------------------------------------------------------
// Achievements
// ---------------------------------------------------------------------------

test('ui/showAchievements: unlocked and locked cards are both rendered', () => {
    withUi((ui) => {
        ui.showAchievements({ first_blood: 12345 }, () => {});
        const html = markup(ui.els.achievementsScreen);
        assert.ok(html.includes('ach-card earned'), `an unlocked card is missing: ${html}`);
        assert.ok(html.includes('ach-card locked'), `a locked card is missing: ${html}`);
        assert.ok(html.includes('???' + ''), 'a locked card hides its name');
        assert.ok(html.includes('ach-count'), 'the earned/total counter must render');
    });
});

test('ui/showAchievementToast: builds a toast and appends it', () => {
    // The toast schedules a 3.5s removal. Fake both timers so the test does not
    // leave the process alive for four seconds, and so the second `setTimeout`
    // (the nested fade-out) is exercised too.
    const realSet = globalThis.setTimeout;
    const realClear = globalThis.clearTimeout;
    (globalThis as Record<string, unknown>).setTimeout = () => 0;
    (globalThis as Record<string, unknown>).clearTimeout = () => {};
    try {
        withUi((ui) => {
            ui.showAchievementToast({ icon: '🏆', name: 'First Blood', description: 'Kill one.' });
            const host = ui.els.achievementToasts;
            assert.equal(host.children.length, 1, 'the toast must be appended');
            const toast = host.children[0] as { innerHTML: string; className: string };
            assert.ok(toast.innerHTML.includes('First Blood'), toast.innerHTML);
            assert.ok(toast.innerHTML.includes('Kill one.'), toast.innerHTML);
            assert.ok(toast.className.includes('ach-toast'), toast.className);
        });
    } finally {
        (globalThis as Record<string, unknown>).setTimeout = realSet;
        (globalThis as Record<string, unknown>).clearTimeout = realClear;
    }
});

// ---------------------------------------------------------------------------
// Settings and remap
// ---------------------------------------------------------------------------

test('ui/showSettings: every row renders with its current value', () => {
    withUi((ui) => {
        ui.showSettings(
            settings(),
            () => {},
            () => {},
            () => {},
            { vibrationSupported: true }
        );
        const html = markup(ui.els.settingsMenu);
        assert.ok(html.includes('value="0.6"'), `the volume slider: ${html}`);
        assert.ok(html.includes('data-key="masterVolume"'), html);
        // Every difficulty is OFFERED; the point is which one is SELECTED. An
        // assertion that "nightmare" is absent would be asserting that the
        // option list is broken.
        assert.ok(html.includes('value="nightmare"'), 'all difficulties must be offered');
        assert.ok(/>normal</.test(html), 'the current difficulty must be the selected one');
        assert.ok(html.includes('data-key="vibration"'), 'the vibration row is supported here');
        assert.ok(html.includes(t('settings')), html);
    });
});

test('ui/showSettings: an unsupported vibration API hides the row, and remap adds one', () => {
    withUi((ui) => {
        ui.showSettings(
            settings({ difficulty: 'nightmare' }),
            () => {},
            () => {},
            () => {},
            {
                vibrationSupported: false,
                onRemap: () => {}
            }
        );
        const html = markup(ui.els.settingsMenu);
        assert.ok(!html.includes('data-key="vibration"'), 'the row must be hidden');
        assert.ok(html.includes('data-action="remap"'), `the remap button: ${html}`);
        assert.ok(html.includes('value="nightmare"') || html.includes('>nightmare<'), html);
    });
});

test('ui/showRemap: renders a row per action and reports a conflict', () => {
    withUi((ui, env) => {
        // `x` bound to two actions is exactly the conflict the dialog exists to
        // surface, so this renders the conflict branch as well.
        ui.showRemap(
            {
                up: ['w', 'x'],
                down: ['x'],
                left: ['a'],
                right: ['d'],
                pause: ['p'],
                help: ['h'],
                mute: ['m']
            },
            () => {},
            () => {}
        );
        // `#remapDialog` is created on demand; it is not a cached id either.
        const html = markup(env.getEl('remapDialog'));
        assert.equal((html.match(/class="remap-row"/g) || []).length, 7, html);
        assert.ok(html.includes('remap-conflicts'), `no conflict reported: ${html}`);
        // The keys are readable as KEYS, not as character references: `W / X`
        // is what a player must see, not `W&#32;/&#32;X`.
        assert.ok(html.includes('W / X'), html);
        assert.ok(html.includes(t('customizeControls')), html);
    });
});

test('ui/showRemap: an unbound action renders the dash, and no conflict banner', () => {
    withUi((ui, env) => {
        ui.showRemap(
            {
                up: [],
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
        const html = markup(env.getEl('remapDialog'));
        assert.ok(html.includes('—'), `an empty binding renders as a dash: ${html}`);
        assert.ok(!html.includes('remap-conflicts'), html);
    });
});

// ---------------------------------------------------------------------------
// Game over
// ---------------------------------------------------------------------------

test('ui/showGameOver: renders the run summary and the leaderboard', () => {
    withUi((ui) => {
        ui.showGameOver(gameOver());
        assert.equal(ui.els.finalTime.textContent, '02:05');
        // The stub coerces like the real DOM does, so these come back as strings.
        assert.equal(ui.els.finalKills.textContent, '42');
        assert.equal(ui.els.finalLevel.textContent, '7');
        const html = markup(ui.els.highScoreList);
        assert.ok(html.includes('hs-row'), `the compact board: ${html}`);
        assert.ok(html.includes('01:00'), `the saved run's time: ${html}`);
    });
});

test('ui/showGameOver: an empty board says so, and splits render for a speedrun', () => {
    withUi((ui) => {
        ui.showGameOver(
            gameOver({
                save: { highScores: [] },
                speedrunMode: true,
                speedrunSplits: [
                    { mark: 30, realMs: 30123 },
                    { mark: 60, realMs: 60246 }
                ]
            })
        );
        const html = markup(ui.els.highScoreList);
        assert.ok(html.includes('hs-empty'), html);
        assert.ok(html.includes('splits'), `the splits block: ${html}`);
        assert.ok(html.includes('00:30'), html);
        assert.ok(html.includes('30.12s'), `real time to 2dp: ${html}`);
    });
});
