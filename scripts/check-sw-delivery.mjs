#!/usr/bin/env node
/**
 * @file scripts/check-sw-delivery.mjs
 * @description End-to-end proof of the F3 property the static gate can only
 * approximate: **a returning player receives the new bundle, and the old cache
 * is purged.**
 *
 * WHY A BROWSER IS THE ONLY THING THAT CAN SETTLE THIS
 *
 * `check:sw-cache` proves the cache NAME matches its inputs. It cannot prove the
 * name is enough, because what decides whether a release reaches a player is the
 * browser's update algorithm: a new worker is installed only when the bytes of
 * `service-worker.js` change, and only `activate` deletes the old cache. A
 * cache-first worker whose bytes did not change serves the old bundle forever,
 * whatever its name says. That is a claim about Chromium, so it is settled in
 * Chromium.
 *
 * It was settled the other way once already: an earlier probe hardcoded its bump
 * to `survivor-v3.0.1`, which later became the name the site actually shipped —
 * so its "changed" release was byte-identical to the installed one and its
 * CONTROL, the half that reproduces the bug, could no longer fire. A control that
 * cannot fail is not evidence. **Both names here are derived from the bytes the
 * server is holding**, and the probe refuses to call the releases distinguishable
 * unless the derived names and the worker bytes actually differ.
 *
 * THE TWO SCENARIOS, IN FRESH STORAGE PARTITIONS
 *
 *   fixed   release A installed; `dist/main.js` changes AND the worker is
 *           regenerated. Assert: the page runs the NEW bundle, the new cache
 *           exists, the old cache is GONE.
 *   control release A installed; `dist/main.js` changes and the worker is held
 *           BYTE-IDENTICAL — the hand-maintained behaviour this defect was.
 *           Assert: the page still runs the OLD bundle, the old cache is still
 *           there, and no new cache appeared — while the server is proven to be
 *           serving the new bundle over the wire.
 *
 * The control is what makes the fixed half mean anything. It is also this
 * probe's watched failure: the assertions that hold in `fixed` are the same ones
 * shown false in `control`.
 *
 * WHAT IT DOES NOT COVER: only Chromium is driven, so this is evidence about one
 * engine's update algorithm. Safari and Firefox are not measured here.
 *
 * Usage:
 *   npm run build && node scripts/check-sw-delivery.mjs
 */

import {
    cpSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    readdirSync,
    rmSync,
    writeFileSync
} from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { cacheNameFromDigest, digestOf, renderWorker } from './lib/sw-cache-name.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');

/** Everything the served site needs, so the worker's precache list resolves. */
const COPIED = ['index.html', 'styles.css', 'manifest.json', 'docs/hero.svg', 'docs/og-card.svg'];

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png'
};

const results = [];
function step(name, ok, detail = '') {
    results.push({ name, ok, detail });
    console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name.padEnd(54)} ${detail}`);
}

/** Every file under `dir`, relative and sorted. */
function listFiles(dir, base = dir) {
    const out = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) out.push(...listFiles(full, base));
        else out.push(path.relative(base, full));
    }
    return out.sort();
}

/**
 * The cache name for the bytes a served site holds, excluding the worker itself.
 *
 * The worker is excluded because a name cannot contain its own digest. This is
 * the same construction `scripts/lib/sw-cache-name.mjs` uses for the repository,
 * applied to the temporary site so BOTH names are derived rather than written
 * down — which is the fix for the probe whose control stopped firing.
 */
function siteCacheName(site) {
    const entries = listFiles(site)
        .filter((rel) => rel !== 'service-worker.js')
        .map((rel) => ({ path: rel, bytes: readFileSync(path.join(site, rel)) }));
    return cacheNameFromDigest(digestOf(entries));
}

/** A static server over a directory that is mutated between loads, so the origin never moves. */
function serve(root) {
    return new Promise((resolve, reject) => {
        const server = createServer((req, res) => {
            const rel = decodeURIComponent((req.url || '/').split('?')[0]);
            const target = path.normalize(path.join(root, rel === '/' ? '/index.html' : rel));
            if (!target.startsWith(root)) {
                res.writeHead(403);
                res.end('forbidden');
                return;
            }
            let body;
            try {
                body = readFileSync(target);
            } catch {
                res.writeHead(404, { 'Content-Type': 'text/plain' });
                res.end('404');
                return;
            }
            res.writeHead(200, {
                'Content-Type':
                    MIME[path.extname(target).toLowerCase()] || 'application/octet-stream',
                // GitHub Pages caches for 600s. `no-store` here means a stale read is
                // the SERVICE WORKER's doing and never the HTTP cache's, which is the
                // claim under test. (The worker script itself is refetched on every
                // update check under the default `updateViaCache: 'imports'`.)
                'Cache-Control': 'no-store'
            });
            res.end(body);
        });
        server.on('error', reject);
        server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
    });
}

/**
 * Stamp a marker onto `dist/main.js` so the page can be asked which bundle it
 * actually EXECUTED, rather than which one the server is holding.
 *
 * The pristine file is copied from the repository each time, so a marker is
 * never stripped by string surgery.
 */
function tagBundle(site, marker) {
    const source = readFileSync(path.join(repoRoot, 'dist', 'main.js'), 'utf8');
    writeFileSync(
        path.join(site, 'dist', 'main.js'),
        `${source}\n// release ${marker}\nwindow.__RELEASE__ = ${JSON.stringify(marker)};\n`
    );
}

let chromium;
try {
    ({ chromium } = await import('playwright'));
} catch (err) {
    console.error(`check-sw-delivery: could not load playwright — ${err.message}`);
    console.error('Run `npm ci` first.');
    process.exit(1);
}

for (const rel of [...COPIED, 'dist/main.js']) {
    try {
        readFileSync(path.join(repoRoot, rel));
    } catch {
        console.error(`check-sw-delivery: ${rel} is missing — run \`npm run build\` first.`);
        process.exit(1);
    }
}

const workerTemplate = readFileSync(path.join(repoRoot, 'service-worker.js'), 'utf8');
const renderedFor = (site) => {
    const name = siteCacheName(site);
    const worker = renderWorker(workerTemplate, name);
    if (!worker.ok) throw new Error(`could not render the worker: ${worker.reason}`);
    return { name, text: worker.text };
};

const scratch = mkdtempSync(path.join(tmpdir(), 'sw-delivery-'));
const site = path.join(scratch, 'site');
mkdirSync(path.join(site, 'dist'), { recursive: true });
mkdirSync(path.join(site, 'docs'), { recursive: true });
for (const rel of COPIED) cpSync(path.join(repoRoot, rel), path.join(site, rel));
cpSync(path.join(repoRoot, 'dist'), path.join(site, 'dist'), { recursive: true });

const { server, port } = await serve(site);
const url = `http://127.0.0.1:${port}/`;

let browser;
try {
    browser = await chromium.launch({ headless: true });
} catch (err) {
    console.error(
        `check-sw-delivery: could not launch Chromium — ${String(err.message).split('\n')[0]}`
    );
    console.error('\nInstall the browser once with:\n    npx playwright install chromium');
    rmSync(scratch, { recursive: true, force: true });
    server.close();
    process.exit(1);
}

/** Poll a page predicate until it holds. */
async function until(page, fn, arg, timeoutMs = 25000) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
        if (await page.evaluate(fn, arg).catch(() => false)) return true;
        if (Date.now() > deadline) return false;
        await new Promise((r) => setTimeout(r, 100));
    }
}

const cacheNames = (page) => page.evaluate(() => caches.keys());
const markerIn = (page) => page.evaluate(() => window.__RELEASE__ ?? null);

/** A fresh storage partition with release A installed and controlling the page. */
async function installRelease(workerText) {
    writeFileSync(path.join(site, 'service-worker.js'), workerText);
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'load' });
    await page.evaluate(() => navigator.serviceWorker.ready);
    const controlled = await until(page, () => Boolean(navigator.serviceWorker.controller));
    return { context, page, controlled };
}

try {
    for (const scenario of ['fixed', 'control']) {
        console.log(`\n${scenario}:`);

        // --- release A ------------------------------------------------------
        tagBundle(site, 'A');
        const releaseA = renderedFor(site);
        const { context, page, controlled } = await installRelease(releaseA.text);
        step('a worker installed and took control of the page', controlled);
        const installedCaches = await cacheNames(page);
        step(
            `the installed worker cached under ${releaseA.name}`,
            installedCaches.includes(releaseA.name),
            installedCaches.join(', ')
        );
        const servedA = await markerIn(page);
        step('the page is running release A', servedA === 'A', `window.__RELEASE__=${servedA}`);

        // --- the asset changes ----------------------------------------------
        const changed = scenario === 'fixed' ? 'B' : 'C';
        tagBundle(site, changed);
        const releaseNew = renderedFor(site);
        // `fixed` regenerates the worker; `control` holds the SAME bytes, which is
        // exactly the hand-maintained behaviour that made 146 releases invisible.
        const workerText = scenario === 'fixed' ? releaseNew.text : releaseA.text;
        const workerBytesChanged = workerText !== releaseA.text;

        step(
            scenario === 'fixed'
                ? 'regenerating moves BOTH the cache name and the worker bytes'
                : 'the control holds the worker BYTE-IDENTICAL',
            scenario === 'fixed'
                ? releaseNew.name !== releaseA.name && workerBytesChanged
                : !workerBytesChanged,
            `${releaseA.name} -> ${releaseNew.name}${workerBytesChanged ? '' : ' (worker unchanged)'}`
        );

        // The server really is serving the new bundle. Without this, "the old
        // bundle is still running" would be unfalsifiable — the network might
        // never have had the new one.
        const onTheWire = await fetch(`${url}dist/main.js`).then((r) => r.text());
        step(
            `the server now serves release ${changed} over the wire`,
            onTheWire.includes(`__RELEASE__ = "${changed}"`),
            `${onTheWire.length} bytes`
        );

        // --- the update check -----------------------------------------------
        // A reload alone does NOT check for a new worker within 24h of the last
        // check; the browser only does it on navigation once the registration is
        // stale. An explicit update() is what a returning player's next visit
        // performs when the check does run, and it is the strongest probe available.
        // Waiting is not optional, and getting it wrong is how a probe lies: the new
        // cache KEY appears as soon as `install` calls `caches.open`, which is BEFORE
        // `skipWaiting()` and long before `activate` purges anything. Reloading at
        // that moment measures the OLD worker and reports a product failure that is
        // really a race in the probe. (It did, on this probe's first run.)
        //
        // So the signal is `controllerchange`: `clients.claim()` firing is the exact
        // moment the new worker took the page over. Only then is the cache set
        // expected to have settled.
        writeFileSync(path.join(site, 'service-worker.js'), workerText);
        await page.evaluate(() => {
            window.__SW_TAKEOVER__ = false;
            navigator.serviceWorker.addEventListener('controllerchange', () => {
                window.__SW_TAKEOVER__ = true;
            });
        });
        await page.evaluate(() =>
            navigator.serviceWorker.getRegistration().then((r) => (r ? r.update() : null))
        );

        const tookOver = await until(
            page,
            () => window.__SW_TAKEOVER__ === true,
            null,
            scenario === 'fixed' ? 25000 : 8000
        );
        // Polled rather than sampled, so a broken `activate` costs the timeout
        // instead of passing because the assertion looked too early.
        const settled = await until(
            page,
            (want) => caches.keys().then((k) => k.includes(want.now) && !k.includes(want.was)),
            { now: releaseNew.name, was: releaseA.name },
            scenario === 'fixed' ? 20000 : 4000
        );

        await page.reload({ waitUntil: 'load' });
        const finalMarker = await markerIn(page);
        const finalCaches = await cacheNames(page);

        if (scenario === 'fixed') {
            step('the new worker took over the page (controllerchange)', tookOver);
            step('the new cache is live and the old one is gone', settled, finalCaches.join(', '));
            step(
                'the page is running the NEW bundle',
                finalMarker === 'B',
                `window.__RELEASE__=${finalMarker}`
            );
            step(
                'the OLD cache was purged',
                !finalCaches.includes(releaseA.name),
                finalCaches.join(', ') || '(none)'
            );
        } else {
            step('no new worker ever took control', !tookOver);
            step(
                'the page is STILL running the OLD bundle — the defect reproduced',
                finalMarker === 'A',
                `window.__RELEASE__=${finalMarker}`
            );
            step(
                'the old cache is still present — nothing purged it',
                finalCaches.includes(releaseA.name),
                finalCaches.join(', ')
            );
            step(
                'no cache for the new release ever appeared',
                !finalCaches.includes(releaseNew.name),
                finalCaches.join(', ')
            );
        }

        await context.close();
    }
} finally {
    await browser.close();
    server.close();
    rmSync(scratch, { recursive: true, force: true });
}

const failed = results.filter((r) => !r.ok);
if (failed.length > 0) {
    console.error(`\ncheck-sw-delivery: FAILED — ${failed.length} assertion(s):`);
    for (const f of failed) console.error(`    ${f.name}${f.detail ? `  (${f.detail})` : ''}`);
    process.exit(1);
}
console.log(
    `\ncheck-sw-delivery: ${results.length} assertion(s) hold in Chromium — a regenerated worker ` +
        'delivers the new bundle and purges the old cache, and the byte-identical control still ' +
        'reproduces the failure it is there to reproduce.'
);
