#!/usr/bin/env node
/**
 * @file scripts/check-destructive.mjs
 * @description Refuses unverified bulk edits in this repository's own tooling.
 *
 * Both of this session's self-inflicted failures came from editing source text
 * in bulk — an annotator that mis-handled an optional parameter, and a global
 * `sed` that stripped every backtick from a file it was cleaning up. Both were
 * caught by `typecheck` within seconds, and both were avoidable by not reaching
 * for a blunt instrument.
 *
 * This holds the half of that lesson a machine can hold: committed scripts and
 * hooks must not rewrite source files with an unanchored in-place substitution.
 *
 * WHAT IT CANNOT SEE is stated in its own module header: the destructive command
 * was an agent's shell invocation, never committed. That half is a mandate, and
 * this check does not pretend to cover it.
 */

import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { findDestructiveEdits } from './lib/destructive-edit.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');

/** Scripts and hooks: the files that DO things, as opposed to describing them. */
const scripts = execFileSync('git', ['ls-files', 'scripts/*', '.githooks/*'], {
    cwd: repoRoot,
    encoding: 'utf8'
})
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && /\.(?:mjs|js|cjs|sh)$/.test(line))
    .sort();

if (scripts.length === 0) {
    console.error(
        'check-destructive: FAILED — nothing to check: 0 scripts were found, so ' +
            'this gate verified nothing. A gate that looks at nothing must not ' +
            'report that it looked at everything.'
    );
    process.exit(1);
}

const findings = [];
for (const rel of scripts) {
    findings.push(...findDestructiveEdits(rel, readFileSync(path.join(repoRoot, rel), 'utf8')));
}

if (findings.length) {
    console.error('check-destructive: FAILED\n');
    for (const finding of findings) console.error(`  ${finding}`);
    console.error('');
    process.exit(1);
}

console.log(
    `check-destructive: ${scripts.length} script(s) and hook(s); none rewrites source ` +
        'files with an unanchored bulk substitution.'
);
