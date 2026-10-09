# Decoupling game logic from DOM and canvas

**Status: surveyed and measured. No code moved yet.**

The goal asks for the port to be structured so a future Godot/GDScript port stays
viable. That means the simulation must not require a browser to exist. This
document records what is actually coupled, measured, so the work is planned
against evidence rather than a feeling about which files look messy.

## What is already clean

Five modules reference no DOM or canvas API at all:

```
tutorial.ts      konami.ts      pool.ts      spatial-hash.ts      systems.ts
```

These are pure logic and translate to GDScript directly. They are also the
modules the test suite covers best, which is not a coincidence.

## Where the coupling actually is

Counted by references to `ctx`, `document`, `window`, `navigator`, `canvas`,
`getContext`, `requestAnimationFrame` or `localStorage`:

| Module        | refs     | LOC  | Verdict                                                    |
| ------------- | -------- | ---- | ---------------------------------------------------------- |
| `entities.ts` | **167**  | 1142 | **the problem** — simulation and drawing in one class each |
| `main.ts`     | 81       | 1960 | owns canvas, loop and state together                       |
| `effects.ts`  | 46       | 301  | rendering; legitimately                                    |
| `audio.ts`    | 27       | 260  | Web Audio; a platform layer                                |
| `ui.ts`       | 20       | 1194 | DOM UI; legitimately                                       |
| `input.ts`    | 14       | 423  | DOM input; a platform layer                                |
| `storage.ts`  | 13       | 323  | localStorage; a platform layer                             |
| `replay.ts`   | 13       | 333  | mixed                                                      |
| others        | ≤ 9 each |      | mostly platform or trivial                                 |

Most of these are fine. `ui.ts`, `input.ts`, `storage.ts` and `audio.ts` **are**
the browser boundary; a port replaces them wholesale and expects to. `effects.ts`
is drawing.

`entities.ts` is different, and it is the one that matters. Nine classes each
carry both `update(dt, game)` and `render(ctx)`:

```
Player  Enemy  EnemyProjectile  Projectile  OrbitShard  Mine  ExpOrb  Particle  FloatingText
```

**Roughly 243 of the file's 1142 lines are inside `render()` methods.** That
means the entity — its position, health, timers, collision behaviour — cannot be
constructed or stepped without a drawing context being in scope, and a port has
to unpick simulation from drawing inside the same class rather than at a seam.

## The plan

Extract the nine `render()` methods into `src/entity-render.ts` as plain
functions:

```ts
export function renderEnemy(ctx: CanvasRenderingContext2D, self: Enemy) { … }
```

Entities then own simulation only, and the drawing is a module a port discards
and reimplements against Godot's `CanvasItem` API. `main.ts`'s five call sites
become explicit calls rather than method invocations, which also makes the
drawing order visible in one place instead of implied by object shape.

A `src/types.ts` aliasing `CanvasRenderingContext2D` was drafted to state the
rendering boundary in one place, but is not committed — the render module can
import the global type directly and the alias is only worth adding if a second
non-DOM host ever needs to satisfy it.

## A failed attempt, and what it teaches

The extraction was scripted: find `    render(ctx) {`, count braces to the
matching close, move the block, rewrite `this.` to `self.`.

**A naive brace counter is not safe on this code.** `Enemy.render` contains
nested blocks and template literals; the counter closed the method early, leaving
its tail orphaned in `entities.ts` and `renderEnemy` truncated in the new module.

`tsc` reported it immediately and unambiguously:

```
src/entities.ts(546,17): error TS1005: ';' expected.
src/entities.ts(558,1): error TS1128: Declaration or statement expected.
```

That is the whole argument for the typecheck step added in round 4: a text
transformation corrupted the file, and the compiler said so before anything ran.
The attempt was reverted rather than repaired, because repairing a
mis-extracted method by hand is how a subtle behavioural change gets introduced
under the cover of a refactor.

The lesson is narrow and worth writing down: **extract these by hand, one class
at a time, or with a brace-aware parser — not with a counter.** One class per
change also keeps each diff reviewable, which is how the rest of this port was
done and the reason it landed without a regression.

## Order

1. `entities.ts`, one class at a time, verifying after each: the five simplest
   renderers first (`Particle`, `FloatingText`, `ExpOrb`, `Mine`, `OrbitShard`),
   then `Projectile` and `EnemyProjectile`, then `Enemy`, then `Player`.
2. `main.ts`'s render path, once entities no longer draw themselves.
3. Only then consider `main.ts`'s own split of canvas ownership from game state.

## Not in scope

`ui.ts`, `input.ts`, `storage.ts` and `audio.ts` stay browser-specific. A port
replaces them; decoupling them would mean inventing an abstraction with exactly
one implementation, which is more code and no more portability.
