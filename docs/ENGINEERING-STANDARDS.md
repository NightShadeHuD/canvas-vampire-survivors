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

| Step               | Command                        | Proves                                                      |
| ------------------ | ------------------------------ | ----------------------------------------------------------- |
| Lint               | `npm run lint`                 | No undefined globals, no dead identifiers, style rules hold |
| Coverage           | `npm run check:coverage`       | Lint, format and test discovery actually reach every file   |
| Typecheck          | `npm run typecheck`            | The TypeScript config is valid and the tree parses          |
| Strict flags       | `npm run check:strict`         | Enabled strict flags have not been turned back off          |
| Format             | `npm run format:check`         | Code matches the project's Prettier contract                |
| Unit tests         | `npm test`                     | Behaviour is as specified                                   |
| Suite mandates     | `npm run check:suite`          | No test was skipped, left as todo, or deleted               |
| Assertion strength | `npm run check:assertions`     | No assertion was weakened since the base revision           |
| Shortcut register  | `npm run check:register`       | Every shortcut is bounded, tracked and correctly cited      |
| Rule documents     | `npm run check:docs`           | Tables, citations and acceptance criteria all hold          |
| Date-hermeticity   | `npm run test:clock`           | No test depends on today's date                             |
| Baseline           | `npm run check:baseline`       | No new failures, no stale baseline entries                  |
| Coverage floors    | `npm run check:coverage-floor` | Measured coverage has not fallen below its recorded floors  |
| Suppressions       | `npm run check:suppressions`   | Every suppression is within its declared ceiling            |
| Type coverage      | `npm run check:types`          | The use of `any` has not grown                              |
| Hygiene            | `npm run check:hygiene`        | No debuggers, no `.only`, no conflict markers, no secrets   |
| Destructive edits  | `npm run check:destructive`    | Committed tooling does not bulk-edit source                 |
| Build              | `npm run build`                | The shipped browser artifact compiles                       |

`scripts/check-coverage.mjs` verifies this table in both directions: every step
in `scripts/verify.mjs` must appear here, and every command listed here must
exist in `package.json`. That second direction is not theoretical — this table
once listed a build step that did not exist, and the guard refused it until the
step was real. It is now.

### Where the browser loads from

`index.html` imports `./dist/main.js`. `src/` is the source of truth and what
the tests and coverage measure; `dist/` is what ships. `npm run build` compiles
one to the other, and `verify:browser` builds before it drives a browser, so the
browser gates always exercise the artifact a player actually receives.

`dist/` is generated, so it is gitignored and excluded from lint — the coverage
guard reasons about tracked source files only.

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

| Rule                        | Mechanism                          | Runs           |
| --------------------------- | ---------------------------------- | -------------- |
| Tests pass, no new failures | `scripts/check-baseline.mjs`       | pre-push, CI   |
| Suppressions bounded        | `scripts/check-suppressions.mjs`   | pre-commit, CI |
| Type coverage               | `scripts/check-types.mjs`          | pre-commit, CI |
| Style + format              | eslint, prettier                   | pre-commit, CI |
| Destructive edits           | `scripts/check-destructive.mjs`    | pre-push, CI   |
| Suite mandates              | `scripts/check-suite.mjs`          | pre-push, CI   |
| Assertion strength          | `scripts/check-assertions.mjs`     | pre-push, CI   |
| Shortcut register           | `scripts/check-register.mjs`       | pre-push, CI   |
| Rule documents              | `scripts/check-docs.mjs`           | pre-push, CI   |
| TypeScript compiles         | `tsc` via `npm run build`          | pre-push, CI   |
| Strict flags                | `scripts/check-strict.mjs`         | pre-push, CI   |
| Coverage is real            | `scripts/check-coverage.mjs`       | pre-push, CI   |
| Coverage only rises         | `scripts/check-coverage-floor.mjs` | pre-push, CI   |
| Hermetic tests              | `scripts/check-clocks.mjs`         | pre-push, CI   |
| No debug leftovers          | `scripts/check-hygiene.mjs`        | pre-commit, CI |
| Reviewed before merge       | PR template + branch protection    | GitHub         |
| Everything at once          | `npm run verify`                   | pre-push, CI   |

### Why "lint coverage is real" is its own rule

ESLint fails **completely silently** for a file that no config block matches. It
prints nothing, warns about nothing, and exits 0. Measured on this repository:

```
$ eslint --max-warnings 0 tools/probe.js      # in-repo, no matching block
$ echo $?
0
```

`--max-warnings 0` cannot help: it promotes _reported_ warnings to failures, and
an uncovered file produces no report to promote.

The consequence here was that `scripts/`, `service-worker.js` and `game.js` —
including the file that owns the production offline cache — were never linted
once in the project's life, while `npm run lint` reported success the whole
time. A green light wired to nothing is worse than a red one, because nobody
investigates it.

So coverage is asserted directly: every tracked source file must match at least
one `files:` block, checked with `path.matchesGlob` (minimatch semantics).

### Type coverage, the port-readiness metric

Every other gate here measures the JavaScript game: coverage of lines, branches
and functions, a test count, a gate count. None of them measures the thing that
decides whether a GDScript port is a translation or a guess.

**`any` has no GDScript equivalent.** `float`, `String`, `Array[Enemy]` and a
class type all translate. `any` leaves the translator to infer intent from the
body, and an inference is what a port cannot afford to get wrong.

`check:types` measures it and holds a ceiling that may only fall:

```
check-types: 118 use(s) of `any` across 28 of 62 file(s) (ceiling 118)
  — 57 cast, 30 record, 19 annotation, 8 array, 4 generic
```

**The forms are counted where they are types, not as a word.** A grep would also
count `company`, and the word inside a docblock explaining why something is loose
— and a metric people do not believe is a metric they ignore. Comment-only lines
are skipped, because an explanation of a deliberate `any` is evidence of care
rather than a defect.

The largest group is `as any` (57). Those are the quietest: the type around them
is real, and the cast removes the check at one point.

**A ceiling is on the total, not per file.** A per-file ceiling fails the moment
a file is renamed or split — `check:coverage-floor` already demonstrated that cost
— while the total is what the port cares about, and an improvement in one file
correctly offsets a regression in another.

### Scripted edits to source

Two failures in one session, both self-inflicted, both from editing source text
in bulk rather than at an anchor.

**1. An annotator that assumed the shape of what it matched.** It inserted a type
at a parameter's identifier and produced

```ts
update(dt: number, height: number?) {   // invalid
```

because `height` was already optional. It assumed an identifier is never
followed by `?`.

**2. A global substitution, run to clean up after the first mistake.** A
backtick-stripping `sed` across `src/effects.ts` removed **every backtick in the
file**, including the template literals it builds its colours from.

Both were caught by `typecheck` within seconds — the gate did its job and the
agent did not do theirs.

**The rule.** A scripted edit to source must anchor on text that matches exactly
once, refuse otherwise, verify the result after writing, and be followed by the
full gate before anything else. Work one file at a time.

**The safe path.** `AGENTS.md` rule 6 is a prohibition, and a prohibition with no
alternative is a rule that gets worked around. So the alternative exists:

- `scripts/edit.mjs` — a CLI that anchors, counts, replaces and reads back.
- `scripts/lib/source-edit.mjs` — the same as a library, split into `planEdit`
  (pure, testable without a filesystem) and `applyEdit` (which verifies its own
  write).

It refuses an anchor matching zero times or the wrong number of times, and after
writing it reads the file back and compares against the plan. It deliberately
does **not** parse the language or judge the change — that belongs to `typecheck`
and the suite.

_Building it found a bug in itself:_ an early version also asserted the anchor
was gone from the result, which refuses a good edit whose **replacement contains
the anchor** — appending to the line it matched. A tool that refuses correct work
is a tool people stop using, which is the failure this whole mechanism exists to
prevent. The check was removed and the case pinned by a test.

**What is enforced, and what is not.** `check:destructive` refuses these patterns
in committed scripts and hooks. It **cannot** see a shell command that was never
committed — which is precisely where failure 2 happened. That half is
`AGENTS.md` rule 6, and it is stated here rather than implied by a gate that
would otherwise look like it covered the case.

### A gate that checks nothing is not a pass

Two states look identical from the outside and must never be conflated:

- **Nothing to check** — the scan set is empty because a glob is wrong or the
  tree moved. That is a **failure**. Measured: with its glob pointed at nothing,
  `check:hygiene` printed `clean — 0 tracked files checked` and `check:docs`
  printed `0 document(s) ... resolve`, **both exit 0**. Neither had looked at
  anything, and both reported success in exactly the shape a real pass takes.
  Every scanning gate now refuses an empty set.
- **Nothing to check yet** — a project with no shortcut register has genuinely
  declared no shortcuts. That is a **notice**, printed with a `NOTICE:` prefix
  and counted by `verify`, so a run ends with either
  `all 15 gates passed, and every one checked something` or a list of the gates
  that checked nothing and the rule each does not yet apply to.

Adopted from the agent-scaffold method, whose closing line is the model:
_"ALL 12 GATES PASSED (3 skipped as unconfigured — each is a rule this project
does not yet check)."_

### Suite mandates

`check:suite` reads the suite's own machine-readable report — Node's
`--test-reporter=junit` output — rather than the console summary, and refuses
three things:

1. **Any outcome that is not Passed.**
2. **A skipped or todo test.** This is the quietest way to a green suite, and it
   was measured here rather than assumed. Adding one skipped test produced:

    ```
    tests 513   pass 512   fail 0   skipped 1
    ```

    and `lint`, `check:hygiene` and `check:baseline` all exited 0. Nothing in this
    repository could see it.

3. **A total below `testCountFloor`**, so _deleting_ a test fails the build while
   _adding_ one only requires raising the floor in the same commit.

The floor is deliberately a floor and not an equality. Asserting an exact count
would make every unrelated test addition a failure, which trains people to edit
the number without reading it. A floor can only be satisfied by tests that exist.

**Why the report and not the console.** The console summary counts passes; it
does not say _which_ test stopped running, and a count that grows by one while a
skip appears is exactly the shape that reads as success.

Adopted from the agent-scaffold method, whose own note on the parser proved
correct here: _"the parser is the per-language branch"_. The first version of
`scripts/lib/suite-report.mjs` assumed no `>` could appear inside an attribute
value — which is false, and one of this repository's test names contains one
(`… prunes old days (>14d)`). It truncated that case, lost its name, and reported
a second skipped test that did not exist. The fix and its regression test are in
`test/suite-report.test.ts`.

### Coverage floors

The same reasoning applies to _how much_ of the code the tests actually run. The
floors in `quality-baseline.json` under `coverageFloors` are not targets — every
one is a number this repository measured, and they may only rise.

They exist because a gate can be satisfied while being hollowed out: add tests
in one module, delete them in another, and an overall average holds while a
whole file rots. So floors are recorded **per file as well as overall**, and a
module no test ever loads counts as 0%, never as absent.

Two calibrations keep the numbers honest rather than decorative:

- Compared with a 0.05-point tolerance, because CI runs a different OS and a
  tolerance absorbs platform wobble without opening a door. A real regression
  moves whole percentage points.
- Ratcheting is requested only on a gain of **1.0 point or more**. Prompting on
  every hundredth would turn the message into wallpaper, and a warning nobody
  reads is worse than no warning.

#### The measurement runs in a single process

`check-coverage-floor` measures with `--test-isolation=none`, and that flag is
load-bearing rather than a speed tweak.

This section previously claimed measurement was "bit-for-bit deterministic —
three consecutive runs produced an identical report". That claim was written when
the tree was smaller, and it was wrong. Repeating the experiment properly, with
the suite grown to 512 tests, `src/i18n.js` branches came back at both 90.00% and
100.00% on an unchanged tree, moving the overall branch figure by ~0.1 points and
failing this gate roughly one run in four **with nothing changed**. Each test file
measured alone was perfectly stable, so the nondeterminism was in Node's
end-of-run merge of per-process coverage. A gate that fails at random teaches
people to re-run it, and that is how a real regression gets waved through.

One process also models the product more honestly. The browser loads each module
exactly once; per-file isolation instantiates it once per test file and sums the
branch counts. The clearest case is `src/daily.js`, which four test files import:
per-file isolation reported 71.67% branches, one process reports 66.67%. With a
single importing test file the two methods agree exactly, which is what proves
the gap is duplicated instantiation rather than a test taking a different path.

Changing the method re-baselines every branch figure, so it was done explicitly
and the diff read: **line and function floors were unchanged everywhere**, seven
branch floors rose, and one — `src/daily.js` — fell by 5 points, for the reason
above. That is a declared change of measurement, not coverage quietly going
missing, and it is the only circumstance in which a floor may fall.

### Git hooks

Hooks are installed by `npm run setup` (sets `core.hooksPath` to `.githooks`).

- `pre-commit` — fast: format + lint + suppression ceilings on staged files.
- `pre-push` — full `npm run verify`.

Hooks are convenience and fast feedback. **CI is the authority**, because hooks
can be bypassed with `--no-verify` and CI cannot.

### Branch protection

`main` is locked by GitHub itself, which is the layer that cannot be talked
around. Enforced: the required `Verify` check (strict), pull requests
mandatory, force pushes denied, deletions denied, and `enforce_admins` on so
that not even the repository owner bypasses it.

Verified by probe rather than assumed — a force push and a direct commit push
were both rejected:

```
remote: - Changes must be made through a pull request.
remote: - Required status check "Verify" is expected.
 ! [remote rejected] HEAD -> main (protected branch hook declined)
```

So every change lands through a pull request:

```bash
git switch -c my-change
git commit -m "..."                     # pre-commit gate
git push -u origin my-change            # pre-push gate
gh pr create --fill                     # CI runs the full gate
gh pr merge --squash --delete-branch    # only once Verify is green
```

The approval count is 0 so a solo maintainer can merge their own PR. An
approval count of 1 would lock the owner out of their own repository, since
GitHub forbids self-approval — a protection that stops all work is a bug, not a
safeguard.

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
