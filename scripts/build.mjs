#!/usr/bin/env node
/**
 * @file scripts/build.mjs
 * @description Compiles `src/` to `dist/` for the browser.
 *
 * The build is two steps, not one, and the second is not optional.
 *
 * `src/package.json` contains `{"type": "module"}`, which is what makes Node
 * treat every file in `src/` as an ES module. `tsc` does not copy it, so a
 * freshly emitted `dist/` has no such marker and inherits `"type": "commonjs"`
 * from the root package.json. Every emitted file is then loaded as CommonJS:
 *
 *     SyntaxError: Named export 'FpsMeter' not found. The requested module
 *     '../../dist/systems.js' is a CommonJS module, which may not support all
 *     module.exports as named exports.
 *
 * The browser does not care — it treats `<script type="module">` imports as ESM
 * regardless of any package.json — so this defect is invisible until something
 * runs the built output under Node, which is exactly what the tests do to prove
 * the build is faithful. It is also what any future Node-side consumer of
 * `dist/` would hit.
 *
 * See docs/TYPESCRIPT-MIGRATION.md.
 */

import { execFileSync } from 'node:child_process';
import { rmSync, mkdirSync, writeFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
const distDir = path.join(repoRoot, 'dist');

// Start clean so a file deleted from src/ cannot linger in dist/ and keep being
// served. A stale artifact that still imports a removed module fails in the
// browser, at runtime, for a user.
rmSync(distDir, { recursive: true, force: true });
mkdirSync(distDir, { recursive: true });

let output = '';
try {
    output = execFileSync(
        path.join(repoRoot, 'node_modules', '.bin', 'tsc'),
        ['-p', path.join(repoRoot, 'tsconfig.build.json')],
        { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
    );
} catch (err) {
    const errOutput = `${err.stdout || ''}${err.stderr || ''}`;
    const errors = errOutput.split('\n').filter((l) => l.includes('error TS'));
    console.error(`build: tsc failed with ${errors.length} error(s).`);
    for (const line of errors.slice(0, 40)) console.error(`  ${line}`);
    if (errors.length > 40) console.error(`  … and ${errors.length - 40} more`);
    process.exit(1);
}

// Declare the module system for the emitted tree. Without this every file in
// dist/ is CommonJS. See the file header.
writeFileSync(
    path.join(distDir, 'package.json'),
    `${JSON.stringify({ type: 'module' }, null, 4)}\n`
);

const emitted = readdirSync(distDir).filter((f) => f.endsWith('.js')).length;
if (emitted === 0) {
    console.error('build: tsc reported no errors but emitted no JavaScript.');
    process.exit(1);
}

console.log(`build: ${emitted} module(s) written to dist/ (ESM declared)`);
if (output.trim()) console.log(output.trim());
