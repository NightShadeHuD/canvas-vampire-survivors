#!/usr/bin/env node
/**
 * @file scripts/ci-report.mjs
 * @description Publish the `Verify` status for a commit that has already been pushed.
 *
 * WHY THIS IS SEPARATE FROM `npm run ci`
 *
 * A commit status can only be attached to a commit GitHub has seen. But `npm run ci` has to run
 * BEFORE `git push` — `pre-push` refuses without the receipt it writes. **The two moments cannot
 * be the same one**, and the first version of `ci-local.mjs` treated that as a failure and
 * blamed `gh auth status`, which was fine.
 *
 * So the receipt is written before the push (enforcement) and the status is published after it
 * (evidence). This script reads the receipt and posts it. Nothing here re-runs the gate — **it
 * reports what was already measured, and refuses if the receipt is not for HEAD**, because a
 * status on a revision nobody verified is worse than no status.
 *
 * The status is EVIDENCE, not enforcement: nothing reads it. See AGENTS.md.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const run = (cmd, args) => execFileSync(cmd, args, { cwd: repoRoot, encoding: 'utf8' }).trim();
const say = (msg) => console.log(`ci-report: ${msg}`);

const CONTEXT = 'Verify';

let receipt;
try {
    receipt = JSON.parse(readFileSync(path.join(repoRoot, '.verify-receipt.json'), 'utf8'));
} catch {
    say('FAILED — no readable .verify-receipt.json. Run `npm run ci` first.');
    process.exit(1);
}

const head = run('git', ['rev-parse', 'HEAD']);
if (receipt.sha !== head) {
    say(
        `FAILED — the receipt is for ${receipt.short ?? receipt.sha.slice(0, 7)}, but HEAD is ${head.slice(0, 7)}.`
    );
    say('  A status on a revision nobody verified is worse than no status. Re-run `npm run ci`.');
    process.exit(1);
}

const repo = run('gh', ['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner']);
const state = receipt.ok ? 'success' : 'failure';
const description = receipt.ok
    ? `local verify:all passed in ${receipt.seconds}s on ${receipt.short}`
    : `local verify:all FAILED after ${receipt.seconds}s on ${receipt.short}`;

try {
    run('gh', [
        'api',
        '--method',
        'POST',
        `repos/${repo}/statuses/${head}`,
        '-f',
        `state=${state}`,
        '-f',
        `context=${CONTEXT}`,
        '-f',
        `description=${description}`
    ]);
    say(`published "${CONTEXT}" = ${state} for ${receipt.short} to ${repo}`);
    say(`  measured at ${receipt.at}; the receipt is what \`pre-push\` reads.`);
} catch (err) {
    const stderr = String(err.stderr ?? '').trim();
    say('FAILED to publish the status.');
    if (/No commit found for SHA/i.test(stderr)) {
        say(`  ${receipt.short} is still not on GitHub. Push the branch first:`);
        say('      git push -u origin <branch>');
    } else if (stderr) {
        say(`  gh said: ${stderr.split('\n')[0]}`);
    }
    say('  Nothing is blocked: the receipt is written and `pre-push` reads the receipt.');
    process.exit(1);
}
