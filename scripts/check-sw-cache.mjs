#!/usr/bin/env node
/**
 * @file scripts/check-sw-cache.mjs
 * @description The cache name `service-worker.js` serves under must match the
 * content it caches. Regenerates to a TEMPORARY PATH and DIFFS.
 *
 * WHY THIS IS A GATE AND NOT A BUILD STEP
 *
 * The obvious implementation is for `npm run build` to write the name as it
 * emits `dist/`. That would make this gate unable to fail: `build` is the last
 * step of `npm run verify`, so it would silently REPAIR the drift and the check
 * would then agree with itself. This repository has already paid for that once —
 * `check:godot` regenerated the Godot data and then verified it, so corrupting a
 * committed value produced "ok". Rule 13: **generate to a temporary directory
 * and DIFF.**
 *
 * So the generator is `npm run gen:sw-cache`, it is run deliberately, and this
 * gate refuses a worker whose name does not match its inputs. Nothing that runs
 * inside the chain can repair what the chain checks.
 *
 * WHAT IT ALSO PROTECTS, AND WHY THAT IS IN THIS FILE
 *
 * A cache name is only worth deriving if the worker is actually SERVED, at a
 * scope that covers the page. That is a property of two files this repository
 * does not otherwise connect:
 *
 *   - `index.html` registers `./service-worker.js`. A worker's default scope is
 *     its own directory, so moving the file to `dist/` would silently reduce its
 *     scope to `/dist/` and stop it controlling `index.html`, `styles.css` and
 *     the root `/` at all. GitHub Pages cannot send `Service-Worker-Allowed`, so
 *     that is not fixable with a header.
 *   - `.github/workflows/deploy-pages.yml` copies `service-worker.js` into
 *     `_site/`, which is what makes it reachable at the root of the deployed site.
 *
 * Both are asserted below. Without them a "correct" generated name could be
 * deployed for a worker nobody loads, which is the same defect wearing a
 * different hat.
 *
 * THE GUARANTEE, WHICH IS NOW MECHANICAL
 *
 * "Any change to the bytes a player receives changes at least one input" used to
 * be a claim about a hand-written list, and the list was wrong three ways:
 * `scripts/build.mjs` was not on it (adding `--removeComments` changed every byte
 * of `dist/main.js` while this gate stayed GREEN), and `game.js` and all but two
 * of the `docs/**` files were SERVED by `cp -r docs _site/docs` and were not on
 * it either.
 *
 * The served set is now PARSED OUT OF `.github/workflows/deploy-pages.yml` and
 * every path in it is an input, so the guarantee holds by construction rather
 * than by memory — and the assertion that says so was watched failing: deleting
 * the loop that adds them names all 53 `docs/**` files.
 *
 * WHAT IT DOES NOT COVER, STATED WHERE IT IS OWNED
 *
 * The name is a digest of the INPUTS of the served bytes, not of the served
 * bytes themselves. `dist/` cannot be the input, because it is gitignored: a
 * gate whose verdict depends on an untracked artefact reads nothing in a fresh
 * checkout. The substitution has one residual hole — a `tsc` whose emitted
 * JavaScript changed while every committed input stayed identical would move the
 * bundle without moving the name. `package-lock.json` is in the input set so the
 * ordinary form of that (a compiler upgrade) cannot happen silently; a compiler
 * that changed its output with no version change is not something this gate can
 * see, and pretending otherwise would be the overclaim this file exists to
 * avoid.
 *
 * The other half — that the name moving is SUFFICIENT to deliver the bytes — is
 * not checkable statically at all, and is settled in a browser by
 * `scripts/check-sw-delivery.mjs`.
 *
 * Usage:
 *   node scripts/check-sw-cache.mjs             # enforce (gate)
 *   node scripts/check-sw-cache.mjs --write     # regenerate the name (npm run gen:sw-cache)
 *   node scripts/check-sw-cache.mjs --dry-run   # say what --write would change
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { applyEdit } from './lib/source-edit.mjs';
import {
    SITE_DIR,
    WORKER_PATH,
    cacheLines,
    expectedForRepo,
    readCacheName
} from './lib/sw-cache-name.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');

const write = process.argv.includes('--write');
const dryRun = process.argv.includes('--dry-run');
const workerPath = path.join(repoRoot, WORKER_PATH);

/** Line-by-line differences, so a mismatch names the line rather than the file. */
function diffLines(expected, actual, limit = 6) {
    const a = expected.split('\n');
    const b = actual.split('\n');
    const out = [];
    for (let i = 0; i < Math.max(a.length, b.length) && out.length < limit; i += 1) {
        if (a[i] !== b[i]) {
            out.push(`    line ${i + 1}`);
            out.push(`      committed: ${JSON.stringify(b[i] ?? '(no line)')}`);
            out.push(`      generated: ${JSON.stringify(a[i] ?? '(no line)')}`);
        }
    }
    return out;
}

// ---------------------------------------------------------------------------
// The name, and what it should be.
//
// COMPUTED FIRST, because the layout assertions below are about the SAME served
// set this derives from: what the workflow copies into the artifact is what the
// name must be a function of, and asking that question twice, in two files, from
// two different readings of the workflow, is how the two answers drift apart.
// ---------------------------------------------------------------------------
const expected = expectedForRepo(repoRoot);

if (!expected.ok) {
    console.error(`check-sw-cache: FAILED — ${expected.reason}`);
    console.error('\n  A cache name cannot be derived from inputs that do not parse. See');
    console.error('  scripts/lib/sw-cache-name.mjs for what the inputs are.');
    process.exit(1);
}

// ---------------------------------------------------------------------------
// The files that decide whether the worker is SERVED, and whether every byte that
// IS served is an input to the name.
// ---------------------------------------------------------------------------

/**
 * The `navigator.serviceWorker.register(...)` call in `index.html`.
 *
 * Matched by counting PARENTHESES rather than by a regex, because the regex this
 * replaces stopped at the first quote: `register('./service-worker.js', { scope:
 * './docs/' })` satisfied `register\(\s*'([^']+)'` and passed the gate. Chromium
 * ACCEPTS that registration and the scope does not cover the page, so the worker
 * installs, controls nothing, and the site is served without a cache — measured,
 * not reasoned about. A `scope:` is therefore refused unless it restates the
 * worker's own directory, which for `./service-worker.js` is `./`.
 *
 * @returns {{ path: string, options: string } | null}
 */
function registrationCall(html) {
    const at = html.indexOf('.register(');
    if (at === -1) return null;
    const open = html.indexOf('(', at);
    let depth = 0;
    let i = open;
    for (; i < html.length; i += 1) {
        if (html[i] === '(') depth += 1;
        else if (html[i] === ')') {
            depth -= 1;
            if (depth === 0) break;
        }
    }
    if (depth !== 0) return null;
    const args = html.slice(open + 1, i);
    const first = /^\s*'([^']*)'/.exec(args);
    if (!first) return null;
    return { path: first[1], options: args.slice(first[0].length) };
}

const served = expected.served;
const layout = [];
{
    const html = readFileSync(path.join(repoRoot, 'index.html'), 'utf8');
    const call = registrationCall(html);
    const ownDirectory = call ? call.path.slice(0, call.path.lastIndexOf('/') + 1) : './';
    const scope = call ? /\bscope\s*:\s*([^,}]*)/.exec(call.options) : null;
    const scopeRestatesOwnDirectory = scope !== null && scope[1].trim() === `'${ownDirectory}'`;
    layout.push({
        what: 'index.html registers the worker at the site root and asks for no wider scope',
        ok:
            call !== null &&
            call.path === `./${WORKER_PATH}` &&
            (scope === null || scopeRestatesOwnDirectory),
        detail:
            call === null
                ? 'no navigator.serviceWorker.register(...) call found'
                : `register('${call.path}'` +
                  (scope ? `, { scope: ${scope[1].trim()} }` : '') +
                  ')',
        why:
            "A worker's default scope is its own directory, and registering anything under a " +
            'subdirectory scopes it there and stops it controlling the page. An explicit ' +
            '`scope:` does the same thing without moving the file, and GitHub Pages cannot send ' +
            '`Service-Worker-Allowed` to widen it back.'
    });

    // WHICH the worker lands at, not merely that its name appears next to `_site`.
    // `cp service-worker.js _site/dist/` satisfied the regex this replaces, and
    // `/dist/service-worker.js` 404s, so NO worker installs at all.
    // WHERE it lands, not merely that its name appears near `_site`. Every copy
    // that names the worker is resolved to a path inside the artifact.
    const landings = served.copies.flatMap((c) =>
        c.sources
            .filter((s) => s === WORKER_PATH)
            .map(() =>
                c.destFile !== null
                    ? c.destFile
                    : c.destDir === ''
                      ? WORKER_PATH
                      : `${c.destDir}/${WORKER_PATH}`
            )
    );
    layout.push({
        what: `deploy-pages.yml lands the worker at ${SITE_DIR}/${WORKER_PATH}`,
        ok: landings.length === 1 && landings[0] === WORKER_PATH,
        detail:
            landings.length === 0
                ? `no copy of ${WORKER_PATH} into ${SITE_DIR}/`
                : `lands at ${landings.map((l) => `${SITE_DIR}/${l}`).join(', ')}`,
        why:
            `The Pages artifact is assembled from ${SITE_DIR}/ and the page registers ` +
            `./${WORKER_PATH}. A worker left in the checkout is never uploaded, so the derived ` +
            'name is generated for a file nobody fetches — and the page logs a 404 while ' +
            'silently having no offline support.'
    });

    const misplaced = landings.filter((l) => l !== WORKER_PATH);
    layout.push({
        what: `${SITE_DIR}/dist/${WORKER_PATH} does not exist`,
        ok: misplaced.length === 0,
        detail:
            misplaced.length === 0
                ? `only ${SITE_DIR}/${WORKER_PATH}`
                : `also at ${misplaced.map((l) => `${SITE_DIR}/${l}`).join(', ')}`,
        why:
            `\`cp ${WORKER_PATH} ${SITE_DIR}/dist/\` used to satisfy the check this replaces, and ` +
            `/dist/${WORKER_PATH} 404s, so NO worker installs at all. A second copy under dist/ ` +
            'is a worker at a path the page never registers, and it is how the FIRST copy gets ' +
            `moved there by accident — at which point the scope is ${SITE_DIR}/dist/ and the ` +
            'page stops being controlled.'
    });

    // THE GUARANTEE, made mechanical: every byte the artifact is assembled from is
    // an input to the name. `game.js` (371 bytes, HTTP 200 on the live site) and
    // 53 of the 55 `docs/**` files were served and unhashed -- a change to any of
    // them was invisible to every returning player.
    const hashed = new Set(expected.inputs.map((entry) => entry.path));
    const unhashed = served.files.filter((f) => !hashed.has(f));
    layout.push({
        what: 'every path the artifact is assembled from is an input to the cache name',
        ok: unhashed.length === 0,
        detail:
            unhashed.length === 0
                ? `${served.files.length} served file(s), and ` +
                  (served.compiled.length > 0
                      ? `${served.compiled.join(', ')}/ covered by src/ + the build inputs`
                      : 'no compiled tree')
                : `served but NOT hashed: ${unhashed.slice(0, 6).join(', ')}` +
                  (unhashed.length > 6 ? ` (+${unhashed.length - 6} more)` : ''),
        why:
            'A served byte that is not an input to the name can change without moving the name, ' +
            'and the name is the ONLY thing that makes a release reach a player who has already ' +
            'played. This is read from the workflow rather than listed by hand, so a new copy ' +
            'step cannot re-open it silently.'
    });
}

const layoutFailures = layout.filter((l) => !l.ok);

if (expected.unresolved.length > 0) {
    console.error(
        `check-sw-cache: FAILED — ${expected.unresolved.length} asset(s) in the worker's own\n` +
            'ASSETS list do not resolve to anything in the tree:\n'
    );
    for (const u of expected.unresolved) console.error(`    ${u}`);
    console.error(
        '\n  cache.addAll() REJECTS AS A WHOLE if any request fails, so one bad entry leaves\n' +
            '  the worker permanently uninstalled — no offline support at all, and no error a\n' +
            '  player would ever see. Fix the entry, or the source it is compiled from.'
    );
    process.exit(1);
}

// ---------------------------------------------------------------------------
// GENERATE TO A TEMPORARY PATH AND DIFF (rule 13).
//
// The rendered text is written out and read back rather than compared in memory,
// because "the string in this variable is right" and "the file on disk is right"
// are different claims, and only the second one is what ships.
// ---------------------------------------------------------------------------
const scratch = mkdtempSync(path.join(tmpdir(), 'sw-cache-'));
const generatedPath = path.join(scratch, WORKER_PATH);
let generated;
try {
    writeFileSync(generatedPath, expected.rendered, 'utf8');
    generated = readFileSync(generatedPath, 'utf8');
} finally {
    rmSync(scratch, { recursive: true, force: true });
}

if (generated !== expected.rendered) {
    console.error(
        'check-sw-cache: FAILED — the rendered worker did not survive a write and read back.\n' +
            '  A gate whose own output is unstable cannot report on anything else.'
    );
    process.exit(1);
}

const committed = readFileSync(workerPath, 'utf8');
const committedName = readCacheName(committed);

if (dryRun || write) {
    const before = committedName ?? '(none)';
    console.log(`check-sw-cache: ${expected.inputs.length} input(s) -> ${expected.name}`);
    console.log(`  committed name : ${before}`);
    console.log(`  derived name   : ${expected.name}`);

    // A REGENERATION CANNOT REPAIR THE LAYOUT, so a broken layout refuses here too.
    // `--dry-run` used to print the name diff and exit 0 with the worker landing
    // somewhere the page never fetches — a green light from the one command a
    // developer runs to find out whether anything is wrong. Watched: with the copy
    // step moved to `_site/dist/`, `--dry-run` exited 0 and said nothing about it.
    if (layoutFailures.length > 0) {
        console.error(
            `\ncheck-sw-cache: REFUSING to ${write ? 'write' : 'call this dry run clean'} — ` +
                `${layoutFailures.length} layout problem(s):\n`
        );
        for (const l of layoutFailures)
            console.error(`  ${l.what} — ${l.detail}\n      ${l.why}\n`);
        process.exit(1);
    }

    if (!expected.changed) {
        console.log('  nothing to do: the committed worker already carries the derived name.');
        process.exit(0);
    }
    if (dryRun) {
        console.log('  --dry-run: the worker would be rewritten as below.');
        for (const line of diffLines(expected.rendered, committed)) console.log(line);
        process.exit(0);
    }

    // Anchored, counted, and read back. The anchor is the exact line that is
    // there, taken from the file rather than reconstructed from a template, so a
    // whitespace or quoting change in the worker is a refusal rather than a
    // silent no-op.
    const found = cacheLines(committed);
    if (found.length !== 1) {
        console.error(
            `check-sw-cache: refusing to write — ${found.length} cache-name line(s) in ` +
                `${WORKER_PATH}; exactly one is required.`
        );
        process.exit(1);
    }
    const result = applyEdit({
        path: workerPath,
        anchor: found[0].line,
        replacement: `const CACHE = '${expected.name}';`
    });
    if (!result.ok) {
        console.error(`check-sw-cache: refusing to write — ${result.reason}`);
        process.exit(1);
    }
    console.log(`  wrote ${WORKER_PATH}: ${before} -> ${expected.name}`);
    process.exit(0);
}

// ---------------------------------------------------------------------------
// The gate.
// ---------------------------------------------------------------------------
const problems = [];
if (committed !== expected.rendered) {
    problems.push(
        `the committed ${WORKER_PATH} is not what its inputs generate.\n` +
            `      committed name: ${committedName ?? '(no cache-name line)'}\n` +
            `      derived name  : ${expected.name}`
    );
}
for (const l of layoutFailures) {
    problems.push(`${l.what} — ${l.detail}\n      ${l.why}`);
}

if (problems.length > 0) {
    console.error(`check-sw-cache: FAILED in ${problems.length} area(s).\n`);
    for (const p of problems) console.error(`  ${p}\n`);
    if (committed !== expected.rendered) {
        console.error('  The cache name is the ONLY thing that makes a release reach a player');
        console.error('  who has already played: this worker is cache-first, and the browser');
        console.error('  installs a new one only when its bytes change. A name that does not');
        console.error('  match its inputs means the new bundle never arrives.\n');
        for (const line of diffLines(expected.rendered, committed)) console.error(line);
        console.error(`\n  Regenerate it:\n      npm run gen:sw-cache\n`);
    }
    process.exit(1);
}

console.log(
    `check-sw-cache: ${expected.name} derives from ${expected.inputs.length} input(s); ` +
        'regenerated to a temporary path and diffed byte-for-byte against ' +
        `${WORKER_PATH}.`
);
for (const l of layout) console.log(`  ok   ${l.what}  (${l.detail})`);
