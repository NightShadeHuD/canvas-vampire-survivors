# Porting to Godot: what the research says

**Written after researching the actual tooling, not from assumption. It changes
the plan for the better.**

## The headline: the TypeScript port was the right call, and more right than we knew

A mature tool exists — [`typescript-to-gdscript`](https://nnn3d.github.io/typescript-to-gdscript/) —
that **writes Godot 4 scripts in TypeScript and emits ordinary `.gd` files that
Godot runs.** It is not a rewrite target; it is a _compiler_. Its own summary:

> "Write Godot 4 scripts in TypeScript. You get autocomplete and type-checking for
> the whole Godot API, errors in your editor as you type, and clean `.gd` files
> that Godot runs as usual. TypeScript is only how you write it, not something
> Godot runs."

It ships all 900+ engine classes as generated typings, a `gd` namespace for
GDScript-only constructs, source maps from `.gd` errors back to TypeScript lines,
and a bulk GD → TS converter.

**The consequence for us is large:** the Godot port is not "throw away the
TypeScript and write GDScript". It is _transform the TypeScript we already have_,
which means every round spent typing this codebase is spent on the port.

## What that does to our priorities

Three things we were doing anyway turn out to be directly load-bearing, and one
we were treating as optional turns out not to be:

| Work                        | Why it matters more than we thought                                                                                                                                                    |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The TypeScript port itself  | It is the port's input language, not a staging post                                                                                                                                    |
| `strict`, and `check:types` | The converter wants explicit types. `any` has no GDScript equivalent, and "a `number` becomes a `float`" — so an untyped parameter is an ambiguity the converter cannot resolve for us |
| The renderer decoupling     | Still correct: `entity-render.ts` and `game-render.ts` are replaced against Godot's `CanvasItem` API, and they are now 100% covered, so they are a specification rather than a guess   |

## What will not port, measured

The converter reports unsupported syntax as an error, so none of it can slip
through unnoticed. Measured across `src/` — 24 modules:

| Hazard                             |   Count | What it needs                                                               |
| ---------------------------------- | ------: | --------------------------------------------------------------------------- |
| `?.` optional chaining             | **156** | A `null` check first; GDScript has no short-circuiting member access        |
| `??` nullish coalescing            |  **59** | A ternary: `x !== null ? x : fallback`                                      |
| top-level `const` / `let`          |  **44** | GDScript has no globals; constants move into a class namespace              |
| `undefined` as a VALUE             |   **5** | GDScript has only `null`; `!== undefined` becomes `!= null`                 |
| `typeof x === 'undefined'`         |  **30** | Platform detection — **deleted, not translated**                            |
| classes beyond the first in a file |  **14** | A `.gd` file is one class; the rest become inner classes or their own files |
| spread `...`                       |  **11** | Pass values one by one; join arrays with `gd.ops.add`                       |
| `x in y`                           |   **8** | `array.has(x)` — see below, this one is a silent difference                 |
| destructuring                      |   **4** | Assign each value on its own line                                           |
| numeric `switch`                   |   **0** | ✅                                                                          |
| default or namespace imports       |   **0** | ✅                                                                          |
| **total**                          | **327** |                                                                             |

### The `undefined` count was misleading, and the split matters

The original inventory counted 31 `undefined` sites and implied 31 null-migrations.
Measured properly, they are two different jobs:

- **30 are `typeof window === 'undefined'`** — a _string_ comparison, and the way
  this codebase asks "am I in a browser". `typeof` does not exist in GDScript and
  there is no `window` to ask about, so **these guards are deleted along with the
  browser module they protect.** Platform-boundary work, not null work.
- **5 are the `undefined` value**, every one a dictionary read such as
  `p.def.effect[key] !== undefined`. These **do** translate, mechanically: a
  GDScript dictionary read returns `null` for a missing key, so `!== undefined`
  becomes `!= null` and behaves identically.

`check:ports` counts them as two hazards with separate reasons, because lumping
them together made the port look like it had 31 null-migrations when 30 of them
disappear with the platform.

**These figures are now enforced rather than written down.** `npm run check:ports` measures
them, holds two ceilings that may only fall, and runs in the gate. **The gate measures `src/`
only**, because `test/` drives the TypeScript implementation and will never be ported — a
GDScript project would use GUT and different tests. The counts here and the gate agree.

**`??` and `?.` are 215 of the 327.** They dominate the cost and they are
entirely mechanical, which means the port's shape is known rather than hoped for.

## The difference that is silent, and the bug hunt it prompted

Two entries above are not "will not compile" — they are **"compiles and behaves
differently"**, which is the dangerous kind. Both were checked for live bugs in
our current code rather than only noted as port risk:

**`x in y` — 8 sites.** In TypeScript, `in` on an array checks the **index**; in
GDScript it checks the **element**. A direct translation of `if (i in arr)`
silently changes meaning. **All 8 sites were inspected and none is an array
membership test** — they are `for` loops, which convert correctly. No live bug.

**The one apparent numeric `switch`** — `keymap.ts:213` — is `switch (k)` where
`k = normaliseKey(rawKey)` returns a **string** such as `'arrowup'`. GDScript
matches a `StringName` against a string case safely, so it is not the hazard. Had
it switched on a `number`, `case 1:` would never match a float `1.0` and **no
error would tell us**. No live bug.

Reporting these as "no bug found, and here is the check that says so" rather than
listing them as risks is the point: a hazard inventory that cries wolf gets
skipped.

## What this means for the register

- **`noImplicitAny` and `strictNullChecks` are port work**, not code hygiene.
  The converter needs the types, and `undefined` vs `null` is a real semantic
  difference rather than a pedantic one.
- **Row 4 (`save: Record<string, any>`)** is the same problem in the save format:
  a `Dictionary` with no declared shape is exactly what a translator must guess at.
- **The renderer rows are closed and that was the right call**, because those two
  modules are the ones Godot replaces wholesale.

## What we should NOT do

**Do not hand-rewrite the simulation in GDScript.** That was the original framing
— "move it to Godot with GDScript" — and the research says the expensive version
is the wrong one. The 19 modules that contain **zero** canvas references are a
clean DAG with no runtime import cycles; they are input to a converter, not work
to be redone by hand.

## Sources

- [typescript-to-gdscript — documentation and playground](https://nnn3d.github.io/typescript-to-gdscript/)
- [Caveats: unsupported syntax and behavioural differences](https://nnn3d.github.io/typescript-to-gdscript/guide/caveats/)
- [Godot proposal #1866 — separate integer and real division operators](https://github.com/godotengine/godot-proposals/issues/1866) — the int/float division difference is a known, deliberate Godot design
