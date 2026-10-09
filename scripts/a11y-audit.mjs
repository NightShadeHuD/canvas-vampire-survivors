#!/usr/bin/env node
/**
 * @file scripts/a11y-audit.mjs
 * @description Accessibility gate. Loads the real game in a real browser and
 * runs axe-core against **every overlay the game ships**, failing the build on
 * violations at or above the configured impact level.
 * See docs/ENGINEERING-STANDARDS.md §4.
 *
 * Coverage matters more than the tool here. An earlier version scanned only the
 * six surfaces reachable by clicking a menu button, so `a11yCeiling: 0` meant
 * "clean on the six surfaces we looked at" while five overlays — the stage
 * picker, the daily streak, help, and the in-game pause / level-up / game-over
 * screens — were never examined at all. That is the same "green light wired to
 * nothing" failure mode as the ESLint glob, and `scripts/check-coverage.mjs`
 * cannot catch it. So the surface list below is exhaustive on purpose.
 *
 * How each surface is reached, and why:
 *   - Menu overlays are reached by clicking their real button, which also
 *     proves the button is clickable.
 *   - Overlays with no menu button (help) and the in-game overlays are driven
 *     by invoking the game object directly. Simulating the key or gamepad
 *     binding would test the input layer rather than the overlay; boot-smoke
 *     already covers the input wiring end to end.
 *   - The first-run How-to-Play overlay needs a genuinely fresh profile, since
 *     on a clean profile it opens on top of the menu and intercepts clicks.
 *
 * Usage:
 *   node scripts/a11y-audit.mjs            # enforce (CI)
 *   node scripts/a11y-audit.mjs --report   # print findings, always exit 0
 */

import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
const reportOnly = process.argv.includes('--report');

/** Impacts we treat as release-blocking. */
const BLOCKING = new Set(['critical', 'serious']);

/** localStorage seed that marks the one-time first-run overlays as already seen. */
const SEED_FLAGS = () => {
    try {
        const KEY = 'vs_clone_save_v2';
        const raw = localStorage.getItem(KEY);
        const obj = raw ? JSON.parse(raw) : {};
        obj.flags = obj.flags || {};
        obj.flags.howToSeen = true;
        obj.flags.tutorialDone = true;
        obj.flags.pwaPromptSeen = true;
        localStorage.setItem(KEY, JSON.stringify(obj));
    } catch {
        /* sandboxed context — the game falls back to an in-memory save */
    }
};

/**
 * Every overlay the game ships, and how to open it.
 *
 * `selector`  must become visible before the scan runs — asserted, so a surface
 *             that silently fails to open is reported instead of being scanned
 *             as the empty page underneath and passing.
 * `click`     open by clicking this menu button.
 * `invoke`    open by evaluating this expression against the running game.
 * `needsRun`  start a run first (in-game overlays).
 */
const SURFACES = [
    { name: 'main menu', selector: '#startScreen' },
    { name: 'how-to-play', selector: '#howToPlayScreen', click: '#btnHowTo' },
    { name: 'settings', selector: '#settingsMenu', click: '#btnSettings' },
    { name: 'achievements', selector: '#achievementsScreen', click: '#btnAchievements' },
    { name: 'leaderboard', selector: '#leaderboardScreen', click: '#btnLeaderboard' },
    { name: 'stage picker', selector: '#stagePickerScreen', click: '#btnStage' },
    { name: 'daily streak', selector: '#streakScreen', click: '#btnViewStreak' },
    // No menu button: bound to an input action. Driving it through the input
    // layer would test the binding, not the overlay.
    { name: 'help', selector: '#helpScreen', invoke: 'window.__vsGame.toggleHelp()' },
    // In-game overlays.
    {
        name: 'pause menu',
        selector: '#pauseMenu',
        needsRun: true,
        invoke: 'window.__vsGame.togglePause()'
    },
    {
        name: 'level-up menu',
        selector: '#levelUpMenu',
        needsRun: true,
        invoke: 'window.__SURV_DEBUG__.grantLevel(1)'
    },
    {
        name: 'game over',
        selector: '#gameOver',
        needsRun: true,
        invoke: 'window.__SURV_DEBUG__.killPlayer()'
    }
];

function freePort() {
    return new Promise((resolve, reject) => {
        const srv = createServer();
        srv.on('error', reject);
        srv.listen(0, () => {
            const { port } = srv.address();
            srv.close(() => resolve(port));
        });
    });
}

async function waitForServer(url, timeoutMs = 15000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        try {
            const res = await fetch(url, { method: 'HEAD' });
            if (res.ok || res.status === 404) return true;
        } catch {
            /* not up yet */
        }
        await new Promise((r) => setTimeout(r, 150));
    }
    return false;
}

function loadCeiling() {
    try {
        const b = JSON.parse(readFileSync(path.join(repoRoot, 'quality-baseline.json'), 'utf8'));
        return b.a11yCeiling ?? { blockingViolations: 0, nodes: 0 };
    } catch {
        return { blockingViolations: 0, nodes: 0 };
    }
}

let chromium;
let AxeBuilder;
try {
    ({ chromium } = await import('playwright'));
    ({ default: AxeBuilder } = await import('@axe-core/playwright'));
} catch (err) {
    console.error('a11y-audit: could not load playwright / @axe-core/playwright.');
    console.error(`  ${err.message}`);
    console.error('\nRun `npm ci` first.');
    process.exit(1);
}

/**
 * Open one surface and scan it. Always starts from a fresh navigation, because
 * the game's overlays are modal and stacking them makes later clicks fail on
 * pointer interception.
 */
async function auditSurface(context, url, surface) {
    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', (e) => pageErrors.push(String(e)));

    try {
        await page.goto(url, { waitUntil: 'load' });
        await page.waitForTimeout(900);

        if (surface.needsRun) {
            const started = await page
                .click('#btnStart', { timeout: 5000 })
                .then(() => true)
                .catch(() => false);
            if (!started) return { surface: surface.name, skipped: '#btnStart not clickable' };

            const playing = await page
                .waitForFunction(() => window.__vsGame?.state === 'playing', { timeout: 8000 })
                .then(() => true)
                .catch(() => false);
            if (!playing) return { surface: surface.name, skipped: 'run never started' };
        }

        if (surface.click) {
            const btn = await page.$(surface.click);
            if (!btn) return { surface: surface.name, skipped: `${surface.click} not present` };
            try {
                await btn.click({ timeout: 5000 });
            } catch (err) {
                return {
                    surface: surface.name,
                    skipped: `click failed: ${String(err.message).split('\n')[0]}`
                };
            }
        }

        if (surface.invoke) {
            const invoked = await page
                .evaluate(surface.invoke)
                .then(() => true)
                .catch((err) => String(err.message).split('\n')[0]);
            if (invoked !== true) {
                return { surface: surface.name, skipped: `invoke failed: ${invoked}` };
            }
        }

        // Assert the overlay actually opened. Without this, a surface that fails
        // to open gets scanned as the empty page underneath and reports clean —
        // which would be another green light wired to nothing.
        const visible = await page
            .waitForFunction(
                (sel) => {
                    const el = document.querySelector(sel);
                    return !!el && getComputedStyle(el).display !== 'none';
                },
                surface.selector,
                { timeout: 6000 }
            )
            .then(() => true)
            .catch(() => false);

        if (!visible) {
            return { surface: surface.name, skipped: `${surface.selector} never became visible` };
        }

        // Let the overlay settle (fonts, injected rows) before measuring.
        await page.waitForTimeout(350);

        const results = await new AxeBuilder({ page }).analyze();
        return { surface: surface.name, violations: results.violations, pageErrors };
    } finally {
        await page.close().catch(() => {});
    }
}

const port = await freePort();
const url = `http://127.0.0.1:${port}/`;
const server = spawn(process.execPath, [path.join(repoRoot, 'server.js')], {
    cwd: repoRoot,
    env: { ...process.env, PORT: String(port) },
    stdio: 'ignore'
});

let browser;
let exitCode = 0;

try {
    if (!(await waitForServer(url))) {
        throw new Error(`dev server did not come up at ${url}`);
    }

    try {
        browser = await chromium.launch({ headless: true });
    } catch (err) {
        console.error('a11y-audit: could not launch Chromium.');
        console.error(`  ${String(err.message).split('\n')[0]}`);
        console.error('\nInstall the browser once with:\n    npx playwright install chromium');
        process.exit(1);
    }

    const findings = [];

    // Pass A — every surface, with the one-time first-run overlays suppressed
    // so the menu is actually clickable.
    const seeded = await browser.newContext({
        viewport: { width: 1280, height: 900 },
        deviceScaleFactor: 1
    });
    await seeded.addInitScript(SEED_FLAGS);
    for (const surface of SURFACES) {
        findings.push(await auditSurface(seeded, url, surface));
    }
    await seeded.close();

    // Pass B — the first-run overlay itself, on a genuinely fresh profile.
    const fresh = await browser.newContext({
        viewport: { width: 1280, height: 900 },
        deviceScaleFactor: 1
    });
    findings.push(
        await auditSurface(fresh, url, { name: 'first-run overlay', selector: '#howToPlayScreen' })
    );
    await fresh.close();

    // --- report -------------------------------------------------------------
    let blocking = 0;
    let totalNodes = 0;
    const skipped = [];

    console.log(`a11y-audit: axe-core across ${findings.length} surfaces\n`);

    for (const f of findings) {
        if (f.skipped) {
            console.log(`  ${f.surface.padEnd(18)} SKIPPED (${f.skipped})`);
            skipped.push(f.surface);
            continue;
        }
        const viol = f.violations || [];
        const blockingHere = viol.filter((v) => BLOCKING.has(v.impact));
        const nodes = viol.reduce((n, v) => n + v.nodes.length, 0);
        blocking += blockingHere.length;
        totalNodes += nodes;

        console.log(
            `  ${f.surface.padEnd(18)} violations=${viol.length} ` +
                `blocking=${blockingHere.length} nodes=${nodes}`
        );

        for (const v of viol) {
            const mark = BLOCKING.has(v.impact) ? 'BLOCKING' : 'advisory';
            console.log(`      [${mark}] ${v.id} (${v.impact}): ${v.help}`);
            for (const n of v.nodes.slice(0, 4)) {
                console.log(`          ${n.target.join(' ')}`);
            }
            if (v.nodes.length > 4) console.log(`          … and ${v.nodes.length - 4} more`);
        }
    }

    const ceiling = loadCeiling();
    console.log(
        `\na11y-audit: blocking=${blocking} (ceiling ${ceiling.blockingViolations}), ` +
            `total nodes=${totalNodes} (ceiling ${ceiling.nodes}), skipped=${skipped.length}`
    );

    if (skipped.length > 0) {
        // A skipped surface is an unscanned surface. Failing loudly is the whole
        // point: silence here is indistinguishable from "clean".
        console.error(
            `\na11y-audit: FAILED — ${skipped.length} surface(s) could not be opened, so they\n` +
                `were not scanned: ${skipped.join(', ')}.\n` +
                'An unscanned surface is not a clean surface.'
        );
        exitCode = 1;
    } else if (reportOnly) {
        console.log('\na11y-audit: --report mode, not failing the build.');
    } else if (blocking > ceiling.blockingViolations) {
        console.error(
            `\na11y-audit: FAILED — ${blocking} blocking violation(s), ` +
                `ceiling is ${ceiling.blockingViolations}.`
        );
        console.error(
            'Fix the violation, or record it as a declaredGaps entry in\n' +
                'quality-baseline.json and raise a11yCeiling in the same commit.\n' +
                'See docs/ENGINEERING-STANDARDS.md §4 and §5.'
        );
        exitCode = 1;
    } else {
        console.log('\na11y-audit: ok — every surface scanned, within the recorded ceiling.');
    }
} catch (err) {
    console.error(`\na11y-audit: ERROR — ${err.message}`);
    exitCode = 1;
} finally {
    if (browser) await browser.close().catch(() => {});
    server.kill('SIGTERM');
}

process.exit(exitCode);
