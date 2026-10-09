#!/usr/bin/env node
/**
 * @file scripts/check-coverage-floor.mjs
 * @description Enforces the code-coverage floors recorded in
 * quality-baseline.json under `coverageFloors`.
 *
 * Same ratchet discipline as the suppression ceilings, inverted: suppression
 * ceilings may only fall, coverage floors may only rise. Nothing here is an
 * invented target — every floor is a number this repository actually measured,
 * truncated downward, so the gate can never demand something that was never
 * achieved.
 *
 * Two deliberate design choices:
 *
 *   1. Floors are stored at the **exact measured value** (two decimals), and
 *      compared with a 0.05-point tolerance. Measurement on this repository is
 *      bit-for-bit deterministic — three consecutive runs produced an identical
 *      report — but CI runs a different OS, so a small tolerance absorbs
 *      platform wobble without opening a real door. An actual regression moves
 *      whole percentage points.
 *
 *   2. Floors are **per file as well as overall**. An overall-only floor is
 *      easy to satisfy while a single module rots — add tests in one file,
 *      delete them in another, and the average holds. Per-file floors make
 *      that impossible.
 *
 * Ratcheting is prompted only when a metric improves by **1.0 point or more**.
 * Nagging on every hundredth would make the message wallpaper, and a warning
 * nobody reads is worse than no warning.
 *
 * IMPORTANT — a percentage can legitimately FALL while absolute coverage rises.
 * These are percentages, so the denominator moves. When a module joins the
 * graph for the first time, two things happen at once: its own (mostly
 * uncovered) lines enter the overall total, and code in modules it depends on
 * becomes reachable, growing those modules' branch counts. The first time this
 * gate ran against real new tests, `main.js` entered the graph and:
 *
 *     overall   69.76% -> 67.15% lines   (1,887 newly-counted LOC, 44.78% covered)
 *     ui.js     32.54% -> 37.54% lines   (up)
 *     ui.js     66.67% -> 60.78% branches (down — more of it became reachable,
 *                                          so more uncovered branches counted)
 *
 * Absolute coverage went up in every case. So a drop is not automatically a
 * regression, but it is never silent either: it requires an explicit,
 * reviewed re-baseline with the reason in the commit message. That is the
 * point. A tolerance wide enough to absorb this would also absorb a real
 * regression, and would be worth nothing.
 *
 * A module that no test ever loads does not appear in the coverage report at
 * all. It is treated as 0%, not as absent, so it cannot hide.
 *
 * Usage:
 *   node scripts/check-coverage-floor.mjs            # enforce (CI)
 *   node scripts/check-coverage-floor.mjs --update   # ratchet floors upward
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
const baselinePath = path.join(repoRoot, 'quality-baseline.json');
const update = process.argv.includes('--update');

const METRICS = ['lines', 'branches', 'functions'];

/**
 * Files that carry a coverage floor.
 *
 * Shipped product code (`src/`, `.js` or `.ts` while the TypeScript migration is
 * in progress) and shared library logic (`scripts/lib/`) —
 * anything whose behaviour is expressed through importable functions.
 *
 * Deliberately excludes the CLI entry points in `scripts/` themselves. Their
 * "coverage" is not meaningful: they are top-level scripts with no exported
 * surface, and they are verified by *executing* them and observing the result —
 * every gate in this repo has a negative control. A floor there would measure
 * nothing and would read as a permanent gap.
 */
function trackedSourceFiles() {
    return execFileSync('git', ['ls-files'], { cwd: repoRoot, encoding: 'utf8' })
        .split('\n')
        .filter((f) => /^src\/[^/]+\.(js|ts)$/.test(f) || /^scripts\/lib\/[^/]+\.mjs$/.test(f))
        .sort();
}

/**
 * Run the suite with Node's built-in coverage and parse the table.
 * Returns { overall: {...}, files: { 'src/x.js': {...} } }.
 *
 * `--test-isolation=none` is load-bearing, not a speed tweak.
 *
 * By default Node runs each test file in its own process and merges the
 * per-process coverage at the end. That merge is not reproducible: the same
 * suite, run repeatedly on an unchanged tree, reported `src/i18n.js` branches at
 * both 90.00% and 100.00%. Each file measured alone was perfectly stable, so the
 * nondeterminism was in the aggregation, and it moved the overall branch figure
 * by ~0.1 points — enough to fail this gate roughly one run in four with no
 * change to the code at all. A gate that fails at random teaches people to
 * re-run it, and that is how a real regression gets waved through.
 *
 * A single process also models the product more honestly. The browser loads each
 * module exactly once, whereas per-file isolation instantiates it once per test
 * file and sums the branch counts. Line and function coverage agree between the
 * two methods; only branch percentages differ, and it is the branch denominator
 * that the duplicated instantiation distorts.
 */
function measure() {
    let out;
    try {
        out = execFileSync(
            process.execPath,
            ['--test', '--test-isolation=none', '--experimental-test-coverage', 'test/*.test.ts'],
            { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
        );
    } catch (err) {
        // A non-zero exit still carries a report; only a crash has nothing.
        out = `${err.stdout || ''}${err.stderr || ''}`;
        if (!out.includes('start of coverage report')) {
            console.error('check-coverage-floor: could not read a coverage report.');
            console.error(String(err.message).split('\n')[0]);
            process.exit(1);
        }
    }

    const block = /start of coverage report([\s\S]*?)end of coverage report/.exec(out);
    if (!block) {
        console.error('check-coverage-floor: no coverage report in the test output.');
        process.exit(1);
    }

    const row = /^ℹ\s+(.+?)\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)\s*\|/;
    const files = {};
    let overallResult = null;

    for (const line of block[1].split('\n')) {
        const m = row.exec(line.trim());
        if (!m) continue;
        const name = m[1].trim();
        const value = {
            lines: Number(m[2]),
            branches: Number(m[3]),
            functions: Number(m[4])
        };
        if (name === 'all files') overallResult = value;
        else files[name] = value;
    }

    if (!overallResult) {
        console.error('check-coverage-floor: no "all files" row found in the report.');
        process.exit(1);
    }

    // The report prints basenames only. Map each to its tracked path and refuse
    // to guess if a basename is ambiguous.
    const tracked = trackedSourceFiles();
    const byBase = new Map();
    for (const rel of tracked) {
        const base = path.basename(rel);
        if (byBase.has(base)) {
            console.error(
                `check-coverage-floor: basename collision on "${base}" — the coverage ` +
                    'report prints basenames only and cannot be mapped safely. ' +
                    'Rename one of the files or extend this parser.'
            );
            process.exit(1);
        }
        byBase.set(base, rel);
    }

    const mapped = {};
    const unknown = [];
    for (const [base, value] of Object.entries(files)) {
        const rel = byBase.get(base);
        if (!rel) {
            unknown.push(base);
            continue;
        }
        mapped[rel] = value;
    }
    if (unknown.length > 0) {
        console.error(
            `check-coverage-floor: coverage reported for ${unknown.length} file(s) that are ` +
                `not tracked under src/: ${unknown.join(', ')}`
        );
        process.exit(1);
    }

    // Absent from the report means no test ever loaded it: 0%, not "unknown".
    for (const rel of tracked) {
        if (!mapped[rel]) mapped[rel] = { lines: 0, branches: 0, functions: 0 };
    }

    return { overall: overallResult, files: mapped };
}

/** Tolerance absorbing cross-platform measurement wobble. */
const TOLERANCE = 0.05;

/** Improvement worth recording. Smaller gains are noise, not news. */
const RATCHET_THRESHOLD = 1.0;

/** Store the exact measured value, rounded to the report's own precision. */
const floorOf = (v) => Math.round(v * 100) / 100;

const measured = measure();

if (update) {
    const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
    baseline.coverageFloors = {
        _comment:
            'Measured coverage floors — exact values this repository achieved, not targets. They may only rise. Compared with a 0.05-point tolerance for cross-platform wobble. Refresh with: node scripts/check-coverage-floor.mjs --update',
        overall: Object.fromEntries(METRICS.map((m) => [m, floorOf(measured.overall[m])])),
        files: Object.fromEntries(
            Object.entries(measured.files)
                .sort()
                .map(([rel, v]) => [
                    rel,
                    Object.fromEntries(METRICS.map((m) => [m, floorOf(v[m])]))
                ])
        )
    };
    writeFileSync(baselinePath, `${JSON.stringify(baseline, null, 4)}\n`);

    console.log('check-coverage-floor: floors ratcheted to current reality:');
    console.log(
        `  overall: ` + METRICS.map((m) => `${m} ${baseline.coverageFloors.overall[m]}%`).join(', ')
    );
    const zero = Object.entries(baseline.coverageFloors.files).filter(([, v]) => v.lines === 0);
    if (zero.length > 0) {
        console.log(
            `  note: ${zero.length} module(s) still at 0% lines (no test loads them): ` +
                zero.map(([f]) => path.basename(f)).join(', ')
        );
    }
    process.exit(0);
}

const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
const floors = baseline.coverageFloors;

if (!floors || !floors.overall || !floors.files) {
    console.error('check-coverage-floor: quality-baseline.json has no coverageFloors block.');
    console.error('Seed it with: node scripts/check-coverage-floor.mjs --update');
    process.exit(1);
}

const drops = [];
const rises = [];

/** Compare one measured value against one floor. */
function compare(label, actual, floor) {
    for (const m of METRICS) {
        if (actual[m] < floor[m] - TOLERANCE) {
            drops.push({ label, metric: m, actual: actual[m], floor: floor[m] });
        } else if (actual[m] >= floor[m] + RATCHET_THRESHOLD) {
            rises.push({ label, metric: m, actual: actual[m], floor: floor[m] });
        }
    }
}

compare('all files', measured.overall, floors.overall);
for (const [rel, floor] of Object.entries(floors.files)) {
    const actual = measured.files[rel];
    if (!actual) {
        // A floored file that vanished from src/ is a stale baseline.
        drops.push({ label: rel, metric: 'exists', actual: 0, floor: floor.lines });
        continue;
    }
    compare(rel, actual, floor);
}

const fmt = (v) => `${v.toFixed(2)}%`;

console.log(
    `check-coverage-floor: overall ${fmt(measured.overall.lines)} lines ` +
        `(floor ${fmt(floors.overall.lines)}), ${fmt(measured.overall.branches)} branches ` +
        `(floor ${fmt(floors.overall.branches)}), ${fmt(measured.overall.functions)} funcs ` +
        `(floor ${fmt(floors.overall.functions)})`
);

if (drops.length === 0) {
    if (rises.length > 0) {
        console.log(
            `\ncheck-coverage-floor: ok, and ${rises.length} metric(s) improved by a point or` +
                ' more. Ratchet them up so the gain cannot be given back later:' +
                '\n    node scripts/check-coverage-floor.mjs --update'
        );
    } else {
        console.log('check-coverage-floor: all floors hold exactly.');
    }
    process.exit(0);
}

console.error(`\ncheck-coverage-floor: FAILED — ${drops.length} metric(s) fell below floor.\n`);
for (const d of drops.slice(0, 40)) {
    console.error(`  ${d.label}: ${d.metric} ${fmt(d.actual)} < floor ${fmt(d.floor)}`);
}
if (drops.length > 40) console.error(`  … and ${drops.length - 40} more`);

console.error(
    '\nCoverage floors only rise. Either restore the lost coverage, or — if the drop is\n' +
        'genuinely correct — say so explicitly and lower the floor in its own reviewed\n' +
        'commit, with the reason in the message. A floor lowered in passing is a floor\n' +
        'that was never real. See docs/ENGINEERING-STANDARDS.md §4.'
);
process.exit(1);
