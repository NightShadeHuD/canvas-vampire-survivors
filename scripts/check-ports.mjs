#!/usr/bin/env node
/**
 * @file scripts/check-ports.mjs
 * @description Hold the Godot port surface to a ceiling that may only fall.
 *
 * `docs/GODOT-PORT-RESEARCH.md` established that a TypeScript-to-GDScript
 * converter exists, so the port is a TRANSFORM of this codebase rather than a
 * rewrite. This makes the size of that transform a tracked number instead of a
 * figure in a document that drifts the moment someone writes another `?.`.
 *
 * Two totals, because the two kinds of hazard mean different things:
 *
 *   error    the converter refuses it — mechanical work with a known shape
 *   silent   it converts and BEHAVES DIFFERENTLY — nothing fails, so it is
 *            counted separately and watched more closely
 *
 * `--update` records an improvement. The ceiling may only fall; raising it is a
 * deliberate edit to `quality-baseline.json` with its reason.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { measurePorts, judgePorts, PORT_HAZARDS } from './lib/port-hazards.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
const BASELINE = path.join(repoRoot, 'quality-baseline.json');

/**
 * Files that DEFINE these hazards rather than suffer from them.
 *
 * `test/port-hazards.test.ts` is the only one, and it is exempt for the reason
 * `check-destructive` exempts its own rule table: it tests the tool that COUNTS
 * hazards, so its fixtures are hazards. Declared by path rather than inferred,
 * because the alternative is what actually happened — every test added to make
 * the metric trustworthy raised the metric, and the ceiling had to be raised
 * three times in one sitting for a reason nobody could review.
 */
const DEFINES_THE_HAZARDS = new Set(['test/port-hazards.test.ts']);

/** Source ships; tests are contracts, and a loose contract is still a hazard. */
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
        'check-ports: FAILED — nothing to check: 0 source files were found, so this ' +
            'gate verified nothing. A gate that looks at nothing must not report that ' +
            'it looked at everything.'
    );
    process.exit(1);
}

const measured = measurePorts(
    files
        .filter((rel) => !DEFINES_THE_HAZARDS.has(rel))
        .map((rel) => ({ path: rel, text: readFileSync(path.join(repoRoot, rel), 'utf8') }))
);

const baseline = JSON.parse(readFileSync(BASELINE, 'utf8'));
const ceilings = baseline.portCeilings;

if (!ceilings) {
    console.error(
        'check-ports: FAILED — no `portCeilings` in quality-baseline.json. A metric ' +
            'with no recorded ceiling cannot detect a regression.'
    );
    process.exit(1);
}

const describe = () => {
    const rows = PORT_HAZARDS.map((h) => [h, measured.byHazard[h.id] ?? 0])
        .filter(([, n]) => n > 0)
        .sort((a, b) => b[1] - a[1]);
    console.error('  By hazard:');
    for (const [h, n] of rows) {
        console.error(`    ${String(n).padStart(4)}  ${h.label}  [${h.kind}]`);
    }
    console.error('  Worst files:');
    const heaviest = Object.entries(measured.byFile)
        .map(([f, counts]) => [f, Object.values(counts).reduce((a, b) => a + b, 0)])
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6);
    for (const [f, n] of heaviest) {
        console.error(`    ${String(n).padStart(4)}  ${f}`);
    }
};

if (process.argv.includes('--update')) {
    const next = { error: measured.byKind.error ?? 0, silent: measured.byKind.silent ?? 0 };
    if (next.error > ceilings.error || next.silent > ceilings.silent) {
        console.error(
            `check-ports: REFUSED — the measurement (${next.error} error, ${next.silent} silent) ` +
                `is ABOVE the recorded ceiling (${ceilings.error}, ${ceilings.silent}). ` +
                '--update records improvements; raising a ceiling is a deliberate change ' +
                'to quality-baseline.json.'
        );
        process.exit(1);
    }
    // Say WHAT moved, not just that the file was rewritten. A baseline change
    // nobody can read is a baseline change nobody reviews.
    console.log('check-ports: recording an improvement');
    console.log(`  error  ${ceilings.error} -> ${next.error}`);
    console.log(`  silent ${ceilings.silent} -> ${next.silent}`);
    for (const [id, n] of Object.entries(measured.byHazard)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 4)) {
        console.log(`  most of it: ${n} x ${id}`);
    }
    baseline.portCeilings = next;
    const escape = (s) => s.replace(/\u00a7/g, '\\u00a7').replace(/\u2014/g, '\\u2014');
    writeFileSync(BASELINE, escape(JSON.stringify(baseline, null, 4)) + '\n');
    process.exit(0);
}

const verdict = judgePorts(measured, ceilings);

if (!verdict.ok) {
    console.error('check-ports: FAILED\n');
    for (const reason of verdict.reasons) console.error(`  ${reason}\n`);
    describe();
    console.error('');
    process.exit(1);
}

const error = measured.byKind.error ?? 0;
const silent = measured.byKind.silent ?? 0;
console.log(
    `check-ports: ${measured.total} port hazard(s) across ${Object.keys(measured.byFile).length} ` +
        `of ${files.length} file(s) — ${error} refused by the converter (ceiling ${ceilings.error}), ` +
        `${silent} SILENT (ceiling ${ceilings.silent}).`
);
