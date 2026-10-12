# The Godot port

## Measured figures

Checked by `npm run check:claims` against the thing that produces each one. The sections
below quote numbers too, and **those are not checked** -- this block is the part that cannot
drift silently.

<!-- claims:begin -->

| name              | value |
| ----------------- | ----- |
| `godotSuites`     | 12    |
| `godotAssertions` | 313   |
| `weapons`         | 11    |
| `achievements`    | 21    |

<!-- claims:end -->

**Status: playable, and still short of the original.** The data layer, the vertical slice,
XP and the level-up pick, every weapon and passive and enemy archetype, the achievements, the
difficulty curve, persistence and a pixel tier are ported and verified — each section below
records what it proves. **What is genuinely NOT ported is listed at the end of this file**,
and it is shorter than this sentence used to claim: the line above said "Nothing else is" for
several rounds while the same document described seven finished suites beneath it.

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

### All 21 achievements, and the false green behind them

`scripts/export-godot.mjs` has reported this on every run since it was written:

```
    21  a function -- needs a hand-written `func`
```

Those 21 were the port worklist, and this closes them. The CONDITIONS live in
`godot/scripts/achievements.gd`; the DEFINITIONS stay generated, and the generated file
holds `null` where a condition belongs so nothing looks finished that is not.

`Run` -- a new `RefCounted` -- carries the tallies the conditions read: bosses defeated,
longest unhit, orbs collected, passives picked, clones of the speedrun clocks. Named
fields rather than a Dictionary, because **a typo in a string key is a runtime null and a
typo in a field is a compile error.** It is separate from `Game` because it outlives it:
`Game` is the simulation, `Run` is the scorecard, and a leaderboard reads the second.

```
  ok   EVERY achievement definition has a condition  (0 -> 0)
  ok   and the generated table holds all 21  (21.0000 vs 21.0000)
  ok   no condition is orphaned  (0 -> 0)
  ok   slayer_100 stays quiet one kills below / fires ON the boundary
  ok   a missing time is not a fast time
  ok   and over it does not
```

Every threshold is pinned **on the boundary and one past it**, which is how this project
pins an edge -- and for a good reason: a `>=` written `>` passes a "fires when true"
test and fails a player who reaches exactly 100 kills.

#### The bug, and the much worse bug behind it

`triple_build` reads a lifetime total from the save. `Game` had **no `save` member at
all**, so `g.save` threw -- and **the suite reported PASS anyway**, because a GDScript
runtime error does not fail a suite. It prints a stack trace and carries on.

**A crashing test that reports success is worse than a failing one.** `check:godot` now
treats `SCRIPT ERROR`, `Invalid access`, `Invalid call` and `nonexistent function` in
the output as a FAILURE regardless of what the script printed. Swept across all eleven
suites: nothing else was hiding.

### Tooling for the way tests actually went wrong

Half the red tests in this project were the TEST being wrong -- and they were not
random. They fell into seven shapes, and each had a correct assertion that was
_slightly more work to write than the wrong one_. `godot/assertions.gd` makes the
right form the short form.

| The mistake                                                  | What it looked like                              | The helper                                |
| ------------------------------------------------------------ | ------------------------------------------------ | ----------------------------------------- |
| asserted a **magnitude** where the claim was a **direction** | a mage was "at x > 20" instead of "further away" | `Check.further/closer`                    |
| counted **events** where the claim was a **population**      | 4 clones alive 1000 frames read as 2348          | `Check.Peak/Trough`                       |
| read state **after** it changed                              | clone XP read once they were all dead            | capture inside `Check.over`               |
| wrote down a value it could **read**                         | hero start hardcoded 400 in a 1600-tall arena    | derive from the object                    |
| compared floats for **equality**                             | two shots compared by `vx`, where `cos` is EVEN  | `Check.differs(a, b, min_delta)`          |
| expected a **rate** to be a certainty                        | 25% dodge asserted as 100%                       | `Check.rate(hits, trials, expected, tol)` |
| assumed a **precondition** that was unset                    | healing tested on a full-health hero             | `Check.wounded/sturdy`                    |

`Check.rose(before, after)` is no longer than `assert(before < 20.0)` and it **cannot
be wrong about which direction the claim was.** Every helper prints the values it
compared -- a failure that says only "expected true" costs a round trip.

#### An API trap, fixed rather than documented

`Game.new(999.0)` was the obvious way to say "do not spawn" and it **spawned once
immediately**, because `spawn_timer` began at 0 and the first `step` fired. Two tests
were written against that surprise in one round.

The fix is not a note in the docs. **An interval of 999 seconds now means the first
spawn is in 999 seconds** -- the timer starts at the interval -- and `Game.new()` has
been joined by `Game.without_spawns()` so the intent has a name.

#### The tooling had to be tested, and it had three bugs

A helper that reports PASS when it should report FAIL is worse than no helper. The 50
checks in `verify_assertions.gd` exercise every helper **in both directions**.

Three bugs came out of that, and the third is the one worth reading:

1. Two shots at +/-0.023 rad have **exactly** equal `vx` -- `cos` is even. Not "equal
   to three decimals"; **equal.** The original check compared a constant with itself.
2. A GDScript **lambda captures locals by value**. `ran += 1` inside a callback never
   escaped, and neither did a capture in the archetype test. _A test counting inside a
   callback counts nothing._
3. **A suite mixing both harnesses could print `FAIL` and still report `PASS`** --
   because `Check.ok` was never consulted by the older `_check` harness. A false green,
   introduced by the tooling built to remove false greens. Fixed across all three
   suites, which now require **both** flags.

### Every enemy archetype, and the two bugs the tools found

`archetype` is on every enemy in `src/data.ts` and **nothing read it**, so ten enemy
types were ten SKINS walking at you at different speeds. Third time for this shape:
the data declares something the code ignores.

| Archetype     | Foes                                    | Behaviour, all driven by the data's own flags                                |
| ------------- | --------------------------------------- | ---------------------------------------------------------------------------- |
| `chaser`      | bat, zombie, skeleton, ghost, slimeling | closes to nothing                                                            |
| `dasher`      | wolf                                    | prowls at `speed`, bursts to `dashSpeed` on a cycle                          |
| `shielded`    | golem                                   | `shieldHp` absorbs first, `damageReduction` cuts the rest                    |
| `ranged`      | mage                                    | holds `keepDistance`, fires inside `firingRange`                             |
| `splitter`    | slime                                   | becomes `splitCount` x `splitInto` on death                                  |
| `bomber`      | bomber                                  | arms inside `fuseRange`, then blasts `blastRadius` -- **including the hero** |
| `illusionist` | illusionist                             | makes `cloneCount` clones, worth no XP                                       |

```
  ok   EVERY archetype in the data is handled  (unhandled: none)
  ok   a dasher outruns a chaser over 4s  (wolf 702.0 vs bat 440.0)
  ok   and moves in BURSTS rather than steadily  (5.333 vs 2.500 per frame)
  ok   and past it, damage is reduced / by exactly the 50% in the data
  ok   a mage backs off when too close  (30.0 -> 170.0)
  ok   and the signals a shot for the Game to place
  ok   and the blast hurts the HERO, not just foes  (hp 90.0)
  ok   and clones do NOT clone  (4 <= 10 over 25s)
```

#### Three bugs, found three different ways

1. **A constant I invented.** The wolf's prowl was `speed * 0.35` -- a number I made
   up. The data says `speed: 150` and `dashSpeed: 320`, and my version left a wolf
   **slower than a bat over four seconds**: a dasher that never catches anything.
   Found by asserting it outruns a chaser.

2. **Clones cloned.** A clone is the same def, so it cloned too, and the population was
   exponential -- **27,165 foes in 25 seconds**. Found by adding a ceiling to a test
   that had passed the whole time "makes clones" was true.

3. **Clones bypassed the enemy cap.** `_spawn_clones` appended to `foes` directly while
   `_split` used the `spawned` staging list -- so clones skipped the cap check _and_
   mutated the array `step` was iterating. **Found by the invariant fuzzer** at 302
   foes against a cap of 300, ten minutes into a run. It only saw the cap: the mutation
   is a silently skipped foe rather than a number out of range.

Esc/P also **quit** the game. It pauses now, and a level-up cannot be paused over --
two modals at once, and the pick is the one that has to be answered.

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

## Tooling research: `typescript-to-gdscript`

**Researched 2026-10-12, and recorded because it changes what a future contributor should do
— not what this port should do now.**

There is a maintained tool for the exact half of this port that was done by hand:
[`typescript-to-gdscript`](https://github.com/nnn3d/typescript-to-gdscript) (MIT). You write
Godot scripts in TypeScript, it type-checks them against **900+ generated engine classes**
and emits ordinary `.gd` files Godot runs unchanged. Watch mode, source maps back to the
`.ts` line, and scene/path typings generated from the project.

    npm install --save-dev typescript-to-gdscript
    npx tstogd init          # write .ts in src/, it emits .gd into scripts/

### What it does NOT do, which is the half this repository already covers

**It converts code. This repository's `export-godot.mjs` converts DATA.** `WEAPONS`,
`PASSIVES`, `ENEMIES`, `BOSSES`, `WAVES`, `ACHIEVEMENTS`, `UNLOCKS` and the config constants
are turned into `godot/data/*.gd` tables from `src/data.ts` — the single source of truth both
games read. `tstogd` has no equivalent, and a data table is not a script.

**The two are complementary, not competing.** A future project could reasonably use `tstogd`
for the logic and a generator like ours for the tables.

### The honest tradeoff, measured rather than argued

|                               |                                                                         |
| ----------------------------- | ----------------------------------------------------------------------- |
| Hand-written GDScript here    | 11 modules, ~2,900 lines                                                |
| Assertions verifying them     | **309**                                                                 |
| Cost of switching to `tstogd` | rewrite all 11 in TypeScript; **discard every one of those assertions** |
| Benefit                       | type-checking before running; the Godot API typed; safe refactoring     |

**Rule 14 says measure a cascade before starting it, and this cascade is larger than the
increment.** The port is verified and playable. Rewriting it to gain compile-time checking
trades 309 passing assertions for a promise, and the six player-visible bugs this port has
shipped — invisible hero, off-screen title, 82% scrim, undrawn bolts, off-centre panels,
unbound WASD — **were all representation bugs that a type checker would not have caught
either.** Types would not have helped with any of them.

**So: recorded, not adopted.** The recommendation is for the NEXT Godot project, not this one.

### What the research DID change: confirmation that our gotchas were real

Every GDScript trap this port hit by hand is [documented upstream as a caveat](https://nnn3d.github.io/typescript-to-gdscript/guide/caveats/).
That is evidence the mistakes were the language's, not carelessness:

| We hit                                                                                                                   | Their caveat                                                                                             |
| ------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| **A lambda captures locals BY VALUE** — cost a round, and `godot/assertions.gd` works around it with a one-element Array | _"A GDScript lambda gets its own copy of the local variables it uses, and TypeScript doesn't warn you."_ |
| A save read that must never return null — `save.gd` routes every read through `_get`                                     | _"Reading `obj.key` becomes `obj.get("key")`, which gives `null` for a missing key, never `undefined`."_ |
| Generated tables wrap every constant in a `class_name`                                                                   | _"GDScript has no variables outside a class"_ and _"A `.gd` file is one class"_                          |
| `Check.unchanged(arr, [])` compares contents, not identity                                                               | _"`==` … compares vectors, colors, arrays and dictionaries by their contents, not by identity"_          |
| Weapon level scaling written as `(lv - 1.0) / 2.0`, deliberately float                                                   | _"`/` between two `int` values drops the fraction … and TypeScript can't warn you"_                      |

**Five of five.** The workarounds were correct; a compiler would have made them unnecessary
rather than wrong.

### Also worth knowing

[`@gdx/godact`](https://jsr.io/@gdx/godact) is a different approach — a runtime bridge that
lets Godot call JavaScript — and is **not** a fit here. This project's TypeScript is
compiled to a static `dist/` bundle and the Godot build is separate; a runtime bridge would
make Godot depend on a JS engine, against the zero-runtime-dependency constraint.

## What is NOT ported

Everything else. `src/` is 9,885 lines across 24 files; the data layer is ~850 of
them. Still to do:

- **Core logic** — `entities.ts` (924), `weapons.ts` (462), `main.ts` (1,919)
- **Presentation** — `ui.ts` (1,242), `game-render.ts`, `entity-render.ts`
- **Platform** — `input.ts` (435), `storage.ts` (361), `audio.ts`
- ~~**The 21 achievement conditions**~~ — **DONE.** All 21 are implemented in
  `godot/scripts/achievements.gd` and `verify_achievements.gd` asserts every one is present
  and fires on its boundary. Left in place struck through, because a to-do list that keeps
  a finished item without saying so is how this line read as current for several rounds.

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
