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

// `judgeClaims` HAS ALWAYS RETURNED an `unmeasured` list, AND NOTHING READ IT.
//
// It holds every claim whose measurement returned `null` — a claim whose tool is not
// on this machine, which is not the same as a claim that is wrong. The pass line then
// said every claim "match[ed] the measurement" while one had never been compared. The
// shape, measured: without Godot on PATH `measurements.godotAssertions` returns null
// rather than throwing, so `docs/GODOT-PORT.md`'s two Godot figures were counted as
// matching on a machine that could not measure them.
//
// **A report that claims what it did not check is the defect this repository spends
// its time on**, and the fix is the one `verify` already uses: say how many were
// checked and NAME the ones that were not.
//
// Not a failure: a thing that could not be measured is not a thing that failed — the
// distinction `check-assertions` makes when no base is reachable. Not a `NOTICE:`
// line either: `verify` counts those as gates that "checked nothing", and this gate
// did check the rest.
const checked = claims.length - verdict.unmeasured.length;
console.log(
    `check-claims: ${checked} of ${claims.length} claim(s) across ${documents.length} ` +
        `document(s) match the measurement (${names}).`
);
for (const u of verdict.unmeasured) console.log(`  UNMEASURED ${u}`);
if (verdict.unmeasured.length > 0) {
    console.log(
        '  Each is a claim this machine could not measure — a tool that is not here, or\n' +
            '  a suite that is not green. **These claims are unchecked here, not verified.**'
    );
}
