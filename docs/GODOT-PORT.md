# The Godot port

**Status: started.** The data layer is ported and verified. Nothing else is.

## What exists, and what proved it

```bash
npm run export:godot                       # TypeScript data -> godot/data/*.gd
godot --headless --path godot --script res://verify_data.gd
```

The second command is the one that matters. It loads the generated GDScript **inside
Godot 4.7.2** and asserts real field values against the TypeScript:

```
  ok   weapon count = 11        ok   WHIP baseDamage = 20
  ok   enemy count = 11         ok   WHIP baseCooldown = 1.5
  ok   passive count = 13       ok   GARLIC type = aura
  ok   KNIFE piercing = true    ok   WHIP evolveName = Bloody Sweep
verify_data: PASS
```

Syntax acceptance would not have been enough. Godot parsing a file proves the file is
GDScript; reading `WEAPONS["WHIP"]["baseDamage"]` and getting `20` proves the data
crossed.

## Why a generator rather than a hand port

`docs/GODOT-PORT-RESEARCH.md` established this is a **transform**, not a rewrite. The
data layer is the purely mechanical part of that transform: 11 weapons, 11 enemies,
13 passives, 5 bosses, 21 achievements and the tables keying them.

Hand-copying ~850 lines of literals would create a **second source of truth**, and the
first time a weapon's damage is tuned the two would disagree with nothing to say so.
`scripts/export-godot.mjs` imports the actual `src/data.ts` — Node runs it directly,
no build step — and writes GDScript.

## The port worklist, which the generator produces

22 values could not cross, and the exporter **reports each one with its path** rather
than dropping it quietly:

| Count | What                              | Why it cannot be data                         |
| ----: | --------------------------------- | --------------------------------------------- |
|    21 | `check: (c) => …` on achievements | GDScript cannot hold a lambda in a Dictionary |
|     1 | `Infinity`                        | no GDScript literal                           |

Those 21 are the honest state of the achievement system: the **definitions** are
ported and the **conditions** are not. Each needs a hand-written `func` in GDScript.
The generated file holds `null` where each belongs, so nothing looks finished that
is not.

## The vertical slice — playable

```bash
npm run check:godot        # regenerates, imports, and runs both checks below
godot --path godot         # or open the project and play it
```

`godot/scenes/main.tscn` opens to a playable slice: **WASD or arrows** to move, foes
walk in from off-screen, Garlic damages what comes close, the hero blinks through
i-frames, and HP / time / kills are drawn in the corner.

```
  ok   hero moves right when asked  (x 1200.0 -> 1680.0)
  ok   a diagonal is not faster than a straight line  (240.0 vs 240.0)
  ok   foes spawn  (4 after 2s)
  ok   foe closes on the hero  (680.0 -> 625.0)
  ok   the weapon kills  (11 kills in 10s)
  ok   a hit costs hp  (hp = 90.0)
  ok   a hit grants i-frames  (invincible = true)
  ok   a hit during i-frames is free  (hp = 90.0)
  ok   a hit past i-frames lands  (hp = 80.0)
  ok   hero stops at the right edge  (x = 2380.0)
verify_slice: PASS
```

**A scene that loads is not a game that runs**, which is why every one of those is
asserted rather than eyeballed: the hero moves _and_ a diagonal is not faster, foes
spawn _and_ close the distance, the weapon kills _and_ i-frames hold. All of it runs
headless in under a second.

### Logic is separated from rendering, deliberately

| Layer      | File                                       | Knows about                     |
| ---------- | ------------------------------------------ | ------------------------------- |
| Simulation | `scripts/game.gd`, `player.gd`, `enemy.gd` | nothing but numbers             |
| View       | `scripts/main.gd`                          | `_draw`, `Input`, the SceneTree |

`Game` is a `RefCounted` that never touches `_draw` or `_process`, so `verify_slice.gd`
steps thousands of frames without a window. The original decoupled its logic from the
DOM for the same reason, and it pays off identically here.

### A test bug worth recording

The diagonal check first reported `240.0 vs 594.4` — a real-looking failure. The
movement was correct; **the test had hardcoded the hero's start as `ARENA_HEIGHT / 2`
= 400 when the arena is 1600 tall and the start is 800.** It now reads the start
position instead of writing it down. A test that assumes a value it could read fails
on the truth and blames the code.

## What is NOT ported

Everything else. `src/` is 9,885 lines across 24 files; the data layer is ~850 of
them. Still to do:

- **Core logic** — `entities.ts` (924), `weapons.ts` (462), `main.ts` (1,919)
- **Presentation** — `ui.ts` (1,242), `game-render.ts`, `entity-render.ts`
- **Platform** — `input.ts` (435), `storage.ts` (361), `audio.ts`
- **The 21 achievement conditions**

`npm run check:ports` measures the size of that transform: **319 sites the
TypeScript-to-GDScript converter refuses, plus 8 that convert and behave
differently.** Those 8 are the dangerous ones and the research document discusses
each.

## What the TypeScript strictness work was for

`strictNullChecks` reached **zero in `src/`** before this started, and that was
worth doing: GDScript has only `null`, so `undefined`-versus-`null` was a real
semantic difference at the boundary this file crosses. The exporter's `undefined`
branch is one line because of it.

`noImplicitAny` — 168 remaining in `src/` — has **no GDScript analogue.** GDScript is
dynamically typed, so no annotation can be wrong there. It makes the port easier to
read and is not a correctness boundary. It is lower priority than finishing the port.
