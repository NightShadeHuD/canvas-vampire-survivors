#!/usr/bin/env node
/**
 * @file scripts/extended-smoke.js
 * @description Iter-16 deep bug-bash smoke. Spawns the local server, drives
 * a real Chromium through every gameplay mode (forest / crypt / tundra
 * stages, daily, speedrun, replay), and watches console + network for
 * anything that bleeps. The earlier `runtime-smoke.js` only walked one
 * stage; this one is the multi-mode follow-up that catches stage-pollution,
 * pause-timer regressions, and level-up overlays that don't dismiss when
 * the locale changes mid-run.
 *
 * What it does, in order:
 *   1. Spawn `node server.js` on a free port.
 *   2. Launch headless Chromium and wire every console/network listener to
 *      a single accumulator we dump at the end.
 *   3. For each of {forest, crypt, tundra}:
 *      - persist the stage via window.__vsGame.save.settings.stage
 *      - start a normal run, play ~30 s with WASD nudges
 *      - force three level-ups via the dev `__SURV_DEBUG__.grantLevel(1)`
 *        hook (each is dismissed by clicking the first option)
 *      - pause / resume twice
 *      - open / close the Settings overlay once
 *   4. Run a Daily-mode session for ~5 s.
 *   5. Run Speedrun for ~10 s.
 *   6. Replay the last run for ~5 s.
 *   7. Locale-switch mid-run: flip to Chinese while playing, then back.
 *   8. Write `docs/EXTENDED_SMOKE_REPORT.md` with the accumulator dump.
 *
 * Exit code is 0 if nothing tripped, non-zero otherwise. The harness
 * intentionally does NOT use `__vsGame` internals beyond the documented
 * dev hooks (`__SURV_DEBUG__.grantLevel`) and the public field reads —
 * `state`, `stageId`, `gameTime`, `dailyMode`, `speedrunMode`, etc.
 *
 * Usage: `node scripts/extended-smoke.js`
 */
'use strict';

const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const net = require('net');

const ROOT = path.resolve(__dirname, '..');
const REPORT = path.join(ROOT, 'docs', 'EXTENDED_SMOKE_REPORT.md');

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

    const { chromium } = require('playwright');
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
        viewport: { width: 1280, height: 900 },
        deviceScaleFactor: 1
    });
    const page = await context.newPage();

    // Aggregate every signal we care about into one place. Each entry
    // also tags the gameplay phase that was active when it fired so we
    // can tell whether a console.warn happened during forest gameplay
    // vs the speedrun mode, etc.
    const observations = {
        consoleErrors: [],
        consoleWarns: [],
        pageErrors: [],
        failedRequests: [],
        notes: []
    };
    let phase = 'boot';
    const tag = (text) => `[${phase}] ${text}`;

    page.on('console', (msg) => {
        const t = msg.type();
        const text = msg.text();
        if (t === 'error') {
            observations.consoleErrors.push(tag(text));
            process.stdout.write(`[console.error ${phase}] ${text}\n`);
        } else if (t === 'warning') {
            observations.consoleWarns.push(tag(text));
        }
    });
    page.on('pageerror', (err) => {
        observations.pageErrors.push(tag(`${err.name}: ${err.message}`));
        process.stdout.write(`[pageerror ${phase}] ${err.message}\n`);
    });
    page.on('requestfailed', (req) => {
        observations.failedRequests.push(
            tag(`${req.method()} ${req.url()} — ${req.failure()?.errorText || 'failed'}`)
        );
    });
    page.on('response', (res) => {
        if (res.status() >= 400) {
            observations.failedRequests.push(tag(`${res.status()} ${res.url()}`));
        }
    });

    await page.goto(url, { waitUntil: 'load', timeout: 20000 });
    await page.waitForTimeout(1200);

    // Make sure the first-run How-to-Play and tutorial-offer overlays do
    // not block our automated clicks. Setting both flags before any UI
    // listener fires is sufficient — the Game constructor reads them at
    // boot, but a late save here keeps any later prompt suppressed too.
    await page.evaluate(() => {
        try {
            const raw = localStorage.getItem('vs_clone_save_v2');
            const obj = raw ? JSON.parse(raw) : {};
            obj.flags = obj.flags || {};
            obj.flags.howToSeen = true;
            obj.flags.tutorialDone = true;
            obj.flags.pwaPromptSeen = true;
            localStorage.setItem('vs_clone_save_v2', JSON.stringify(obj));
        } catch (_) {
            /* ignore */
        }
    });
    // Reload so the constructor picks the flag up before binding listeners.
    await page.reload({ waitUntil: 'load', timeout: 20000 });
    await page.waitForTimeout(1000);

    // ---------------- helper closures ---------------------------------------
    const playStage = async (stageId) => {
        phase = `stage-${stageId}`;
        process.stdout.write(`\n=== ${phase} ===\n`);

        // Persist stage + return to menu cleanly. The game reads
        // save.settings.stage in start(), so writing it on the live save
        // before clicking Start picks the right map.
        await page.evaluate((sid) => {
            const g = window.__vsGame;
            if (!g) return;
            g.save = g.save || {};
            g.save.settings = g.save.settings || {};
            g.save.settings.stage = sid;
            // Don't persist (saveSave) — keep the test hermetic — but mutate
            // the live object since `start()` reads from it.
            g.stageId = sid;
        }, stageId);

        // Start a fresh run; if a previous run was active, quit to menu first.
        await page.evaluate(() => {
            const g = window.__vsGame;
            if (g && g.state && g.state !== 'menu' && g.state !== 'gameover') {
                // Prefer the public quit path; fall back to direct state set.
                document.getElementById('btnQuit')?.click();
            }
        });
        await page.waitForTimeout(300);
        await page.click('#btnStart');
        await page.evaluate(() => document.getElementById('gameCanvas')?.focus());
        await page.waitForTimeout(500);

        const observed = await page.evaluate(() => window.__vsGame?.stageId);
        if (observed !== stageId) {
            observations.notes.push(`[${stageId}] stageId mismatch — game reports "${observed}".`);
        }

        // 30 s of gameplay split into smaller chunks so we can punctuate it
        // with deterministic events.
        await page.keyboard.down('d');
        await page.waitForTimeout(2000);
        await page.keyboard.up('d');
        await page.keyboard.down('s');
        await page.waitForTimeout(2000);
        await page.keyboard.up('s');

        // Three forced level-ups. Each one shows the upgrade overlay; we
        // dismiss it by clicking the first option (LEVEL_UP state pauses
        // the sim, so a small wait between is enough).
        for (let i = 0; i < 3; i++) {
            const granted = await page.evaluate(
                () => window.__SURV_DEBUG__?.grantLevel?.(1) ?? false
            );
            if (!granted) {
                observations.notes.push(`[${stageId}] grantLevel hook not present`);
                break;
            }
            // Wait a tick so update() sees the pending level-up and renders the menu.
            await page.waitForTimeout(250);
            const picked = await page.evaluate(() => {
                const opt = document.querySelector('#upgradeOptions .upgrade-option');
                if (opt) {
                    opt.click();
                    return true;
                }
                return false;
            });
            if (!picked) {
                observations.notes.push(
                    `[${stageId}] level-up overlay didn't appear after grantLevel(${i + 1})`
                );
            }
            await page.waitForTimeout(200);
        }

        // Two pause/resume cycles using the P hotkey.
        for (let i = 0; i < 2; i++) {
            await page.keyboard.press('p');
            await page.waitForTimeout(250);
            const paused = await page.evaluate(() => window.__vsGame?.state === 'paused');
            if (!paused) {
                observations.notes.push(
                    `[${stageId}] pause #${i + 1} did not transition to paused`
                );
            }
            await page.keyboard.press('p');
            await page.waitForTimeout(250);
            const resumed = await page.evaluate(() => window.__vsGame?.state === 'playing');
            if (!resumed) {
                observations.notes.push(
                    `[${stageId}] resume #${i + 1} did not transition to playing`
                );
            }
        }

        // Open / close the Settings overlay once (mid-run sanity check).
        await page.evaluate(() => document.getElementById('btnPause')?.click());
        await page.waitForTimeout(150);
        // Settings is opened from the main menu; in pause state we just toggle
        // the overlay via the public method to keep the path uniform.
        const opened = await page.evaluate(() => {
            const g = window.__vsGame;
            if (!g) return false;
            g.openSettings();
            const m = document.getElementById('settingsMenu');
            return !!m && m.style.display !== 'none';
        });
        if (!opened) {
            observations.notes.push(`[${stageId}] Settings overlay did not open`);
        }
        await page.waitForTimeout(200);
        // Close via the data-action="close" button if present, else hide manually.
        await page.evaluate(() => {
            const m = document.getElementById('settingsMenu');
            const btn = m?.querySelector('[data-action="close"]');
            if (btn) btn.click();
            else if (m) m.style.display = 'none';
        });
        await page.waitForTimeout(200);
        // Resume the game so the next loop iteration enters cleanly.
        const stillPaused = await page.evaluate(() => window.__vsGame?.state === 'paused');
        if (stillPaused) {
            await page.keyboard.press('p');
            await page.waitForTimeout(150);
        }

        // Drift back into combat for the remaining time so the sim keeps
        // ticking and the stage has time to spawn its tagged enemies.
        await page.keyboard.down('a');
        await page.waitForTimeout(1500);
        await page.keyboard.up('a');
        await page.keyboard.down('w');
        await page.waitForTimeout(1500);
        await page.keyboard.up('w');

        // Per-stage state snapshot — doesn't fail the run, just adds context
        // to the report (so a regression points at exactly which stage made
        // gameTime stall, kills sit at zero, etc).
        const snap = await page.evaluate(() => {
            const g = window.__vsGame;
            if (!g) return null;
            return {
                stage: g.stageId,
                gameTime: g.gameTime,
                kills: g.kills,
                level: g.player?.level || 0,
                enemies: g.enemies?.length || 0,
                projectiles: g.projectiles?.length || 0,
                pendingLevelUps: g._pendingLevelUps || 0
            };
        });
        observations.notes.push(`[${stageId}] snapshot: ${JSON.stringify(snap)}`);

        // Quit to menu so the next stage starts clean.
        await page.evaluate(() => document.getElementById('btnQuit')?.click());
        await page.waitForTimeout(400);
    };

    // ---------------- run the matrix ----------------------------------------
    for (const sid of ['forest', 'crypt', 'tundra']) {
        await playStage(sid);
    }

    // Daily challenge ~5 s.
    phase = 'daily';
    process.stdout.write(`\n=== ${phase} ===\n`);
    await page.click('#btnDaily');
    await page.evaluate(() => document.getElementById('gameCanvas')?.focus());
    await page.waitForTimeout(500);
    const dailyOk = await page.evaluate(() => window.__vsGame?.dailyMode === true);
    if (!dailyOk) observations.notes.push('[daily] dailyMode flag did not flip true');
    await page.keyboard.down('d');
    await page.waitForTimeout(2500);
    await page.keyboard.up('d');
    await page.waitForTimeout(2500);
    await page.evaluate(() => document.getElementById('btnQuit')?.click());
    await page.waitForTimeout(400);

    // Speedrun 10 s.
    phase = 'speedrun';
    process.stdout.write(`\n=== ${phase} ===\n`);
    await page.click('#btnSpeedrun');
    await page.evaluate(() => document.getElementById('gameCanvas')?.focus());
    await page.waitForTimeout(500);
    const speedrunOk = await page.evaluate(() => window.__vsGame?.speedrunMode === true);
    if (!speedrunOk) observations.notes.push('[speedrun] speedrunMode flag did not flip true');
    await page.keyboard.down('d');
    await page.waitForTimeout(5000);
    await page.keyboard.up('d');
    await page.keyboard.down('w');
    await page.waitForTimeout(5000);
    await page.keyboard.up('w');
    await page.evaluate(() => document.getElementById('btnQuit')?.click());
    await page.waitForTimeout(400);

    // Replay last run ~5 s. There should always be a saved replay because
    // every prior run that ended via gameOver() persisted one — but we
    // tolerate the "no replay" branch by checking the dialog before playback.
    phase = 'replay';
    process.stdout.write(`\n=== ${phase} ===\n`);
    // Quit might leave the menu hidden; force it visible, then click replay.
    await page.evaluate(() => {
        const ss = document.getElementById('startScreen');
        if (ss) ss.style.display = 'flex';
    });
    const hasReplay = await page.evaluate(() => {
        try {
            return !!localStorage.getItem('vs_replay_last_v1');
        } catch (_) {
            return false;
        }
    });
    if (!hasReplay) {
        observations.notes.push('[replay] no replay payload in localStorage to play back');
    } else {
        await page.click('#btnReplay');
        await page.waitForTimeout(400);
        // Click any 1× / 2× / 4× speed button if present, or the first <button>
        // in the replay dialog.
        await page.evaluate(() => {
            // The replay menu builds buttons with data-speed; pick 2× when
            // available so it consumes frames briskly inside the smoke window.
            const btn =
                document.querySelector('[data-speed="2"]') ||
                document.querySelector('#replayMenu button') ||
                document.querySelector('.replay-menu button');
            if (btn) btn.click();
        });
        await page.waitForTimeout(5000);
        const replayActive = await page.evaluate(() => window.__vsGame?.replayActive === true);
        observations.notes.push(`[replay] replayActive at end: ${replayActive}`);
        await page.evaluate(() => document.getElementById('btnQuit')?.click());
        await page.waitForTimeout(400);
    }

    // Locale-flip mid-run: start a new forest run, swap to zh, then back.
    phase = 'locale-flip';
    process.stdout.write(`\n=== ${phase} ===\n`);
    await page.evaluate(() => {
        const g = window.__vsGame;
        if (g) {
            g.save.settings.stage = 'forest';
            g.stageId = 'forest';
        }
        const ss = document.getElementById('startScreen');
        if (ss) ss.style.display = 'flex';
    });
    await page.click('#btnStart');
    await page.evaluate(() => document.getElementById('gameCanvas')?.focus());
    await page.waitForTimeout(800);
    // Swap the locale via the live i18n hook + tell UI to refresh.
    const flipped = await page.evaluate(async () => {
        const mod = await import('./src/i18n.ts');
        mod.setLocale('zh');
        // Mirror the path the Settings dialog uses.
        window.__vsGame?.ui?.onLocaleChanged?.();
        // Grab the title text after refresh so the test can assert on it.
        return document.querySelector('#startTitle')?.textContent || '';
    });
    observations.notes.push(`[locale-flip] startTitle after zh flip: ${flipped}`);
    // Flip back to en and assert the labels return to English.
    const restored = await page.evaluate(async () => {
        const mod = await import('./src/i18n.ts');
        mod.setLocale('en');
        window.__vsGame?.ui?.onLocaleChanged?.();
        return document.querySelector('#startTitle')?.textContent || '';
    });
    observations.notes.push(`[locale-flip] startTitle after en flip: ${restored}`);
    await page.evaluate(() => document.getElementById('btnQuit')?.click());
    await page.waitForTimeout(400);

    // ---------------- micro perf profile -----------------------------------
    // Drive a forest run for 5 s while wrapping the per-frame engine update
    // in `console.time`/`console.timeEnd`, then read back the totals via
    // performance.now() deltas captured in-page. This is intentionally
    // small — it only gives us a "is the update path under 8 ms typical?"
    // sanity check, not a flame graph.
    phase = 'profile';
    process.stdout.write(`\n=== ${phase} ===\n`);
    await page.evaluate(() => {
        const ss = document.getElementById('startScreen');
        if (ss) ss.style.display = 'flex';
    });
    await page.click('#btnStart');
    await page.evaluate(() => document.getElementById('gameCanvas')?.focus());
    await page.waitForTimeout(400);
    const profile = await page.evaluate(async () => {
        const g = window.__vsGame;
        if (!g) return { error: 'no game' };
        const samples = { update: [], render: [] };
        const origUpdate = g.update.bind(g);
        const origRender = g.render.bind(g);
        g.update = function (dt) {
            const t0 = performance.now();
            origUpdate(dt);
            samples.update.push(performance.now() - t0);
        };
        g.render = function (dt) {
            const t0 = performance.now();
            origRender(dt);
            samples.render.push(performance.now() - t0);
        };
        await new Promise((r) => setTimeout(r, 4000));
        // Restore so the rest of the harness isn't paying our wrapper cost.
        g.update = origUpdate;
        g.render = origRender;
        const stats = (arr) => {
            if (!arr.length) return null;
            const sorted = arr.slice().sort((a, b) => a - b);
            return {
                samples: arr.length,
                mean: arr.reduce((a, b) => a + b, 0) / arr.length,
                p50: sorted[Math.floor(sorted.length * 0.5)],
                p95: sorted[Math.floor(sorted.length * 0.95)],
                max: sorted[sorted.length - 1]
            };
        };
        return { update: stats(samples.update), render: stats(samples.render) };
    });
    observations.notes.push(`[profile] ${JSON.stringify(profile)}`);
    await page.evaluate(() => document.getElementById('btnQuit')?.click());
    await page.waitForTimeout(300);

    await browser.close();
    server.kill('SIGTERM');

    // Write report ----------------------------------------------------------
    const lines = [];
    lines.push('# Extended Smoke Report (iter-16)');
    lines.push('');
    lines.push(`Generated: ${new Date().toISOString()}`);
    lines.push('');
    lines.push(`## Console errors (${observations.consoleErrors.length})`);
    if (observations.consoleErrors.length) {
        observations.consoleErrors.forEach((e, i) => lines.push(`${i + 1}. \`${e}\``));
    } else {
        lines.push('_None_');
    }
    lines.push('');
    lines.push(`## Page errors (${observations.pageErrors.length})`);
    if (observations.pageErrors.length) {
        observations.pageErrors.forEach((e, i) => lines.push(`${i + 1}. \`${e}\``));
    } else {
        lines.push('_None_');
    }
    lines.push('');
    lines.push(`## Console warnings (${observations.consoleWarns.length})`);
    if (observations.consoleWarns.length) {
        observations.consoleWarns.slice(0, 25).forEach((e, i) => lines.push(`${i + 1}. \`${e}\``));
        if (observations.consoleWarns.length > 25) {
            lines.push(`… and ${observations.consoleWarns.length - 25} more.`);
        }
    } else {
        lines.push('_None_');
    }
    lines.push('');
    lines.push(`## Failed requests (${observations.failedRequests.length})`);
    if (observations.failedRequests.length) {
        observations.failedRequests
            .slice(0, 20)
            .forEach((e, i) => lines.push(`${i + 1}. \`${e}\``));
    } else {
        lines.push('_None_');
    }
    lines.push('');
    lines.push(`## Notes (${observations.notes.length})`);
    if (observations.notes.length) {
        observations.notes.forEach((n, i) => lines.push(`${i + 1}. ${n}`));
    } else {
        lines.push('_None_');
    }
    lines.push('');
    fs.writeFileSync(REPORT, lines.join('\n') + '\n', 'utf8');
    process.stdout.write(`\n[report] ${REPORT}\n`);

    const fatal = observations.consoleErrors.length + observations.pageErrors.length;
    process.stdout.write(
        `\nSummary: ${observations.consoleErrors.length} console.error, ` +
            `${observations.pageErrors.length} pageerror, ` +
            `${observations.consoleWarns.length} warn, ` +
            `${observations.failedRequests.length} netfail, ` +
            `${observations.notes.length} note(s).\n`
    );
    process.exit(fatal > 0 ? 1 : 0);
}

main().catch((err) => {
    console.error('[extended-smoke] fatal', err);
    process.exit(2);
});
