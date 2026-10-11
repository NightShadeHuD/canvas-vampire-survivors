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

### An invariant fuzzer, and the bug no behavioural test could see

Every check so far asserts a specific behaviour in a specific scenario. **None asked
the question that catches a whole class of bug at once: after however many frames of
whatever input, is anything IMPOSSIBLE now true?**

`verify_invariants.gd` runs ten minutes of adversarial play -- random directions,
absurd magnitudes, a hero driven into every corner -- and checks invariants after
every frame, reporting the frame each broke at:

```
  ok   hp is never negative / never exceeds max / is a real number
  ok   hero position is real / is inside the arena
  ok   exp is never negative / is below the next threshold
  ok   foe count is capped
  ok   10 minutes of adversarial play stayed coherent  (36000 frames)
```

Plus the boundary checks a fuzzer cannot reach on its own:

| Check                                                 | Why it is an edge                                     |
| ----------------------------------------------------- | ----------------------------------------------------- |
| a level never goes backwards                          | a mis-signed XP subtraction                           |
| the threshold grows at every level                    | free levelling partway through                        |
| **the threshold stays finite at level 200**           | `*1.2` compounds to 3.3e17                            |
| an unreachable orb expires                            | an orb outside the magnet forever                     |
| every instant falls in a wave                         | sampling every second plus both edges of all 10 waves |
| a boundary instant belongs to the wave STARTING there | an off-by-one that would double-spawn or stop         |
| a fully maxed hero is still offered something         | an empty offer pauses the run forever                 |

#### The bug it found

**`add_weapon` allowed duplicates.** It appended unconditionally, so calling it twice
created two copies of the same weapon at level 1 -- and `has_weapon` then reported the
first, leaving the second as **invisible state the level-up screen could still offer**.

No behavioural test could see it, because every one went through `Upgrades.apply`,
which checks first. The fuzzer found it by asking what a fully-maxed hero is offered --
a question no behavioural test had a reason to ask. It levels instead of appending now.

### Every passive works too — and the hook the weapon commit recorded as missing

Weapons were fixed and **passives were the same bug one screen over**: thirteen were
offered, the hero tracked counts, and nothing read them.

The root cause was worse than "unimplemented". `add_passive(id)` stored a **bare
count**, and an effect lives on the def -- so a count with no def _cannot_ compute
anything. The bug was invisible because no test asked what a passive does.

```
  ok   EVERY passive changes something  (silent: none)
  ok   one Might is 1.1x / two compound to 1.21x, not 1.2x
  ok   damage is floored at 1, never 0
  ok   about 25% of hits are dodged  (0.245 over 4000 trials)
  ok   and a dodged hit costs no health and no i-frames  (0 violation(s))
  ok   Recovery heals over time  (hp 51.00 after 2s)
  ok   Magnet extends the pickup range  (120.0 -> 150.0)
  ok   Might raises weapon damage  (12.0 -> 13.2)
  ok   and IS hit once Area extends the reach  (hp 9995)
  ok   Cooldown shortens the timer, not lengthens it  (0.9200)
  ok   Vitality raises max HP / and heals by the same amount
```

#### The two aggregations are not the same shape

Ported from `_passiveSum` and `_passiveMult` in `src/entities.ts`:

|                | How it combines                      | Used by                                                                                     |
| -------------- | ------------------------------------ | ------------------------------------------------------------------------------------------- |
| `passive_sum`  | adds `effect * count`                | `armor`, `hpRegen`, `critChance`, `dodgeChance`, `damageReduction`                          |
| `passive_mult` | **compounds** `(1 + effect) ^ count` | `damageMult`, `areaMult`, `speedMult`, `expMult`, `cooldownMult`, `magnetMult`, `maxHpMult` |

Two Might stacks are **1.21x, not 1.2x**. A passive that adds instead of compounding
stops scaling the moment you hold more than one, and the difference is invisible until
you do.

#### Also now applied, all of which had no port

`damageMult`, `areaMult` and `cooldownMult` were the hook the weapon commit recorded
as **missing** -- Might, Area and Cooldown did nothing. `magnetMult` was the reason
taking Magnet did nothing; the orb read the bare `MAGNET_BASE`. `speedMult`,
`expMult`, `maxHpMult`, `armor`, `dodgeChance`, `damageReduction` and `hpRegen` were
all unread.

Three ordering rules, all from the original and all load-bearing:

- **dodge → armor → reduction**, so a dodged hit _does not land_ rather than being
  reduced to zero, and **does not burn an i-frame window**
- **damage is floored at 1**, so a tanky build cannot become literally immortal
- **Vitality raises the ceiling AND heals by the same amount**, so taking it is not a
  downgrade

#### A test that was wrong and looked like a bug

The dodge check stacked Evasion twenty times and expected a 100% dodge. `add_passive`
**correctly caps at `PASSIVE_MAX_STACK`**, so it reached 25% and the test failed
against working code. It measures the _rate_ over 4000 trials now -- 0.245 against an
expected 0.25 -- which is a better check than the one it replaced.

### Every weapon works — and the test that says so

The level-up screen offered eleven weapons and **only Garlic had an implementation**.
Picking the Magic Wand stored it, showed it on the hero, and changed nothing. Nothing
caught it because every test asserted the one weapon that worked.

`verify_weapons.gd` drives **the data table**, not a hand-written list:

```
  ok   EVERY weapon damages a foe in range  (silent: none)
  ok   a piercing knife hits more than one foe  (3 of 3)
  ok   orbit makes projectileCount shards  (2)
  ok   and they MOVE / at a constant radius  (120.0)
  ok   a boomerang is thrown / and knows it is one
  ok   Soul Drain heals on hit  (hp 50.0 -> 52.0)
  ok   lightning hits the NEAREST foe / and not the far one
  ok   a 2-projectile weapon fires 2 / 4.6 deg apart
  ok   each weapon has its own timer / the slow one is not reset by the fast one
```

**A weapon added to `src/data.ts` later fails until it is implemented** -- which is the
property that makes this worth having rather than a list that goes stale.

Eight archetypes: `aura`, `melee`, `nova`, `instant`, `drain`, `mine`, `orbit` and
`projectile`. All ported from `src/weapons.ts`.

#### Three bugs it found

1. **The boomerang reversed on frame one.** It flew zero distance and looked exactly
   like a weapon that did nothing. It now has an outbound leg, and returns to the
   thrower's SPOT rather than to the hero -- the original's behaviour, and better:
   walk away and the shard comes back to where you were.
2. **The volley spread was wider than the hit radius.** `+/-0.25` rad put both
   blaster shots either side of a bat; `+/-0.12` still missed at 192px. A shot
   connects within `radius + foe.size` = 18px, and 0.12 rad is 23px there. It is
   `+/-0.04` now -- visibly a fan, and converging inside the weapon's own range.
   _A weapon that looks implemented and deals no damage is worse than one that is
   obviously absent._
3. **`getDamageMult` and friends were never applied.** Weapon damage ignored the
   hero's passives entirely. Noted rather than fixed: no passive grants a damage
   multiplier yet, so there is nothing to apply -- but the hook is missing and the
   first damage passive added will silently do nothing.

#### Two of my tests were wrong and looked like bugs

- The **drain** check left the hero at full health, so the heal was correctly clamped
  and the test failed against working code.
- The **fan** check compared `vx` across a spread of 4.6 degrees -- where the x
  components are equal to three decimals. It compares angles now.
- The **projectile** check `break`-ed out of its loop on the first shot, then asserted
  "and they kill" three frames later. Against a weapon that kills nine bats in twenty
  seconds.

Three times in one round the failure was in the test rather than the code, and each
one was indistinguishable from the bug it was testing for. The instinct every time was
to go and change working code.

### XP and the level-up pick — it is a survivors game now

Kill a foe, an orb drops where it fell, it flies to you once you are close enough,
and the bar fills. Fill it and **the run pauses** on three offers you choose between.

Ported from the original rather than invented:

| Ported                                          | From             | Note                                                                                   |
| ----------------------------------------------- | ---------------- | -------------------------------------------------------------------------------------- |
| `expToNext` 50, `*1.2` floored per level        | `Player.gainExp` | asserted against those numbers, not against this code\'s output                        |
| Level-up heals 20, capped at max                | same             | the difference between a reward and a lifeline                                         |
| Orb magnet: 600/s² capped at 560/s              | `ExpOrb.update`  | an orb accelerates rather than flying at a fixed speed                                 |
| Two radii — magnet 120, pickup 24               | `CONFIG`         | collapsed into one, an orb is banked the instant it is pulled and never appears to fly |
| `buildUpgradePool` live/maxed split, pick 3     | `src/ui.ts`      | maxed options only surface when live ones run out                                      |
| Labels `(New!)` / `(Lv.2)` / `(x3)` / `(MAXED)` | same             |                                                                                        |

```
  ok   50 xp is a level              ok   an orb inside the magnet moves toward the hero
  ok   the next costs 60             ok   one outside the magnet stays put
  ok   then 72                       ok   one inside the pickup is collected
  ok   a level heals 20              ok   three offers, all distinct
  ok   and never past max            ok   taking a weapon again LEVELS it
  ok   a kill drops an orb           ok   without adding a duplicate
```

That last pair is the bug worth having a test for: **taking the same weapon twice must
level it, not add a second copy** — otherwise a three-weapon build silently becomes
eleven of the same knife.

### A test that was wrong and looked like a bug

The pause check first reported `FAIL and the run PAUSES for it (-1 frames frozen)`.
The pause was fine. **The test compared the clock against one baseline captured at the
first offer**, so the legitimate resume after a pick read as the sim running on.

It now tracks the _transition_ into and out of each offer. Worth recording because
the failure was indistinguishable from the bug it was testing for, and the instinct
was to go and change working code.

### The hero was immortal, and the test that found it

`verify_play.gd` plays the SCENE for ninety seconds — real `_process`, real `_draw`,
real camera, driven input — and it found this:

```
  FAIL a stationary hero eventually dies  (hp = 100.0 at 600s)
```

**Six hundred seconds of being swarmed cost exactly zero health.** Not a code bug:
a position placed five pixels from the hero dealt its ten damage correctly. The foes
were simply dying 8 pixels short of contact, every time — Garlic reaches 110px and
contact needs 32, and a bat could not cross the last stretch before it died.

THE MECHANIC THAT WAS MISSING

The original gets hard through one line in `main.ts`:

```js
const timeDiff = 1 + Math.floor(this.gameTime / 60) * 0.3;
```

**Enemies gain 30% health every minute**, and damage with it. A foe spawned at minute
three has 1.9x the health of one spawned at the start, so the weapon that holds at
zero seconds is overwhelmed by minute four. My slice had the enemy table and none of
the curve, so nothing ever outran Garlic.

That is now ported, along with the waves it scales with:

| Ported                                            | From                                   |
| ------------------------------------------------- | -------------------------------------- |
| `timeDiff` — 30% per minute                       | `main.ts` `_computeDifficultyMults`    |
| The 10-wave table, with its pools and `spawnMult` | `src/data.ts` `WAVES`                  |
| The 4 difficulty rows                             | `src/config.ts` `Difficulty`           |
| `hpMult` / `dmgMult` applied **at spawn**         | the original applies them at spawn too |

```
  ok   a stationary hero eventually dies  (hp = 0.0 at 16s)
```

A SECOND BUG, FOUND BY THE SAME TEST

Wave pools hold `"bat"`, and `ENEMIES` is keyed `"BAT"`. Looking up by dictionary key
was a guess about casing that happened to be wrong — every spawn pushed a warning and
fell through to the first enemy. Defs are now found by their own `id` field, which
`src/data.ts` carries on every one **precisely so nothing has to infer one.**

### What was broken, and what now catches it

The first version shipped with **an invisible hero**. The arena is 2400x1600 and the
hero starts at its centre, (1200, 800), while Godot\'s default viewport is 1152x648 —
so the camera showed the top-left corner and the hero was 48 pixels off the right
edge. **There was no `Camera2D` at all.**

Every check passed anyway. `verify_slice.gd` asserts the simulation, and the
simulation was correct: the hero really was at (1200, 800). **Nothing asked whether a
human could see it.** A test at the wrong level passes while the game is unplayable.

`verify_scene.gd` now runs at the level the bug was at — a real SceneTree, a real
camera, a real viewport:

```
  ok   the scene HAS a camera            ok   there IS a menu
  ok   the camera is the active one      ok   and a title  (SURVIVOR)
  ok   the hero is INSIDE the viewport   ok   and a way to start
  ok   the camera follows the hero       ok   it is shown first
  ok   and actually moved                ok   START begins a run
```

### It looks like the source material now

The menu is the original\'s, word for word, taken from `index.html`: **SURVIVOR**,
_Vampire Survivors style roguelite_, and the How-to-play list. The hero is drawn the
way `src/entity-render.ts` draws it — a soft glow, an `#44aaff` body, a `#cfeaff`
core, and the Garlic ring pulsing at the original\'s period. Foes carry their data
colour, a pale core and an HP bar once hit.

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
