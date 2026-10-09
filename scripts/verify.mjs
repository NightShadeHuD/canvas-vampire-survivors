#!/usr/bin/env node
/**
 * @file scripts/verify.mjs
 * @description The single definition of "done". See
 * docs/ENGINEERING-STANDARDS.md §2.
 *
 * Runs every gate in order and stops at the first failure. Nothing else may be
 * described as "green" — a partial run is a partial run.
 *
 * Steps marked `TODO` are declared gaps recorded in quality-baseline.json.
 * They are printed on every run so they stay visible rather than being
 * forgotten in a document nobody opens.
 */

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');

/** Ordered gate steps. `npm` script name -> what it proves. */
const STEPS = [
    { script: 'lint', proves: 'no undefined globals, no dead identifiers, style rules hold' },
    {
        script: 'check:lint-coverage',
        proves: 'every tracked source file is actually matched by a lint config block'
    },
    { script: 'format:check', proves: "code matches the project's Prettier contract" },
    { script: 'test', proves: 'behaviour matches the unit tests' },
    { script: 'test:clock', proves: 'no test depends on today’s date' },
    { script: 'check:baseline', proves: 'no new failures, no stale baseline entries' },
    { script: 'check:suppressions', proves: 'every suppression is within its declared ceiling' },
    { script: 'check:hygiene', proves: 'no conflicts, focus marks, debug logs, secrets or bloat' }
];

/** Declared gaps, surfaced on every run. */
function declaredGaps() {
    try {
        const b = JSON.parse(readFileSync(path.join(repoRoot, 'quality-baseline.json'), 'utf8'));
        return b.declaredGaps || [];
    } catch {
        return [];
    }
}

const gaps = declaredGaps();

console.log(`verify: running ${STEPS.length} gates\n`);

const failures = [];

for (const [i, step] of STEPS.entries()) {
    const label = step.script.padEnd(20);
    const started = Date.now();

    const result = spawnSync('npm', ['run', '--silent', step.script], {
        cwd: repoRoot,
        encoding: 'utf8',
        env: process.env
    });

    const ms = Date.now() - started;
    const ok = result.status === 0;

    console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label} ${String(ms).padStart(6)} ms   ${step.proves}`);

    if (!ok) {
        const output = `${result.stdout || ''}${result.stderr || ''}`;
        failures.push({ step, output });
        // Stop at the first failure: later gates assume earlier ones held.
        const remaining = STEPS.slice(i + 1);
        if (remaining.length > 0) {
            console.log(`\n  (stopped early — ${remaining.length} gate(s) not run)`);
        }
        break;
    }
}

if (failures.length > 0) {
    for (const { step, output } of failures) {
        console.error(`\n${'='.repeat(72)}\nFAILED: ${step.script}\n${'='.repeat(72)}\n`);
        console.error(output.trim().slice(-6000));
    }
    console.error(`\nverify: FAILED at "${failures[0].step.script}".`);
    process.exit(1);
}

console.log('\nverify: all gates passed.');

if (gaps.length > 0) {
    console.log(`\nDeclared gaps still open (${gaps.length}) — tracked, not forgotten:`);
    for (const g of gaps) {
        console.log(`  - ${g.id}: ${g.what}`);
        console.log(`      bound: ${g.bound}`);
    }
    console.log('\nSee docs/ENGINEERING-STANDARDS.md §5.');
}
