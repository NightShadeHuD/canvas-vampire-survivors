#!/usr/bin/env node
/**
 * @file scripts/boot-smoke.mjs
 * @description End-to-end boot gate. Drives the real game in a real browser
 * through its critical path — boot, start, spawn, level-up, death — and fails
 * on any page error or any step that does not actually happen.
 * See docs/ENGINEERING-STANDARDS.md §4.
 *
 * Distinct from scripts/runtime-smoke.js, which is a QA/reporting tool that
 * produces screenshots and a written report and is tolerant of rough edges.
 * This one is a gate: no screenshots, no prose, just pass/fail on whether the
 * game still works.
 *
 * It asserts on observed state (the enemy array grew, the menu became visible)
 * rather than on the absence of exceptions, because "nothing threw" is not the
 * same as "the game plays".
 *
 * Usage:
 *   node scripts/boot-smoke.mjs
 */

import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');

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

let chromium;
try {
    ({ chromium } = await import('playwright'));
} catch (err) {
    console.error(`boot-smoke: could not load playwright — ${err.message}`);
    console.error('Run `npm ci` first.');
    process.exit(1);
}

/**
 * Mark the one-time first-run overlays as already seen. On a clean profile the
 * How-to-Play overlay opens on top of the menu and intercepts clicks on
 * #btnStart, so without this the gate cannot start a run at all.
 * (Storage key matches STORAGE_KEY in src/config.ts.)
 */
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

const port = await freePort();
const url = `http://127.0.0.1:${port}/`;
const server = spawn(process.execPath, [path.join(repoRoot, 'server.js')], {
    cwd: repoRoot,
    env: { ...process.env, PORT: String(port) },
    stdio: 'ignore'
});

let browser;
let exitCode = 0;
const steps = [];

/** Record a step result and print it immediately. */
function step(name, ok, detail = '') {
    steps.push({ name, ok, detail });
    console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name.padEnd(34)} ${detail}`);
}

try {
    if (!(await waitForServer(url))) throw new Error(`dev server did not come up at ${url}`);

    try {
        browser = await chromium.launch({ headless: true });
    } catch (err) {
        console.error(
            `boot-smoke: could not launch Chromium — ${String(err.message).split('\n')[0]}`
        );
        console.error('\nInstall the browser once with:\n    npx playwright install chromium');
        process.exit(1);
    }

    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await context.addInitScript(SEED_FLAGS);
    const page = await context.newPage();

    const pageErrors = [];
    page.on('pageerror', (e) => pageErrors.push(String(e)));

    console.log('boot-smoke: driving the critical path\n');

    // --- 1. boot ------------------------------------------------------------
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForTimeout(1200);

    const booted = await page.evaluate(() => typeof window.__vsGame === 'object');
    step('game instance exists', booted);

    const menuState = await page.evaluate(() => window.__vsGame?.state);
    step('starts in the menu state', menuState === 'menu', `state=${menuState}`);

    const hasDebug = await page.evaluate(() => typeof window.__SURV_DEBUG__ === 'object');
    step('dev debug hooks available', hasDebug);

    // --- 2. start the run ---------------------------------------------------
    const startBtn = await page.$('#btnStart');
    if (!startBtn) throw new Error('#btnStart not found — cannot start a run');
    await startBtn.click();

    const started = await page
        .waitForFunction(() => window.__vsGame?.state === 'playing', { timeout: 8000 })
        .then(() => true)
        .catch(() => false);
    step('start button begins a run', started);

    const hasPlayer = await page.evaluate(() => !!window.__vsGame?.player);
    step('player was created', hasPlayer);

    // --- 3. the frame loop is actually running ------------------------------
    const t0 = await page.evaluate(() => window.__vsGame?.gameTime ?? -1);
    await page.waitForTimeout(1500);
    const t1 = await page.evaluate(() => window.__vsGame?.gameTime ?? -1);
    step('frame loop advances time', t1 > t0, `${t0.toFixed(2)}s -> ${t1.toFixed(2)}s`);

    // --- 4. the spawn director produces enemies -----------------------------
    await page.evaluate(() => window.__SURV_DEBUG__.advance(60));
    const spawned = await page
        .waitForFunction(() => (window.__vsGame?.enemies?.length ?? 0) > 0, { timeout: 8000 })
        .then(() => true)
        .catch(() => false);
    const enemyCount = await page.evaluate(() => window.__vsGame?.enemies?.length ?? 0);
    step('enemies spawn', spawned, `count=${enemyCount}`);

    // --- 5. death ends the run ---------------------------------------------
    await page.evaluate(() => window.__SURV_DEBUG__.killPlayer());
    const died = await page
        .waitForFunction(
            () => {
                const el = document.getElementById('gameOver');
                return !!el && el.style.display === 'flex';
            },
            { timeout: 8000 }
        )
        .then(() => true)
        .catch(() => false);
    step('death shows the game-over screen', died);

    // --- 6. level-up flow, from a fresh run ---------------------------------
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForTimeout(1000);
    await page.click('#btnStart');
    await page.waitForFunction(() => window.__vsGame?.state === 'playing', { timeout: 8000 });
    await page.evaluate(() => window.__SURV_DEBUG__.grantLevel(1));
    const levelled = await page
        .waitForFunction(
            () => {
                const el = document.getElementById('levelUpMenu');
                return !!el && el.style.display === 'flex';
            },
            { timeout: 8000 }
        )
        .then(() => true)
        .catch(() => false);
    step('level-up opens the upgrade menu', levelled);

    // --- 7. nothing threw along the way ------------------------------------
    step('no uncaught page errors', pageErrors.length === 0, `${pageErrors.length} error(s)`);
    for (const e of pageErrors.slice(0, 5)) console.log(`         └─ ${e.split('\n')[0]}`);
} catch (err) {
    console.error(`\nboot-smoke: ERROR — ${err.message}`);
    exitCode = 1;
} finally {
    if (browser) await browser.close().catch(() => {});
    server.kill('SIGTERM');
}

if (exitCode === 0) {
    const failed = steps.filter((s) => !s.ok);
    if (failed.length > 0) {
        console.error(
            `\nboot-smoke: FAILED — ${failed.length}/${steps.length} step(s) did not pass.`
        );
        exitCode = 1;
    } else {
        console.log(`\nboot-smoke: all ${steps.length} steps passed.`);
    }
}

process.exit(exitCode);
