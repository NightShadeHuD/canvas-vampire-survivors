#!/usr/bin/env node
/**
 * @file scripts/check-strict.mjs
 * @description Hold the TypeScript `strict` flag set — both the part already paid
 * for and the two flags still outstanding.
 *
 * `strict` is a bundle, and this project turns its eight flags on one at a time
 * because they are not equally hard. That is a deliberate, ordered path, and it has
 * TWO failure modes. This gate now covers both.
 *
 * 1. A flag that is ON today can be set back to `false` tomorrow by someone
 *    unblocking themselves, and nothing would notice. The project has paid for five
 *    flags; this refuses to let one be switched off quietly.
 *
 * 2. The two outstanding flags have ERROR COUNTS, and those counts can RISE. That
 *    is not hypothetical: `strictNullChecks` in `src/` was driven to zero and then
 *    reported as zero for seven rounds after it had gone back to seven, because
 *    every one of those numbers came from a hand-run `tsc` in a shell and nothing
 *    in the repository measured it.
 *
 * **The two flags are not independent.** Declaring a parameter optional to satisfy
 * `noImplicitAny` moves an error into `strictNullChecks`; supplying a default to
 * satisfy `strictNullChecks` can move one back. Working one column without watching
 * the other is how a milestone quietly un-happens.
 *
 * It measures `src/` and `test/` separately, for the same reason `check:ports`
 * measures `src/` only: a GDScript port transforms `src/` and replaces `test/` with
 * GUT, so a single total lets a regression in shipped code hide behind noise in
 * tests. The ceilings may only fall; `--update` records an improvement.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { writeBaseline } from './lib/baseline-file.mjs';
import path from 'node:path';
import { judgeStrict, parseTscOutput, STRICT_FLAGS, STRICT_FLAG_IDS } from './lib/strict-flags.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
const BASELINE = path.join(repoRoot, 'quality-baseline.json');

/** Flags this project has already enabled, and must stay enabled. */
const ENABLED = [
    'alwaysStrict',
    'strictBindCallApply',
    'strictFunctionTypes',
    'noImplicitThis',
    'useUnknownInCatchVariables'
];

// ---------------------------------------------------------------------------
// Part 1 — the flags already paid for must stay on.
// ---------------------------------------------------------------------------

// Ask the compiler for the EFFECTIVE options rather than parsing the JSONC by
// hand: `extends` chains and CLI defaults both affect the answer, and a
// hand-rolled reader would disagree with the compiler about the truth.
const probe = path.join(repoRoot, 'tsconfig.strict-probe.json');
writeFileSync(probe, JSON.stringify({ extends: './tsconfig.json', compilerOptions: {} }));
let effective;
try {
    const raw = execFileSync(
        path.join(repoRoot, 'node_modules', '.bin', 'tsc'),
        ['-p', probe, '--showConfig'],
        { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
    );
    effective = JSON.parse(raw).compilerOptions ?? {};
} finally {
    if (existsSync(probe)) rmSync(probe);
}

const regressed = ENABLED.filter((flag) => effective[flag] !== true);

if (regressed.length) {
    console.error('check-strict: FAILED\n');
    console.error(`  ${regressed.length} strict flag(s) this project already enabled are now off:`);
    for (const flag of regressed) console.error(`    ${flag}`);
    console.error(
        '\n  These were paid for. Turning one back off un-does a fix that found a real\n' +
            '  defect — `noImplicitThis` alone caught a bare `this` that threw a TypeError\n' +
            '  every frame a player held garlic. If a regression genuinely needs one off,\n' +
            '  declare it in docs/SHORTCUTS.md with a ceiling and a trigger first.\n'
    );
    process.exit(1);
}

// ---------------------------------------------------------------------------
// Part 2 — the two outstanding flags may only get smaller.
// ---------------------------------------------------------------------------

/**
 * Run `tsc` once per outstanding flag with that flag switched on.
 *
 * A temporary config extending the project's own `tsconfig.json` is used rather
 * than a hand-written one, so the measured surface cannot drift from the surface
 * the project actually compiles.
 */
function measureFlag(flag) {
    // The config must sit IN THE REPO ROOT. `include` is not inherited through
    // `extends`, so a config written to a temp directory resolves no source files,
    // compiles nothing, and reports zero errors -- which reads exactly like success.
    // Measured: the same config in /tmp reported 1 error where the repo copy
    // reported 237.
    const cfgPath = path.join(repoRoot, `tsconfig.strict-${flag}.json`);
    writeFileSync(
        cfgPath,
        JSON.stringify({
            extends: path.join(repoRoot, 'tsconfig.json'),
            compilerOptions: { [flag]: true, noEmit: true }
        })
    );
    let out = '';
    try {
        out = execFileSync(path.join(repoRoot, 'node_modules', '.bin', 'tsc'), ['-p', cfgPath], {
            cwd: repoRoot,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe']
        });
    } catch (err) {
        // `tsc` exits non-zero when it has errors, which is the normal case here.
        // A crash with no compiler output is different, and must not read as zero.
        out = `${err.stdout ?? ''}${err.stderr ?? ''}`;
        if (!out.includes('error TS')) {
            console.error(
                `check-strict: FAILED — \`tsc\` produced no compiler output for \`${flag}\`. ` +
                    'A failed run is not a clean one, and reporting zero errors here would ' +
                    'be a gate that passes by not working.'
            );
            process.exit(1);
        }
    }
    // A config that resolves no files is not a clean measurement. Ask the compiler
    // what it would actually compile rather than trusting an empty error list.
    const show = execFileSync(
        path.join(repoRoot, 'node_modules', '.bin', 'tsc'),
        ['-p', cfgPath, '--showConfig'],
        { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
    );
    const fileCount = (JSON.parse(show).files ?? []).length;
    if (fileCount < 10) {
        console.error(
            `check-strict: FAILED — the probe for \`${flag}\` resolves only ${fileCount} ` +
                'source file(s). A measurement over nothing reports zero errors, which is ' +
                'indistinguishable from a clean codebase.'
        );
        process.exit(1);
    }
    return { ...parseTscOutput(out), fileCount };
}

const measured = {};
try {
    for (const flag of STRICT_FLAG_IDS) measured[flag] = measureFlag(flag);
} finally {
    for (const flag of STRICT_FLAG_IDS) {
        const cfgPath = path.join(repoRoot, `tsconfig.strict-${flag}.json`);
        if (existsSync(cfgPath)) rmSync(cfgPath);
    }
}

const baseline = JSON.parse(readFileSync(BASELINE, 'utf8'));
const ceilings = baseline.strictCeilings;

if (!ceilings) {
    console.error(
        'check-strict: FAILED — no `strictCeilings` in quality-baseline.json. The two ' +
            'outstanding flags have error counts that can rise, and without recorded ' +
            'ceilings this gate cannot see it. That is the exact failure it exists for.'
    );
    process.exit(1);
}

const describe = () => {
    for (const flag of STRICT_FLAGS) {
        const m = measured[flag.id];
        console.error(
            `    ${flag.label.padEnd(18)} src ${String(m.src).padStart(4)}   test ${String(m.test).padStart(4)}`
        );
    }
};

if (process.argv.includes('--update')) {
    const verdict = judgeStrict(measured, ceilings);
    if (!verdict.ok) {
        console.error('check-strict: REFUSED — the measurement is above the recorded ceiling.\n');
        for (const reason of verdict.reasons) console.error(`  ${reason}\n`);
        console.error('  A rise is a regression. `--update` records improvements only.');
        process.exit(1);
    }
    const next = {};
    for (const flag of STRICT_FLAG_IDS)
        next[flag] = { src: measured[flag].src, test: measured[flag].test };
    console.log('check-strict: recording an improvement');
    for (const line of verdict.improvements) console.log(`  ${line}`);
    baseline.strictCeilings = next;
    writeBaseline(BASELINE, baseline);
    process.exit(0);
}

const verdict = judgeStrict(measured, ceilings);

if (!verdict.ok) {
    console.error('check-strict: FAILED\n');
    for (const reason of verdict.reasons) console.error(`  ${reason}\n`);
    console.error(
        '  The two flags move each other: making a parameter optional for one moves an\n' +
            '  error into the other. If a rise is genuinely intended, raise the ceiling in\n' +
            '  quality-baseline.json deliberately, with the reason in the commit.\n'
    );
    console.error('  Measured:');
    describe();
    console.error('');
    process.exit(1);
}

const parts = STRICT_FLAGS.map((f) => `${f.label} src ${measured[f.id].src}/${ceilings[f.id].src}`);
console.log(
    `check-strict: ${ENABLED.length} flag(s) still enabled; ${parts.join(', ')} ` +
        '(measured/ceiling).'
);
