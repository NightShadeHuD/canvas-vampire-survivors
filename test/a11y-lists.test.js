// Regression tests for the ARIA list contract.
//
// Found by scripts/a11y-audit.mjs once it scanned all 12 surfaces instead of 6:
// axe reported `aria-required-children` (critical) on three containers. Two of
// them — the daily-streak calendar and the weapon chips — are covered here, plus
// the passive chips which had the identical latent bug and only escaped notice
// because the container was empty at scan time.
//
// `role="list"` requires `role="listitem"` children. Without it a screen reader
// does not announce the container as a list, and the items are not enumerable.
// #upgradeOptions already did this correctly with role="menuitem"; the
// role="list" containers were simply missed.
//
// Runs in Node, no browser.

import test from 'node:test';
import assert from 'node:assert/strict';
import { UI } from '../src/ui.ts';

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
 * A DOM stub with working attribute recording and a real createElement, so the
 * role contract can actually be asserted. The iter13 stub no-ops setAttribute
 * and so cannot see ARIA at all.
 */
function makeStubDoc() {
    const byId = new Map();

    const makeEl = (tag) => {
        const attrs = new Map();
        let html = '';
        const el = {
            tagName: tag,
            style: {},
            textContent: '',
            className: '',
            dataset: {},
            children: [],
            _attrs: attrs,
            classList: {
                add(c) {
                    el.className = `${el.className} ${c}`.trim();
                },
                remove() {},
                toggle() {}
            },
            addEventListener() {},
            removeEventListener() {},
            querySelector: () => null,
            querySelectorAll: () => [],
            appendChild(c) {
                el.children.push(c);
                return c;
            },
            insertBefore(c) {
                el.children.push(c);
                return c;
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
        // A real innerHTML assignment replaces all children. Without this the
        // re-render test silently accumulates nodes and cannot detect a leak.
        Object.defineProperty(el, 'innerHTML', {
            get: () => html,
            set: (v) => {
                html = String(v);
                el.children.length = 0;
            }
        });
        return el;
    };

    for (const id of CACHED_IDS) byId.set(id, makeEl('div'));

    // Mirror the roles index.html declares, so the stub reflects the real DOM.
    // test/a11y-lists.test.js also asserts index.html still declares them, so
    // the two cannot drift apart.
    const ROLES_IN_HTML = {
        weaponIcons: 'list',
        passiveIcons: 'list',
        upgradeOptions: 'menu'
    };
    for (const [id, role] of Object.entries(ROLES_IN_HTML)) {
        byId.get(id).setAttribute('role', role);
    }

    return {
        getElementById: (id) => byId.get(id) || null,
        createElement: (tag) => makeEl(tag),
        querySelectorAll: () => [],
        body: makeEl('body'),
        documentElement: { lang: 'en' }
    };
}

function withStubUi(fn) {
    globalThis.document = makeStubDoc();
    try {
        return fn(new UI({}));
    } finally {
        delete globalThis.document;
    }
}

// ---------------------------------------------------------------------------

test('a11y/lists: chips rendered into role="list" containers are role="listitem"', () => {
    withStubUi((ui) => {
        for (const containerId of ['weaponIcons', 'passiveIcons']) {
            const container = ui.els[containerId];
            assert.equal(container.getAttribute('role'), 'list', `${containerId} should be a list`);

            ui._renderChips(container, [{ icon: 'W', level: 2, max: 8 }]);

            assert.equal(container.children.length, 1, `${containerId} should have one chip`);
            assert.equal(
                container.children[0].getAttribute('role'),
                'listitem',
                `${containerId} child needs role="listitem" or axe reports aria-required-children`
            );
        }
    });
});

test('a11y/lists: every chip gets the role, not just the first', () => {
    withStubUi((ui) => {
        const container = ui.els.weaponIcons;
        ui._renderChips(container, [
            { icon: 'A', level: 1, max: 8 },
            { icon: 'B', level: 8, max: 8, evolved: true },
            { icon: 'C', level: 3, max: 8 }
        ]);
        assert.equal(container.children.length, 3);
        for (const child of container.children) {
            assert.equal(child.getAttribute('role'), 'listitem');
        }
    });
});

test('a11y/lists: the daily-streak calendar cells are role="listitem"', () => {
    withStubUi((ui) => {
        ui.showStreak();
        const html = ui.els.streakScreen.innerHTML;

        assert.match(html, /class="streak-grid" role="list"/, 'the grid should still be a list');

        const cells = html.match(/class="streak-cell[^"]*"[^>]*/g) || [];
        assert.ok(cells.length >= 14, `expected at least 14 cells, got ${cells.length}`);
        for (const cell of cells) {
            assert.match(cell, /role="listitem"/, `streak cell missing role="listitem": ${cell}`);
        }
    });
});

test('a11y/lists: re-rendering chips clears and re-marks them', () => {
    // updateHud runs every frame during a run, so this path is hot and must not
    // accumulate stale children or lose the role on re-render.
    withStubUi((ui) => {
        const container = ui.els.weaponIcons;
        ui._renderChips(container, [{ icon: 'A', level: 1, max: 8 }]);
        ui._renderChips(container, [{ icon: 'B', level: 2, max: 8 }]);

        assert.equal(container.children.length, 1, 'previous children should be cleared');
        assert.equal(container.children[0].getAttribute('role'), 'listitem');
    });
});

test('a11y/lists: index.html still declares the container roles the code assumes', async () => {
    // Ties the JS contract to the real markup. If someone drops role="list"
    // from the HUD containers, the reason the chips carry role="listitem"
    // disappears, and this fails rather than drifting silently.
    const { readFileSync } = await import('node:fs');
    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

    for (const id of ['weaponIcons', 'passiveIcons']) {
        const tag = new RegExp(`id="${id}"[^>]*`, 's').exec(html);
        assert.ok(tag, `#${id} should exist in index.html`);
        assert.match(
            tag[0],
            /role="list"/,
            `#${id} must declare role="list" to match the listitem contract`
        );
    }

    const menu = new RegExp(`id="upgradeOptions"[^>]*`, 's').exec(html);
    assert.ok(menu, '#upgradeOptions should exist in index.html');
    assert.match(menu[0], /role="menu"/, '#upgradeOptions must declare role="menu"');
});
