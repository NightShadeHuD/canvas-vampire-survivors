// Regression tests for the accessible names on the dynamically-populated
// dialogs (bug found by scripts/a11y-audit.mjs: axe `aria-dialog-name`, 5
// blocking violations across 4 dialogs plus the first-run overlay).
//
// These run in Node with a tiny attribute-recording DOM stub, so they are
// instant. The browser-level a11y gate remains the authority for the real
// rendered page; this is the fast guard that makes the specific regression
// impossible to reintroduce without noticing.
//
// Runs in Node, no browser.

import test from 'node:test';
import assert from 'node:assert/strict';
import { UI } from '../src/ui.ts';
import { t, setLocale } from '../src/i18n.ts';

/** The dialogs ui.ts populates dynamically, and the i18n key of the heading
 *  each one renders. The accessible name must match that heading. */
const DIALOG_LABEL_KEYS = {
    achievementsScreen: 'achievements',
    leaderboardScreen: 'leaderboard',
    stagePickerScreen: 'chooseStage',
    streakScreen: 'dailyStreak',
    helpScreen: 'helpTitle',
    howToPlayScreen: 'howToTitle',
    settingsMenu: 'settings'
};

/** Every id the UI constructor caches. */
const CACHED_IDS = [
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
];

/**
 * A DOM stub whose setAttribute/getAttribute/hasAttribute actually work.
 * The stub in iter13.test.js deliberately no-ops setAttribute, so it cannot
 * assert on ARIA attributes — this one exists for exactly that.
 */
function makeStubDoc() {
    const els = new Map();

    const make = (id) => {
        const attrs = new Map();
        const el = {
            id,
            style: {},
            innerHTML: '',
            textContent: '',
            dataset: {},
            children: [],
            _listeners: {},
            _attrs: attrs,
            classList: { add() {}, remove() {}, toggle() {} },
            addEventListener(ev, fn) {
                (this._listeners[ev] = this._listeners[ev] || []).push(fn);
            },
            removeEventListener() {},
            querySelector() {
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
            setAttribute(k, v) {
                attrs.set(k, String(v));
            },
            getAttribute(k) {
                return attrs.has(k) ? attrs.get(k) : null;
            },
            hasAttribute(k) {
                return attrs.has(k);
            },
            removeAttribute(k) {
                attrs.delete(k);
            },
            focus() {}
        };
        els.set(id, el);
        return el;
    };

    for (const id of CACHED_IDS) make(id);

    return {
        getElementById: (id) => els.get(id) || null,
        querySelectorAll: () => [],
        body: { classList: { add() {}, remove() {}, toggle() {} } },
        documentElement: { lang: 'en' }
    };
}

/** Build a UI against a fresh stub document and hand back both. */
function withStubUi(fn) {
    (globalThis as any).document = makeStubDoc();
    try {
        const ui = new UI({});
        return fn(ui);
    } finally {
        delete globalThis.document;
        setLocale('en'); // Leave global locale state as we found it.
    }
}

test('a11y: every dynamic dialog is role="dialog" with aria-modal', () => {
    withStubUi((ui) => {
        for (const id of Object.keys(DIALOG_LABEL_KEYS)) {
            const el = ui.els[id];
            assert.ok(el, `${id} should be cached by the constructor`);
            assert.equal(el.getAttribute('role'), 'dialog', `${id} role`);
            assert.equal(el.getAttribute('aria-modal'), 'true', `${id} aria-modal`);
        }
    });
});

test('a11y: every dynamic dialog has a non-empty accessible name', () => {
    withStubUi((ui) => {
        for (const [id, key] of Object.entries(DIALOG_LABEL_KEYS)) {
            const label = ui.els[id].getAttribute('aria-label');
            assert.ok(label && label.trim().length > 0, `${id} must have an accessible name`);
            assert.equal(label, t(key), `${id} label should be the heading text`);
        }
    });
});

test('a11y: the accessible name follows a locale change', () => {
    withStubUi((ui) => {
        const before = ui.els.achievementsScreen.getAttribute('aria-label');
        assert.equal(before, 'Achievements');

        setLocale('zh');
        ui.onLocaleChanged();

        const after = ui.els.achievementsScreen.getAttribute('aria-label');
        assert.notEqual(after, before, 'the name must be re-translated, not left stale');
        assert.equal(after, t('achievements'));
    });
});

test('a11y: the accessible name matches the heading the dialog actually renders', () => {
    // The invariant that matters for a screen-reader user: what they hear when
    // the dialog opens equals what they read at the top of it.
    withStubUi((ui) => {
        ui.showHelp();
        assert.equal(ui.els.helpScreen.getAttribute('aria-label'), t('helpTitle'));
        assert.match(ui.els.helpScreen.innerHTML, new RegExp(escapeRe(t('helpTitle'))));

        ui.showHowToPlay();
        assert.equal(ui.els.howToPlayScreen.getAttribute('aria-label'), t('howToTitle'));
        assert.match(ui.els.howToPlayScreen.innerHTML, new RegExp(escapeRe(t('howToTitle'))));
    });
});

/** Escape a string for safe use inside a RegExp. */
function escapeRe(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
