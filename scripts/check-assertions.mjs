#!/usr/bin/env node
/**
 * @file scripts/check-assertions.mjs
 * @description Refuses an assertion that became weaker between two revisions.
 *
 * The companion to `check:suite`. That gate refuses a test that was DELETED or
 * DISABLED; this one refuses the same test, still present and still passing,
 * asserting less. Measured in this repository: weakening
 * `assert.equal(cam.intensity, 0)` to `assert.ok(cam.intensity >= 0)` left
 * 530/530 tests passing and every other gate green.
 *
 * Adopted from the agent-scaffold method (`mechanisms/check_assertions.py`).
 *
 * A DELIBERATE WEAKENING IS SOMETIMES RIGHT
 *
 *   npm run check:assertions -- --allow "reason the assertion is weaker"
 *
 * `--allow` requires text, so "because CI failed" is not expressible, and the
 * reason is printed. This mirrors principle P2: a shortcut is legitimate only
 * when it is declared.
 *
 * WHEN THERE IS NO BASE
 *
 * The check compares revisions, so it needs one. With no base reachable it
 * SKIPS WITH A NOTICE and says so — it never exits 0 while quietly having
 * checked nothing, which is the failure this repository's own gate list exists
 * to avoid.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { writeBaseline } from './lib/baseline-file.mjs';
import path from 'node:path';
import { compareFiles, judgeDigests } from './lib/assertion-diff.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');

/** Read an argument's value, or null when it is absent. */
function option(name) {
    const index = process.argv.indexOf(name);
    return index === -1 ? null : (process.argv[index + 1] ?? '');
}

const allowReason = option('--allow');
if (process.argv.includes('--allow') && !allowReason?.trim()) {
    console.error('check-assertions: --allow requires a reason. A weakening with no');
    console.error('stated reason is an undeclared shortcut, not a decision.');
    process.exit(2);
}

/** Run git, returning stdout, or null when the command fails. */
function git(args) {
    try {
        return execFileSync('git', args, {
            cwd: repoRoot,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe']
        });
    } catch {
        return null;
    }
}

/** The base revision to compare against, or null when none is reachable. */
function resolveBase() {
    const explicit = option('--base');
    if (explicit) return git(['rev-parse', '--verify', '-q', explicit]) ? explicit : null;
    for (const candidate of ['origin/main', 'main', 'HEAD~1']) {
        if (git(['rev-parse', '--verify', '-q', candidate])) return candidate;
    }
    return null;
}

const base = resolveBase();
if (!base) {
    console.log(
        'check-assertions: SKIPPED (not checked) — no base revision is reachable, ' +
            'so no assertion could be compared. This is a notice, not a pass: pass ' +
            '--base <rev> to run it.'
    );
    process.exit(0);
}

// Only MODIFIED files: a file added this revision has no parent assertions to
// weaken, and a deleted one is caught by the test-count floor in check:suite.
const listed = git(['diff', '--name-only', '--diff-filter=M', base, '--', 'test/*.test.ts']) ?? '';
const files = listed
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

/**
 * THE DIGEST PASS — the hole the revision diff structurally cannot cover.
 *
 * `git diff base..HEAD` cannot see a weakening committed DIRECTLY to the base,
 * because the base then contains the weakened version and there is nothing to
 * compare against. Row 8 of `docs/SHORTCUTS.md` records that hole.
 *
 * A digest recorded in `quality-baseline.json` closes it: a test file whose
 * assertions differ from the recorded digest AND which is not modified against
 * the base arrived by that unseen path. It is a report for a human, not a
 * verdict — a legitimate addition also changes the digest, and the answer is to
 * re-record it.
 */
const allTests = execFileSync('git', ['ls-files', 'test/*.test.ts'], {
    cwd: repoRoot,
    encoding: 'utf8'
})
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

const loaded = allTests
    .filter((rel) => existsSync(path.join(repoRoot, rel)))
    .map((rel) => ({ path: rel, text: readFileSync(path.join(repoRoot, rel), 'utf8') }));

const baseline = JSON.parse(readFileSync(path.join(repoRoot, 'quality-baseline.json'), 'utf8'));
const recorded = baseline.assertionDigests ?? {};
const modified = new Set(files);

if (process.argv.includes('--update')) {
    const { fresh } = judgeDigests(loaded, {}, modified);
    baseline.assertionDigests = Object.fromEntries(
        Object.entries(fresh).sort(([a], [b]) => a.localeCompare(b))
    );
    // Written with the escaping the other baselines use, so the file stays
    // byte-consistent whichever tool last touched it.
    writeBaseline(path.join(repoRoot, 'quality-baseline.json'), baseline);
    console.log(
        `check-assertions: recorded digests for ${Object.keys(fresh).length} test file(s).`
    );
    process.exit(0);
}

const digestVerdict = judgeDigests(loaded, recorded, modified);
if (!digestVerdict.ok) {
    console.error('check-assertions: FAILED\n');
    for (const reason of digestVerdict.reasons) console.error(`  ${reason}\n`);
    process.exit(1);
}

if (!files.length) {
    console.log(
        `check-assertions: no modified test files against ${base}; ` +
            `${Object.keys(recorded).length} recorded digest(s) all match.`
    );
    process.exit(0);
}

let findings = 0;
for (const file of files) {
    const parentText = git(['show', `${base}:${file}`]);
    if (parentText === null) continue;
    let currentText;
    try {
        currentText = readFileSync(path.join(repoRoot, file), 'utf8');
    } catch {
        continue;
    }
    for (const finding of compareFiles(parentText, currentText)) {
        findings += 1;
        console.error(`check-assertions: ${file}\n  ${finding}\n`);
    }
}

if (findings) {
    if (allowReason?.trim()) {
        console.log(`check-assertions: ${findings} weakening(s) ALLOWED against ${base}.`);
        console.log(`  reason: ${allowReason.trim()}`);
        process.exit(0);
    }
    console.error(
        `check-assertions: FAILED — ${findings} weakening(s) against ${base}.\n\n` +
            '  A suite that gets greener without getting stronger is principle P7.\n' +
            '  If the weakening is deliberate and right, record why:\n' +
            '    npm run check:assertions -- --allow "reason"\n'
    );
    process.exit(1);
}

console.log(
    `check-assertions: ${files.length} modified test file(s) compared against ${base}, no weakening.`
);
