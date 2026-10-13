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
import { noticesIn } from './lib/gate-input.mjs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');

/** Ordered gate steps. `npm` script name -> what it proves. */
const STEPS = [
    { script: 'lint', proves: 'no undefined globals, no dead identifiers, style rules hold' },
    {
        script: 'check:coverage',
        proves: 'lint, format and test discovery actually reach every file'
    },
    { script: 'typecheck', proves: 'the TypeScript config is valid and the tree parses' },
    {
        script: 'check:strict',
        proves: 'no strict flag this project already enabled has been turned back off'
    },
    {
        script: 'check:claims',
        proves: 'the numbers the register states match the ones the gates measured'
    },
    {
        script: 'check:workflow-parity',
        proves: 'the two CI workflows install the same toolchain, so neither drifts'
    },
    {
        script: 'check:lifecycle',
        proves: 'every piece of state that is SET is also UNSET, on a path that can reach it'
    },
    {
        script: 'check:reach',
        proves: 'every key the game advertises can be pressed, and every modal answered'
    },
    {
        script: 'check:selftests',
        proves: 'every gate has been WATCHED failing on a deliberately broken input'
    },
    { script: 'format:check', proves: "code matches the project's Prettier contract" },
    { script: 'test', proves: 'behaviour matches the unit tests' },
    {
        script: 'check:godot',
        proves: 'the Godot port runs, and its generated data matches the TypeScript'
    },
    {
        script: 'check:isolation',
        proves: 'the suite agrees under per-file isolation and a single process'
    },
    {
        script: 'check:suite',
        proves: 'no test was skipped, left as todo, or deleted'
    },
    {
        script: 'check:assertions',
        proves: 'no assertion was weakened since the base revision'
    },
    {
        script: 'check:register',
        proves: 'every declared shortcut is bounded, tracked and correctly cited'
    },
    {
        script: 'check:docs',
        proves: 'rule docs hold: tables, citations, acceptance criteria'
    },
    { script: 'test:clock', proves: 'no test depends on today’s date' },
    { script: 'check:baseline', proves: 'no new failures, no stale baseline entries' },
    {
        script: 'check:coverage-floor',
        proves: 'measured code coverage has not fallen below its recorded floors'
    },
    { script: 'check:suppressions', proves: 'every suppression is within its declared ceiling' },
    {
        script: 'check:types',
        proves: 'the use of `any` has not grown — the port-readiness metric'
    },
    {
        script: 'check:ports',
        proves: 'the Godot transform has not grown — error and SILENT hazards'
    },
    { script: 'check:hygiene', proves: 'no conflicts, focus marks, debug logs, secrets or bloat' },
    {
        script: 'check:destructive',
        proves: 'no committed tooling rewrites source with an unanchored substitution'
    },
    { script: 'build', proves: 'the shipped browser artifact compiles' }
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
/** Gates that passed while reporting they had nothing to check. */
const notCheckingAnything = [];

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

    // A gate that legitimately had nothing to check says so with a NOTICE line.
    // It PASSES — "no shortcuts are declared yet" is a real state — but the run
    // reports how many did, so "passed" is never mistaken for "verified
    // everything". The scaffold's closing line is the model:
    //   "ALL 12 GATES PASSED (3 skipped as unconfigured — each is a rule this
    //    project does not yet check)"
    const notices = ok ? noticesIn(`${result.stdout || ''}${result.stderr || ''}`) : [];
    if (notices.length) {
        for (const text of notices) notCheckingAnything.push({ step: step.script, text });
    }

    console.log(
        `  ${ok ? 'ok  ' : 'FAIL'} ${label} ${String(ms).padStart(6)} ms   ${step.proves}` +
            (notices.length ? '  (checked nothing — see below)' : '')
    );

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

if (notCheckingAnything.length > 0) {
    console.log(
        `\nverify: all ${STEPS.length} gates passed, ${notCheckingAnything.length} of which ` +
            'checked nothing:'
    );
    for (const { step, text } of notCheckingAnything) {
        console.log(`  - ${step}: ${text}`);
    }
    console.log('  Each is a rule this project does not yet have anything to apply to.');
} else {
    console.log(`\nverify: all ${STEPS.length} gates passed, and every one checked something.`);
}

if (gaps.length > 0) {
    console.log(`\nDeclared gaps still open (${gaps.length}) — tracked, not forgotten:`);
    // THE FIELD NAMES, which were wrong for every gap this printer has ever shown.
    //
    // It read `g.what` and `g.bound`; `quality-baseline.json` stores `id`, `why` and
    // `removal`. So the one place a declared gap is surfaced to a human printed:
    //
    //     - godot-not-installed-in-ci: undefined
    //           bound: undefined
    //
    // **The mechanism whose entire job is to keep a shortcut visible was printing
    // `undefined` for all six of them**, and it stayed that way because nothing asserts on
    // a console line. An audit found it by reading the output rather than the code.
    //
    // Printed in full, and truncated at a width that keeps a terminal readable: a gap the
    // reader cannot finish is a gap the reader skips.
    const wrap = (text, indent) => {
        const words = String(text ?? '(no reason given)').split(/\s+/);
        const lines = [];
        let line = '';
        for (const w of words) {
            if ((line + ' ' + w).trim().length > 96) {
                lines.push(line.trim());
                line = w;
            } else {
                line += ' ' + w;
            }
        }
        if (line.trim()) lines.push(line.trim());
        return lines.map((l) => `${indent}${l}`).join('\n');
    };
    for (const g of gaps) {
        console.log(`  - ${g.id}`);
        console.log(wrap(g.why, '      why: '));
        console.log(wrap(g.removal, '      removal: '));
    }
    console.log('\nSee docs/ENGINEERING-STANDARDS.md §5.');
}
