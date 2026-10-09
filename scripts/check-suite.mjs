#!/usr/bin/env node
/**
 * @file scripts/check-suite.mjs
 * @description Refuses a suite that reached green by not running.
 *
 * Three rules, none of which the console summary can enforce:
 *
 *   1. No test outcome other than Passed.
 *   2. No SKIPPED and no TODO test. Adding one to this repository produced
 *      `tests 513 / pass 512 / fail 0 / skipped 1` while lint, check:hygiene and
 *      check:baseline all exited 0 — the hole this gate fills.
 *   3. A test count at or above the recorded floor, so DELETING a test fails the
 *      build while ADDING one only requires raising the floor.
 *
 * The floor is deliberately a floor and not an equality. An exact count would
 * make every unrelated test addition a failure, which trains people to edit the
 * number without reading it.
 *
 * Adopted from the agent-scaffold method (`mechanisms/check_suite.py`,
 * `mechanisms/gates.sh`). The logic transfers unchanged; the report parser is
 * the per-language part and reads Node's own `--test-reporter=junit` output.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { parseSuiteReport, judgeSuite } from './lib/suite-report.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');

/** Run the suite and return its JUnit report. */
function runSuite() {
    try {
        return execFileSync(
            process.execPath,
            ['--test', '--test-reporter=junit', 'test/*.test.ts'],
            {
                cwd: repoRoot,
                encoding: 'utf8',
                stdio: ['ignore', 'pipe', 'pipe'],
                maxBuffer: 64 * 1024 * 1024
            }
        );
    } catch (err) {
        // A failing suite still emits a report, and the report is what says
        // which test failed. Only a crash has nothing to read.
        const out = `${err.stdout || ''}`;
        if (!out.includes('<testcase')) {
            console.error('check-suite: could not read a test report.');
            console.error(String(err.message).split('\n')[0]);
            process.exit(2);
        }
        return out;
    }
}

/** The recorded floor, or null when none is recorded. */
function recordedFloor() {
    const baseline = JSON.parse(readFileSync(path.join(repoRoot, 'quality-baseline.json'), 'utf8'));
    const floor = baseline.testCountFloor;
    return typeof floor === 'number' && Number.isFinite(floor) ? floor : null;
}

const report = parseSuiteReport(runSuite());
const floor = recordedFloor();
const { problems, notes } = judgeSuite(report, floor);

const skipped = report.cases.filter((c) => c.outcome === 'Skipped').length;
const todo = report.cases.filter((c) => c.outcome === 'Todo').length;

if (problems.length) {
    console.error('check-suite: FAILED\n');
    for (const problem of problems) console.error(`  ${problem}`);
    console.error('');
    process.exit(1);
}

const ran = report.total - skipped - todo;
for (const note of notes) console.log(`check-suite: ${note}`);
console.log(`check-suite: ${report.total} test(s), ${ran} executed, 0 failed, 0 skipped, 0 todo`);
