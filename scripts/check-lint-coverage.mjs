#!/usr/bin/env node
/**
 * @file scripts/check-lint-coverage.mjs
 * @description Every tracked source file must be matched by at least one
 * `files:` block in eslint.config.js.
 *
 * Why this exists: ESLint fails *completely silently* for a file no config
 * block matches. Measured on this repository:
 *
 *   $ eslint --max-warnings 0 tools/probe.js     # in-repo, no matching block
 *   $ echo $?
 *   0
 *
 * No output. No warning. Exit zero. So `npm run lint` reported success for the
 * project's entire life while `scripts/`, `service-worker.js` and `game.js`
 * were never linted at all — a green light wired to nothing, which is worse
 * than a red one because nobody investigates it.
 *
 * `--max-warnings 0` does not help: it turns *reported* warnings into failures,
 * and an uncovered file produces no report to promote.
 *
 * Matching uses `path.matchesGlob` (Node >= 22.5), which implements minimatch
 * semantics — the same family ESLint uses — so `src/**\/*.js` correctly matches
 * both `src/a.js` and `src/deep/a.js`.
 *
 * See docs/ENGINEERING-STANDARDS.md §6.
 */

import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
const require = createRequire(import.meta.url);

/** Extensions ESLint is expected to own. */
const SOURCE_EXT = /\.(js|mjs|cjs|jsx|ts|tsx|mts|cts)$/;

if (typeof path.matchesGlob !== 'function') {
    console.error('check-lint-coverage: path.matchesGlob is unavailable.');
    console.error('This check needs Node >= 22.5. Refusing to pass silently.');
    process.exit(1);
}

// --- every tracked source file ---------------------------------------------
const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: repoRoot, encoding: 'utf8' })
    .split('\0')
    .filter(Boolean)
    .filter((f) => SOURCE_EXT.test(f));

// --- the config's own file/ignore patterns ---------------------------------
const config = require(path.join(repoRoot, 'eslint.config.js'));

const filePatterns = [];
const ignorePatterns = [];
for (const block of config) {
    const files = block.files ? [].concat(block.files) : [];
    filePatterns.push(...files);
    if (block.ignores) ignorePatterns.push(...[].concat(block.ignores));
}

if (filePatterns.length === 0) {
    console.error('check-lint-coverage: eslint.config.js declares no `files:` patterns.');
    process.exit(1);
}

const isIgnored = (rel) => ignorePatterns.some((p) => rel === p || path.matchesGlob(rel, p));

const isCovered = (rel) => !isIgnored(rel) && filePatterns.some((p) => path.matchesGlob(rel, p));

const uncovered = tracked.filter((rel) => !isCovered(rel));

if (uncovered.length === 0) {
    console.log(
        `check-lint-coverage: all ${tracked.length} tracked source files match a lint config block.`
    );
    process.exit(0);
}

console.error(`check-lint-coverage: FAILED — ${uncovered.length} unlinted file(s).\n`);
for (const rel of uncovered) console.error(`  ${rel}`);
console.error(
    '\nESLint reports nothing at all for these — it exits 0 with no output — so\n' +
        'they would silently skip every lint rule forever. Add a `files:` block to\n' +
        'eslint.config.js that covers them, with globals appropriate to their\n' +
        'runtime, then add the path to the `lint` script in package.json.\n' +
        'See docs/ENGINEERING-STANDARDS.md §6.'
);
process.exit(1);
