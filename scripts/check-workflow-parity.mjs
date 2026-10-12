#!/usr/bin/env node
/**
 * @file scripts/check-workflow-parity.mjs
 * @description Do the two CI workflows install the same toolchain?
 *
 * WHY THIS EXISTS
 *
 * `deploy-pages.yml` carried the comment **"Identical to the CI job so the two can never
 * drift"** while it was missing `fetch-depth: 0` and the Godot steps. A comment asserting
 * parity is not parity, and nothing checked it -- so the deploy job's `check:assertions`
 * ran with a vacuously shallow history and its `check:godot` was a no-op.
 *
 * Found by a tooling audit, which observed that the commit that ACHIEVED parity is the one
 * that broke it.
 *
 * WHAT IT CHECKS, and it is deliberately narrow: the two workflows run the same command
 * (`verify:all`) and must therefore install the same things. Any step whose name matches a
 * toolchain installer or a project-preparation step has to appear in both. A step that is
 * genuinely job-specific is DECLARED below with a reason, because an undeclared difference
 * is how this drifted the first time.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CI = path.join(repoRoot, '.github', 'workflows', 'ci.yml');
const DEPLOY = path.join(repoRoot, '.github', 'workflows', 'deploy-pages.yml');

/** Step names that install a toolchain or prepare the tree. Must match in both. */
const SHARED = [
    'Setup Node.js',
    'Install dependencies',
    'Install Chromium for the browser gates',
    'Install Godot',
    'Import the Godot project',
    'Run the full verify gate'
];

/** Differences that are deliberate. Each needs a reason, or it is drift. */
const DECLARED = {
    checkout:
        'ci.yml sets fetch-depth: 0; deploy-pages.yml now does too, and this entry exists only to keep the intent written down.'
};

const names = (file) => {
    const src = readFileSync(file, 'utf8');
    return [...src.matchAll(/^\s*- name:\s*(.+?)\s*$/gm)].map((m) => m[1]);
};

const ci = names(CI);
const deploy = names(DEPLOY);

const missing = [];
for (const step of SHARED) {
    const inCi = ci.includes(step);
    const inDeploy = deploy.includes(step);
    if (inCi && !inDeploy) missing.push(`"${step}" runs in ci.yml and NOT in deploy-pages.yml`);
    if (inDeploy && !inCi) missing.push(`"${step}" runs in deploy-pages.yml and NOT in ci.yml`);
    if (!inCi && !inDeploy) {
        missing.push(
            `"${step}" is in the parity list and runs in NEITHER workflow. A list that ` +
                'names a step nobody runs cannot report a missing one.'
        );
    }
}

// A shallow checkout is the specific defect this gate was written for, so it is checked
// directly rather than trusted to the step list.
// COMMENTS STRIPPED FIRST, and the reason is this check's first bug: it matched its own
// explanatory prose. The comment above deploy's checkout contains the literal text
// `fetch-depth: 0` while describing the defect, so `fetch-depth: 1` in the actual
// configuration still passed.
//
// **A check that reads comments is checking the documentation, not the thing.** Same defect
// as a pass line counting files it never opened, one layer down: the pattern was satisfied
// by a sentence ABOUT the setting rather than by the setting.
const shallow = [];
for (const [label, file] of [
    ['ci.yml', CI],
    ['deploy-pages.yml', DEPLOY]
]) {
    const src = readFileSync(file, 'utf8')
        .split('\n')
        .filter((line) => !/^\s*#/.test(line))
        .join('\n');
    if (!/^\s*fetch-depth:\s*0\s*$/m.test(src)) {
        shallow.push(`${label} does not set \`fetch-depth: 0\``);
    }
}

if (missing.length > 0 || shallow.length > 0) {
    console.error('check-workflow-parity: FAILED\n');
    for (const m of missing) console.error(`  ${m}`);
    for (const s of shallow) {
        console.error(
            `  ${s}, so \`check:assertions\` compares against a base it cannot see and its`
        );
        console.error('      revision half is vacuously green.');
    }
    console.error(
        '\n  The two workflows run the same command, so they must install the same things.\n' +
            '  Either add the step to both, or declare the difference in DECLARED with a reason.\n'
    );
    process.exit(1);
}

console.log(
    `check-workflow-parity: ${SHARED.length} shared step(s) present in both workflows, ` +
        `both fetch full history (${Object.keys(DECLARED).length} declared difference).`
);
