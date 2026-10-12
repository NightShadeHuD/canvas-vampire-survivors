#!/usr/bin/env node
/**
 * @file scripts/check-claims.mjs
 * @description Do the numbers in the register match the ones the gates measured?
 *
 * Ported from `agent-scaffold/mechanisms/check_claims.py`. See
 * `scripts/lib/claims.mjs` for why, and for what it deliberately does not check.
 *
 * `check:register` reads the register's structure. This reads its NUMBERS, because a
 * row can be well formed and factually stale -- and this project's own example is
 * `strictNullChecks` in `src/` reported as zero for seven rounds after it was seven.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { CLAIM_BEGIN, judgeClaims, parseClaims } from './lib/claims.mjs';
import { measurements } from './lib/measurements.mjs';
import { execFileSync } from 'node:child_process';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');

const BASELINE = path.join(repoRoot, 'quality-baseline.json');

// EVERY tracked markdown file, not one hardcoded path. The register's block worked and
// covered 6 of 176 numeric lines; an audit found 15 stale numbers in the remainder.
const documents = execFileSync('git', ['ls-files', '*.md'], { cwd: repoRoot, encoding: 'utf8' })
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((rel) => ({ rel, text: readFileSync(path.join(repoRoot, rel), 'utf8') }))
    .filter((d) => d.text.includes(CLAIM_BEGIN));

const text = documents.map((d) => d.text).join('\n');
const ceilings = JSON.parse(readFileSync(BASELINE, 'utf8')).strictCeilings;

if (!ceilings || Object.keys(ceilings).length === 0) {
    console.error(
        'check-claims: FAILED — no `strictCeilings` in quality-baseline.json, so there is ' +
            'nothing measured to compare the register against. A gate with no source of ' +
            'truth can only agree with itself.'
    );
    process.exit(1);
}

const claims = parseClaims(text);

// A register whose numbers became unparseable would otherwise pass by finding nothing.
// "I checked nothing" must not look like "everything is consistent".
if (claims.length === 0) {
    console.error(
        'check-claims: FAILED — no measurable claims found in docs/SHORTCUTS.md. Either the ' +
            'numbers were removed, or the shape this parser reads changed. Both need looking ' +
            'at: a gate that matches nothing passes for the wrong reason.'
    );
    process.exit(1);
}

// Both sources: the ratcheted strict ceilings, and the measurement registry for
// one-number claims. A registry name that measures nothing is a claim nothing can check.
// AWAITED, because half the registry is async -- `src/data.ts` is imported, not parsed.
// Unresolved, every one of those compared against `[object Promise]` and the claim failed
// with a value nobody could act on. Measured rather than assumed: the first version printed
// exactly that string.
const registry = measurements(repoRoot);
const resolved = {};
for (const [name, value] of Object.entries(registry)) {
    resolved[name] = typeof value === 'function' ? await value() : value;
}
const sources = { ...ceilings, ...resolved };
const verdict = judgeClaims(claims, sources);

if (!verdict.ok) {
    console.error('check-claims: FAILED\n');
    for (const reason of verdict.reasons) console.error(`  ${reason}\n`);
    console.error(
        '  These are figures about the CURRENT revision, in the marked blocks of the\n' +
            '  documents that carry them. Every one is measurable by `npm run check:claims`\n' +
            '  (or `--update` where a ceiling ratchets). **A number in a document that nothing\n' +
            '  re-measures drifts, and prose does not notice** -- an audit found fifteen that had.\n'
    );
    process.exit(1);
}

const names = [...new Set(claims.map((c) => c.gate))].join(', ');
console.log(
    `check-claims: ${claims.length} claim(s) across ${documents.length} document(s) ` +
        `match the measurement (${names}).`
);
