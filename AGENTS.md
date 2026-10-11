# Agent & contributor mandate

**Read this before touching anything. It is not advisory.**

The full, versioned standard is [docs/ENGINEERING-STANDARDS.md](docs/ENGINEERING-STANDARDS.md).
This file is the short form that must be honoured on every single task.
Where this file and the standard disagree, the standard wins.

---

## The fourteen non-negotiables

Rules 1-7 are the original mandate. Rules 8-14 were each learned here the hard way --
each made more than twice before being written down, which is the threshold for a rule
worth having.

### 1. A red baseline stops everything

All tests must pass before you change anything. If they do not, **STOP and
report.** Do not attempt repairs — a red baseline you did not create is
information, and guessing at it destroys that information.

Reproduce it in a pristine checkout to prove it is not yours:

```bash
git worktree add --detach /tmp/baseline HEAD
cd /tmp/baseline && npm test
```

Diagnose it from evidence, report it, then fix it as its own reviewed commit.

### 2. No hacks. No undeclared shortcuts.

A shortcut is permitted only if it is **declared, bounded, and tracked** in
`quality-baseline.json`. An undeclared `@ts-nocheck`, `eslint-disable`,
`.skip`, or `TODO` is a build failure — mechanically, not by opinion.

### 3. No claim of correctness without the command that proved it

"It should work" is not a status. Name the command and its result. If you
cannot name the command, you have not verified it — say so.

### 4. If you are unsure whether it is finished, it is not

Report it as **partial** and name the gap. Optimism in a status report is a
defect. "Done except X, which is untested" is useful; "done" is not.

### 5. Review before commit

Read the diff as if someone else wrote it. Check style, production readiness,
and that tests exist and pass. Then commit.

### 6. Never edit source text with a blunt instrument

**Do not run `sed -i`, `perl -pi`, or any global substitution across a source
file. Do not rewrite a file with a one-line script.** Every scripted edit to
source must:

1. **anchor on text that matches exactly once**, and refuse if it matches zero
   or more than one;
2. **verify the result after writing** — read the file back and assert the
   intended text is present;
3. **be followed by `npm run verify`** before anything else happens.

Two failures in one session, both self-inflicted, both from ignoring this:

- An annotator inserted a type at a parameter's identifier and produced
  `update(dt: number, height: number?)` — invalid syntax — because it assumed the
  identifier was never already followed by `?`.
- A global substitution stripping backticks, run across `src/effects.ts` to
  clean up after the first mistake, **removed every backtick in the file** —
  including the template literals it builds its colours from:
  ``ctx.strokeStyle = `rgba(160,255,160,${...})`;``

Both were caught by `typecheck` within seconds. That is the gate doing its job
and the agent not doing theirs.

**The rule for a bulk change is: do it per-position, in a script that checks its
own work, one file at a time, with the full gate between files.**

**Use the helper. It is what makes this rule possible to follow.**

```bash
node scripts/edit.mjs src/foo.ts --anchor 'exact old text' --replace 'new text'
node scripts/edit.mjs src/foo.ts --anchor-file a.txt --replace-file b.txt  # multi-line
node scripts/edit.mjs src/foo.ts --anchor 'x' --replace 'y' --dry-run
```

It refuses an anchor that matches zero times or the wrong number of times, and
**after writing it reads the file back** to confirm the change is really there.
`scripts/lib/source-edit.mjs` is the same thing as a library for scripts, with
`planEdit` (pure, no writes) and `applyEdit`.

`npm run check:destructive` refuses `sed -i`/`perl -i`, shell redirection into a
source file, and direct `writeFileSync('src/...')` in committed tooling — but it
**cannot see a shell command that was never committed**, which is exactly where
the second failure happened. That half is on you.

**Do not mix mechanisms on one file.** A third failure, in one line of Python: read
`AGENTS.md` into memory, edit it with `edit.mjs` (which writes to disk), then write the
in-memory copy back — **clobbering the edit just made.** The file looked fine and one
change had silently vanished.

**One file, one tool, one write.** If a script must read and write, let IT do all the
edits, and never interleave a helper that writes with a buffer read before it.

---

### 7. Apple is the benchmark

How it looks, how smoothly it runs, how optimised the code is, how smooth the
interface is, how easy it is to use — we settle for nothing less. Perceived
quality comes from consistency, not features.

---

## What this project learned the hard way

Every rule below cost a round trip. They are written down because each one was made
**more than twice**, and a rule you have broken three times is a rule you will break
again.

### 8. A number in prose must cite the command that produced it

`strictNullChecks` in `src/` was reported as **zero for seven consecutive rounds** after
it had gone back to seven. Every one of those figures came from a hand-run shell command
and was then quoted rather than re-measured.

**If you state a metric, name the command — and re-run it in the round you state it.**
A metric with no gate behind it drifts, and prose does not notice.

### 9. When a port or migration is the goal, START IT

The Godot port was deferred for twenty rounds of TypeScript strictness work first.
Twenty rounds later: `strictNullChecks` had been worth every hour — GDScript has only
`null`, and the exporter's `undefined` branch is one line because of it — while
`noImplicitAny` had **no GDScript analogue at all** and 168 errors still outstanding.

**The port tells you what the source actually needs.** Doing the preparation first means
preparing for the wrong things, and nothing reveals which until the port begins.

### 10. Make the correct assertion the EASIER one

Half the red tests in this project were the _test_ being wrong, and they were not random
— they took seven distinct shapes: magnitude asserted where the claim was _direction_;
events counted where the claim was a _population_; state read _after_ it changed; a value
hardcoded that could be _read_; floats compared for _equality_; a _rate_ expected to be a
certainty; a _precondition_ assumed and never set.

"Be more careful" fixes none of these. `godot/assertions.gd` does, by making the correct
form the short form: `Check.rose(before, after)` is no longer than
`assert(before < 20.0)` and **cannot be wrong about which direction the claim was.**

### 11. A check is not a check until you have watched it FAIL

Twice in two rounds the verification layer itself was the defect:

- A suite mixing two assertion harnesses **printed `FAIL` and reported `PASS`.**
- A **GDScript runtime error did not fail a suite** — it printed a stack trace and
  carried on, so a crashing test was green.

**Break the thing on purpose and confirm the check catches it.** A green light nobody
investigates is worse than a red one.

### 12. If the data declares it, a test must prove the code reads it

Four times a field existed in `src/data.ts` and **nothing read it**: weapon `type`,
passive `effect`, enemy `archetype`, achievement `check`. Each was invisible because the
tests asserted the one case that happened to work.

**Drive the data table itself.** A test that iterates the real table and asserts every
entry does _something_ fails the moment a new entry is added without an implementation —
which is what `verify_weapons`, `verify_passives` and `verify_archetypes` do.

### 13. Generated code needs a DRIFT check, not a regeneration

`check:godot` regenerated the Godot data and then verified it — so it **silently repaired
drift and always passed.** Proved by corrupting a committed value: the check rewrote it
and reported `ok`.

**Generate to a temporary directory and DIFF.** A check that fixes the thing it is
checking can never fail.

### 14. Measure a cascade before starting it

A dozen changes were backed out because the cascade was larger than the increment — and
every one was discovered _after_ starting. `--explain`, `--dry-run` and a one-file probe
say how big a change is before it is half-made.

Backing out is correct. Backing out **repeatedly, for the same reason,** means the
measuring step was being skipped.

## Before you commit

```bash
npm run verify          # tier 1: lint, format, tests, clocks, baseline, hygiene
npm run verify:all      # tier 2 as well: boot smoke + accessibility (needs Chromium)
```

Both must pass. `npm run verify:all` is the definition of done.

Setup, once per clone:

```bash
npm install
npx playwright install chromium   # only needed for the browser gates
npm run setup                     # installs the git hooks
```

**Re-run `npx playwright install chromium` after any Playwright upgrade.** The
browser is versioned with the library, so a bump leaves the old binary in place
and the new one missing. The failure is loud but misleading — `verify` passes every
gate and then stops at

```
boot-smoke: could not launch Chromium — Executable doesn't exist at
  .../chromium_headless_shell-1243/...
```

— which reads like a broken gate rather than a missing download. **CI is unaffected
because `verify:all`'s workflow step installs the browser every run**, which is
why a green PR is not evidence that a local checkout works. Hit for real when
Playwright went 1.59 to 1.63.

---

## What is enforced, and by what

| Rule                                                    | Mechanism                                        |
| ------------------------------------------------------- | ------------------------------------------------ |
| No new test failures, no stale baseline                 | `scripts/check-baseline.mjs`                     |
| Suppression ceilings can only shrink                    | `scripts/check-suppressions.mjs`                 |
| No conflicts, focused tests, debug logs, secrets, bloat | `scripts/check-hygiene.mjs`                      |
| Every source file is really linted                      | `scripts/check-coverage.mjs`                     |
| Measured coverage never falls                           | `scripts/check-coverage-floor.mjs`               |
| No test depends on today's date                         | `scripts/check-clocks.mjs`                       |
| The game still boots and plays                          | `scripts/boot-smoke.mjs`                         |
| Accessibility holds                                     | `scripts/a11y-audit.mjs`                         |
| No bulk edits to source in committed tooling            | `scripts/check-destructive.mjs`                  |
| The Godot port runs and has not drifted                 | `scripts/check-godot.mjs`                        |
| All of the above, in order, locally                     | `.githooks/pre-push` → `npm run verify`          |
| All of the above, unbypassably                          | CI job **Verify**, required by branch protection |

`check:coverage` exists because ESLint prints **nothing** — no warning, exit
0 — for a file that no config block matches, so `npm run lint` can report success
while whole directories are never linted. That is exactly what had happened to
`scripts/`, `service-worker.js` and `game.js`. Never trust `eslint .` on its own;
the coverage check is what makes it meaningful.

If a gate is wrong, fix the gate in a reviewed commit. **Never delete or weaken
a gate to make a change pass.** That is the one move that turns this repository
back into a project with good intentions instead of guarantees.

---

## Working on this codebase

- **Zero runtime dependencies.** Every added dependency is a liability we chose
  to accept, and the commit message must justify it.
- **Unit tests are the default.** `node --test`, no framework churn. Every bug
  fix lands with the test that would have caught it.
- **Tests are hermetic.** Inject time; never read the wall clock. (Two tests
  once passed for months and then failed forever because they hardcoded a date
  against a 14-day prune window. `scripts/check-clocks.mjs` exists because of
  that.)
- **Boundaries get pinned.** If code prunes, caps, or expires, test the value
  exactly on the boundary and one past it.
- **Performance is measured, not assumed.** Object pooling and spatial
  partitioning are load-bearing; `test/perf-budget.test.js` guards them.
- **Accessibility is a feature.** Every dialog needs an accessible name; see
  `test/a11y-dialogs.test.js`.

---

## Repository setup notes

**`main` is protected. Every change goes through a pull request.** Direct pushes
are rejected by GitHub, not merely discouraged:

```
remote: - Changes must be made through a pull request.
remote: - Required status check "Verify" is expected.
 ! [remote rejected] HEAD -> main (protected branch hook declined)
```

Enforced on `main`: the required `Verify` check (strict — the branch must be up
to date), pull requests mandatory, force pushes denied, deletions denied, and
`enforce_admins` on so nobody bypasses it, not even the owner. Verified by probe:
both a force push and a direct commit push were rejected.

The practical workflow is therefore:

```bash
git switch -c my-change
git commit -m "..."                     # pre-commit gate runs
git push -u origin my-change            # pre-push gate runs
gh pr create --fill                     # CI runs the full gate on the PR
gh pr merge --squash --delete-branch    # succeeds only once Verify is green
```

`required_approving_review_count` is 0, so a solo maintainer can merge their own
PR once the gate passes. Setting it to 1 would have locked the owner out of
their own repository, because GitHub does not allow self-approval.

**Never add a git remote named `upstream`.** The `gh` CLI prefers a remote with
that exact name over `origin`, which means every `gh` command run without an
explicit `-R` would silently target a repository you do not own. This bit us
once already: `gh repo view` in this working copy resolved to the original
public project rather than to ours. The reference remote is therefore named
`source`:

```
origin    https://github.com/NightShadeHuD/canvas-vampire-survivors.git
source    https://github.com/ricardo-foundry/canvas-vampire-survivors.git
```

Pass `-R NightShadeHuD/canvas-vampire-survivors` on any scripted `gh` command as
well. Belt and braces — the rename protects interactive use, the flag protects
automation.

**GitHub Pages is ENABLED, and the game is playable at**
<https://nightshadehud.github.io/canvas-vampire-survivors/>.

This was previously recorded here as _not enabled_, with the deploy workflow disabled so a
permanent red X could not mask real failures. Both were corrected once the workflow was
verified to gate on the full `Verify` job before deploying:

```bash
gh api --method POST repos/NightShadeHuD/canvas-vampire-survivors/pages -f build_type=workflow
gh workflow enable "Deploy to GitHub Pages"
```

First deploy verified end to end: the workflow ran `Verify`, built `dist/`, assembled `_site`
and deployed; every asset returned 200; and a headless browser confirmed the deployed game
starts a run, advances its clock and reports **0 page errors**.

**`__SURV_DEBUG__` is deliberately absent on the deployed site.** It is gated on
`location.hostname` being `localhost`, `127.0.0.1` or empty, so the debug hooks that
`scripts/boot-smoke.mjs` drives exist locally and not in production. That is intended, and it
means boot smoke cannot verify the live site — it is verified by observation instead.
