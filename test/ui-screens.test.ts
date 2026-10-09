// Unit tests for the screen-building half of src/ui.ts.
//
// ui.ts is the largest remaining coverage gap. The existing a11y tests cover
// `_applyDialogAria` and `_renderChips`; this file covers the per-frame HUD
// update and the overlay show/hide contract.
//
// `updateHud` runs every single frame, which makes it the most-executed code in
// the module, and it is pure string formatting over game state — exactly the
// kind of thing that is silently wrong for months (a bar that reads 120%, a
// timer that shows "3:7" instead of "03:07").
//
// Runs in Node, no DOM.

import test from 'node:test';
import assert from 'node:assert/strict';
import { installBrowserStub } from './helpers/browser-stub.ts';
import { UI } from '../src/ui.ts';
import { CONFIG } from '../src/config.ts';

/** Build a UI against a fresh stub; always restore. */
function withUi(fn, { now = 1000 } = {}) {
    const env = installBrowserStub({ now });
    try {
        return fn(new UI({ stageId: null }), env);
    } finally {
        env.restore();
    }
}

/** Capture setTimeout/clearTimeout so banner timers can be driven by hand. */
function withFakeTimers(fn) {
    const realSet = globalThis.setTimeout;
    const realClear = globalThis.clearTimeout;
    let nextId = 1;
    const pending = new Map(); // id -> { cb, ms }
    const cleared = [];

    (globalThis as any).setTimeout = (cb, ms) => {
        const id = nextId++;
        pending.set(id, { cb, ms });
        return id;
    };
    // Cancellation must actually cancel, or a test can "prove" a cleared timer
    // fires and the stub lies about the behaviour it is meant to model.
    (globalThis as any).clearTimeout = (id) => {
        cleared.push(id);
        pending.delete(id);
    };

    try {
        return fn({
            pending,
            cleared,
            /** Run every timer that is still pending. */
            flush() {
                const batch = [...pending.entries()];
                pending.clear();
                for (const [, t] of batch) t.cb();
                return batch;
            }
        });
    } finally {
        (globalThis as any).setTimeout = realSet;
        (globalThis as any).clearTimeout = realClear;
    }
}

/** The subset of Game that updateHud reads. */
function makeGame(overrides = {}) {
    return {
        player: {
            hp: 100,
            maxHp: 100,
            level: 1,
            exp: 0,
            expToNext: 50,
            weapons: [],
            passives: {}
        },
        gameTime: 0,
        kills: 0,
        currentWave: null,
        save: { highScore: { timeSurvived: 0, kills: 0 } },
        ...overrides
    };
}

// ---------------------------------------------------------------------------
// updateHud — runs every frame
// ---------------------------------------------------------------------------

test('ui/updateHud: writes health rounded up, so 1hp never reads as 0', () => {
    withUi((ui) => {
        ui.updateHud(makeGame({ player: { ...makeGame().player, hp: 0.4, maxHp: 100 } }));
        assert.equal(ui.els.hp.textContent, '1', 'a living player must not display 0 health');
        assert.equal(ui.els.maxHp.textContent, '100');
    });
});

test('ui/updateHud: the health bar is a percentage of the maximum', () => {
    withUi((ui) => {
        ui.updateHud(makeGame({ player: { ...makeGame().player, hp: 25, maxHp: 100 } }));
        assert.equal(ui.els.hpBar.style.width, '25%');
    });
});

test('ui/updateHud: the health bar never goes negative', () => {
    // Damage can overshoot; a negative width would render as nothing at best
    // and an invalid CSS value at worst.
    withUi((ui) => {
        ui.updateHud(makeGame({ player: { ...makeGame().player, hp: -50, maxHp: 100 } }));
        assert.equal(ui.els.hpBar.style.width, '0%');
    });
});

test('ui/updateHud: the experience bar is capped at 100%', () => {
    withUi((ui) => {
        ui.updateHud(makeGame({ player: { ...makeGame().player, exp: 500, expToNext: 50 } }));
        assert.equal(ui.els.expBar.style.width, '100%', 'overshoot must not overflow the bar');
    });
});

test('ui/updateHud: the timer is zero-padded minutes and seconds', () => {
    withUi((ui) => {
        ui.updateHud(makeGame({ gameTime: 67 }));
        assert.equal(ui.els.time.textContent, '01:07', 'not "1:7"');

        ui.updateHud(makeGame({ gameTime: 0 }));
        assert.equal(ui.els.time.textContent, '00:00');

        ui.updateHud(makeGame({ gameTime: 3599 }));
        assert.equal(ui.els.time.textContent, '59:59');
    });
});

test('ui/updateHud: the timer floors fractional seconds rather than rounding', () => {
    withUi((ui) => {
        ui.updateHud(makeGame({ gameTime: 59.9 }));
        assert.equal(
            ui.els.time.textContent,
            '00:59',
            'a run must not appear to end a second early'
        );
    });
});

test('ui/updateHud: kills and level are written straight through', () => {
    withUi((ui) => {
        ui.updateHud(makeGame({ kills: 1234, player: { ...makeGame().player, level: 17 } }));
        assert.equal(ui.els.kills.textContent, '1234');
        assert.equal(ui.els.level.textContent, '17');
    });
});

test('ui/updateHud: the high score shows a padded time and the kill count', () => {
    withUi((ui) => {
        ui.updateHud(makeGame({ save: { highScore: { timeSurvived: 125, kills: 42 } } }));
        assert.match(ui.els.highScore.textContent, /02:05/, 'the best time must be padded');
        assert.match(ui.els.highScore.textContent, /42K/, 'and the kill count shown');
    });
});

test('ui/updateHud: the wave label appears only when there is a wave', () => {
    withUi((ui) => {
        const before = ui.els.waveLabel.textContent;
        ui.updateHud(makeGame({ currentWave: null }));
        assert.equal(ui.els.waveLabel.textContent, before, 'no wave, no label change');

        ui.updateHud(makeGame({ currentWave: { label: 'Horde' } }));
        assert.match(ui.els.waveLabel.textContent, /Horde/);
    });
});

test('ui/updateHud: weapon chips carry icon, level and the max-level flag', () => {
    withUi((ui) => {
        ui.updateHud(
            makeGame({
                player: {
                    ...makeGame().player,
                    weapons: [
                        { icon: 'W', level: 3, isEvolved: () => false },
                        { icon: 'X', level: CONFIG.WEAPON_MAX_LEVEL, isEvolved: () => true }
                    ]
                }
            })
        );
        const chips = ui.els.weaponIcons.children;
        assert.equal(chips.length, 2, 'one chip per weapon');
        assert.equal(chips[0].getAttribute('role'), 'listitem');
        assert.ok(chips[1]._classes.has('maxed'), 'a maxed weapon must be flagged');
        assert.ok(chips[1]._classes.has('evolved'), 'and an evolved one too');
    });
});

test('ui/updateHud: passive chips are rendered from the passive map', () => {
    withUi((ui) => {
        ui.updateHud(
            makeGame({
                player: {
                    ...makeGame().player,
                    passives: { armor: { def: { icon: 'A' }, count: 4 } }
                }
            })
        );
        const chips = ui.els.passiveIcons.children;
        assert.equal(chips.length, 1);
        assert.equal(chips[0].textContent, 'A');
    });
});

test('ui/updateHud: an empty loadout renders no chips', () => {
    withUi((ui) => {
        ui.updateHud(makeGame());
        assert.equal(ui.els.weaponIcons.children.length, 0);
        assert.equal(ui.els.passiveIcons.children.length, 0);
    });
});

// ---------------------------------------------------------------------------
// FPS counter
// ---------------------------------------------------------------------------

test('ui/setFps: rounds the reading and toggles visibility', () => {
    withUi((ui) => {
        ui.setFps(59.6, true);
        assert.equal(ui.els.fpsCounter.textContent, '60 fps');
        assert.equal(ui.els.fpsCounter.style.display, 'block');

        ui.setFps(30, false);
        assert.equal(ui.els.fpsCounter.style.display, 'none');
        assert.equal(ui.els.fpsCounter.textContent, '30 fps', 'the text is written either way');
    });
});

// ---------------------------------------------------------------------------
// pause / boss banner
// ---------------------------------------------------------------------------

test('ui/pause: shows and hides the pause menu', () => {
    withUi((ui) => {
        ui.showPause();
        assert.equal(ui.els.pauseMenu.style.display, 'flex');
        ui.hidePause();
        assert.equal(ui.els.pauseMenu.style.display, 'none');
    });
});

test('ui/bossBanner: shows the warning, then hides itself on a timer', () => {
    withUi((ui) => {
        withFakeTimers((timers) => {
            ui.showBossBanner();

            assert.ok(ui.els.bossBanner.textContent.length > 0, 'the banner needs a label');
            assert.ok(ui.els.bossBanner._classes.has('visible'), 'and must become visible');
            assert.equal(ui._activeBannerKey, 'bossIncoming');
            assert.equal(timers.pending.size, 1, 'a hide timer must be scheduled');

            timers.flush();
            assert.ok(!ui.els.bossBanner._classes.has('visible'), 'and it must hide again');
            assert.equal(ui._activeBannerKey, null, 'clearing the key stops re-translation');
        });
    });
});

test('ui/bossBanner: re-showing cancels the previous hide timer', () => {
    // Without this, a second boss warning would be hidden early by the first
    // warning's timer, so the banner would flash off at the wrong moment.
    withUi((ui) => {
        withFakeTimers((timers) => {
            ui.showBossBanner();
            const firstId = [...timers.pending.keys()][0];

            ui.showBossBanner();

            assert.ok(timers.cleared.includes(firstId), 'the stale timer must be cancelled');
            assert.equal(timers.pending.size, 1, 'and exactly one timer must remain');

            timers.flush();
            assert.ok(!ui.els.bossBanner._classes.has('visible'), 'which still hides the banner');
        });
    });
});

// ---------------------------------------------------------------------------
// level-up menu
// ---------------------------------------------------------------------------

test('ui/levelUp: renders a full set of choices and opens the menu', () => {
    withUi((ui) => {
        const player = { hp: 50, maxHp: 100, weapons: [], passives: {} };
        const picks = [];
        ui.showLevelUp(player, (choice) => picks.push(choice));

        assert.equal(ui.els.levelUpMenu.style.display, 'flex');
        const options = ui.els.upgradeOptions.children;
        assert.equal(options.length, 3, 'three choices is the design');
        for (const opt of options) {
            assert.equal(opt.getAttribute('role'), 'menuitem', 'each choice is a menu item');
            assert.ok(opt.getAttribute('aria-label'), 'and carries a readable label');
            assert.equal(opt.getAttribute('tabindex'), '0', 'and is keyboard reachable');
        }
    });
});

test('ui/levelUp: a brand-new upgrade is labelled as new', () => {
    withUi((ui) => {
        const player = { hp: 50, maxHp: 100, weapons: [], passives: {} };
        ui.showLevelUp(player, () => {});
        const labels = ui.els.upgradeOptions.children.map((c) => c.getAttribute('aria-label'));
        assert.ok(
            labels.some((l) => l.includes('(New!)')),
            `an untouched upgrade must say New!, got: ${labels[0]}`
        );
    });
});

test('ui/levelUp: choosing an option reports it back to the caller', () => {
    withUi((ui) => {
        const player = { hp: 50, maxHp: 100, weapons: [], passives: {} };
        const picks = [];
        ui.showLevelUp(player, (choice) => picks.push(choice));

        const first = ui.els.upgradeOptions.children[0];
        first._listeners.click.forEach((fn) => fn());

        assert.equal(picks.length, 1, 'the click handler must fire the callback');
        assert.ok(picks[0], 'and hand back the chosen upgrade');
    });
});

test('ui/levelUp: Enter and Space choose an option, and are prevented from scrolling', () => {
    withUi((ui) => {
        const player = { hp: 50, maxHp: 100, weapons: [], passives: {} };
        const picks = [];
        ui.showLevelUp(player, (choice) => picks.push(choice));
        const first = ui.els.upgradeOptions.children[0];

        for (const key of ['Enter', ' ']) {
            let prevented = false;
            first._listeners.keydown.forEach((fn) =>
                fn({ key, preventDefault: () => (prevented = true) })
            );
            assert.ok(prevented, `${key} must not scroll the page`);
        }
        assert.equal(picks.length, 2);
    });
});

test('ui/levelUp: arrow keys move focus without choosing', () => {
    withUi((ui) => {
        const player = { hp: 50, maxHp: 100, weapons: [], passives: {} };
        const picks = [];
        ui.showLevelUp(player, (choice) => picks.push(choice));
        const first = ui.els.upgradeOptions.children[0];

        first._listeners.keydown.forEach((fn) =>
            fn({ key: 'ArrowDown', preventDefault: () => {} })
        );
        assert.equal(picks.length, 0, 'moving the selection must not pick anything');
    });
});

test('ui/hideLevelUp: closes the menu', () => {
    withUi((ui) => {
        const player = { hp: 50, maxHp: 100, weapons: [], passives: {} };
        ui.showLevelUp(player, () => {});
        ui.hideLevelUp();
        assert.equal(ui.els.levelUpMenu.style.display, 'none');
    });
});

// ---------------------------------------------------------------------------
// overlay show/hide contract
// ---------------------------------------------------------------------------

test('ui/overlays: every hide method actually hides its overlay', () => {
    // The hide/show pairs are mechanical, which is exactly why a copy-paste
    // slip (hiding the wrong element) would go unnoticed.
    withUi((ui) => {
        const pairs = [
            ['hideStagePicker', 'stagePickerScreen'],
            ['hideStreak', 'streakScreen'],
            ['hideHelp', 'helpScreen'],
            ['hideHowToPlay', 'howToPlayScreen'],
            ['hideLeaderboard', 'leaderboardScreen'],
            ['hideAchievements', 'achievementsScreen'],
            ['hideSettings', 'settingsMenu'],
            ['hideGameOver', 'gameOver'],
            ['hideStart', 'startScreen']
        ];
        for (const [method, id] of pairs) {
            ui.els[id].style.display = 'flex';
            ui[method]();
            assert.equal(ui.els[id].style.display, 'none', `${method}() must hide #${id}`);
            assert.equal(typeof ui[method], 'function', `${method} must exist`);
        }
    });
});

test('ui/overlays: showStart restores the menu', () => {
    withUi((ui) => {
        ui.showStart();
        assert.equal(ui.els.startScreen.style.display, 'flex');
    });
});

test('ui/onLocaleChanged: refreshes the boss banner only while it is showing', () => {
    withUi((ui) => {
        // No banner active: nothing to refresh, and nothing must throw.
        ui._activeBannerKey = null;
        assert.doesNotThrow(() => ui.onLocaleChanged());

        // Banner active: the text must be rewritten in the new locale.
        ui._activeBannerKey = 'bossIncoming';
        ui.els.bossBanner.textContent = 'stale';
        ui.onLocaleChanged();
        assert.notEqual(ui.els.bossBanner.textContent, 'stale');
    });
});
