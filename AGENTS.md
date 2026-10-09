# Agent & contributor mandate

**Read this before touching anything. It is not advisory.**

The full, versioned standard is [docs/ENGINEERING-STANDARDS.md](docs/ENGINEERING-STANDARDS.md).
This file is the short form that must be honoured on every single task.
Where this file and the standard disagree, the standard wins.

---

## The six non-negotiables

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

### 6. Apple is the benchmark

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
| No test depends on today's date                         | `scripts/test-clock.mjs`                         |
| The game still boots and plays                          | `scripts/boot-smoke.mjs`                         |
| Accessibility holds                                     | `scripts/a11y-audit.mjs`                         |
| All of the above, in order, locally                     | `.githooks/pre-push` → `npm run verify`          |
| All of the above, unbypassably                          | CI job **Verify**, required by branch protection |

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
  against a 14-day prune window. `scripts/test-clock.mjs` exists because of
  that.)
- **Boundaries get pinned.** If code prunes, caps, or expires, test the value
  exactly on the boundary and one past it.
- **Performance is measured, not assumed.** Object pooling and spatial
  partitioning are load-bearing; `test/perf-budget.test.js` guards them.
- **Accessibility is a feature.** Every dialog needs an accessible name; see
  `test/a11y-dialogs.test.js`.

---

## Repository setup notes

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

**GitHub Pages is not enabled on this private repository**, so the
`Deploy to GitHub Pages` workflow cannot complete until it is (Pages on a
private repo needs a plan that includes it, or the repository made public). The
workflow itself is correct and now gated on the full verify job; it is disabled
so that a permanent red X cannot mask real failures. Re-enable it with
`gh workflow enable "Deploy to GitHub Pages"` once Pages is switched on.
