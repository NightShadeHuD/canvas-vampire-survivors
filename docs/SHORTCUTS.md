# Declared shortcuts

The mandate says a shortcut is legitimate only when it is **declared, bounded and
tracked**. This is where that happens, and `npm run check:register` is what stops
the table rotting: it refuses a row missing a column, a citation to a row that
does not exist, and a gap in the numbering.

Every row is a thing this project knowingly does not do properly yet. **A ceiling
with no trigger is a promise nobody will keep**, so both are required.

Before this file existed, `declaredGaps` was an empty array with no field for a
ceiling or a trigger, the eight `suppressionCeilings` were bare numbers, and every
shortcut below lived in prose that nothing read.

## Register

| #   | Area          | Location                                                     | Ceiling accepted                                                                                                                                                                                                                                                                                                                                   | Revisit trigger                                                                                                                                                                                                     | Status |
| --- | ------------- | ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 1   | Type safety   | `tsconfig.json` (`strict`)                                   | **`strict` is off for the whole project.** Measured at **951 errors** with it on, two thirds of them parameters that were never annotated while these files were JavaScript. The build is type-checked under the lenient settings only; `strictNullChecks` in particular is not running, so a possibly-`null` dereference is not caught.           | The error count reaching zero. It only moves down, so the trigger is "the next `tsc --strict` run reports 0", at which point the flag flips in its own commit.                                                      | OPEN   |
| 2   | Test coverage | `src/entity-render.ts` (whole file)                          | **Canvas drawing, largely untested: 18.98% lines, 42.86% branches, 22.22% functions.** The simulation it draws is well covered; the drawing itself is verified only by the browser boot smoke, which asserts the frame loop advances and no page error is thrown — not that anything looks right.                                                  | The first rendering defect that a unit test would have caught, or the first change to a renderer made without a way to see the result. Then the renderers get a stub-context test that asserts the draw calls made. | OPEN   |
| 3   | Test coverage | `src/game-render.ts` (whole file)                            | **Canvas drawing, largely untested: 25.16% lines, 0% functions.** Every exported function is exercised only through the browser gate. A regression in `drawGrid` or `renderEnemies` that still throws no error would reach a player.                                                                                                               | The first rendering defect that a unit test would have caught. Same remedy as row 2.                                                                                                                                | OPEN   |
| 4   | Type safety   | `src/main.ts` (`declare save`)                               | **`save` is `Record<string, any>`.** The save object is assembled at runtime by `mergeDeep`, which erases `DEFAULT_SAVE`'s shape, so no real interface can be produced from it without restructuring storage. A typo in a save field reaches runtime.                                                                                              | The first defect traced to a save field that a type would have caught, or the first schema migration. Then `DEFAULT_SAVE` gains an interface and `mergeDeep` becomes generic over it.                               | OPEN   |
| 5   | Measurement   | `scripts/check-coverage-floor.mjs` (`--test-isolation=none`) | **Coverage is measured with every test in one process.** Chosen because Node's per-file merge was not reproducible and moved the overall branch figure by ~0.1 points at random. The cost is real: module-level state persists across test files, so a test that depends on a fresh module would behave differently here than under `npm test`.    | A test that passes under `npm test` and fails under `check:coverage-floor`, or the reverse. That would mean the two isolation models disagree about behaviour, not just about a number.                             | OPEN   |
| 6   | Toolchain     | `package.json` (`typescript`)                                | **TypeScript is pinned to `^5.8`, not 7.x.** `typescript-eslint` requires `typescript <6.1`, and 7 is the new Go-based compiler, so the newest compiler is unavailable while linting needs the parser. `rewriteRelativeImportExtensions` was re-verified against 5.9, so the build is sound — it is the version that is behind, not the behaviour. | `typescript-eslint` declaring support for TypeScript 7. Then the pin moves and the build is re-verified.                                                                                                            | OPEN   |
| 7   | Deployment    | `.github/workflows/deploy-pages.yml` (whole file)            | **GitHub Pages is not enabled, so the deploy workflow is disabled.** There is no live URL, the README tells readers to run locally, and the deploy path is therefore unverified end to end.                                                                                                                                                        | Enabling Pages on the repository. Then the workflow is re-enabled and one real deploy is watched to completion.                                                                                                     | OPEN   |
| 8   | Review        | `scripts/check-assertions.mjs` (base resolution)             | **Assertion weakening is compared against one base revision, and only for test files modified since it.** A weakening committed directly to the base, or spread across several commits, is not seen. With no base reachable the gate skips with a notice rather than failing.                                                                      | A weakening that reached `main` through a path this did not cover. Then the comparison moves to a recorded per-file assertion digest, which does not need a base.                                                   | OPEN   |

### How a row is written

- **Location** names the file and the symbol, in backticks. _"the parser"_ is not
  a location; a reader cannot act on it.
- **Ceiling accepted** says what this does _not_ handle and roughly where the
  limit is. State the limit numerically if it has one — _"small"_ is not a bound.
- **Revisit trigger** is a concrete event: a feature that needs it, a measurement
  that exceeds it, a scale that reaches it. _"When we have time"_ is not a trigger.
- **Status** is `OPEN`, or `RESOLVED at <revision>` naming what changed, or the row
  is **struck through** and kept: `| ~~1~~ | ... |`. **A discharged row stays in
  the table saying so** — a number that vanishes is indistinguishable from a row
  someone deleted to tidy up, and the numbering check refuses a gap.

## Review

Reviewed at every release, so a ceiling is re-read rather than forgotten. The
point is to make _"has anything changed since this was accepted?"_ a step someone
actually takes.

| Gate   | Reviewed   | Open shortcuts | Any trigger met? |
| ------ | ---------- | -------------- | ---------------- |
| v2.8.0 | 2026-10-09 | 8              | No               |
