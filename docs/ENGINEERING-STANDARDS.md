# Engineering Standards

**Version:** 1.0.0
**Status:** In force
**Applies to:** every commit, every branch, every contributor — human or agent.

This document is the constitution for this repository. Where anything else — a
README, a code comment, a habit, an agent's convenience — conflicts with this
document, this document wins.

It is enforced **mechanically, not by good intentions.** Every rule below names
the command or CI check that makes it true. A rule with no enforcement is a
wish, and wishes do not survive contact with a deadline.

---

## 1. The non-negotiables

### 1.1 A red baseline stops all work

> All tests must pass before you change anything. If they do not, **STOP and
> report.** Do not attempt repairs — a red baseline you did not create is
> information, and guessing at it destroys that information.

When you discover a failing test that you did not cause:

1. **Stop.** Do not write another line of code.
2. **Reproduce it in a pristine checkout** so you can prove it is not yours.
   `git worktree add --detach /tmp/baseline HEAD` then run the suite there.
3. **Diagnose it from evidence.** Reproduce the mechanism. Do not guess at a
   fix and let a green run hide the cause.
4. **Report it** with the evidence and the proposed fix.
5. **Only then** fix it — as its own commit, with the failure named in the
   message, reviewed like any other change.

A failure you did not create is _data_. Repairing it by trial and error
destroys that data.

**Enforced by:** `scripts/check-baseline.mjs` (fails on any test failure not
recorded in `quality-baseline.json`) and `npm test`.

### 1.2 No hacks, and no undeclared shortcuts

Nothing ships that we would be embarrassed to explain. Where a shortcut is
genuinely unavoidable, it is permitted only if it is **declared, bounded, and
tracked**:

- **Declared** — written down in `quality-baseline.json` under
  `declaredGaps`, with the reason and a removal condition.
- **Bounded** — given a hard numeric ceiling that cannot be raised.
- **Tracked** — counted by CI on every push, so it can only ever shrink.

An undeclared `@ts-nocheck`, `eslint-disable`, `.skip`, or `TODO` is a build
failure. Not a style opinion — a failure.

**Enforced by:** `scripts/check-suppressions.mjs`.

### 1.3 No claim of correctness without the command that proved it

"It should work" is not a status. Every claim in a commit message, a PR, or a
report must be backed by a command whose output you actually saw. If you cannot
name the command, you have not verified it — say so.

**Enforced by:** the commit and PR templates, which require the exact command
and its result. Reviewers reject unverifiable claims.

### 1.4 If you are unsure whether it is finished, it is not

Report it as **partial** and **name the gap**. Optimism in a status report is a
defect. "Done except X, which is untested" is a useful sentence; "done" is not.

### 1.5 Review before commit

Every change is reviewed before it is committed — by a second reader, or by a
deliberate, adversarial self-review that reads the diff as if someone else
wrote it. The review checks style compliance, production readiness, and that
tests exist and pass.

**Enforced by:** `.githooks/pre-commit`, the PR template checklist, and branch
protection on `main`.

---

## 2. The gate

One command defines "done":

```bash
npm run verify
```

It runs, in order, and stops at the first failure:

| Step             | Command                  | Proves                                                      |
| ---------------- | ------------------------ | ----------------------------------------------------------- |
| Lint             | `npm run lint`           | No undefined globals, no dead identifiers, style rules hold |
| Format           | `npm run format:check`   | Code matches the project's Prettier contract                |
| Unit tests       | `npm test`               | Behaviour is as specified                                   |
| Date-hermeticity | `npm run test:clock`     | No test depends on today's date                             |
| Baseline         | `npm run check:baseline` | No new failures, no unratcheted suppressions                |
| Hygiene          | `npm run check:hygiene`  | No debuggers, no `.only`, no conflict markers, no secrets   |
| Build            | `npm run build`          | The shipped artifact actually builds                        |

`npm run verify` is the only thing that may be described as "green". A partial
run is a partial run.

---

## 3. Testing

Testing is the highest-value work in this repository.

- **Unit tests are the default.** Any function with a branch gets a test for
  the branch. `node --test` only — no framework churn.
- **Test behaviour, not implementation.** Assert on outcomes a player or caller
  can observe.
- **Every bug fix lands with the test that would have caught it.** No
  exceptions. A fix without a regression test is not a fix.
- **Tests must be hermetic.** No wall clock, no network, no shared mutable
  state, no dependence on execution order. Time is injected, never read.
- **Boundaries get pinned.** If code prunes, limits, caps, or expires, test
  the value exactly on the boundary and one past it.
- **A flaky test is a broken test.** Quarantine it in the baseline with a
  declared gap — never re-run until it passes.

**Enforced by:** `npm test`, `npm run test:clock`, `scripts/check-baseline.mjs`.

---

## 4. Quality bar — "what would Apple do?"

We do not ship something that merely functions. The benchmark is a company that
sweats the details nobody asked for. Concretely, and measurably:

| Dimension         | The bar                                                                                                                         |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| **Correctness**   | Every branch tested; boundaries pinned; failures loud, never silent                                                             |
| **Smoothness**    | 60 fps budget held under load; no frame-time spikes; no GC churn in the hot loop                                                |
| **Optimisation**  | Object pooling for per-frame allocations; spatial partitioning for collisions; measured, not assumed                            |
| **Interface**     | Immediate response to input; no layout jank; every state reachable and escapable; keyboard and touch both first-class           |
| **Accessibility** | Automated axe scan clean; visible focus; reduced-motion respected                                                               |
| **Robustness**    | Survives denied storage, private browsing, quota exhaustion, clock skew, and a lost network without data loss or a white screen |
| **Restraint**     | Zero runtime dependencies. Every added dependency is a liability we chose to accept, and it is justified in the commit          |

Perceived quality comes from consistency, not from features. A rough edge in a
common path costs more than a missing feature in a rare one.

---

## 5. Declared gaps

A gap is work we know is undone. Gaps live in `quality-baseline.json`, never in
someone's memory:

```json
{
    "declaredGaps": [
        {
            "id": "eslint-scripts-uncovered",
            "what": "ESLint does not lint scripts/",
            "why": "Pre-existing: 83 no-undef errors in Playwright scripts that use browser globals inside page.evaluate callbacks",
            "bound": "Must be closed before v3.0.0",
            "trackedBy": "scripts/check-suppressions.mjs"
        }
    ]
}
```

Rules for gaps:

- A gap without an `id`, a `why`, and a removal condition is not a gap, it is
  a bug being hidden.
- Gaps are reviewed at every release. A gap that survives two releases without
  progress must be either closed or re-justified in writing.
- **Ceilings never rise.** If a change would increase a recorded suppression
  count, the change is wrong, not the ceiling.

---

## 6. Enforcement map

| Rule                        | Mechanism                        | Runs           |
| --------------------------- | -------------------------------- | -------------- |
| Tests pass, no new failures | `scripts/check-baseline.mjs`     | pre-push, CI   |
| Suppressions bounded        | `scripts/check-suppressions.mjs` | pre-commit, CI |
| Style + format              | eslint, prettier                 | pre-commit, CI |
| Hermetic tests              | `scripts/test-clock.mjs`         | pre-push, CI   |
| No debug leftovers          | `scripts/check-hygiene.mjs`      | pre-commit, CI |
| Reviewed before merge       | PR template + branch protection  | GitHub         |
| Everything at once          | `npm run verify`                 | pre-push, CI   |

### Git hooks

Hooks are installed by `npm run setup` (sets `core.hooksPath` to `.githooks`).

- `pre-commit` — fast: format + lint + suppression ceilings on staged files.
- `pre-push` — full `npm run verify`.

Hooks are convenience and fast feedback. **CI is the authority**, because hooks
can be bypassed with `--no-verify` and CI cannot. Branch protection on `main`
requires the CI check to pass before merge.

---

## 7. Commits

Conventional Commits. The body answers three questions:

1. **What was wrong, and how do you know?** (evidence, not vibes)
2. **What changed, and why this way?**
3. **What command proves it?**

A commit message that claims a fix without naming the verification command is
incomplete.

---

## 8. Changing this document

This document is versioned in git. Changing it requires a commit that states
what rule changed and why. Weakening a rule requires an explicit justification
in the message — silence is not consent, and a lowered bar must be visible in
the history where anyone can find it.

Amendments:

| Version | Date       | Change                                                                                                                                                                                              |
| ------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.0.0   | 2026-10-09 | Initial standard. Established after a red baseline was worked through instead of reported, and a 35-file `@ts-nocheck` blanket was applied without a ceiling. Both are now mechanically impossible. |
