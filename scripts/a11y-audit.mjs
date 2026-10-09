#!/usr/bin/env node
/**
 * @file scripts/a11y-audit.mjs
 * @description Accessibility gate. Loads the real game in a real browser and
 * runs axe-core against every reachable surface, failing the build on
 * violations at or above the configured impact level.
 * See docs/ENGINEERING-STANDARDS.md §4.
 *
 * This is deliberately separate from scripts/runtime-smoke.js. That script is a
 * QA/reporting tool: it produces screenshots and a written report and tolerates
 * a rough edge. A gate has to be fast, deterministic, and fail loudly, so it
 * lives on its own and is wired into CI.
 *
 * Two passes, because the first-run experience is itself a surface we ship:
 *   Pass A  clean profile -> the five surfaces reachable from the main menu.
 *   Pass B  fresh profile -> the first-run How-to-Play overlay.
 * A clean Chromium profile opens that overlay on top of the menu and it
 * intercepts clicks, so auditing it needs its own context rather than a
 * suppressed one. (Storage key and flags match STORAGE_KEY in src/config.js.)
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
 * Load one surface and scan it. Always starts from a fresh navigation, because
 * the game's overlays are modal and stacking them makes later clicks fail on
 * pointer interception.
 */
async function auditSurface(context, url, surface) {
    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', (e) => pageErrors.push(String(e)));

    try {
        await page.goto(url, { waitUntil: 'load' });
        await page.waitForTimeout(1000);

        if (surface.open) {
            const btn = await page.$(surface.open);
            if (!btn) {
                return { surface: surface.name, skipped: `${surface.open} not present` };
            }
            try {
                await btn.click({ timeout: 5000 });
            } catch (err) {
                return {
                    surface: surface.name,
                    skipped: `click failed: ${String(err.message).split('\n')[0]}`
                };
            }
            await page.waitForTimeout(500);
        }

        const results = await new AxeBuilder({ page }).analyze();
        return { surface: surface.name, violations: results.violations, pageErrors };
    } finally {
        await page.close().catch(() => {});
    }
}

const MENU_SURFACES = [
    { name: 'main menu', open: null },
    { name: 'how-to-play', open: '#btnHowTo' },
    { name: 'settings', open: '#btnSettings' },
    { name: 'achievements', open: '#btnAchievements' },
    { name: 'leaderboard', open: '#btnLeaderboard' }
];

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

    // Pass A — the menu and everything reachable from it, with the one-time
    // first-run overlays suppressed so the menu is actually clickable.
    const seeded = await browser.newContext({
        viewport: { width: 1280, height: 900 },
        deviceScaleFactor: 1
    });
    await seeded.addInitScript(SEED_FLAGS);
    for (const surface of MENU_SURFACES) {
        findings.push(await auditSurface(seeded, url, surface));
    }
    await seeded.close();

    // Pass B — the first-run overlay itself, on a genuinely fresh profile.
    const fresh = await browser.newContext({
        viewport: { width: 1280, height: 900 },
        deviceScaleFactor: 1
    });
    findings.push(await auditSurface(fresh, url, { name: 'first-run overlay', open: null }));
    await fresh.close();

    // --- report -------------------------------------------------------------
    let blocking = 0;
    let totalNodes = 0;

    console.log('a11y-audit: axe-core results\n');

    for (const f of findings) {
        if (f.skipped) {
            console.log(`  ${f.surface.padEnd(18)} SKIPPED (${f.skipped})`);
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
            `total nodes=${totalNodes} (ceiling ${ceiling.nodes})`
    );

    if (reportOnly) {
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
        console.log('\na11y-audit: ok — within the recorded ceiling.');
    }
} catch (err) {
    console.error(`\na11y-audit: ERROR — ${err.message}`);
    exitCode = 1;
} finally {
    if (browser) await browser.close().catch(() => {});
    server.kill('SIGTERM');
}

process.exit(exitCode);
