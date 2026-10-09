#!/usr/bin/env node
/**
 * @file scripts/check-baseline.mjs
 * @description Enforces the test baseline recorded in quality-baseline.json.
 * See docs/ENGINEERING-STANDARDS.md §1.1.
 *
 * This is the mechanical expression of rule 1.1: a red baseline is information,
 * not an invitation to start editing. The guard makes two things impossible:
 *
 *   1. **Adding a failure.** Any test failing that is not written down in
 *      `knownFailingTests` fails the build. You cannot quietly commit on top of
 *      a red suite.
 *   2. **Silently papering over one.** If a recorded failure starts passing,
 *      the build fails too, because the baseline is now stale. That forces the
 *      fix to be claimed deliberately (with `--update`) instead of a green run
 *      hiding the fact that the recorded reason for the red no longer holds.
 *
 * Usage:
 *   node scripts/check-baseline.mjs            # enforce (CI / pre-push)
 *   node scripts/check-baseline.mjs --update   # record the current failures
 */

import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
const baselinePath = path.join(repoRoot, 'quality-baseline.json');
const update = process.argv.includes('--update');

const testFiles = readdirSync(path.join(repoRoot, 'test'))
    // Mid-migration: some test files are still JavaScript.
    .filter((f) => f.endsWith('.test.js') || f.endsWith('.test.ts'))
    .sort()
    .map((f) => path.join('test', f));

if (testFiles.length === 0) {
    console.error('check-baseline: no test/*.test.{js,ts} files found');
    process.exit(1);
}

const run = spawnSync(process.execPath, ['--test', '--test-reporter=tap', ...testFiles], {
    cwd: repoRoot,
    encoding: 'utf8'
});

const output = `${run.stdout || ''}${run.stderr || ''}`;

/** TAP summary counts. */
function count(key) {
    const m = new RegExp(`^# ${key} (\\d+)$`, 'm').exec(output);
    return m ? Number(m[1]) : null;
}

/** Failing test names from TAP `not ok <n> - <name>` lines. */
function failingTests() {
    const names = new Set();
    for (const line of output.split('\n')) {
        const m = /^not ok \d+ - (.+?)\s*$/.exec(line.trim());
        if (m) names.add(m[1]);
    }
    return [...names].sort();
}

const tests = count('tests');
const pass = count('pass');
const fail = count('fail');

if (tests === null) {
    console.error('check-baseline: could not parse the test runner output.');
    console.error('The runner crashed before reporting. Raw output follows:\n');
    console.error(output.slice(-4000));
    process.exit(1);
}

const actual = failingTests();
const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
const known = [...(baseline.knownFailingTests || [])].sort();

if (update) {
    baseline.knownFailingTests = actual;
    writeFileSync(baselinePath, `${JSON.stringify(baseline, null, 4)}\n`);
    if (actual.length === 0) {
        console.log('check-baseline: baseline cleared — the suite is fully green.');
    } else {
        console.log(`check-baseline: recorded ${actual.length} known failure(s):`);
        for (const n of actual) console.log(`  - ${n}`);
    }
    process.exit(0);
}

const knownSet = new Set(known);
const actualSet = new Set(actual);

const added = actual.filter((n) => !knownSet.has(n));
const fixed = known.filter((n) => !actualSet.has(n));

console.log(
    `check-baseline: tests=${tests} pass=${pass} fail=${fail} ` +
        `(baseline records ${known.length} known failure(s))`
);

if (added.length === 0 && fixed.length === 0) {
    if (known.length === 0) {
        console.log('check-baseline: suite is fully green and the baseline is empty.');
    } else {
        console.log('check-baseline: matches the recorded baseline exactly.');
    }
    process.exit(0);
}

if (added.length > 0) {
    console.error('\ncheck-baseline: FAILED — new test failures.\n');
    for (const n of added) console.error(`  NEW FAILURE  ${n}`);
    console.error(
        '\nDo not commit on top of this and do not edit tests until you know why.\n' +
            'Per docs/ENGINEERING-STANDARDS.md §1.1: reproduce it in a pristine checkout\n' +
            '    git worktree add --detach /tmp/baseline HEAD\n' +
            'to prove whether it is yours, diagnose it from evidence, report it, then fix\n' +
            'it as its own reviewed commit.'
    );
}

if (fixed.length > 0) {
    console.error('\ncheck-baseline: FAILED — the baseline is stale.\n');
    for (const n of fixed) console.error(`  NOW PASSING  ${n}`);
    console.error(
        '\nThese were recorded as failing and are not anymore. Claim that deliberately:\n' +
            '    node scripts/check-baseline.mjs --update\n' +
            'so the baseline shrinks and the headroom cannot be silently reused.'
    );
}

process.exit(1);
