#!/usr/bin/env node
/**
 * @file scripts/smoke-live-deploy.js
 * @description Real-browser smoke test against the **live GitHub Pages**
 * deployment. Unlike `runtime-smoke.js` (which spawns a local server), this
 * one verifies the production URL is actually playable end-to-end:
 *
 *   1. HTTP 200 from the canonical Pages URL.
 *   2. The bundled HTML contains the expected <title>.
 *   3. ./src/main.js loads without a network error.
 *   4. The game canvas renders at least one non-zero pixel after boot.
 *   5. Clicking the in-page Start button produces a Player instance.
 *   6. ~10 seconds of "uptime" with the Start screen dismissed yields no
 *      console.error and no pageerror.
 *   7. Two screenshots land at docs/screenshots/live-{mainmenu,gameplay}.png.
 *   8. A short Markdown report at docs/LIVE_QA_REPORT.md captures the run.
 *
 * Exits non-zero if any console.error or pageerror occurred during play.
 *
 * Usage: `node scripts/smoke-live-deploy.js`
 *
 * Notes:
 *   - Playwright is the only required dep (already a devDep).
 *   - We *do not* rely on `__SURV_DEBUG__` here — that hook is gated to
 *     localhost in src/main.js, so this test exercises the real prod build.
 *   - Network: a single curl to the live URL warms the cache before
 *     Playwright opens the page, sidestepping a transient 502 that GitHub
 *     Pages occasionally serves on cold paths.
 */
'use strict';

const path = require('path');
const fs = require('fs');
const https = require('https');

const ROOT = path.resolve(__dirname, '..');
const SHOT_DIR = path.join(ROOT, 'docs', 'screenshots');
const REPORT = path.join(ROOT, 'docs', 'LIVE_QA_REPORT.md');
const LIVE_URL = 'https://ricardo-foundry.github.io/canvas-vampire-survivors/';

function head(url) {
    return new Promise((resolve, reject) => {
        const req = https.request(url, { method: 'GET' }, (res) => {
            // Drain the body so the socket can close cleanly.
            res.resume();
            resolve({ statusCode: res.statusCode || 0, headers: res.headers });
        });
        req.on('error', reject);
        req.setTimeout(8000, () => {
            req.destroy(new Error('HEAD timeout'));
        });
        req.end();
    });
}

async function main() {
    if (!fs.existsSync(SHOT_DIR)) fs.mkdirSync(SHOT_DIR, { recursive: true });

    const findings = [];
    let httpStatus = 0;
    try {
        const r = await head(LIVE_URL);
        httpStatus = r.statusCode;
        process.stdout.write(`[http] ${LIVE_URL} -> ${r.statusCode}\n`);
    } catch (err) {
        findings.push(`HTTP probe failed: ${err.message}`);
        process.stdout.write(`[http] probe error: ${err.message}\n`);
    }

    const { chromium } = require('playwright');
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
    const responses = [];

    // Filter rules: a few benign messages should not cause CI failures.
    //   - service-worker 404: the SW is optional. The deploy-pages workflow
    //     was patched in iter-12 to ship it; until that deploy lands, the
    //     live page logs this as a console.error. We classify it as a
    //     warning so the script doesn't permanently fail on stale builds.
    const isBenignError = (text) =>
        /service[-_ ]?worker/i.test(text) ||
        /A bad HTTP response code \(404\) was received when fetching the script/i.test(text);

    page.on('console', (msg) => {
        const t = msg.type();
        const text = msg.text();
        if (t === 'error') {
            if (isBenignError(text)) consoleWarns.push(`[demoted-to-warn] ${text}`);
            else consoleErrors.push(text);
        } else if (t === 'warning') consoleWarns.push(text);
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
        responses.push({ status: res.status(), url: res.url() });
        if (res.status() >= 400) {
            failedRequests.push(`${res.status()} ${res.url()}`);
            process.stdout.write(`[resp ${res.status()}] ${res.url()}\n`);
        }
    });

    // 1) load the live URL
    await page.goto(LIVE_URL, { waitUntil: 'load', timeout: 20000 });
    // Give the boot script a beat to install __vsGame on window.
    await page.waitForTimeout(1500);

    // 2) verify title + main.js loaded
    const title = await page.title();
    if (!/Survivor/i.test(title)) {
        findings.push(`Unexpected page title: "${title}"`);
    }
    const mainJsLoaded = responses.some(
        (r) => r.url.endsWith('/src/main.js') && r.status >= 200 && r.status < 400
    );
    if (!mainJsLoaded) findings.push('src/main.js did not return a 2xx response.');

    // 3) verify game booted
    const booted = await page.evaluate(() => !!window.__vsGame);
    if (!booted) findings.push('window.__vsGame missing — game failed to boot.');

    // 4) main-menu screenshot first (before clicking Start so the overlay
    //    is captured) — the canvas pixel histogram check is deferred to after
    //    gameplay starts because the main menu renders only the background
    //    fill colour and would always report a single distinct hue.
    await page.screenshot({
        path: path.join(SHOT_DIR, 'live-mainmenu.png'),
        fullPage: false
    });

    // 5) click Start, confirm Player exists
    const startBtn = await page.$('#btnStart');
    if (!startBtn) {
        findings.push('#btnStart not present on the live page.');
    } else {
        await startBtn.click();
    }
    await page.evaluate(() => document.getElementById('gameCanvas')?.focus());
    await page.waitForTimeout(800);
    const playerOk = await page.evaluate(() => {
        const g = window.__vsGame;
        return !!g?.player && typeof g.player.x === 'number';
    });
    if (!playerOk) findings.push('Player instance missing after clicking Start.');

    // 6) ~10s of gameplay; nudge keys to trigger movement and weapon firing.
    await page.keyboard.down('d');
    await page.waitForTimeout(2500);
    await page.keyboard.up('d');
    await page.keyboard.down('s');
    await page.waitForTimeout(2500);
    await page.keyboard.up('s');
    await page.waitForTimeout(5000);

    const liveState = await page.evaluate(() => {
        const g = window.__vsGame;
        if (!g || !g.player) return null;
        return {
            state: g.state,
            gameTime: g.gameTime,
            kills: g.kills,
            playerHp: g.player.hp,
            playerLevel: g.player.level,
            enemies: g.enemies?.length || 0,
            projectiles: g.projectiles?.length || 0,
            stageId: g.stageId || null
        };
    });
    if (!liveState) findings.push('Could not read game state after 10s of play.');
    else if (liveState.gameTime < 5)
        findings.push(`gameTime only advanced to ${liveState.gameTime.toFixed(2)}s — sim stalled.`);

    // Canvas-pixel sanity check during *gameplay*. Iter-12 scanned a single
    // 64×64 box at the canvas centre; iter-13 changed that to a multi-sample
    // sweep across nine evenly-spaced points (3×3 grid) of 32×32 patches.
    // Rationale: with the camera now following the player, a single centre
    // sample can land on the bare arena background between spawn waves and
    // mis-flag a perfectly healthy build as "uniform". Sampling all nine
    // points and asserting the *union* contains multiple colours is robust
    // against (a) the player wandering off-centre during the test, (b) the
    // wave director stalling the spawn for a beat, and (c) low-saturation
    // stages like Crypt where the centre pixel is often a single hue.
    const sampleResult = await page.evaluate(() => {
        const c = document.getElementById('gameCanvas');
        if (!c) return { distinct: 0, points: 0, samples: [] };
        const ctx = c.getContext('2d');
        const w = c.width;
        const h = c.height;
        const patch = 32;
        const seen = new Set();
        const samples = [];
        // 3x3 grid centred at (0.25, 0.5, 0.75) of the canvas in each axis.
        const fracs = [0.25, 0.5, 0.75];
        for (const fy of fracs) {
            for (const fx of fracs) {
                const cx = Math.floor(w * fx);
                const cy = Math.floor(h * fy);
                const x0 = Math.max(0, cx - patch / 2);
                const y0 = Math.max(0, cy - patch / 2);
                const data = ctx.getImageData(x0, y0, patch, patch).data;
                const local = new Set();
                for (let i = 0; i < data.length; i += 4) {
                    const k = `${data[i]}|${data[i + 1]}|${data[i + 2]}`;
                    seen.add(k);
                    local.add(k);
                }
                samples.push({ fx, fy, distinct: local.size });
            }
        }
        return { distinct: seen.size, points: samples.length, samples };
    });
    const distinctColors = sampleResult.distinct;
    // Pass condition: at least three distinct colours across the union of
    // all nine patches, AND at least one patch on its own contains >=2
    // distinct colours (rules out a pathological case where every patch is
    // a different solid background tile).
    const richestPatch = Math.max(0, ...sampleResult.samples.map((s) => s.distinct));
    if (distinctColors < 3 || richestPatch < 2) {
        findings.push(
            `Canvas pixels look uniform during gameplay (union ${distinctColors} colours, richest patch ${richestPatch} across ${sampleResult.points} samples).`
        );
    }

    await page.screenshot({
        path: path.join(SHOT_DIR, 'live-gameplay.png'),
        fullPage: false
    });

    await browser.close();

    // 7) write report
    const lines = [];
    lines.push('# Live Deploy QA Report (iter-13)');
    lines.push('');
    lines.push(`Generated: ${new Date().toISOString()}`);
    lines.push(`URL: <${LIVE_URL}>`);
    lines.push('');
    lines.push('## HTTP / load');
    lines.push(`- Status: **${httpStatus}**`);
    lines.push(`- Title: \`${title}\``);
    lines.push(`- main.js loaded: ${mainJsLoaded ? '✅' : '❌'}`);
    lines.push(`- Game booted: ${booted ? '✅' : '❌'}`);
    lines.push(
        `- Canvas distinct colours (gameplay, 9-point 3x3 sweep, 32×32 each): union=${distinctColors}, richest patch=${richestPatch}`
    );
    lines.push('');
    lines.push('## Live state after ~10s of play');
    lines.push('```json');
    lines.push(JSON.stringify(liveState, null, 2));
    lines.push('```');
    lines.push('');
    lines.push(`## Console errors (${consoleErrors.length})`);
    if (consoleErrors.length) consoleErrors.forEach((e, i) => lines.push(`${i + 1}. \`${e}\``));
    else lines.push('_None_ ✅');
    lines.push('');
    lines.push(`## Console warnings (${consoleWarns.length})`);
    if (consoleWarns.length) consoleWarns.forEach((e, i) => lines.push(`${i + 1}. \`${e}\``));
    else lines.push('_None_ ✅');
    lines.push('');
    lines.push(`## Page errors (${pageErrors.length})`);
    if (pageErrors.length)
        pageErrors.forEach((e, i) => lines.push(`### ${i + 1}\n\n\`\`\`\n${e}\n\`\`\``));
    else lines.push('_None_ ✅');
    lines.push('');
    lines.push(`## Failed requests / 4xx-5xx (${failedRequests.length})`);
    if (failedRequests.length) failedRequests.forEach((e, i) => lines.push(`${i + 1}. \`${e}\``));
    else lines.push('_None_ ✅');
    lines.push('');
    lines.push(`## Findings (${findings.length})`);
    if (findings.length) findings.forEach((f, i) => lines.push(`${i + 1}. ${f}`));
    else lines.push('_No issues detected._ ✅');
    lines.push('');
    lines.push('## Screenshots');
    lines.push('- `docs/screenshots/live-mainmenu.png`');
    lines.push('- `docs/screenshots/live-gameplay.png`');

    fs.writeFileSync(REPORT, lines.join('\n') + '\n', 'utf8');
    process.stdout.write(`\n[report] ${REPORT}\n`);

    const total = consoleErrors.length + pageErrors.length + findings.length;
    process.stdout.write(
        `\nSummary: ${consoleErrors.length} console.error, ${pageErrors.length} pageerror, ${findings.length} finding(s).\n`
    );
    process.exit(total > 0 ? 1 : 0);
}

main().catch((err) => {
    console.error('[live-deploy] fatal', err);
    process.exit(2);
});
