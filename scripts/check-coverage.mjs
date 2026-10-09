#!/usr/bin/env node
/**
 * @file scripts/check-coverage.mjs
 * @description Asserts that every file this repository owns is actually being
 * checked by something. Four separate silent-failure modes, one gate.
 *
 * This replaces scripts/check-lint-coverage.mjs, which covered only the first.
 * All four were found by auditing for one bug class: **a green light wired to
 * nothing.** Each was invisible, not failing.
 *
 *   1. LINT COVERAGE
 *      ESLint prints nothing — no warning, exit 0 — for a file no config block
 *      matches. Measured: `eslint --max-warnings 0 tools/probe.js` → exit 0.
 *      `--max-warnings 0` cannot help, because it promotes *reported* warnings
 *      and an uncovered file reports nothing. Consequence here: `scripts/`,
 *      `service-worker.js` and `game.js` were never linted once in the
 *      project's life while `npm run lint` reported success throughout.
 *
 *   2. FORMAT COVERAGE
 *      Same shape, different tool. The prettier glob is an allow-list of
 *      extensions, so any extension not listed is silently skipped. 32 of 139
 *      tracked files were uncovered — including every `.yml`, which meant the
 *      CI workflows themselves were never format-checked.
 *
 *   3. TEST DISCOVERY
 *      Two halves. (a) A test file outside the runner's glob never runs and
 *      nothing says so. (b) Node's bare `node --test` treats any `test-*` file
 *      as a test, so tooling named that way is executed *as a test* — which is
 *      exactly what happened to `scripts/test-clock.mjs` and
 *      `scripts/test-live-deploy.js` (the latter failing against a live URL).
 *
 *   4. GATE DOCUMENTATION DRIFT
 *      The gate list in docs/ENGINEERING-STANDARDS.md §2 and the actual steps
 *      in scripts/verify.mjs are two descriptions of one thing. If they drift,
 *      the document starts lying about what "green" means.
 *
 * See docs/ENGINEERING-STANDARDS.md §6.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
const require = createRequire(import.meta.url);

if (typeof path.matchesGlob !== 'function') {
    console.error('check-coverage: path.matchesGlob is unavailable (needs Node >= 22.5).');
    console.error('Refusing to pass silently.');
    process.exit(1);
}

const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: repoRoot, encoding: 'utf8' })
    .split('\0')
    .filter(Boolean);

const pkg = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
const failures = [];
const notes = [];

/** Extensions inside a `**\/*.{a,b,c}` glob. */
function globExtensions(glob) {
    const m = /\{([^}]+)\}/.exec(glob);
    return m ? m[1].split(',').map((s) => s.trim()) : [];
}

const extOf = (f) => {
    const m = /\.([A-Za-z0-9]+)$/.exec(f);
    return m ? m[1] : null;
};

// ---------------------------------------------------------------------------
// 1. Lint coverage
// ---------------------------------------------------------------------------
{
    const SOURCE_EXT = /\.(js|mjs|cjs|jsx|ts|tsx|mts|cts)$/;
    const config = require(path.join(repoRoot, 'eslint.config.js'));

    const filePatterns = [];
    const ignorePatterns = [];
    for (const block of config) {
        if (block.files) filePatterns.push(...[].concat(block.files));
        if (block.ignores) ignorePatterns.push(...[].concat(block.ignores));
    }

    const uncovered = tracked
        .filter((f) => SOURCE_EXT.test(f))
        .filter((f) => !ignorePatterns.some((p) => path.matchesGlob(f, p)))
        .filter((f) => !filePatterns.some((p) => path.matchesGlob(f, p)));

    if (filePatterns.length === 0) {
        failures.push('lint: eslint.config.js declares no `files:` patterns at all');
    } else if (uncovered.length > 0) {
        failures.push(
            `lint: ${uncovered.length} source file(s) match no eslint config block, so they\n` +
                '      are never linted and ESLint reports nothing:\n' +
                uncovered.map((f) => `        ${f}`).join('\n')
        );
    }
    notes.push(`lint: ${tracked.filter((f) => SOURCE_EXT.test(f)).length} source files covered`);
}

// ---------------------------------------------------------------------------
// 2. Format coverage
// ---------------------------------------------------------------------------
{
    // Extensions prettier can format and that we own, and therefore expect the
    // format glob to include. Deliberately excludes assets (.png, .svg) and
    // files prettier has no parser for (.sh, .gitignore, CODEOWNERS).
    const SHOULD_FORMAT = new Set([
        'js',
        'mjs',
        'cjs',
        'jsx',
        'ts',
        'tsx',
        'json',
        'yml',
        'yaml',
        'html',
        'css',
        'md'
    ]);

    const glob = /--check "([^"]+)"/.exec(pkg.scripts['format:check'] || '');
    if (!glob) {
        failures.push('format: package.json `format:check` has no quoted glob to inspect');
    } else {
        const covered = new Set(globExtensions(glob[1]));
        const missingExts = [...SHOULD_FORMAT].filter((e) => !covered.has(e));

        if (missingExts.length > 0) {
            const affected = tracked.filter((f) => missingExts.includes(extOf(f)));
            failures.push(
                `format: the format glob omits ${missingExts.map((e) => `.${e}`).join(', ')}, ` +
                    `leaving ${affected.length} tracked file(s) never format-checked:\n` +
                    affected
                        .slice(0, 12)
                        .map((f) => `        ${f}`)
                        .join('\n') +
                    (affected.length > 12 ? `\n        … and ${affected.length - 12} more` : '')
            );
        }
        notes.push(`format: ${covered.size} extensions covered`);
    }
}

// ---------------------------------------------------------------------------
// 3. Test discovery
// ---------------------------------------------------------------------------
{
    const runner = pkg.scripts.test || '';
    // The runner may list SEVERAL globs — the test tree is mid-migration, so
    // it passes .js and .ts side by side. Reading only the first would report
    // every converted file as unrun, which is exactly the false alarm that
    // teaches people to ignore this check.
    //
    // Match everything AFTER `--test` and pull out each quoted token: a global
    // match on `--test` itself finds only the one occurrence of that word.
    const afterTest = runner.slice(runner.indexOf('--test') + '--test'.length);
    const runnerGlobs = [...afterTest.matchAll(/'([^']+)'|"([^"]+)"/g)].map((m) => m[1] || m[2]);
    const runnerGlob = runnerGlobs.length ? runnerGlobs.join(' ') : null;

    // Node's own bare-discovery heuristics. Any file matching these outside
    // test/ will be executed as a test by a bare `node --test`.
    const NODE_TEST_PATTERNS = [
        '**/*.test.js',
        '**/*.test.mjs',
        '**/*.test.cjs',
        '**/*-test.js',
        '**/*-test.mjs',
        '**/*-test.cjs',
        '**/*_test.js',
        '**/*_test.mjs',
        '**/*_test.cjs',
        '**/test-*.js',
        '**/test-*.mjs',
        '**/test-*.cjs',
        '**/test.js',
        '**/test.mjs',
        '**/test.cjs',
        '**/test/**/*.js',
        '**/test/**/*.mjs',
        '**/test/**/*.cjs'
    ];

    // (a) every test file must be run by the configured glob
    const testFiles = tracked.filter((f) => /\.(test|spec)\.[cm]?[jt]s$/.test(f));
    if (!runnerGlob) {
        failures.push('tests: package.json `test` script has no `--test <glob>` to inspect');
    } else {
        const notRun = testFiles.filter((f) => !runnerGlobs.some((g) => path.matchesGlob(f, g)));
        if (notRun.length > 0) {
            failures.push(
                `tests: ${notRun.length} test file(s) are not matched by "${runnerGlob}", so\n` +
                    '      they never run and nothing reports that:\n' +
                    notRun.map((f) => `        ${f}`).join('\n')
            );
        }
    }

    // (b) nothing outside test/ may look like a test to bare discovery
    const collisions = tracked.filter(
        (f) =>
            !f.startsWith('test/') &&
            !/^docs\//.test(f) &&
            NODE_TEST_PATTERNS.some((p) => path.matchesGlob(f, p))
    );
    if (collisions.length > 0) {
        failures.push(
            `tests: ${collisions.length} file(s) outside test/ match Node's bare test-discovery\n` +
                '      patterns, so a plain `node --test` would execute them as tests:\n' +
                collisions.map((f) => `        ${f}`).join('\n') +
                '\n      Rename them (they are tooling, not tests).'
        );
    }

    notes.push(`tests: ${testFiles.length} test files all matched by "${runnerGlob}"`);
}

// ---------------------------------------------------------------------------
// 4. Gate documentation drift
// ---------------------------------------------------------------------------
{
    const verifySrc = readFileSync(path.join(repoRoot, 'scripts/verify.mjs'), 'utf8');
    const steps = [...verifySrc.matchAll(/script:\s*'([^']+)'/g)].map((m) => m[1]);

    const docSrc = readFileSync(path.join(repoRoot, 'docs/ENGINEERING-STANDARDS.md'), 'utf8');

    // Direction A: every real step is documented.
    const undocumented = steps.filter((s) => !docSrc.includes(`npm run ${s}`));

    // Direction B: every documented command actually exists. This direction is
    // not theoretical — the §2 table used to document `npm run build`, a script
    // that has never existed. A documented-but-absent gate reads as coverage
    // and provides none.
    const documented = new Set([...docSrc.matchAll(/`npm run ([a-z0-9:_-]+)`/gi)].map((m) => m[1]));
    const nonExistent = [...documented].filter((s) => !(s in (pkg.scripts || {})));

    if (steps.length === 0) {
        failures.push('docs: scripts/verify.mjs declares no steps to compare against the docs');
    } else if (undocumented.length > 0) {
        failures.push(
            `docs: ${undocumented.length} verify step(s) are not listed in\n` +
                '      docs/ENGINEERING-STANDARDS.md §2, so the documented definition of\n' +
                '      "green" is out of date:\n' +
                undocumented.map((s) => `        npm run ${s}`).join('\n')
        );
    }

    if (nonExistent.length > 0) {
        failures.push(
            `docs: ${nonExistent.length} command(s) are documented in\n` +
                '      docs/ENGINEERING-STANDARDS.md but do not exist in package.json.\n' +
                '      A gate nobody can run is worse than no gate:\n' +
                nonExistent.map((s) => `        npm run ${s}`).join('\n')
        );
    }

    notes.push(`docs: ${steps.length} verify steps documented, both directions checked`);
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------
if (failures.length === 0) {
    console.log('check-coverage: all four coverage dimensions hold.');
    for (const n of notes) console.log(`  ${n}`);
    process.exit(0);
}

console.error(`check-coverage: FAILED in ${failures.length} area(s).\n`);
for (const f of failures) console.error(`  ${f}\n`);
console.error(
    'Each of these is a silent gap: the tooling reports success while never\n' +
        'looking at the file. That is worse than a red failure, because nobody\n' +
        'investigates a green light. See docs/ENGINEERING-STANDARDS.md §6.'
);
process.exit(1);
