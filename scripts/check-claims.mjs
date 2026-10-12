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
import { judgeClaims, parseClaims } from './lib/claims.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');

const REGISTER = path.join(repoRoot, 'docs', 'SHORTCUTS.md');
const BASELINE = path.join(repoRoot, 'quality-baseline.json');

const text = readFileSync(REGISTER, 'utf8');
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

const verdict = judgeClaims(claims, ceilings);

if (!verdict.ok) {
    console.error('check-claims: FAILED\n');
    for (const reason of verdict.reasons) console.error(`  ${reason}\n`);
    console.error(
        '  The register states figures about the CURRENT revision. Every one of them is\n' +
            '  measurable by `npm run check:strict` (or `--update` to ratchet). A number in a\n' +
            '  document that nothing re-measures drifts, and prose does not notice.\n'
    );
    process.exit(1);
}

const names = [...new Set(claims.map((c) => c.gate))].join(', ');
console.log(
    `check-claims: ${claims.length} claim(s) in docs/SHORTCUTS.md match the measured ` +
        `ceilings (${names}).`
);
