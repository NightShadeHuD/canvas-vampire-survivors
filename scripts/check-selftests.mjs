#!/usr/bin/env node
/**
 * @file scripts/check-selftests.mjs
 * @description Does every gate have input that makes it FAIL?
 *
 * PORTED FROM `agent-scaffold/mechanisms/check_selftests.py`, whose docstring names this
 * project's own four findings as the reason it exists:
 *
 *     a gate that regenerated the thing it was checking, so it could not fail
 *     a suite that printed FAIL and reported PASS
 *     a runtime error did not fail a suite
 *     a gate counting one directory while the product's other half went unchecked
 *
 * **Every one was found by someone OTHER than the person who wrote the gate.** That is
 * rule 16; this is rule 11 made mechanical rather than remembered.
 *
 * WHAT IT IS NOT, stated first because the honest version is the useful one: it cannot
 * invent a falsifying input for arbitrary logic, and it does not try. It makes the
 * DECLARATION mandatory -- a gate with no self-test is reported as UNPROVEN rather than
 * assumed sound, and a declared self-test is RUN, so "this can fail" is verified rather
 * than asserted. The intelligence stays with the person writing the gate.
 *
 * A self-test that leaves its gate GREEN is a failure of the self-test: it means the gate
 * cannot fail on that input, which is the finding.
 *
 * ---------------------------------------------------------------------------
 * RESTORING, WHICH I GOT WRONG TWICE
 *
 * A break that creates a file and `git add`s it is STAGED, and `git checkout HEAD -- .`
 * does not unstage -- so the probe survived and the run failed while blaming the break.
 * Fixed with `git reset` first.
 *
 * Then `git clean -fdq -- scripts` **deleted this script**, because the script itself was
 * a new untracked file in `scripts/`. A restore that removes more than the break created
 * is worse than no restore.
 *
 * So each entry DECLARES what it creates (`creates`), and the restore removes exactly
 * those paths and nothing else. `git clean` is not used at all.
 * ---------------------------------------------------------------------------
 */

import { execSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { NOTICE_PREFIX } from './lib/gate-input.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
const manifest = JSON.parse(readFileSync(path.join(repoRoot, 'gate-selftests.json'), 'utf8'));

// The gates `verify.mjs` runs, so a gate with NO self-test can be NAMED rather than
// silently omitted. A ledger that only lists what it already knows cannot show a gap.
const verifySource = readFileSync(path.join(repoRoot, 'scripts', 'verify.mjs'), 'utf8');
const allGates = [...verifySource.matchAll(/script: '([^']+)'/g)].map((m) => m[1]);

/**
 * Undo ONE entry's damage, and nothing else.
 *
 * `git checkout HEAD -- .` was the original, and it reverts **every uncommitted change in
 * the tree** -- not only the ones a break made. That is not a restore, it is a reset, and it
 * silently destroyed work five times in one session:
 *
 *     a `package.json` edit, notices two commands later via check:coverage
 *     an AGENTS.md header change, noticed by grepping for the text that should be there
 *     a gate-selftests.json fix, twice, and the same fix a third time
 *
 * **Every one was an edit to THIS MECHANISM'S OWN INPUT**, which is the worst place for it:
 * the way to find out whether a self-test works is to write one and run it, and the run
 * deleted the thing being tested. The workaround -- edit, commit, then run -- is not a fix,
 * because the failure is silent and looks like your own mistake.
 *
 * So each `run` now restores exactly the paths its own `break` touched, declared in
 * `touches`, plus anything it `creates`. A path the break did not name is left alone.
 */
function restore(entry) {
    const touched = [...(entry.touches ?? []), ...(entry.creates ?? [])];
    if (touched.length > 0) {
        try {
            execSync('git reset -q', { cwd: repoRoot, stdio: 'pipe' });
            execSync('git checkout -q HEAD -- ' + touched.map((t) => `'${t}'`).join(' '), {
                cwd: repoRoot,
                stdio: 'pipe'
            });
        } catch {
            /* a path that is not tracked cannot be checked out; creates handles it below */
        }
    }
    try {
        execSync('git reset -q', { cwd: repoRoot, stdio: 'pipe' });
    } catch {
        /* best effort */
    }
    for (const rel of entry.creates ?? []) {
        const full = path.join(repoRoot, rel);
        if (existsSync(full)) rmSync(full, { force: true });
    }
}

// ---------------------------------------------------------------------------
// REFUSE TO RUN ON A DIRTY TREE.
//
// The restore is `git checkout HEAD -- .`, which reverts EVERY uncommitted change -- not
// only the ones a break made. Running this mid-work therefore DESTROYS the work in
// progress, and it did: an edit to `package.json` made earlier in the same session was
// silently reverted by a run of this script, and the only reason it was noticed is that
// `check:coverage` then reported a command that did not exist.
//
// A self-test that can destroy uncommitted work is worse than no self-test, because the
// damage is invisible and lands on the person least able to tell it apart from their own
// mistake. So it does not run at all unless the tree is clean apart from its own files.
// ---------------------------------------------------------------------------
// NO EXEMPTIONS. This list used to exclude the manifest and this script, on the reasoning
// that they are the mechanism's own files and a break never touches them. **But the
// restore is a blanket `git checkout HEAD -- .`, so "a break never touches it" is not the
// question -- "will the restore revert it" is, and the answer for an uncommitted manifest
// edit is YES.** It reverted one, silently, and the fix had to be written twice.
const OWN_PATHS = [];
const preDirty = execSync('git status --porcelain', { cwd: repoRoot, encoding: 'utf8' })
    .split('\n')
    .filter((l) => l.trim() && !OWN_PATHS.some((o) => l.includes(o)));

if (preDirty.length > 0 && !process.argv.includes('--force')) {
    // A NOTICE, NOT A FAILURE -- and the distinction matters now that this is in the chain.
    //
    // The restore is `git checkout HEAD -- .`, which reverts ALL uncommitted changes, so
    // running on a dirty tree would DESTROY the work in progress. It did once: a
    // `package.json` edit was silently reverted and only noticed two commands later.
    //
    // Failing here would make `npm run verify` refuse for the entire time anyone is
    // mid-change, which is most of the time -- and a gate that blocks ordinary work is a
    // gate that gets bypassed. So it reports what it did NOT check and exits 0.
    //
    // **The honest cost:** on a dirty tree this proves nothing, exactly like a skipped
    // check. It says so out loud, in the same shape `check:godot` uses when Godot is
    // absent, and CI runs it on a committed tree where it does the real work.
    console.log(
        // `NOTICE:` with a COLON -- `scripts/lib/gate-input.mjs` counts that exact prefix,
        // and this line said `NOTICE —` with an em dash, so `verify` reported "1 of which
        // checked nothing" while TWO had. Found by a tooling audit.
        `check-selftests: ${NOTICE_PREFIX} ${preDirty.length} uncommitted path(s), so the gate ` +
            'self-tests did NOT run. This is not a pass; it is an unchecked gate. Commit ' +
            'and re-run, or pass --force if you are certain there is nothing to lose.\n' +
            preDirty
                .slice(0, 5)
                .map((d) => `    ${d}`)
                .join('\n')
    );
    process.exit(0);
}

// ---------------------------------------------------------------------------
// A SELF-TEST CAN REQUIRE SOMETHING. CI found this the first time the gate ran there.
//
// `check:godot`'s break edits a generated value, and the gate refuses drift -- **but only
// where Godot is installed.** In CI it prints NOTICE and exits 0, so the break produced no
// failure and the self-test reported "the gate stayed GREEN", which reads as a gate defect
// and is actually a missing dependency.
//
// **A self-test that cannot run is not a self-test that failed**, and conflating them makes
// the ledger wrong in the direction that matters: it would report a gate as unproven when
// nobody had tried. Declared per entry, and reported in its own category.
// ---------------------------------------------------------------------------
const has = (cmd) => {
    try {
        execSync(`command -v ${cmd}`, { cwd: repoRoot, stdio: 'pipe' });
        return true;
    } catch {
        return false;
    }
};
const REQUIREMENTS = { godot: () => has('godot'), python3: () => has('python3') };

const proven = [];
const failures = [];
const skipped = [];
const unmet = [];

for (const entry of manifest) {
    const missing = (entry.requires ?? []).filter((r) => !(REQUIREMENTS[r] ?? (() => true))());
    if (missing.length > 0) {
        unmet.push(`${entry.gate}: needs ${missing.join(', ')}, which is not available here`);
        restore(entry);
        continue;
    }

    if (entry.incomplete) {
        skipped.push(`${entry.gate}: ${entry.why}`);
        restore(entry);
        continue;
    }

    let broke = true;
    try {
        execSync(entry.break, { cwd: repoRoot, stdio: 'pipe' });
    } catch {
        broke = false;
    }
    if (!broke) {
        failures.push(`${entry.gate}: its BREAK command itself failed to run`);
        restore(entry);
        continue;
    }

    let green = false;
    try {
        execSync(entry.run, { cwd: repoRoot, stdio: 'pipe' });
        green = true;
    } catch {
        green = false;
    }
    restore(entry);

    if (green) {
        failures.push(
            `${entry.gate}: the gate stayed GREEN on a deliberately broken input.\n      ${entry.why}`
        );
    } else {
        proven.push(entry.gate);
    }
}

const declaredGates = new Set(manifest.map((s) => s.gate));
const unproven = allGates.filter((g) => !declaredGates.has(g));

// The mechanism's OWN files are excluded. They are new when this is first committed and
// a break never touches them, so counting them would fail the run on the author's own
// uncommitted work rather than on a restore failure -- a false alarm in the one check
// whose whole job is to notice a real mess.
const OWN = OWN_PATHS;
const dirty = execSync('git status --porcelain', { cwd: repoRoot, encoding: 'utf8' })
    .split('\n')
    .filter((l) => l.trim() && !l.includes('node_modules') && !OWN.some((o) => l.includes(o)));

console.log(
    `check-selftests: ${proven.length} gate(s) WATCHED FAILING, ${unproven.length} unproven, ` +
        `${skipped.length} self-test(s) declared incomplete, of ${allGates.length} in the chain.`
);
for (const g of unproven) {
    console.log(`  UNPROVEN   ${g} — no self-test declares an input that makes it fail`);
}
for (const s of skipped) console.log(`  INCOMPLETE ${s}`);
for (const u of unmet) console.log(`  UNMET      ${u}`);

if (dirty.length > 0) {
    console.error(`\ncheck-selftests: FAILED — ${dirty.length} path(s) left modified by a break:`);
    for (const d of dirty.slice(0, 8)) console.error(`  ${d}`);
    console.error('\n  A self-test that leaves the tree dirty is worse than no self-test.');
    process.exit(1);
}

if (failures.length > 0) {
    console.error('\ncheck-selftests: FAILED\n');
    for (const f of failures) console.error(`  ${f}\n`);
    process.exit(1);
}

if (unproven.length > 0) {
    // A NOTICE, not a failure. Failing would make the honest answer -- "nobody has watched
    // this one fail" -- the expensive one, and the ledger would fill with plausible
    // entries instead of real ones. The count prints every run so it cannot be forgotten.
    console.log(
        `\ncheck-selftests: NOTICE — ${unproven.length} gate(s) have never been watched ` +
            'failing. Rule 11: a gate nobody has watched fail is a gate nobody knows works.'
    );
}
