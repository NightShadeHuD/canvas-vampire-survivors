#!/usr/bin/env node
/**
 * @file scripts/check-hygiene.mjs
 * @description Catches the classes of mistake that are always wrong and must
 * never reach a commit. See docs/ENGINEERING-STANDARDS.md §1.2.
 *
 * Each check is here because it fails *silently* otherwise:
 *
 *   - A merge conflict marker means the merge was never finished. The file may
 *     still parse. Nothing else will tell you.
 *   - A focused test (`.only`) makes the rest of the suite stop running while
 *     still reporting green. It is the single most dangerous line a developer
 *     can commit, and it is invisible in a passing CI log.
 *   - A `console.log` in shipped game code is debug residue that a player sees
 *     in devtools.
 *   - A committed credential is a permanent leak: it survives in history after
 *     the line is deleted.
 *   - A large tracked binary bloats every clone forever.
 *
 * All checks run against `git ls-files`, so only tracked content is judged and
 * node_modules/, .wip/ and other scratch are excluded by construction.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');

/**
 * Tracked files, with their size in bytes.
 *
 * Refuses an empty set. Measured: with the glob pointed at nothing this gate
 * printed "clean — 0 tracked files checked" and exited 0, which is the same
 * shape a real pass takes.
 */
function trackedFiles() {
    const out = execFileSync('git', ['ls-files', '-z'], { cwd: repoRoot, encoding: 'utf8' });
    const files = out
        .split('\0')
        .filter(Boolean)
        .map((rel) => ({ rel, size: statSync(path.join(repoRoot, rel)).size }));
    if (files.length === 0) {
        console.error(
            'check-hygiene: FAILED — nothing to check: 0 tracked files were found, so ' +
                'this gate verified nothing. A gate that looks at nothing must not ' +
                'report that it looked at everything.'
        );
        process.exit(1);
    }
    return files;
}

const TEXT_EXT = /\.(js|mjs|cjs|jsx|ts|tsx|mts|cts|json|html|css|md|yml|yaml|sh|txt)$/;

/** Read a file as text, or null if it cannot be decoded (binary). */
function readText(abs) {
    try {
        return readFileSync(abs, 'utf8');
    } catch {
        return null;
    }
}

const problems = [];
const note = (check, rel, detail) => problems.push({ check, rel, detail });

const files = trackedFiles();
const textFiles = files.filter((f) => TEXT_EXT.test(f.rel));

// ---------------------------------------------------------------------------
// 1. Merge conflict markers
// ---------------------------------------------------------------------------
const CONFLICT = /^(<{7}|={7}|>{7})(\s|$)/m;
for (const { rel } of textFiles) {
    const text = readText(path.join(repoRoot, rel));
    if (text === null) continue;
    const m = CONFLICT.exec(text);
    if (m) {
        const line = text.slice(0, m.index).split('\n').length;
        note('conflict-marker', rel, `line ${line}: unfinished merge`);
    }
}

// ---------------------------------------------------------------------------
// 2. Focused tests — the silent suite-killer
// ---------------------------------------------------------------------------
const FOCUS = /\b(?:it|test|describe|suite)\.only\s*\(/;
for (const { rel } of textFiles) {
    const text = readText(path.join(repoRoot, rel));
    if (text === null) continue;
    const m = FOCUS.exec(text);
    if (m) {
        const line = text.slice(0, m.index).split('\n').length;
        note('focused-test', rel, `line ${line}: .only() stops the rest of the suite running`);
    }
}

// ---------------------------------------------------------------------------
// 3. Debug logging left in shipped game code
//    Scoped to src/ only: scripts/ are CLI tools where stdout is the interface.
// ---------------------------------------------------------------------------
const DEBUG_LOG = /\bconsole\.(log|debug)\s*\(/;
for (const { rel } of textFiles) {
    if (!rel.startsWith('src/')) continue;
    const text = readText(path.join(repoRoot, rel));
    if (text === null) continue;
    const lines = text.split('\n');
    lines.forEach((line, i) => {
        if (DEBUG_LOG.test(line)) {
            note('debug-logging', rel, `line ${i + 1}: console.log left in shipped code`);
        }
    });
}

// ---------------------------------------------------------------------------
// 4. Committed credentials
// ---------------------------------------------------------------------------
const SECRETS = [
    {
        name: 'private key block',
        re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/
    },
    { name: 'AWS access key id', re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
    { name: 'GitHub token', re: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/ },
    { name: 'Slack token', re: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/ },
    { name: 'Google API key', re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
    { name: 'OpenAI-style key', re: /\bsk-[A-Za-z0-9]{20,}\b/ }
];
for (const { rel } of textFiles) {
    const text = readText(path.join(repoRoot, rel));
    if (text === null) continue;
    for (const { name, re } of SECRETS) {
        if (re.test(text)) note('secret', rel, `looks like a committed ${name}`);
    }
}

// ---------------------------------------------------------------------------
// 5. Oversized tracked files
//    Bound chosen from measurement: the largest tracked asset is a 156 KB
//    screenshot, so 512 KB leaves >3x headroom for legitimate art while still
//    catching an accidental binary or bundle dump.
// ---------------------------------------------------------------------------
const MAX_BYTES = 512 * 1024;
for (const { rel, size } of files) {
    if (size > MAX_BYTES) {
        note('oversized-file', rel, `${Math.round(size / 1024)} KB > ${MAX_BYTES / 1024} KB bound`);
    }
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------
if (problems.length === 0) {
    console.log(
        `check-hygiene: clean — ${files.length} tracked files checked ` +
            `(conflicts, focused tests, debug logs, secrets, size).`
    );
    process.exit(0);
}

console.error(`check-hygiene: FAILED — ${problems.length} problem(s).\n`);
for (const { check, rel, detail } of problems) {
    console.error(`  [${check}] ${rel}\n      ${detail}`);
}
console.error('\nEach of these is always wrong and never intentional. Fix before committing.');
process.exit(1);
