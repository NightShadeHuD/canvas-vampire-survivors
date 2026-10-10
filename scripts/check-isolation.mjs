#!/usr/bin/env node
/**
 * @file scripts/check-isolation.mjs
 * @description Run the suite under both process-isolation models and compare.
 *
 * Shortcut register row 5 records that coverage is measured with
 * `--test-isolation=none` — every test in one process — because Node's per-file
 * merge was not reproducible. Its trigger is *"a test that passes under `npm test`
 * and fails under `check:coverage-floor`, or the reverse."*
 *
 * Nothing was watching for that. This does, on every run.
 *
 * The comparison is PER TEST by name, not by total: two runs can both report 792
 * passing while a different test fails in each, and a count would call that
 * agreement.
 */

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { parseSuiteReport } from './lib/suite-report.mjs';
import { compareIsolation } from './lib/isolation-compare.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');

/** Run the suite once, under a named isolation model, and parse its report. */
function run(isolation) {
    const args = ['--test', '--test-reporter=junit', 'test/*.test.ts'];
    if (isolation) args.splice(2, 0, `--test-isolation=${isolation}`);
    let xml;
    try {
        xml = execFileSync(process.execPath, args, {
            cwd: repoRoot,
            encoding: 'utf8',
            // Capture stderr rather than inheriting it. Several tests exercise
            // error handling on purpose and log the errors they expect; letting
            // those through buries this gate's own output in stack traces that
            // are not failures.
            stdio: ['ignore', 'pipe', 'pipe'],
            maxBuffer: 64 * 1024 * 1024
        });
    } catch (err) {
        // A non-zero exit is the normal path when a test fails; the report is
        // still on stdout and still worth comparing.
        xml = `${err.stdout ?? ''}`;
    }
    return parseSuiteReport(xml);
}

const isolated = run(undefined);
const shared = run('none');

if (isolated.total === 0 || shared.total === 0) {
    console.error(
        'check-isolation: FAILED — nothing to check: one of the two runs produced no ' +
            'report, so this comparison proves nothing.'
    );
    process.exit(1);
}

const verdict = compareIsolation(isolated, shared);

if (!verdict.ok) {
    console.error('check-isolation: FAILED\n');
    console.error(
        '  The suite behaves differently under per-file isolation and under a single\n' +
            '  process. coverage is measured with `--test-isolation=none`, so any figure\n' +
            '  from it rests on this difference being understood.\n'
    );
    for (const reason of verdict.reasons) console.error(`  ${reason}\n`);
    process.exit(1);
}

for (const note of verdict.notes) console.log(`check-isolation: ${note}`);
console.log(
    `check-isolation: the suite agrees under both models — ` +
        `${isolated.total} test(s) per-file, ${shared.total} in one process.`
);
