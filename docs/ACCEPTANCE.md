# Writing acceptance criteria

**An acceptance criterion is a claim about the product that a command can
settle.** That is the whole idea. If you cannot name the check when you write the
criterion, you are writing a wish, and a wish in a requirements document is worse
than an absence — it reads as coverage.

Adopted from the agent-scaffold method, with this project's own gates as the
criteria. `npm run check:docs` checks the table below: unique un-renumbered ids,
a named check in every row, and evidence that is a produced value rather than a
restatement of the build.

## The shape

Every criterion has three parts, and the third is the one people skip:

| Part             | What it says                                                                              |
| ---------------- | ----------------------------------------------------------------------------------------- |
| **The claim**    | One sentence, present tense, about behaviour a user or caller can observe                 |
| **The check**    | The command, test or measurement that settles it                                          |
| **The evidence** | What the check produces when the claim holds — a count, a hash, a listing, an observation |

**A criterion whose evidence column is "tests pass" is not a criterion.** It
restates the build.

## Rules that make the set usable

**One criterion, one claim.** If it contains "and", it is usually two criteria,
and they will be cleared at different times. Split them.

**Number them and never renumber.** `AC-4` keeps its meaning forever. A criterion
that is superseded is struck through with a note, not deleted — the same rule as
the shortcut register, and for the same reason: a number that vanishes takes
every citation to it with it. `check:docs` refuses a gap in the numbering.

**Cite the criterion from the change that clears it.** A plan without criteria is
a to-do list; a plan that names what it must prove is a plan.

**State the failure, not just the success.** _"Validation refuses a duplicate id"_
is testable. _"Validation is robust"_ is not.

## Acceptance criteria

Status is `MET`, `OPEN`, or `RESOLVED at <revision>`; a superseded row is struck
through and kept.

| Id    | The claim                                                                                           | The check                                                        | The evidence                                                                                                 | Tier        | Status |
| ----- | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ----------- | ------ |
| AC-1  | The game boots in a browser and reaches a playable run without an uncaught error.                   | `npm run smoke:boot`                                             | 10 steps reported, the frame loop advances from ~0.00s to ~1.52s, and 0 uncaught page errors                 | Functional  | MET    |
| AC-2  | No source module is JavaScript.                                                                     | `git ls-files 'src/*.js' \| wc -l`                               | `0`, against 24 files under `src/*.ts`                                                                       | Functional  | MET    |
| AC-3  | No test is skipped, left as todo, or deleted.                                                       | `npm run check:suite`                                            | `585 test(s), 585 executed, 0 failed, 0 skipped, 0 todo`, floor 585                                          | Production  | MET    |
| AC-4  | No assertion was weakened since the base revision.                                                  | `npm run check:assertions`                                       | A count of modified test files compared, and `no weakening` — or a failure naming the file and the transform | Production  | MET    |
| AC-5  | Every surface scanned is free of blocking accessibility violations.                                 | `npm run a11y`                                                   | 12 surfaces reported, `blocking=0`, `nodes=0`, `skipped=0`                                                   | Interaction | MET    |
| AC-6  | Measured coverage never falls below the recorded floors.                                            | `npm run check:coverage-floor`                                   | The measured figures beside the floors, and `all floors hold exactly`                                        | Production  | MET    |
| AC-7  | Every declared shortcut states a ceiling and a revisit trigger, and every citation of one resolves. | `npm run check:register`                                         | `8 row(s), all well formed, numbering contiguous`, and citations across the citing documents resolve         | Production  | MET    |
| AC-8  | Rule documents have well-formed tables and no citation of a document that does not exist.           | `npm run check:docs`                                             | A count of documents and document references checked, and no findings                                        | Production  | MET    |
| AC-9  | Game simulation does not depend on the canvas.                                                      | `grep -cE '\bctx\b\|canvas\|getContext' src/entities.ts`         | `1`, and that one is the module docblock — not code                                                          | Production  | MET    |
| AC-10 | A suppressed construct cannot be added without raising a declared ceiling in the same commit.       | `npm run check:suppressions`                                     | Each of the 8 ceilings reported against its measured count, `all 8 ceilings match exactly`                   | Functional  | MET    |
| AC-11 | The browser artifact the build produces passes the full suite.                                      | `npm run build && node --test test/*.test.ts` against `dist/`    | `585/585` on the built output, not only on the sources                                                       | Production  | OPEN   |
| AC-12 | A player can complete a run on a real device without a console error.                               | manual pass on a physical phone, recorded in `docs/MANUAL_QA.md` | A dated entry naming the device, the OS version and any error observed                                       | Interaction | OPEN   |

| AC-13 | `strict` is fully enabled: no configuration sets `strictNullChecks` or `noImplicitAny` to `false`. | `npm run check:strict` | `0` errors from `tsc --strict`, and no explicit `false` for either flag in `tsconfig.json` | Production | OPEN |

### Why AC-11 and AC-12 are OPEN rather than quietly dropped

**AC-11** was verified once, by hand, when the build pipeline landed: the suite
was pointed at `dist/` and all 512 tests passed. It is not wired as a gate, so it
is not re-checked on every change — it is a claim that was true at a revision,
not one that is true now. Its check is written down so the gap has a shape.

**AC-12** has no automated check and will not get one. It is recorded as a gap
rather than given a criterion that pretends. A criterion set that includes
untestable items teaches its readers to skim the set.

## What to leave out

**Do not write a criterion for something you cannot check yet, and do not pretend
you can.** Record it as a known gap instead, with the shape the check will take.

**Do not write criteria for things that are not claims about the product** — _"the
code is well organised"_ is a review matter, not an acceptance criterion.

## The tier structure

They do not all need clearing at the same time, so they are grouped by how strong
the claim is:

- **Functional** — the product does what it says, verified by tests.
- **Production** — it is safe to ship: errors are loud, contracts are stable, and
  the suite can fail.
- **Interaction** — a person can use it, verified by observation and measurement
  rather than by assertion.

**Be explicit about which tier a change clears.** A change that clears every
functional criterion and no production one has not produced a shippable product,
and the tiering is what stops that being mistaken for completeness.
