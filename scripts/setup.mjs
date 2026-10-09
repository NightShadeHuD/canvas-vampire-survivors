#!/usr/bin/env node
/**
 * @file scripts/setup.mjs
 * @description One-time developer setup: point git at the committed hooks and
 * make sure they are executable. See docs/ENGINEERING-STANDARDS.md §6.
 *
 * Hooks live in .githooks/ and are versioned with the code, so the rules travel
 * with the repository instead of living in one person's memory. Git only reads
 * them from `core.hooksPath`, which this script sets.
 *
 * Idempotent: safe to run any number of times.
 */

import { execFileSync } from 'node:child_process';
import { chmodSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
const hooksDir = path.join(repoRoot, '.githooks');

try {
    const inRepo = execFileSync('git', ['rev-parse', '--is-inside-work-tree'], {
        cwd: repoRoot,
        encoding: 'utf8'
    }).trim();
    if (inRepo !== 'true') throw new Error('not a work tree');
} catch {
    console.error('setup: not inside a git work tree — nothing to do.');
    process.exit(1);
}

// 1. Make every hook executable (git tracks the mode, but a fresh clone on a
//    filesystem that dropped it would silently stop enforcing).
const entries = readdirSync(hooksDir);
let chmodded = 0;
for (const name of entries) {
    const abs = path.join(hooksDir, name);
    try {
        chmodSync(abs, 0o755);
        chmodded++;
    } catch {
        /* Not a regular file, or already fine. */
    }
}

// 2. Point git at the committed hooks.
execFileSync('git', ['config', 'core.hooksPath', '.githooks'], { cwd: repoRoot });

const active = execFileSync('git', ['config', 'core.hooksPath'], {
    cwd: repoRoot,
    encoding: 'utf8'
}).trim();

console.log('setup: hooks installed');
console.log(`  core.hooksPath = ${active}`);
console.log(`  ${chmodded} hook(s) marked executable: ${entries.join(', ')}`);
console.log('\n  pre-commit  fast gates (suppressions, hygiene, format, lint)');
console.log('  pre-push    full gate (npm run verify)');
console.log('\nCI enforces the same gates on every push, so a bypassed hook is still caught.');
