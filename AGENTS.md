# Agent & contributor mandate

**Read this before touching anything. It is not advisory.**

The full, versioned standard is [docs/ENGINEERING-STANDARDS.md](docs/ENGINEERING-STANDARDS.md).
This file is the short form that must be honoured on every single task.
Where this file and the standard disagree, the standard wins.

---

## The seven non-negotiables

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

### 7. Apple is the benchmark

How it looks, how smoothly it runs, how optimised the code is, how smooth the
interface is, how easy it is to use — we settle for nothing less. Perceived
quality comes from consistency, not features.

---

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

**GitHub Pages is not enabled on this repository**, so the
`Deploy to GitHub Pages` workflow cannot complete until it is. The workflow
itself is correct and gated on the full verify job; it is disabled so that a
permanent red X cannot mask real failures. Re-enable it with
`gh workflow enable "Deploy to GitHub Pages"` once Pages is switched on.
