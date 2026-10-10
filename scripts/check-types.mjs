#!/usr/bin/env node
/**
 * @file scripts/check-types.mjs
 * @description Track how much of this codebase is typed as `any`.
 *
 * This is the port-readiness metric. Every other gate here measures the
 * JavaScript game; this one measures how much of it a GDScript translator would
 * have to infer rather than read. `any` has no Godot equivalent, so a falling
 * count is the port getting closer and a rising one is the port getting further
 * away while every other gate stays green.
 *
 * The ceiling may only fall. `--update` records an improvement; raising it is a
 * deliberate act that shows up in review as a diff to `quality-baseline.json`.
 */

import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { writeBaseline } from './lib/baseline-file.mjs';
import path from 'node:path';
import { measureAny, judgeAny } from './lib/type-coverage.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
const BASELINE = path.join(repoRoot, 'quality-baseline.json');

/** Source and tests, because a loose test is a place a contract is unstated. */
const files = execFileSync('git', ['ls-files', 'src/*', 'test/*'], {
    cwd: repoRoot,
    encoding: 'utf8'
})
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => /\.(?:ts|js|mjs)$/.test(l))
    .sort();

if (files.length === 0) {
    console.error(
        'check-types: FAILED — nothing to check: 0 source files were found, so this ' +
            'gate verified nothing. A gate that looks at nothing must not report that ' +
            'it looked at everything.'
    );
    process.exit(1);
}

const measured = measureAny(
    files.map((rel) => ({ path: rel, text: readFileSync(path.join(repoRoot, rel), 'utf8') }))
);

const baseline = JSON.parse(readFileSync(BASELINE, 'utf8'));
const ceiling = baseline.anyCeiling;

if (ceiling === undefined) {
    console.error(
        'check-types: FAILED — no `anyCeiling` in quality-baseline.json. A metric with ' +
            'no recorded ceiling cannot detect a regression.'
    );
    process.exit(1);
}

if (process.argv.includes('--update')) {
    if (measured.total > ceiling) {
        console.error(
            `check-types: REFUSED — the measured count (${measured.total}) is ABOVE the ` +
                `recorded ceiling (${ceiling}). --update records improvements; raising a ` +
                'ceiling is a deliberate change to quality-baseline.json with its reason.'
        );
        process.exit(1);
    }
    baseline.anyCeiling = measured.total;
    writeBaseline(BASELINE, baseline);
    console.log(`check-types: ceiling lowered ${ceiling} -> ${measured.total}.`);
    process.exit(0);
}

const verdict = judgeAny(measured, ceiling);

if (!verdict.ok) {
    console.error('check-types: FAILED\n');
    console.error(`  ${verdict.reason}\n`);
    console.error('  The worst offenders:');
    for (const [file, count] of Object.entries(measured.perFile)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)) {
        console.error(`    ${String(count).padStart(3)}  ${file}`);
    }
    console.error('\n  By form:');
    for (const [form, count] of Object.entries(measured.byForm).sort((a, b) => b[1] - a[1])) {
        console.error(`    ${String(count).padStart(3)}  ${form}`);
    }
    console.error('');
    process.exit(1);
}

const forms = Object.entries(measured.byForm)
    .sort((a, b) => b[1] - a[1])
    .map(([f, c]) => `${c} ${f}`)
    .join(', ');
console.log(
    `check-types: ${measured.total} use(s) of \`any\` across ${Object.keys(measured.perFile).length} ` +
        `of ${files.length} file(s) (ceiling ${ceiling})${forms ? ` — ${forms}` : ''}.`
);
if (verdict.reason) console.log(`  ${verdict.reason}`);
