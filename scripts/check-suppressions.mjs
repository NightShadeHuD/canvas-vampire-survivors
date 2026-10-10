#!/usr/bin/env node
/**
 * @file scripts/check-suppressions.mjs
 * @description Enforces the suppression ceilings recorded in
 * quality-baseline.json. See docs/ENGINEERING-STANDARDS.md §1.2.
 *
 * A suppression is any comment or call that tells a tool to stop looking:
 * `@ts-nocheck`, `@ts-ignore`, `eslint-disable`, a skipped test, a `debugger`,
 * a `TODO`. Each one is a place where the code is knowingly worse than the
 * standard. They are allowed to exist, but only in a quantity that is written
 * down, and that quantity may only ever go down.
 *
 * The count is compared with **equality**, not `<=`. If it were `<=`, a stale
 * ceiling of 10 with 3 real suppressions would silently permit 7 new ones —
 * a permanently open door. Equality forces the baseline to be ratcheted down
 * the moment an improvement lands, which is the only way the number stays
 * meaningful.
 *
 * Detection rules live in scripts/lib/suppression-scanner.mjs and are covered
 * by test/suppression-scanner.test.js.
 *
 * Usage:
 *   node scripts/check-suppressions.mjs            # enforce (CI / pre-commit)
 *   node scripts/check-suppressions.mjs --report   # print counts only
 *   node scripts/check-suppressions.mjs --update   # ratchet baseline to reality
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { writeBaseline } from './lib/baseline-file.mjs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { RULES, scanFiles } from './lib/suppression-scanner.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
const baselinePath = path.join(repoRoot, 'quality-baseline.json');

/** File extensions we consider source. Docs are excluded: they legitimately
 *  *describe* these patterns, and counting prose would be noise. */
const SOURCE_EXT = /\.(js|mjs|cjs|jsx|ts|tsx|mts|cts)$/;

const args = new Set(process.argv.slice(2));
const reportOnly = args.has('--report');
const update = args.has('--update');

/** Every tracked source file. Using git keeps node_modules/, .wip/ and other
 *  untracked scratch out of the count by construction. */
function trackedSourceFiles() {
    const out = execFileSync('git', ['ls-files', '-z'], { cwd: repoRoot, encoding: 'utf8' });
    return out
        .split('\0')
        .filter(Boolean)
        .filter((f) => SOURCE_EXT.test(f))
        .filter((f) => !f.startsWith('docs/'));
}

const files = trackedSourceFiles();
const { totals, hitsByRule } = scanFiles(files, (rel) =>
    readFileSync(path.join(repoRoot, rel), 'utf8')
);

if (reportOnly) {
    console.log(`Suppression counts across ${files.length} tracked source files:\n`);
    for (const rule of RULES) {
        console.log(`  ${String(totals[rule.id]).padStart(4)}  ${rule.label}`);
    }
    process.exit(0);
}

function loadBaseline() {
    return JSON.parse(readFileSync(baselinePath, 'utf8'));
}

const baseline = loadBaseline();
const ceilings = baseline.suppressionCeilings || {};

if (update) {
    baseline.suppressionCeilings = Object.fromEntries(RULES.map((r) => [r.id, totals[r.id]]));
    writeBaseline(baselinePath, baseline);
    console.log('check-suppressions: baseline ratcheted to current reality:');
    for (const rule of RULES) console.log(`  ${rule.id}: ${totals[rule.id]}`);
    process.exit(0);
}

const overCeiling = [];
const needRatcheting = [];

for (const rule of RULES) {
    const ceiling = ceilings[rule.id];
    const actual = totals[rule.id];

    if (ceiling === undefined) {
        overCeiling.push({ rule, ceiling: '(unset)', actual });
    } else if (actual > ceiling) {
        overCeiling.push({ rule, ceiling, actual });
    } else if (actual < ceiling) {
        needRatcheting.push({ rule, ceiling, actual });
    }
}

if (overCeiling.length === 0 && needRatcheting.length === 0) {
    console.log(`check-suppressions: all ${RULES.length} ceilings match exactly.`);
    process.exit(0);
}

if (overCeiling.length > 0) {
    console.error('check-suppressions: FAILED — suppression ceilings exceeded.\n');
    for (const { rule, ceiling, actual } of overCeiling) {
        console.error(`  ${rule.label}: ${actual} > ceiling ${ceiling}`);
        for (const e of (hitsByRule[rule.id] || []).slice(0, 10)) {
            console.error(`      ${e}`);
        }
    }
    console.error(
        '\nRemove the suppression, or — if it is genuinely unavoidable — add a\n' +
            'declaredGaps entry in quality-baseline.json explaining why, and raise\n' +
            'the ceiling in the same commit. Ceilings never rise silently.\n' +
            'Note: only comment directives count, so prose that merely mentions a\n' +
            'suppression is not flagged. See docs/ENGINEERING-STANDARDS.md §1.2.'
    );
}

if (needRatcheting.length > 0) {
    console.error('check-suppressions: FAILED — ceiling is stale (suppressions were removed).\n');
    for (const { rule, ceiling, actual } of needRatcheting) {
        console.error(`  ${rule.label}: ${actual} < ceiling ${ceiling}`);
    }
    console.error(
        '\nGood news: there are fewer suppressions than the baseline allows. Lock that\n' +
            'in so the headroom cannot be silently reused:\n' +
            '    node scripts/check-suppressions.mjs --update'
    );
}

process.exit(1);
