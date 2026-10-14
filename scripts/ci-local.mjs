#!/usr/bin/env node
/**
 * @file scripts/ci-local.mjs
 * @description The gate, run here, reported to GitHub — because there is no CI runner.
 *
 * WHY THIS EXISTS
 *
 * GitHub Actions was removed at the maintainer's direction: **all verification happens on the
 * machine doing the work.** But `main` is protected with `Verify` as a REQUIRED status check,
 * so simply deleting the workflow would have deadlocked the repository — the check would never
 * report and no pull request could ever merge, with `enforce_admins` on so not even the owner
 * could override it.
 *
 * So the check still exists; the RUNNER moved. This script does what the workflow did:
 *
 *   1. runs `npm run verify:all` — the full gate, browser tier included
 *   2. writes a local receipt naming the exact revision it passed on
 *   3. reports that result to GitHub as the `Verify` commit status
 *
 * **What this preserves, and what it costs.** The required check stays unbypassable in the
 * sense that matters: `gh pr merge` refuses without it, and only a passing run produces it.
 * What is lost is INDEPENDENCE — a CI runner cannot be talked out of running, and this script
 * can simply not be invoked. That is a real reduction in guarantee and it is the trade the
 * maintainer chose. **Nothing here should ever be described as "CI".**
 *
 * WHY IT KEYS ON THE REVISION
 *
 * A status is attached to a COMMIT. Reporting `success` for a revision that was never tested
 * would be worse than reporting nothing, because a green check is read as evidence. So the
 * script refuses when the tree is dirty and names the SHA it tested in the description — a
 * reader can compare that against what they are about to merge.
 */

import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RECEIPT = path.join(repoRoot, '.verify-receipt.json');

const run = (cmd, args, opts = {}) =>
    execFileSync(cmd, args, { cwd: repoRoot, encoding: 'utf8', ...opts }).trim();

const sha = run('git', ['rev-parse', 'HEAD']);
const short = sha.slice(0, 7);
const branch = run('git', ['rev-parse', '--abbrev-ref', 'HEAD']);
const dirty = run('git', ['status', '--porcelain']).length > 0;

const say = (msg) => console.log(`ci-local: ${msg}`);

// A RECEIPT IS FOR A REVISION. A dirty tree has no revision that describes it, so a passing run
// here would certify a state that exists on no commit anywhere -- the exact overclaim the
// status API makes permanent on a PR.
if (dirty && !process.argv.includes('--allow-dirty')) {
    say('FAILED — the working tree has uncommitted changes.');
    say('  A commit status names a REVISION, and a dirty tree is not one: the receipt would');
    say('  certify a state that exists on no commit. Commit first, or pass --allow-dirty to');
    say('  run the gate locally without reporting anything.');
    process.exit(1);
}

const report = !process.argv.includes('--no-report');

say(`running the full gate on ${short} (${branch})${dirty ? ' — DIRTY, will not report' : ''}`);
const started = Date.now();
let ok = true;
try {
    execFileSync('npm', ['run', 'verify:all'], { cwd: repoRoot, stdio: 'inherit' });
} catch {
    ok = false;
}
const seconds = Math.round((Date.now() - started) / 1000);

const receipt = {
    sha,
    short,
    branch,
    ok,
    seconds,
    dirty,
    at: new Date().toISOString(),
    gate: 'npm run verify:all'
};
writeFileSync(RECEIPT, `${JSON.stringify(receipt, null, 4)}\n`);
say(`receipt: ${ok ? 'PASS' : 'FAIL'} in ${seconds}s -> .verify-receipt.json`);

if (!report) {
    say('--no-report: the gate result is recorded locally and NOT sent to GitHub.');
    process.exit(ok ? 0 : 1);
}

// The status context must match the name branch protection requires, or the check stays pending
// forever and the PR is unmergeable -- the deadlock this whole design exists to avoid.
const CONTEXT = 'Verify';
// Resolved BEFORE the gate runs, and its own failure is reported as itself. Reading it after a
// five-minute run means a typo here reads as a gate failure.
let repo;
try {
    repo = run('gh', ['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner']);
} catch (err) {
    say('FAILED — could not resolve the repository with `gh repo view`.');
    say(
        `  gh said: ${
            String(err.stderr ?? err.message)
                .trim()
                .split('\n')[0]
        }`
    );
    say('  Is `gh` installed and authenticated? `gh auth status`');
    process.exit(1);
}
const state = ok ? 'success' : 'failure';
const description = ok
    ? `local verify:all passed in ${seconds}s on ${short}`
    : `local verify:all FAILED after ${seconds}s on ${short}`;

try {
    run('gh', [
        'api',
        '--method',
        'POST',
        `repos/${repo}/statuses/${sha}`,
        '-f',
        `state=${state}`,
        '-f',
        `context=${CONTEXT}`,
        '-f',
        `description=${description}`,
        '-f',
        `target_url=https://github.com/${repo}/commit/${sha}`
    ]);
    say(`reported "${CONTEXT}" = ${state} for ${short} to ${repo}`);
} catch (err) {
    // THE REAL DIAGNOSIS, not a guess at it. The first version of this printed
    // "run `gh auth status`" for every failure -- and when it was actually exercised, `gh`
    // was authenticated and the same POST succeeded by hand. **It sent the reader to check a
    // thing that was not wrong**, which is a worse failure than the one it was reporting.
    //
    // `execFileSync` puts the useful part in `stderr`, and `err.message` alone shows only the
    // exit code and the command. So: stderr, verbatim, plus the two facts a reader needs to
    // reproduce it by hand.
    const stderr = String(err.stderr ?? '').trim();

    // A COMMIT THAT IS NOT ON GITHUB YET IS THE NORMAL CASE, NOT A FAILURE.
    //
    // `npm run ci` runs BEFORE `git push` -- it has to, because `pre-push` refuses without the
    // receipt it writes. But a commit status can only be attached to a commit the server has
    // seen, so on an unpushed branch GitHub answers HTTP 422 "No commit found for SHA".
    //
    // **That is not an error, and the first version of this reported it as one** -- then sent
    // the reader to `gh auth status`, which was fine. The right answer is to say what actually
    // happened and name the command that finishes the job once the commit exists.
    const notPushedYet = /No commit found for SHA/i.test(stderr);

    if (notPushedYet) {
        say(`the commit ${short} is not on GitHub yet, so the status cannot be set.`);
        say('  That is expected: `npm run ci` runs before `git push`, and a status needs a');
        say('  commit the server has. The RECEIPT is written and `pre-push` will accept it.');
        say('');
        say('  To publish the status once it is pushed:');
        say('');
        say('      git push -u origin <branch>');
        say('      npm run ci:report');
        process.exit(ok ? 0 : 1);
    }

    say(`FAILED to report the status to GitHub.`);
    if (stderr) say(`  gh said: ${stderr.split('\n').slice(0, 3).join('\n            ')}`);
    say(`  The gate itself ${ok ? 'PASSED' : 'FAILED'}; only the reporting failed.`);
    say(`  Reproduce by hand:`);
    say(
        `    gh api --method POST repos/${repo}/statuses/${sha} -f state=${state} ` +
            `-f context=${CONTEXT} -f description='${description}'`
    );
    say('  This does NOT block anything: the receipt is written and `pre-push` reads it.');
    process.exit(1);
}

process.exit(ok ? 0 : 1);
