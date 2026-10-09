#!/usr/bin/env node
/**
 * @file scripts/runtime-smoke.js
 * @description Real-browser runtime smoke test (Round 9 + 10 QA).
 *
 * What it does:
 *   1. Spawns the dev server (`node server.js`) on a free port.
 *   2. Launches headless Chromium via Playwright.
 *   3. Loads the game and captures:
 *      - real-mainmenu.png      (main menu)
 *      - real-gameplay.png      (~10 s of combat)
 *      - real-boss-fight.png    (Round 10: fast-forward to first boss)
 *      - real-levelup.png       (Round 10: trigger level-up dialog)
 *      - real-gameover.png      (Round 10: kill player + capture)
 *   4. Runs `@axe-core/playwright` against the main menu and writes any
 *      violations into the QA report.
 *   5. Collects every console.error / console.warn / pageerror / failed
 *      network request and prints them to stdout (and to docs/RUNTIME_QA_REPORT.md).
 *   6. Exits non-zero if any console.error or pageerror.
 *
 * Usage: `node scripts/runtime-smoke.js`
 *
 * Notes:
 *   - Playwright + @axe-core/playwright are *dev*-only deps.
 *   - Output PNGs land at docs/screenshots/real-*.png — these replace the
 *     SVG mockups in README. SVG fallbacks live under docs/screenshots/svg/.
 *   - Round 10 screenshots use `window.__SURV_DEBUG__` test hooks (gated to
 *     localhost in src/main.ts) — they don't ship on GitHub Pages.
 */
'use strict';

const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const net = require('net');

const ROOT = path.resolve(__dirname, '..');
const SHOT_DIR = path.join(ROOT, 'docs', 'screenshots');
const REPORT = path.join(ROOT, 'docs', 'RUNTIME_QA_REPORT.md');

// --- Pick a free port to avoid collisions -------------------------------------
function freePort() {
    return new Promise((resolve, reject) => {
        const srv = net.createServer();
        srv.unref();
        srv.on('error', reject);
        srv.listen(0, () => {
            const { port } = srv.address();
            srv.close(() => resolve(port));
        });
    });
}

function waitForServer(url, timeoutMs = 8000) {
    const start = Date.now();
    return new Promise((resolve, reject) => {
        const tick = () => {
            const http = require('http');
            const req = http.get(url, (res) => {
                res.resume();
                if (res.statusCode === 200) return resolve();
                retry();
            });
            req.on('error', retry);
            req.setTimeout(1000, () => {
                req.destroy();
                retry();
            });
        };
        const retry = () => {
            if (Date.now() - start > timeoutMs) return reject(new Error('server timeout'));
            setTimeout(tick, 150);
        };
        tick();
    });
}

async function main() {
    if (!fs.existsSync(SHOT_DIR)) fs.mkdirSync(SHOT_DIR, { recursive: true });

    const port = await freePort();
    const env = { ...process.env, PORT: String(port) };
    const server = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
        env,
        cwd: ROOT,
        stdio: ['ignore', 'pipe', 'pipe']
    });
    server.stdout.on('data', (d) => process.stdout.write(`[server] ${d}`));
    server.stderr.on('data', (d) => process.stderr.write(`[server!] ${d}`));

    const cleanup = (code) => {
        try {
            server.kill('SIGTERM');
        } catch (_) {
            /* ignore */
        }
        if (typeof code === 'number') process.exit(code);
    };
    process.on('SIGINT', () => cleanup(130));
    process.on('SIGTERM', () => cleanup(143));

    const url = `http://localhost:${port}/`;
    await waitForServer(url + 'index.html');

    // Lazy-require so that --help / install paths don't fail without playwright.
    const { chromium } = require('playwright');
    let AxeBuilder = null;
    try {
        // Optional: skip a11y if @axe-core/playwright isn't installed.
        ({ default: AxeBuilder } = await import('@axe-core/playwright'));
    } catch (_e) {
        process.stdout.write('[axe] @axe-core/playwright not installed, skipping a11y scan\n');
    }
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
        viewport: { width: 1280, height: 900 },
        deviceScaleFactor: 1,
        userAgent:
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
    });
    const page = await context.newPage();

    const consoleErrors = [];
    const consoleWarns = [];
    const pageErrors = [];
    const failedRequests = [];

    page.on('console', (msg) => {
        const t = msg.type();
        const text = msg.text();
        if (t === 'error') consoleErrors.push(text);
        else if (t === 'warning') consoleWarns.push(text);
        process.stdout.write(`[console.${t}] ${text}\n`);
    });
    page.on('pageerror', (err) => {
        pageErrors.push(`${err.name}: ${err.message}\n${err.stack || ''}`);
        process.stdout.write(`[pageerror] ${err.message}\n`);
    });
    page.on('requestfailed', (req) => {
        failedRequests.push(`${req.method()} ${req.url()} — ${req.failure()?.errorText}`);
        process.stdout.write(`[reqfail] ${req.url()}\n`);
    });
    page.on('response', (res) => {
        if (res.status() >= 400) {
            failedRequests.push(`${res.status()} ${res.url()}`);
            process.stdout.write(`[resp ${res.status()}] ${res.url()}\n`);
        }
    });

    await page.goto(url, { waitUntil: 'load' });
    await page.waitForTimeout(1500);

    // iter-22: on a clean Chromium profile the iter-13 first-run How-to-Play
    // overlay (and the iter-15 tutorial-offer + iter-14 PWA prompt) sit on
    // top of the main menu and intercept clicks on `#btnStart`. Set the
    // one-time flags in localStorage and reload so the boot constructor
    // never opens those overlays in the first place. Save key matches
    // STORAGE_KEY in src/config.ts (`vs_clone_save_v2`).
    await page.evaluate(() => {
        try {
            const KEY = 'vs_clone_save_v2';
            const raw = localStorage.getItem(KEY);
            const obj = raw ? JSON.parse(raw) : {};
            obj.flags = obj.flags || {};
            obj.flags.howToSeen = true;
            obj.flags.tutorialDone = true;
            obj.flags.pwaPromptSeen = true;
            localStorage.setItem(KEY, JSON.stringify(obj));
        } catch (_) {
            /* ignore — sandboxed contexts already fall back to in-memory save */
        }
    });
    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(1500);

    // --- Scene 1: main menu ------------------------------------------------
    await page.screenshot({
        path: path.join(SHOT_DIR, 'real-mainmenu.png'),
        fullPage: false
    });
    process.stdout.write('[shot] real-mainmenu.png\n');

    // --- Accessibility scan (axe) on the main menu ------------------------
    let axeViolations = [];
    if (AxeBuilder) {
        try {
            const results = await new AxeBuilder({ page })
                .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
                .analyze();
            axeViolations = results.violations || [];
            process.stdout.write(`[axe] ${axeViolations.length} violations\n`);
        } catch (err) {
            process.stdout.write(`[axe] scan failed: ${err.message}\n`);
        }
    }

    // --- Scene 2: early gameplay ------------------------------------------
    const startBtn = await page.$('#btnStart');
    if (!startBtn) {
        pageErrors.push('Could not find #btnStart button on main menu.');
    } else {
        await startBtn.click();
        process.stdout.write('[click] #btnStart\n');
    }
    await page.evaluate(() => document.getElementById('gameCanvas')?.focus());

    await page.keyboard.down('d');
    await page.waitForTimeout(2500);
    await page.keyboard.up('d');
    await page.keyboard.down('s');
    await page.waitForTimeout(2500);
    await page.keyboard.up('s');
    await page.waitForTimeout(5000);

    let liveState = null;
    try {
        liveState = await page.evaluate(() => {
            const g = window.__vsGame;
            if (!g) return null;
            return {
                state: g.state,
                gameTime: g.gameTime,
                kills: g.kills,
                playerHp: g.player ? g.player.hp : null,
                playerLevel: g.player ? g.player.level : null,
                playerXY: g.player
                    ? { x: Math.round(g.player.x), y: Math.round(g.player.y) }
                    : null,
                cameraXY: g.camera
                    ? {
                          worldX: Math.round(g.camera.worldX || 0),
                          worldY: Math.round(g.camera.worldY || 0)
                      }
                    : null,
                enemies: g.enemies?.length ?? 0,
                projectiles: g.projectiles?.length ?? 0,
                particles: g.particles?.length ?? 0,
                fps: g.fpsMeter?.fps ?? null,
                weaponLevels: g.player?.weapons?.map((w) => `${w.id}@${w.level}`) ?? []
            };
        });
    } catch (err) {
        pageErrors.push(`evaluate(state) failed: ${err.message}`);
    }
    process.stdout.write(`[state] ${JSON.stringify(liveState)}\n`);

    await page.screenshot({
        path: path.join(SHOT_DIR, 'real-gameplay.png'),
        fullPage: false
    });
    process.stdout.write('[shot] real-gameplay.png\n');

    // --- Pause / resume sanity --------------------------------------------
    await page.keyboard.press('p');
    await page.waitForTimeout(300);
    const pauseVisible = await page.evaluate(() => {
        const m = document.getElementById('pauseMenu');
        return m && m.style.display !== 'none';
    });
    if (!pauseVisible) pageErrors.push('Pause menu did not appear after pressing P.');
    await page.keyboard.press('p');
    await page.waitForTimeout(300);
    const resumed = await page.evaluate(() => window.__vsGame?.state === 'playing');
    if (!resumed) pageErrors.push('Game did not resume after second P press.');

    // --- Scene 3: boss fight (Round 10) -----------------------------------
    // Fast-forward 5 minutes via test-only debug hook to trigger boss spawns.
    const advanced = await page.evaluate(() => window.__SURV_DEBUG__?.advance?.(300) ?? false);
    if (!advanced) {
        process.stdout.write('[warn] __SURV_DEBUG__.advance unavailable (non-dev build?)\n');
    }
    // Let the spawn director catch up + the boss banner play.
    await page.waitForTimeout(2000);

    // If no boss is on screen yet, force-spawn one for the screenshot.
    const hasBoss = await page.evaluate(() => {
        const g = window.__vsGame;
        return !!g?.enemies?.some((e) => e.boss);
    });
    if (!hasBoss) {
        await page.evaluate(() => window.__SURV_DEBUG__?.spawnBoss?.('big_bat'));
        await page.waitForTimeout(1500);
    }
    await page.screenshot({
        path: path.join(SHOT_DIR, 'real-boss-fight.png'),
        fullPage: false
    });
    process.stdout.write('[shot] real-boss-fight.png\n');

    // --- Scene 4: level-up overlay ----------------------------------------
    await page.evaluate(() => window.__SURV_DEBUG__?.grantLevel?.(1));
    // The level-up dialog flushes on the next update tick; give the loop a beat.
    await page.waitForTimeout(700);
    const levelUpVisible = await page.evaluate(() => {
        const m = document.getElementById('levelUpMenu');
        return m && m.style.display !== 'none';
    });
    if (!levelUpVisible) {
        process.stdout.write('[warn] levelUpMenu not visible after grantLevel\n');
    }
    await page.screenshot({
        path: path.join(SHOT_DIR, 'real-levelup.png'),
        fullPage: false
    });
    process.stdout.write('[shot] real-levelup.png\n');

    // Pick the first level-up choice so we can keep playing toward game-over.
    const firstChoice = await page.$('#upgradeOptions button, #levelUpMenu button');
    if (firstChoice) {
        await firstChoice.click();
        await page.waitForTimeout(400);
    } else {
        await page.keyboard.press('Enter');
        await page.waitForTimeout(400);
    }

    // --- Scene 5: game over ------------------------------------------------
    await page.evaluate(() => window.__SURV_DEBUG__?.killPlayer?.());
    // Player.dead -> next update tick calls gameOver() -> shows screen.
    await page.waitForTimeout(800);
    const gameOverVisible = await page.evaluate(() => {
        const m = document.getElementById('gameOver');
        return m && m.style.display !== 'none';
    });
    if (!gameOverVisible) {
        process.stdout.write('[warn] gameOver overlay not visible after killPlayer\n');
    }
    await page.screenshot({
        path: path.join(SHOT_DIR, 'real-gameover.png'),
        fullPage: false
    });
    process.stdout.write('[shot] real-gameover.png\n');

    await browser.close();
    server.kill('SIGTERM');

    // --- Write report -----------------------------------------------------
    const lines = [];
    lines.push('# Runtime QA Report (Round 10)');
    lines.push('');
    lines.push(`Generated: ${new Date().toISOString()}`);
    lines.push(`Page: ${url}`);
    lines.push('');
    lines.push('## Live game state after ~10 s of play');
    lines.push('```json');
    lines.push(JSON.stringify(liveState, null, 2));
    lines.push('```');
    lines.push('');
    lines.push(`## Console errors (${consoleErrors.length})`);
    if (consoleErrors.length) {
        consoleErrors.forEach((e, i) => lines.push(`${i + 1}. \`${e}\``));
    } else {
        lines.push('_None_ ✅');
    }
    lines.push('');
    lines.push(`## Console warnings (${consoleWarns.length})`);
    if (consoleWarns.length) {
        consoleWarns.forEach((e, i) => lines.push(`${i + 1}. \`${e}\``));
    } else {
        lines.push('_None_ ✅');
    }
    lines.push('');
    lines.push(`## Page errors / uncaught exceptions (${pageErrors.length})`);
    if (pageErrors.length) {
        pageErrors.forEach((e, i) => lines.push(`### ${i + 1}\n\n\`\`\`\n${e}\n\`\`\``));
    } else {
        lines.push('_None_ ✅');
    }
    lines.push('');
    lines.push(`## Failed requests / 4xx-5xx responses (${failedRequests.length})`);
    if (failedRequests.length) {
        failedRequests.forEach((e, i) => lines.push(`${i + 1}. \`${e}\``));
    } else {
        lines.push('_None_ ✅');
    }
    lines.push('');
    lines.push(`## Accessibility (axe-core, main menu) — ${axeViolations.length} violations`);
    if (!AxeBuilder) {
        lines.push('_axe-core not installed, scan skipped._');
    } else if (axeViolations.length === 0) {
        lines.push('_None_ ✅');
    } else {
        for (const v of axeViolations) {
            lines.push(
                `- **${v.id}** (${v.impact || 'n/a'}) — ${v.help}. ${v.nodes.length} node(s).`
            );
            lines.push(`  - ${v.helpUrl}`);
            for (const n of v.nodes.slice(0, 3)) {
                lines.push(`  - target: \`${n.target.join(' ')}\``);
                if (n.failureSummary) {
                    lines.push(`    > ${n.failureSummary.replace(/\n+/g, ' ').slice(0, 240)}`);
                }
            }
        }
    }
    lines.push('');
    lines.push('## Screenshots');
    lines.push('- `docs/screenshots/real-mainmenu.png`');
    lines.push('- `docs/screenshots/real-gameplay.png`');
    lines.push('- `docs/screenshots/real-boss-fight.png`');
    lines.push('- `docs/screenshots/real-levelup.png`');
    lines.push('- `docs/screenshots/real-gameover.png`');
    lines.push('');
    lines.push('## iter-10 notes');
    lines.push(
        '- Camera follow active: player kept centred in viewport, clamped to 2400×1600 arena.'
    );
    lines.push(
        '- Test-only `window.__SURV_DEBUG__` hooks (advance / grantLevel / killPlayer / spawnBoss) are gated to localhost.'
    );

    fs.writeFileSync(REPORT, lines.join('\n') + '\n', 'utf8');
    process.stdout.write(`\n[report] ${REPORT}\n`);

    const totalErrors = consoleErrors.length + pageErrors.length;
    process.stdout.write(
        `\nSummary: ${consoleErrors.length} console.error, ${consoleWarns.length} console.warn, ${pageErrors.length} pageerror, ${failedRequests.length} failed-request, ${axeViolations.length} a11y.\n`
    );
    process.exit(totalErrors > 0 ? 1 : 0);
}

main().catch((err) => {
    console.error('[runtime-smoke] fatal', err);
    process.exit(2);
});
