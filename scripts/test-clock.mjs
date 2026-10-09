#!/usr/bin/env node
/**
 * @file scripts/test-clock.mjs
 * @description Runs the unit suite repeatedly with the ambient clock offset,
 * to catch date-dependent "time bomb" tests before they detonate in CI months
 * from now. See scripts/clock-shift.mjs for the mechanism.
 *
 * A test that pins its own clock passes at every offset. A test that reads the
 * wall clock will pass at offset 0 and fail somewhere else — which is exactly
 * the bug this guards. Two tests in this repo did precisely that: they stored a
 * hardcoded '2026-04-25' and were pruned by a real-clock 14-day window, so they
 * passed until 2026-05-09 and failed permanently afterwards. No run of the
 * suite could see it, because every run used the one clock that still worked.
 *
 * Parses the TAP reporter (not the spec reporter) so the output contract is
 * stable and we can name the failing tests. Exits non-zero if any offset fails,
 * so it can gate CI.
 */

import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const DAY_MS = 86400000;

/** Offsets in days. 0 is the wall clock; the rest are deliberately extreme. */
const OFFSETS = [0, 365, 1825, -1825];

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
const preloadUrl = pathToFileURL(path.join(here, 'clock-shift.mjs')).href;

const testFiles = readdirSync(path.join(repoRoot, 'test'))
    .filter((f) => f.endsWith('.test.js'))
    .sort()
    .map((f) => path.join('test', f));

if (testFiles.length === 0) {
    console.error('test-clock: no test/*.test.js files found');
    process.exit(1);
}

/** Parse the TAP summary counts. */
function summarise(output) {
    const pick = (key) => {
        const m = new RegExp(`^# ${key} (\\d+)$`, 'm').exec(output);
        return m ? Number(m[1]) : null;
    };
    return { tests: pick('tests'), pass: pick('pass'), fail: pick('fail') };
}

/** Names of failing tests, from TAP `not ok <n> - <name>` lines. */
function failingNames(output) {
    const names = [];
    for (const line of output.split('\n')) {
        const m = /^not ok \d+ - (.+?)\s*$/.exec(line.trim());
        if (m) names.push(m[1]);
    }
    return names;
}

console.log(`Running ${testFiles.length} test files at ${OFFSETS.length} clock offsets...\n`);

const failures = [];

for (const days of OFFSETS) {
    const label = days === 0 ? 'wall clock (offset 0)' : `offset ${days > 0 ? '+' : ''}${days}d`;
    const result = spawnSync(process.execPath, ['--test', '--test-reporter=tap', ...testFiles], {
        cwd: repoRoot,
        encoding: 'utf8',
        env: {
            ...process.env,
            CLOCK_SHIFT_MS: String(days * DAY_MS),
            NODE_OPTIONS: `--import ${preloadUrl}`
        }
    });

    const output = `${result.stdout || ''}${result.stderr || ''}`;
    const { tests, pass, fail } = summarise(output);
    const ok = result.status === 0 && fail === 0;

    console.log(
        `${ok ? '  ok  ' : ' FAIL '} ${label.padEnd(22)} ` +
            `tests=${tests ?? '?'} pass=${pass ?? '?'} fail=${fail ?? '?'}`
    );

    if (!ok) {
        const names = failingNames(output);
        for (const n of names) console.log(`         └─ ${n}`);
        if (names.length === 0) {
            console.log(
                '         └─ (could not parse failing test names; raw exit ' + `${result.status})`
            );
        }
        failures.push({ label, names });
    }
}

console.log('');
if (failures.length > 0) {
    console.error(`test-clock: FAILED at ${failures.length}/${OFFSETS.length} clock offsets.`);
    console.error('A test is reading the wall clock instead of pinning its own time.');
    console.error('Fix the test to inject a fixed `now` — do not delete this check.');
    process.exit(1);
}

console.log(`test-clock: all ${OFFSETS.length} clock offsets passed. Suite is date-hermetic.`);
