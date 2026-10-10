#!/usr/bin/env node
/**
 * @file scripts/check-strict.mjs
 * @description Locks in the strict flags that are already satisfied.
 *
 * `strict` is a bundle, and this project turns its eight flags on one at a time
 * because they are not equally hard. That is a deliberate, ordered path — and it
 * has a failure mode of its own: a flag that is ON today can be set back to
 * `false` tomorrow by someone unblocking themselves, and nothing would notice.
 *
 * This refuses that. It reads the effective compiler options and fails if a flag
 * this project has already paid for is off.
 *
 * It does NOT fail on the two flags still outstanding — `noImplicitAny` and
 * `strictNullChecks`. Those are declared in `docs/SHORTCUTS.md` with ceilings,
 * and a gate that fails on a known, bounded, tracked gap is a gate somebody
 * disables. The point here is only that progress cannot silently reverse.
 */

import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');

/** Flags this project has already enabled, and must stay enabled. */
const ENABLED = [
    'alwaysStrict',
    'strictBindCallApply',
    'strictFunctionTypes',
    'noImplicitThis',
    'useUnknownInCatchVariables'
];

/** Flags still outstanding, declared in docs/SHORTCUTS.md with ceilings. */
const OUTSTANDING = ['noImplicitAny', 'strictNullChecks'];

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

console.log(
    `check-strict: ${ENABLED.length} flag(s) still enabled (${ENABLED.join(', ')}); ` +
        `${OUTSTANDING.join(' and ')} remain outstanding and are declared.`
);
