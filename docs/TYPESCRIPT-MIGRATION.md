# TypeScript migration

**Status: design validated by experiment, implementation not started.**
The plan below is the result of testing the mechanism first. No source file has
been converted yet.

The goal carries a constraint that decides the whole approach:

> keeping the game fully playable in the browser at every step

That rules out the obvious method. See "Why not a single rename" below.

---

## Why not a single rename

The tempting approach is to rename all 22 modules and 27 test files to `.ts` at
once, declare the class fields TypeScript requires, and be done. It was tried,
and it was measured.

The rename itself is nearly free — with every file converted, all 512 tests
still pass under Node's native type stripping. The problem is what happens in
between: the browser.

`index.html` loads `./src/main.js`. After a rename that file does not exist —
it is `main.ts`, which no browser will execute. Until a build step lands, the
game does not boot at all. Everything after the rename (build pipeline, a
typecheck reduced to zero errors, lint config for TypeScript, coverage floors
re-pointed) would have to land before the game worked again.

Measured cost of that rename, for the record, starting from a clean tree:

| Stage                                              | `tsc` errors |
| -------------------------------------------------- | ------------ |
| Rename only, no suppression                        | 2340         |
| + `types: ["node"]`                                | 2285         |
| + declare 282 class fields the compiler asked for  | 304          |
| + mark genuinely-optional parameters optional      | 250          |
| + type the options bags (`opts = {}` is type `{}`) | 194          |

So the work is real but tractable, and the remaining 194 are type-design
decisions (the save shape, the generic `Pool`, `ReplayRecorder` internals) rather
than mechanical edits. The reason to reject it is not cost — it is that it breaks
the game for the whole duration.

## The validated approach: one file at a time

Three things were verified before committing to this design. All three had to
hold; any one of them failing would have invalidated it.

**1. A `.js` file can import a `.ts` file under Node.**

```
$ node consumer.js          # consumer.js contains: import { make } from './dep.ts'
JS importing TS works: 7
```

Node's type stripping applies to the `.ts` file being imported. The importer
does not have to be TypeScript yet. This is what makes incremental conversion
possible at all.

**2. `tsc` emits both `.js` and `.ts` sources to the output directory.**

With `allowJs: true`, a mixed tree compiles: `dist/` receives `consumer.js`,
`consumer2.js` and `dep.js`. The unconverted files are passed through; the
converted ones are compiled.

**3. The build rewrites `.ts` specifiers inside `.js` sources.**

This is the piece that makes it hold together. `consumer.js` imports `'./dep.ts'`,
which a browser cannot load. After the build:

```js
// dist/consumer.js
import { make } from './dep.js';
```

`rewriteRelativeImportExtensions` is not limited to files TypeScript authored —
it rewrites the specifiers in emitted `.js` sources too. So the browser always
receives a consistent, loadable `.js` module graph.

### What this buys

| Consumer                             | Reads                              | Needs a build? |
| ------------------------------------ | ---------------------------------- | -------------- |
| Tests (`node --test test/*.test.ts`) | `src/` directly, mixed `.js`/`.ts` | **No**         |
| Browser (`index.html`)               | `dist/`, fully compiled            | Yes            |

Tests keep running natively with no build, which keeps the inner loop fast and
keeps the coverage floors meaningful. The browser gets a consistent compiled
graph. Neither ever sees a broken state.

## The per-change recipe

Each conversion is its own reviewable change, and the game is playable at the
end of every one:

1. `git mv src/thing.js src/thing.ts`.
2. Update importers: `'./thing.js'` → `'./thing.ts'`. This is the only edit
   forced on other files, and it is a mechanical rename of one specifier.
3. Resolve that file's `tsc` errors. For a class, this means declaring the
   fields TypeScript requires — it never infers a field from `this.x = …` in a
   constructor, and that single pattern accounted for 1895 of the 2047 original
   errors.
4. `npm run verify:all`. Tests run natively on the mixed tree; boot-smoke and
   the accessibility scan run against the built `dist/`.

Start with leaf modules that nothing else imports (`src/config.js` is the
obvious first candidate: 77 LOC, pure data, no internal imports) and work
outward toward `main.js`, which imports 21 of the other 21 modules.

## Prerequisites for the first conversion

These are needed once, and they are why the first conversion is larger than the
later ones:

- **`typescript` as a devDependency.** It is currently installed locally but
  deliberately absent from `package.json`, so nothing depends on it yet.
- **A build emitting `dist/`**, with `rewriteRelativeImportExtensions`,
  `allowJs` and `verbatimModuleSyntax`, and `index.html` pointed at
  `./dist/main.js`. `service-worker.js`, the Pages workflow and `server.js` all
  reference `./src/` and must follow.
- **ESLint coverage for `.ts`.** `scripts/check-coverage.mjs` fails when a
  tracked source file matches no lint config block, and it is right to — that is
  the guard that caught `scripts/`, `service-worker.js` and `game.js` being
  silently unlinted. Converting a file to `.ts` therefore requires lint rules
  for it, which means `typescript-eslint`.
- **Coverage-floor paths.** `scripts/check-coverage-floor.mjs` currently floors
  `src/*.js`. Converted files move to `src/*.ts` and would silently drop out of
  the floor set — the exact "green light wired to nothing" failure the floors
  exist to prevent. The glob must widen to `.ts` in the same change.

## Phase B: strictness

Phase A deliberately runs with `strict: false` and `noImplicitAny: false` so
that the mechanical work stays behaviour-preserving and reviewable. Those are
recorded as a declared gap with a ceiling, not left implicit.

Phase B tightens one file at a time, floor-style: `strict` is enabled per file
as it is cleaned up, and the count of files still on the lenient setting may
only fall. The largest real prizes are the loosely-typed `opts` bags
(`Record<string, any>` after Phase A) and the save shape, which is assembled
dynamically by `mergeDeep` and therefore currently has no type at all — the
subagent review that scoped this work called it "the central type of the whole
app".

## Not decided yet

- Whether `dist/` is committed or built in CI. Building in CI is cleaner;
  committing it keeps Pages deployable without a build job.
- Whether to split `main.js` (1,887 LOC, a state god-object with 59 fields
  assigned across ~50 methods) during the port or after it. Splitting during the
  port would make the types easier to write and the diffs harder to review.
