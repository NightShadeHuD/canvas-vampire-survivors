## Firing one weapon, by archetype.
##
## Split out of `game.gd` because the eight archetypes are eight small behaviours and
## `game.gd` is the loop that owns them. Everything here is a pure function of the
## world it is handed -- no nodes, no drawing -- so `verify_weapons.gd` can fire each
## archetype at a known target and assert what happened.
##
## Ported from `Weapon.fire` and its per-type branches in `src/weapons.ts`.
extends RefCounted
class_name WeaponFire

## How fast a projectile travels. `speed` is on the weapon data where it has one; the
## rest fall back to this, which is the original's default for a thrown attack.
const DEFAULT_SPEED := 420.0
## How fast an orbiting shard sweeps, in radians per second.
const ORBIT_SPIN := 2.4
## The original's melee sweep half-height: `if (Math.abs(dy) > 40) continue;` in
## `_fireMelee`. Named rather than written twice, because the band that DAMAGES and the
## band that is DRAWN have to be the same band.
const MELEE_HALF_HEIGHT := 40.0
## How far a Lightning chain hop reaches: `if (d < 180 && d < minD)` in `_fireInstant`.
const CHAIN_RADIUS := 180.0
## What a hop deals, as a fraction of the strike's damage: `nearest.takeDamage(dmg * 0.7)`.
const CHAIN_DAMAGE := 0.7
## The weapon level the chain starts at: `if (this.def.chain && this.level >= 3)`.
const CHAIN_LEVEL := 3

# ---------------------------------------------------------------------------
# EVOLUTION
#
# `Weapon.isEvolved` in `src/weapons.ts`:
#
#     return !!this.def.evolveLevel && this.level >= this.def.evolveLevel;
#
# -- ONE threshold, read once per fire and passed to every branch below, rather than
# each archetype re-deriving "is this weapon level 5". The five `evolve*` fields are on
# the defs in `src/data.ts` and reach this file through `godot/data/weapons.gd`, which
# the exporter generates from the same source, so there is nothing to hand-copy.
#
# Every constant below is a literal the ORIGINAL writes inline. They are named here so
# the number has one home, and `verify_weapons.gd` drives the real table rather than a
# hand-written list of weapons -- a def added with `evolveLevel` and no branch fails
# there the moment it is added.
# ---------------------------------------------------------------------------

## How much wider the evolved projectile fan is: `_fireProjectile`'s
## `const spreadDeg = count > 1 ? (this.isEvolved() ? 24 : 14) : 0;`. A RATIO, because
## the fan this port draws is a fraction of the original's absolute one -- see the
## note at the spread itself for why that absolute width is not reproduced.
const FAN_EVOLVED_RATIO := 24.0 / 14.0
## `_fireInstant`: `const strikes = evolved ? Math.min(3, targets.length) : 1;`
const EVOLVED_STRIKES := 3
## `_fireInstant`: `const chainCount = evolved ? this.def.chainCount + 2 : ...`
const EVOLVED_CHAIN_BONUS := 2
## `getOrbitShardCount`: `if (this.isEvolved()) n = n * 2;`
const EVOLVED_SHARD_MULT := 2
## `getOrbitShardCount`'s own bound: `return Math.min(12, n + extra);`
const SHARD_CAP := 12
## The passive whose stacks buy an extra shard: `player.passives?.cooldown?.count`.
const SHARD_PASSIVE := "cooldown"
## `_fireDrain`: `const targetCount = this.isEvolved() ? 2 : 1;`
const EVOLVED_DRAIN_TARGETS := 2
## `_fireMine`'s evolved cluster: a second charge `60` px away at `radius * 0.8`.
const CLUSTER_OFFSET := 60.0
const CLUSTER_RADIUS_MULT := 0.8
## `_fireNova`'s evolved second ring: `schedule(0.4, ...)` at `baseDmg * 0.6`.
const NOVA_PULSE_DELAY := 0.4
const NOVA_PULSE_DAMAGE := 0.6
## `_fireNova`'s slow, and its own two inline fallbacks:
##
##     const slowPct = this.def.slowPct ?? 0.5;
##     const slowDur = this.def.slowDuration ?? 1.2;
##
## The data declares BOTH on Frost Nova, so neither fallback is reachable today -- they are
## here because the original writes them there. `CONFIG.NOVA_SLOW_DEFAULT` (0.5) is NOT the
## source of the first one: it is declared in `src/config.ts` and read by nothing in the
## whole TypeScript, and reproducing an unread constant as if it were the read site would be
## exactly the kind of "ported but doing nothing" this port keeps finding.
const NOVA_SLOW_PCT := 0.5
const NOVA_SLOW_DURATION := 1.2

# ---------------------------------------------------------------------------
# THE DAMAGE NUMBERS
#
# `_rollCrit` in `src/weapons.ts` does two things: it rolls, and it DRAWS THE NUMBER. The
# colour and the height above the foe are the FOUR CALL SITES' and not its own:
#
#     216  _fireMelee    _rollCrit(player, game, baseDmg, enemy.x,  enemy.y - 20, '#ffaa00')
#     289  _fireInstant  _rollCrit(player, game, baseDmg, target.x, target.y - 20, '#ffff66')
#     395  _fireNova     _rollCrit(player, game, baseDmg, enemy.x,  enemy.y - 20, '#88ddff')
#     454  _fireDrain    _rollCrit(player, game, baseDmg, e.x,      e.y - 16, '#ff66aa')
#
#     112  the CRIT branch, for every weapon:  `'#ffee44'` with `{ crit: true }`
#
# Each colour is named here for the reason `MELEE_HALF_HEIGHT` is: the number the player reads
# over a foe has one home, and a suite can name the weapon it is checking. `-20` is three of
# the four sites and `-16` is the fourth, which is why they are two constants and not one.
#
# AND NO NUMBER REACHES THE OTHER FOUR ARCHETYPES **THROUGH THIS FUNCTION** -- which is a
# claim about the original rather than an omission here. `_fireProjectile`, `_fireAura` and
# `_fireMine` call `_rollCrit` NOWHERE, and `OrbitShard` reads `this.damage`. Where those
# four get a number, they get it SOMEWHERE ELSE, and this file is not that place:
#
#   projectile  `main.ts:1465-1483` draws one on IMPACT, with its own per-hit crit and the
#               two colours `'#ffee44'` / `'#fff'`. That is `projectile.gd`'s, it is a
#               DIFFERENT roll from `_rollCrit` (no `evolveBonusCrit`), and it is why the
#               projectile arm below passes no sink to anything.
#   orbit       `OrbitShard.update` draws `'#ffffcc'` at `e.y - 18`, with NO crit and no
#               `hp > 0` guard. DRAWING NOWHERE IN THIS PORT -- reported, not invented.
#   aura        `_fireAura` contains no `createFloatingText` at all. GENUINELY SILENT, and
#               the one archetype of the four that is.
#   mine        `Mine.update` draws `'#ff9944'` at `enemy.y - 20` over every foe in its
#               blast. DRAWING NOWHERE IN THIS PORT -- reported, not invented: the `Mine`
#               object is a separate change and the number belongs to it, not to `fire()`.
# ---------------------------------------------------------------------------

## The height above the foe's centre that a damage number is drawn at: `enemy.y - 20`.
const NUMBER_DY := -20.0
## `_fireDrain`'s own offset, `e.y - 16`. The tether's number sits closer to the foe than the
## other three, and the original says so four pixels at a time.
const DRAIN_NUMBER_DY := -16.0
## The Whip's sweep, `src/weapons.ts:216` -- also the colour the drawn sweep band uses.
const MELEE_NUMBER := Color("ffaa00")
## Lightning's strike, `src/weapons.ts:289`. A CHAIN HOP draws none (see `_fire_instant`).
const INSTANT_NUMBER := Color("ffff66")
## Frost Nova's burst, `src/weapons.ts:395` -- one per foe the ring catches.
const NOVA_NUMBER := Color("88ddff")
## Soul Drain's tether, `src/weapons.ts:454`. The only one of the four at `-16`.
const DRAIN_NUMBER := Color("ff66aa")
## `_rollCrit`'s CRIT branch, `src/weapons.ts:112`: ONE colour for every weapon, plus
## `{ crit: true }`, which is the size and the outline. `projectile.gd` draws this same
## literal for the projectile impact crit -- a second face of one colour in the original, and
## two different rolls, so the two are named where they are used rather than shared.
const CRIT_NUMBER := Color("ffee44")

## The reach a weapon fires with, in ONE place.
##
##     baseRange * (1 + (level - 1) * 0.1) * areaMult
##
## -- `Weapon.getRange` in `src/weapons.ts`. A function rather than a line inside `fire`
## because `main.gd` DRAWS one of these: the Garlic ring. That ring was drawn at
## `weapon["baseRange"]`, so after five Area passives the aura reached 177 and the ring
## stopped at 110 -- a behavioural audit measured a foe 150px away taking damage from
## outside the drawn ring, which is a drawing that lies about what the code does. One
## formula with two callers cannot disagree with itself.
static func reach_for(weapon: Dictionary, hero: Hero, level: int) -> float:
	var lv: float = maxf(1.0, float(level))
	return float(weapon["baseRange"]) * (1.0 + (lv - 1.0) * 0.1) * hero.area_mult()

## IS THIS WEAPON EVOLVED?
##
##     return !!this.def.evolveLevel && this.level >= this.def.evolveLevel;
##
## -- `Weapon.isEvolved` in `src/weapons.ts`. `>=` and not `==`, so a weapon that is
## somehow pushed past its evolve level stays evolved; the `!!` is a truthiness guard
## on an OPTIONAL field, reproduced as `> 0.0` -- absent and `0` both mean "this
## weapon does not evolve", which is Garlic in `src/data.ts`.
static func is_evolved(weapon: Dictionary, level: int) -> bool:
	var at := float(weapon.get("evolveLevel", 0))
	return at > 0.0 and float(level) >= at

## THE CRIT CHANCE, in ONE place.
##
##     let chance = player.getCritChance();
##     if (this.isEvolved() && this.def.evolveBonusCrit) chance += this.def.evolveBonusCrit;
##     if (chance > 0 && Math.random() < chance) { const dmg = baseDamage * 2; ... }
##
## -- `Weapon._rollCrit` in `src/weapons.ts`. The weapon's bonus is added to the hero's own
## chance BEFORE the `chance > 0` guard, and that ORDER is load-bearing: an evolved Knife
## (+10%) or Thunder Call (+15%) rolls for a hero who has taken no Luck at all, and guarding
## on `hero.crit_chance() > 0.0` alone would make `evolveBonusCrit` unreachable for exactly
## the hero it was written for.
##
## The CHANCE is a property of the hero and the weapon, so it is read ONCE per fire. The
## ROLL is a property of the TARGET, so it is `_roll_crit` below, once per foe.
static func crit_chance_for(weapon: Dictionary, hero: Hero, evolved: bool) -> float:
	var chance := hero.crit_chance()
	if evolved and float(weapon.get("evolveBonusCrit", 0.0)) != 0.0:
		chance += float(weapon["evolveBonusCrit"])
	return chance

## ONE CRIT ROLL *AND ITS ONE DAMAGE NUMBER*, for ONE target. `_rollCrit` in full --
## `src/weapons.ts:102`:
##
##     if (chance > 0 && Math.random() < chance) {
##         const dmg = baseDamage * 2;
##         game.createFloatingText(Math.round(dmg), x, y, '#ffee44', { crit: true });
##         return dmg;
##     }
##     game.createFloatingText(Math.round(baseDamage), x, y, color);
##     return baseDamage;
##
## -- the ROLL and the DRAW are one function in the original, so they are one function here.
## `fx` is the sink `game` is in the original: null means NO NUMBER, which is what the aura,
## the orbit and the mine pass (see the header note), and what a headless caller with no
## interest in drawing passes. The PER-TARGET loops that use this are the four below; the
## PROJECTILE's own number is a different roll in `projectile.gd`, and NO number is drawn by
## `fire()` for that archetype.
##
## THE POSITION IS THE FOE'S. That is the whole reason the draw lives here rather than once
## per fire: `x`/`y` are the TARGET's coordinates, so two foes inside one Whip band get two
## numbers eighty pixels apart, and neither of them is at the hero. One number at the hero
## would draw the same thing for a hit that landed and a hit that missed, which is the half of
## this feature that a per-fire port could not have reproduced even with the damage right.
##
## `Math.round` is repeated at the two emit sites rather than at the caller, which is where
## the original writes it -- and `str`/`roundi` are its GDScript spelling rather than a
## formatting choice of this port's.
##
## WHO ROLLS, AND HOW OFTEN. `grep -n "_rollCrit" src/weapons.ts` is four lines, and those
## four are the whole of the original's crit:
##
##     src/weapons.ts:216   `_fireMelee`    inside `for (const enemy of candidates)`
##     src/weapons.ts:289   `_fireInstant`  inside `for (let i = 0; i < strikes; i++)`
##     src/weapons.ts:395   `_fireNova`     inside `for (const enemy of candidates)`
##     src/weapons.ts:454   `_fireDrain`    inside `for (const e of targets)`
##
## EVERY ONE SITS INSIDE A PER-TARGET LOOP, so one Whip sweep can double one foe and leave
## the one beside it alone. This port rolled ONCE per fire, before the `match`, and multiplied
## the single number into every archetype -- every multi-target weapon was all-crit or
## no-crit, a variance the original does not have. That is the declared gap
## `godot-crit-rolled-once-per-fire`, and the four loops above are where it is closed.
##
## THE FOUR ARCHETYPES WITH NO CALL SITE HERE -- projectile, orbit, aura and mine -- never
## reach `_rollCrit` in the original: `_fireProjectile`, `_fireAura` and `_fireMine` hand
## `getDamage()` straight to the shot or the mine, and `OrbitShard` reads `this.damage`. This
## port used to roll ONE for each of them per fire, and that roll is GONE: the four `match`
## arms below pass `dmg` -- `getDamage(player)` -- straight through, as the original does.
## MEASURED, rather than read off the grep: one `fire()` at four foes in range takes three
## draws for a level-1 Whip, four for a level-5 Whip, one per Lightning strike (three at
## level 5) and four for a Frost Nova, and ZERO for a Knife, a Magic Wand, an Orbiter, an Area
## Mine, a Boomerang, a Retro Blaster or Garlic.
##
## AND "NO CALL SITE" IS NOT "NO ROLL", which is the distinction this paragraph used to
## flatten and which the PROJECTILE archetype is the counter-example to. `_fireProjectile`
## rolls nothing, and the port rolls nothing for it in `fire()` -- but the shot it pushed is
## rolled for ON IMPACT, once per foe it touches, by `_updateProjectiles`:
##
##     src/main.ts:1470   const chance = this.player.getCritChance();
##     src/main.ts:1471   const crit = chance > 0 && Math.random() < chance;
##
## -- a FIFTH roll site the four `_rollCrit` lines above do not contain, on the HERO's chance
## with no weapon bonus, doubling a LOCAL copy of `p.damage`, and drawing `'#ffee44'`/`'#fff'
## only when `enemy.hp > 0`. `projectile.gd`'s `resolve` is where it lives. So the original's
## crit is four per-target `_rollCrit` sites PLUS this one, and the ORBIT, AURA and MINE
## archetypes are the three with no roll anywhere at all.
##
## AND THE DECLARED FIELD THE OLD ROLL WAS KEPT FOR IS DEAD. `evolveBonusCrit: 0.1` sits on
## the evolved KNIFE, which is a projectile, and `_rollCrit` is the ONLY reader of that field
## anywhere in the original -- so a weapon whose archetype never reaches `_rollCrit` never
## reads it. Deleting the roll does not leave a field unread that the original reads; it
## leaves a field unread that the ORIGINAL leaves unread, which is the whole point. Lightning's
## `0.15` is the live one, because `_fireInstant` is one of the four call sites at the top of
## this block. `verify_weapons.gd`'s `_bonus_crit_is_read` measures both, and asserts a damage
## ratio of exactly 1.0 for the Knife and 1 + 0.15 for Thunder Call -- so a future port that
## starts reading the Knife's field again fails there rather than passing quietly.
##
## It is why this function takes a `chance` rather than reaching for the hero itself: the
## chance is read ONCE per fire by the caller, and WHICH archetypes roll at all is the caller's
## business -- four of the eight now pass this function nothing to roll with.
static func _roll_crit(
	base_damage: float,
	chance: float,
	rng: RandomNumberGenerator,
	fx: Fx = null,
	x := 0.0,
	y := 0.0,
	color := Color.WHITE
) -> float:
	# THE RANDOM DRAW COMES FIRST IN BOTH BRANCHES, which is the original's order and the
	# reason a seeded sequence still replays: `_randf` is called before anything is emitted,
	# and `emit_text` draws NOTHING from any generator. A damage number that jittered its own
	# position would have moved every recorded draw count in `verify_weapons.gd`.
	if chance > 0.0 and _randf(rng) < chance:
		var doubled := base_damage * 2.0
		if fx != null:
			fx.emit_text(str(roundi(doubled)), x, y, CRIT_NUMBER, true)
		return doubled
	if fx != null:
		fx.emit_text(str(roundi(base_damage)), x, y, color)
	return base_damage

## A float in `[0, 1)` from the generator the CALLER supplied when there is one, and from the
## global one otherwise -- `_pick_index`'s contract, for the same reason.
##
## The original draws its crit from `Math.random()`, the SAME single stream it picks
## Lightning's target from, so a caller that seeds a generator must get the whole fire pinned
## rather than the target pick alone. `fire()`'s `rng` is that generator.
##
## The `chance > 0.0` guard lives in `_roll_crit`, so a hero with no Luck consumes NO draw for
## a crit: the seeded sequences `verify_weapons.gd` replays are draws-per-fire measurements,
## and a roll taken with nothing to decide would move every one of them.
static func _randf(rng: RandomNumberGenerator) -> float:
	if rng == null:
		return randf()
	return rng.randf()

## The cooldown a weapon re-arms to, in ONE place.
##
##     baseCooldown * 0.92^(level - 1) * player.cooldownMult()   [* evolveCooldownMult]
##
## -- `Weapon.getCooldown` in `src/weapons.ts`. `game.gd` held this formula inline and
## is its only caller; it calls this now, because the evolves-cooldown branch is a
## second reader of the same curve and two call sites is how a timer and a number
## drift apart. Twin Arc's `evolveCooldownMult` (0.95) is the only one in the data.
static func cooldown_for(weapon: Dictionary, hero: Hero, level: int) -> float:
	var lv: float = maxf(1.0, float(level))
	var cd := float(weapon["baseCooldown"]) * pow(0.92, lv - 1.0) * hero.cooldown_mult()
	if is_evolved(weapon, level) and float(weapon.get("evolveCooldownMult", 0.0)) != 0.0:
		cd *= float(weapon["evolveCooldownMult"])
	return cd

## HOW MANY ORBIT SHARDS: `Weapon.getOrbitShardCount`.
##
##     let n = (base ? base : 0) + Math.floor((this.level - 1) / 2);
##     if (this.isEvolved()) n = n * 2;
##     const extra = Math.floor((player.passives?.cooldown?.count || 0) / 2);
##     return Math.min(12, n + extra);
##
## Orbit is the one archetype whose projectile count is NOT `_fireProjectile`'s: the
## original reads this function for it, and the doubled evolved count is the whole of
## Twin Halo's shape change. All four lines are here, including the Cooldown-passive
## synergy, which is a real term of the same expression rather than a separate claim.
static func orbit_count(weapon: Dictionary, hero: Hero, level: int) -> int:
	var lv: float = maxf(1.0, float(level))
	var n: int = int(weapon.get("projectileCount", 0)) + int(floor((lv - 1.0) / 2.0))
	if is_evolved(weapon, level):
		n *= EVOLVED_SHARD_MULT
	var extra := int(floor(float(hero.passive_count(SHARD_PASSIVE)) / 2.0))
	return mini(SHARD_CAP, n + extra)

## Fire one weapon. Returns the shots it created, which the caller owns.
##
## `nearest` is the foe to aim at, or null. A projectile with no target is not fired
## rather than fired at nothing -- the original does the same, and a knife thrown into
## empty space reads as a bug to the player.
##
## `rng` is the generator an archetype draws from when it needs one -- Lightning's random
## target is the only one today. Null means the GLOBAL generator: Godot seeds it from the
## device when the project runs, so play stays unpredictable, and only a caller that
## passes a seeded generator gets a pinned sequence. `Upgrades._next_index` is the same
## contract, and `verify_weapons.gd` is the caller that pins one.
static func fire(
	weapon: Dictionary, hero: Hero, foes: Array, shots: Array, level: int = 1, fx: Fx = null,
	rng: RandomNumberGenerator = null
) -> Array:
	# `fx` is the visual sink: the caller owns it, and a caller with no interest in
	# drawing (the headless suites) passes nothing. A weapon that applies damage directly
	# creates no `Shot`, and without this it left nothing on screen at all.
	var created: Array = []
	var kind: String = str(weapon["type"])
	# The hero's passives, applied HERE rather than at each archetype. This is the hook
	# the weapon commit recorded as missing: `damageMult`, `areaMult` and `cooldownMult`
	# had no port, so Might/Area/Cooldown did nothing when taken.
	# THE WEAPON'S OWN LEVEL, from `src/weapons.ts`.  A behavioural audit measured this
	# as absent: knife and whip at weapon level 1 and level 5 produced identical damage
	# (12.0), identical shot life (0.677s) and identical rates (24 shots in 10s).
	#
	# The level-up UI offers "Lv.2", "Lv.3" and "MAXED", so a player was choosing between
	# offers that did nothing. The original scales damage +20%/level, cooldown x0.92^(n-1),
	# range +10%/level and +1 projectile per 2 levels; only the passives were ported.
	var lv: float = maxf(1.0, float(level))
	var lv_damage := 1.0 + (lv - 1.0) * 0.2
	# THE THRESHOLD, read once. Every branch below takes it as a parameter rather than
	# asking again -- a second derivation of "is this weapon evolved" is a second thing
	# to keep in step, and `src/weapons.ts` has exactly one (`Weapon.isEvolved`).
	var evolved := is_evolved(weapon, level)

	var dmg := float(weapon["baseDamage"]) * lv_damage * hero.damage_mult()
	# `getDamage`: `if (this.isEvolved() && this.def.evolveDamageMult) base *= ...`.
	# Twin Halo's +10% is the only one in the data, and it is a SCALAR on the damage
	# the level curve already produced, not a replacement for it.
	if evolved and float(weapon.get("evolveDamageMult", 0.0)) != 0.0:
		dmg *= float(weapon["evolveDamageMult"])
	# THE CRIT IS NO LONGER ROLLED HERE. `dmg` is `getDamage(player)` -- the original's
	# `baseDmg`, and never doubled in place -- because `_rollCrit` is called at FOUR sites and
	# all four are inside a per-target loop. The doubling happens at the foe, through
	# `_roll_crit` below, and the counts are the original's: one draw per foe the Whip sweeps,
	# per foe the nova catches, per foe the drain tethers, and per STRIKE for Lightning (whose
	# chain hops inherit the strike's roll, `dmg * 0.7`, rather than rolling again).
	#
	# A crit doubles. `luck` is the only source of `hero.crit_chance()` and a base hero has
	# none -- and the guard is on the SUM, because `_rollCrit` adds the weapon's own bonus
	# BEFORE it rolls:
	#
	#     let chance = player.getCritChance();
	#     if (this.isEvolved() && this.def.evolveBonusCrit) chance += ...;
	#     if (chance > 0 && Math.random() < chance) { const dmg = baseDamage * 2; ... }
	#
	# An evolved Knife (+10%) or Thunder Call (+15%) therefore rolls for a hero with no
	# Luck at all. Guarding on `hero.crit_chance() > 0.0` -- which is what this line did
	# -- would make `evolveBonusCrit` unreachable for exactly the hero it was written
	# for, and the field would look ported while doing nothing.
	var crit := crit_chance_for(weapon, hero, evolved)
	var reach := reach_for(weapon, hero, level)
	# +1 projectile per 2 weapon levels, floored -- `_fireProjectile`'s own count.
	var count: int = int(weapon.get("projectileCount", 1)) + int(floor((lv - 1.0) / 2.0))
	# And its two evolved id-specific bonuses, as the original's own two `if`s. A Knife
	# becomes Blade Fan at no fewer than FIVE blades; a Magic Wand gains two.
	if evolved and str(weapon["id"]) == "knife":
		count = maxi(count, 5)
	if evolved and str(weapon["id"]) == "magic_wand":
		count += 2

	match kind:
		"projectile":
			# NO ROLL AT ALL. `_fireProjectile` in `src/weapons.ts` hands `getDamage(player)`
			# into `new Projectile(...)` and calls `_rollCrit` NOWHERE, so neither does this.
			# The `evolveBonusCrit` the volley roll here was kept for is declared on the
			# evolved KNIFE and is DEAD in the original -- see the note on `_roll_crit`.
			created = _fire_projectiles(weapon, hero, foes, reach, dmg, count, evolved)
		"orbit":
			# `getOrbitShardCount`, NOT the projectile count above: orbit is the one
			# archetype the original counts differently, and at level 5 it DOUBLES.
			# NO ROLL: `OrbitShard` reads `this.damage`, which is `getDamage(player)`, and
			# `_rollCrit` is nowhere in its path in the original either.
			created = _fire_orbit(hero, reach, dmg, orbit_count(weapon, hero, level))
		"melee":
			# THE ORIGINAL'S SWEEP IS A BAND, NOT A DISC -- until level 5, where the band
			# is replaced by `Math.hypot(dx, dy) > range`, a full circle. `_strike_sweep`
			# owns both shapes and both bursts, so the shape DRAWN and the shape APPLIED
			# cannot come from two different places.
			# PER TARGET. `src/weapons.ts:216`, inside `_fireMelee`'s `for (const enemy of
			# candidates)`: the roll is the loop body's first line, so two foes inside one
			# band are two independent coin flips.
			_strike_sweep(hero, foes, reach, dmg, evolved, crit, rng, fx)
			if fx != null:
				if evolved:
					# `game.createParticles(player.x, player.y, '#ff6644', 12)` -- the
					# MIRRORED burst, at the hero rather than at the two ends of a band
					# that no longer exists, and in `#ff6644` rather than `#ffaa00`. The
					# circle the damage covered is drawn at `reach` for the same reason
					# the band is at level 1-4: a shape applied one way and drawn another
					# is a drawing that lies about what the code did.
					fx.emit_particles(hero.x, hero.y, Color("ff6644"), 12)
					fx.emit_ring(hero.x, hero.y, reach, Color("ff6644"))
				else:
					fx.emit_sweep(hero.x, hero.y, reach, MELEE_HALF_HEIGHT, Color("ffaa00"))
					fx.emit_particles(hero.x - reach / 2.0, hero.y, Color("ffaa00"), 5)
					fx.emit_particles(hero.x + reach / 2.0, hero.y, Color("ffaa00"), 5)
		"aura":
			# NO ROLL: `_fireAura` damages with `getDamage(player)` and calls `_rollCrit`
			# NOWHERE in the original. Garlic declares no `evolveBonusCrit` either way, so
			# the volley roll this used to take had nothing to decide -- and it is gone.
			#
			# AND NO TEXT SINK, which is a claim about the original rather than an omission:
			# `_fireAura` contains no `createFloatingText` at all, so a foe dying inside the
			# Garlic ring never had a number over it. `_strike_disc_unrolled` takes no sink
			# parameter for exactly this reason -- of its three callers one is genuinely
			# silent and the other two are the Area Mine's, whose `Mine.update` number
			# belongs to the `Mine` object and is DRAWING NOWHERE in this port. A sink that
			# existed and was deliberately not passed would be a caller that could forget;
			# there is nothing to pass.
			_strike_disc_unrolled(hero.x, hero.y, foes, reach, dmg)
			# `createParticles(player.x + cos(a) * r, player.y + sin(a) * r, '#88ff88', 1)`
			# on 40% of fires -- a RATE in the original too, so a fire that emits nothing
			# is correct rather than broken. The ring `main.gd` draws is the constant, and
			# it is drawn at `reach_for`, which is the same number this struck with.
			if fx != null and randf() < 0.4:
				var aura_angle := randf() * TAU
				var aura_r := randf() * reach
				fx.emit_particles(
					hero.x + cos(aura_angle) * aura_r,
					hero.y + sin(aura_angle) * aura_r,
					Color("88ff88"),
					1
				)
		"nova":
			# THE SLOW. `slowPct` and `slowDuration` are on the Frost Nova def and
			# `_fireNova` in `src/weapons.ts` reads BOTH and applies them to every foe the
			# burst caught. `Foe` had no slow field at all, so until this was ported Frost
			# Nova's own description -- "Expanding ring of ice slows foes caught in the
			# burst" -- was a promise the code did not keep.
			#
			# THE FOES SLOWED ARE THE FOES THE DISC HIT, handed back by the same
			# `_strike_disc` predicate the damage used, rather than a second disc
			# re-derived here. A radius that damages one set and slows another is the
			# Garlic ring's lie one weapon along.
			# PER TARGET. `src/weapons.ts:395`, inside `_fireNova`'s `for (const enemy of
			# candidates)`: every foe the burst catches is its own coin flip, and the
			# `nova_hits` handed to the slow are the foes this same predicate reached.
			# `#88ddff` is the FOURTH of `_rollCrit`'s call sites' colours, and it travels
			# into the disc so every foe the burst catches gets its own number at its own
			# position -- not one number at the hero for the whole ring.
			var nova_hits := _strike_all_in_range(
				hero, foes, reach, dmg, crit, rng, fx, NOVA_NUMBER
			)
			var nova_slow_pct: float = float(weapon.get("slowPct", NOVA_SLOW_PCT))
			var nova_slow_dur: float = float(weapon.get("slowDuration", NOVA_SLOW_DURATION))
			for caught in nova_hits:
				caught.apply_slow(nova_slow_pct, nova_slow_dur)
			if fx != null:
				# `createParticles(player.x, player.y, '#aaeeff', 24)`, reproduced. The ring
				# is NOT in the original -- `RingPulse` exists in `src/effects.ts` and nova
				# does not call it -- and it is drawn because a nova IS its radius.
				fx.emit_particles(hero.x, hero.y, Color("aaeeff"), 24)
				fx.emit_ring(hero.x, hero.y, reach, Color("aaeeff"))
			# THE EVOLVED SECOND RING. `_fireNova`:
			#
			#     const r = range;
			#     const d2 = baseDmg * 0.6;
			#     game.effects?.schedule?.(0.4, () => { ... if (d < r) e.takeDamage(d2); ... });
			#
			# `r` and `d2` are captured at FIRE time -- the original says so in as many
			# words, "so a stat change between pulses doesn't retro-buff" -- and the
			# CENTRE is read when the callback RUNS, so a hero who walked away takes the
			# second ring where they are standing. The pulse carries those two numbers
			# and `Game.step` lands it, which is the port of `effects.schedule`.
			#
			# AND THE SECOND RING DOES NOT SLOW. Read the original's callback again: it
			# calls `e.takeDamage(d2)` and `createParticles` and writes NO `slowTimer`.
			# The slow is the FIRST ring's alone -- the evolved Glacial Cascade is more
			# damage, not more ice. A port that slowed on both would be kinder than the
			# original and wrong, so `verify_weapons.gd` pins the asymmetry.
			# AND `d2` IS THE UNCRITTED BASE. `const d2 = baseDmg * 0.6;` is taken from
			# `getDamage(player)` before any `_rollCrit`, so the second ring NEVER crits --
			# it also never rolls, so it is not a fifth call site. `dmg` here is that base
			# and is never doubled in place, which is what keeps this line honest now that
			# the first ring rolls per foe.
			if evolved and fx != null:
				fx.schedule_pulse(NOVA_PULSE_DELAY, reach, dmg * NOVA_PULSE_DAMAGE)
		"instant":
			# A RANDOM foe, and then the chain. `_fireInstant` in `src/weapons.ts`:
			#
			#     const cand = targets[Math.floor(Math.random() * targets.length)];
			#     if (this.def.chain && this.level >= 3) { ... d < 180 ... dmg * 0.7 ... }
			#
			# The port used to strike the NEAREST and never chain, and `verify_weapons.gd`
			# ASSERTED that nearest-target behaviour -- a test pinning what the data
			# contradicts. `src/data.ts` says "Smites a random foe. Lv3+ chains." The code
			# and that assertion are replaced together; `_fire_instant` below carries the
			# rest of the original, quoted rather than invented.
			var hits := _fire_instant(
				weapon, hero, foes, reach, dmg, level, rng, evolved, crit, fx
			)
			if fx != null:
				# `createParticles(target.x, target.y, '#ffff66', 14)` runs INSIDE the
				# original's strike loop and `8` runs inside its chain loop, so EVERY foe
				# the bolt touches leaves a burst of its own -- the strike AND each hop --
				# and the player can see which foes were hit. The size travels with the
				# foe: one number for both would draw a hop as loudly as the bolt that
				# began it, which is a drawing that lies about what happened.
				for hit in hits:
					var hit_foe: Foe = hit["foe"]
					fx.emit_particles(hit_foe.x, hit_foe.y, Color("ffff66"), int(hit["sparks"]))
		"drain":
			#     const targetCount = this.isEvolved() ? 2 : 1;
			#
			# NOT the projectile count, which is what this passed: Soul Drain tethered a
			# second foe from weapon level 3 and a third from level 5, so the weapon had
			# two extra beams before it evolved and the evolution itself was invisible.
			# The original's one tether becomes two only at `evolveLevel`.
			var draining := EVOLVED_DRAIN_TARGETS if evolved else 1
			# PER TARGET. `src/weapons.ts:454`, inside `_fireDrain`'s `for (const e of
			# targets)`: the evolved weapon tethers TWO foes and rolls TWICE, so either one
			# can be doubled on its own. `_strike_nearest` hands back what each foe was
			# actually dealt, because the heal is the SUM of those rolls.
			var drained := _strike_nearest(hero, foes, reach, dmg, draining, crit, rng, fx)
			# Soul Drain heals on tick -- `lifestealPct` is on the data -- for
			# `totalDmg * steal`, summed over what it ACTUALLY drained. Two things were
			# wrong in the one line this replaces: it healed even when nothing was in
			# range (the original returns before the heal when `targets` is empty), and
			# it healed for ONE foe's damage while the evolved weapon drains two.
			#
			# AND IT IS NOW THE SUM OF TWO ROLLS RATHER THAN ONE ROLL COUNTED TWICE.
			# `totalDmg` accumulates `dmg` INSIDE the loop the crit is rolled in:
			#
			#     for (const e of targets) { const dmg = this._rollCrit(...); totalDmg += dmg; }
			#     if (player.heal) player.heal(totalDmg * steal);
			#
			# so one crit of two tethers heals 3x a plain tether -- not 2x and not 4x.
			# `dmg * drained.size()` equalled that sum only while both foes shared a single
			# roll, which is exactly what the roll above stops doing.
			var total := 0.0
			for drained_foe in drained:
				total += float(drained_foe["damage"])
			var pct: float = float(weapon.get("lifestealPct", 0.0))
			if pct > 0.0 and not drained.is_empty():
				hero.hp = minf(hero.hp + total * pct, hero.max_hp)
			if fx != null:
				for drained_foe in drained:
					var foe: Foe = drained_foe["foe"]
					# The original's own tether visual, reproduced exactly: two sparks at
					# the MIDPOINT. `src/weapons.ts` calls it a "cheap 'tether' visual".
					fx.emit_particles(
						(hero.x + foe.x) / 2.0, (hero.y + foe.y) / 2.0, Color("ff88cc"), 2
					)
					fx.emit_beam(hero.x, hero.y, foe.x, foe.y, Color("ff88cc"))
		"mine":
			# A mine this slice treats as a delayed nova: the fuse is real in the data
			# and the arming behaviour is not ported, so it strikes immediately rather
			# than pretending to arm. Named here so it is not mistaken for finished.
			# NO ROLL: `_fireMine` passes `getDamage(player)` into `new Mine(...)` and
			# `Mine.update` calls `enemy.takeDamage(this.damage)` with no crit -- so the
			# charge and its evolved twin both carry the un-rolled base, exactly as the
			# two `new Mine(...)` calls in the original do.
			_strike_disc_unrolled(hero.x, hero.y, foes, reach, dmg)
			if fx != null:
				# WHAT THE ORIGINAL DRAWS, and what it therefore cannot be reproduced as:
				# `renderMine` fills the blast radius and paints a 10px body that turns
				# bright red once `armed = fuse < maxFuse * 0.5`. That armed state needs a
				# mine that ARMS, and this port has none -- so the DETONATION is what is
				# reproduced (`Mine.update`: `createParticles(this.x, this.y, '#ff8833', 20)`
				# plus the blast radius the damage used). No fuse is invented for a mine
				# that is already gone.
				fx.emit_particles(hero.x, hero.y, Color("ff8833"), 20)
				fx.emit_blast(hero.x, hero.y, reach, Color("ff8833"))
			if evolved:
				# `_fireMine`'s evolved Cluster Mine, quoted:
				#
				#     const a = Math.random() * Math.PI * 2;
				#     game.mines.push(new Mine(player.x + Math.cos(a) * 60,
				#                              player.y + Math.sin(a) * 60,
				#                              radius * 0.8, dmg, fuse));
				#
				# A SECOND charge at full damage, 60px away, covering 80% of the radius --
				# and a second `Mine.update`, which is where the 20 sparks and the blast
				# disc come from. The angle has no data behind it in the original either,
				# so it is a global draw: what a player sees is two overlapping blasts,
				# not which way round they are.
				var cluster_angle := randf() * TAU
				var cluster_x := hero.x + cos(cluster_angle) * CLUSTER_OFFSET
				var cluster_y := hero.y + sin(cluster_angle) * CLUSTER_OFFSET
				var cluster_reach := reach * CLUSTER_RADIUS_MULT
				_strike_disc_unrolled(cluster_x, cluster_y, foes, cluster_reach, dmg)
				if fx != null:
					fx.emit_particles(cluster_x, cluster_y, Color("ff8833"), 20)
					fx.emit_blast(cluster_x, cluster_y, cluster_reach, Color("ff8833"))
		_:
			push_warning("weapon archetype '%s' has no implementation" % kind)

	shots.append_array(created)
	return created

static func _fire_projectiles(
	weapon: Dictionary, hero: Hero, foes: Array, reach: float, dmg: float, count: int,
	evolved: bool
) -> Array:
	var target = nearest_to(hero.x, hero.y, foes, reach)
	if target == null:
		return []
	var speed: float = float(weapon.get("speed", DEFAULT_SPEED))
	# Boomerangs return to the THROWER, so they need to remember where from.
	var boomerang: bool = bool(weapon.get("boomerang", false))
	var out: Array = []
	for i in count:
		# A fan: several projectiles spread around the aim direction, so a three-knife
		# volley reads as a volley rather than one knife drawn three times.
		# A TIGHT fan, and tight is load-bearing rather than cosmetic.
		#
		# Two attempts got this wrong in the same direction. +/-0.25 rad put both
		# blaster shots either side of a bat; +/-0.12 still missed at 192px, because a
		# shot only connects within `radius + foe.size` (18px) and 0.12 rad spreads to
		# 23px there. A weapon that looks implemented and deals no damage is worse than
		# one that is obviously absent.
		#
		# 0.04 rad each side is ~2.3 degrees: 7px at 192px, comfortably inside the hit
		# radius, and still visibly a fan at range.
		#
		# AND THE EVOLVED FAN IS WIDER, by the original's own ratio:
		#
		#     const spreadDeg = count > 1 ? (this.isEvolved() ? 24 : 14) : 0;
		#
		# WHAT IS NOT FAITHFUL, stated rather than glossed: the original's width is
		# ABSOLUTE -- `(i - (count - 1) / 2) * spreadDeg` degrees apart per blade, so an
		# evolved Blade Fan spans +/-48 degrees -- and this port's is a fraction of that
		# (see the paragraph above: the original's own 14-degree fan already misses a
		# lone foe at 192px through THIS projectile geometry). The DIRECTION and the
		# RATIO are the original's; the absolute width is the port's, and a fan that
		# visibly widens is the part a player can see.
		var width := 0.08 * (FAN_EVOLVED_RATIO if evolved else 1.0)
		var spread := 0.0
		if count > 1:
			spread = (float(i) / float(count - 1) - 0.5) * width
		var dir: Vector2 = Vector2(target.x - hero.x, target.y - hero.y).normalized().rotated(spread)
		var s := Shot.new(hero.x, hero.y, dir, dmg, reach, speed, bool(weapon.get("piercing", false)))
		if boomerang:
			s.kind = Shot.Kind.BOOMERANG
			# Half the life outbound, half coming back.
			s.return_after = s.life * 0.5
		out.append(s)
	return out

static func _fire_orbit(hero: Hero, reach: float, dmg: float, count: int) -> Array:
	var out: Array = []
	for i in count:
		out.append(Shot.orbiting(hero.x, hero.y, TAU * float(i) / float(count), reach, dmg, ORBIT_SPIN))
	return out

## THE ORIGINAL'S MELEE SWEEP, AND IT IS NOT A DISC:
##
##     if (Math.abs(dx) > range) continue;
##     if (Math.abs(dy) > 40) continue;
##
## A horizontal band `2 * reach` wide and 80 tall, centred on the hero. This port damaged a
## 360-degree disc instead, and a behavioural audit measured what that costs: on a ring of
## eight foes the original hits the two on the horizontal axis and the disc hits all eight.
##
## The band is DRAWN by `Fx.emit_sweep` from these same two numbers, which is the point of
## the exercise -- a shape drawn one way and applied another is the same lie as a Garlic
## ring that stops short of its aura.
##
## At weapon level 5 the original EVOLVES this into a full circle:
##
##     if (evolved) {
##         if (Math.hypot(dx, dy) > range) continue;   // Full circular sweep
##     } else {
##         if (Math.abs(dx) > range) continue;
##         if (Math.abs(dy) > 40) continue;
##     }
##
## Both shapes live HERE, and the caller draws the one this function used, so the band a
## level-1 Whip applies and the circle a level-5 Whip applies are each drawn at the
## radius they actually reached. A 40px half-height on the evolved sweep would be the
## Garlic ring's lie again, one weapon along.
static func _strike_sweep(
	hero: Hero, foes: Array, reach: float, dmg: float, evolved: bool, chance: float,
	rng: RandomNumberGenerator, fx: Fx = null
) -> void:
	for foe in foes:
		if foe.dead:
			continue
		var dx: float = foe.x - hero.x
		var dy: float = foe.y - hero.y
		if evolved:
			# `Math.hypot(dx, dy) > range`, STRICT: a foe at exactly `reach` is swept.
			if sqrt(dx * dx + dy * dy) > reach:
				continue
		else:
			if absf(dx) > reach:
				continue
			if absf(dy) > MELEE_HALF_HEIGHT:
				continue
		# THE ROLL IS THE LOOP BODY'S FIRST LINE in `src/weapons.ts:216`, so it is here, and
		# the NUMBER it draws comes with it. One foe inside the band is one coin flip,
		# whatever the foe beside it did -- and one number, at THAT foe.
		foe.take_damage(
			_roll_crit(dmg, chance, rng, fx, foe.x, foe.y + NUMBER_DY, MELEE_NUMBER)
		)

## Everything within `reach`, PER FOE -- Frost Nova is the only caller left, and it is the
## only one of the three disc weapons whose damage the original rolls for. Garlic and Area
## Mine do NOT come through here: `_fireAura` and `_fireMine` call `_rollCrit` nowhere, so
## they use `_strike_disc_unrolled`, which rolls nothing at all.
##
## Returns the foes it HIT, because Frost Nova has to do a second thing to exactly those
## foes -- and it is handed the same set this predicate damaged rather than a second disc
## re-derived, so the slow and the damage cannot disagree.
static func _strike_all_in_range(
	hero: Hero, foes: Array, reach: float, dmg: float, chance: float,
	rng: RandomNumberGenerator, fx: Fx = null, color := Color.WHITE
) -> Array:
	return _strike_disc(hero.x, hero.y, foes, reach, dmg, chance, rng, fx, color)

## The same disc, around an arbitrary point rather than the hero. `_strike_all_in_range`
## is this centred on the hero; the aura and the two mine charges reach it through
## `_strike_disc_unrolled`, whose centre is the hero for one and the SECOND charge's own
## position for the other.
##
## `<= reach`, and the hits are returned so a caller that applies a SECOND effect -- the
## nova's slow -- applies it to the set this predicate actually reached rather than to a
## set it worked out again for itself.
static func _strike_disc(
	cx: float, cy: float, foes: Array, reach: float, dmg: float, chance: float,
	rng: RandomNumberGenerator, fx: Fx = null, color := Color.WHITE,
	number_dy := NUMBER_DY
) -> Array:
	var hit: Array = []
	for foe in foes:
		if foe.dead:
			continue
		var dx: float = foe.x - cx
		var dy: float = foe.y - cy
		if sqrt(dx * dx + dy * dy) <= reach:
			# PER FOE, so a nova that catches eight foes rolls eight times and a fire
			# can double some of them and not others -- AND EIGHT NUMBERS, one over each
			# foe, which is what `color` and `number_dy` are for. A caller whose archetype
			# `_rollCrit` has no call site in does not come through here with a chance --
			# it uses `_strike_disc_unrolled`, which is the same predicate with nothing
			# left to decide and NO sink, so it draws nothing.
			foe.take_damage(
				_roll_crit(dmg, chance, rng, fx, foe.x, foe.y + number_dy, color)
			)
			hit.append(foe)
	return hit

## The same disc, struck with damage that was never rolled at all.
##
## The aura, the mine and the mine's evolved cluster are the three callers. `_fireAura` and
## `_fireMine` in `src/weapons.ts` call `_rollCrit` NOWHERE -- they hand `getDamage(player)`
## to every foe they touch -- so there is no roll for the original to have, per foe or per
## fire, and there is none here. The chance below is a stated ZERO rather than an absent
## argument: this predicate is `_strike_disc` with nothing left to decide, and naming it is
## what keeps the difference between these three and the nova a word a reader can follow.
##
## AND IT IS MEASURED, not merely asserted by this comment: `verify_weapons.gd`'s
## `_the_aura_rolls_nothing_and_is_the_control` fires Garlic through a SEEDED generator at a
## hero who HAS Luck and requires the generator to be exactly where it was -- one roll, per
## fire or per foe, would move it. A caller that starts rolling again fails there.
static func _strike_disc_unrolled(
	cx: float, cy: float, foes: Array, reach: float, dmg: float
) -> Array:
	return _strike_disc(cx, cy, foes, reach, dmg, 0.0, null)

## ONE LIGHTNING STRIKE: a RANDOM foe in range, and then the chain.
##
## WHICH FOE, AND WHY IT IS NOT THE NEAREST
##
##     const cand = targets[Math.floor(Math.random() * targets.length)];
##
## -- `_fireInstant` in `src/weapons.ts`, and `src/data.ts`'s own description of the
## weapon is "Smites a random foe". This port struck the NEAREST instead, and
## `verify_weapons.gd` ASSERTED that: a test pinning the behaviour the data contradicts,
## which is rule 12 upside down. Both are replaced in the same change.
##
## THE CHAIN, QUOTED RATHER THAN INVENTED
##
##     if (this.def.chain && this.level >= 3) {
##         const chainCount = evolved ? this.def.chainCount + 2 : this.def.chainCount;
##         for (let c = 0; c < chainCount; c++) {
##             ... if (d < 180 && d < minD) { minD = d; nearest = e; }
##             if (!nearest) break;
##             nearest.takeDamage(dmg * 0.7);
##             game.createParticles(nearest.x, nearest.y, '#ffff66', 8);
##
## -- the nearest UN-CHAINED foe within 180px of the last one hit, `dmg * 0.7` a hop, at
## most `chainCount` of them. Every one of those four numbers is read here: the flag, the
## level, the count and the radius. None of them is written into the code twice.
##
## WHAT EVOLUTION CHANGES HERE, quoted rather than described:
##
##     const strikes = evolved ? Math.min(3, targets.length) : 1;
##     const chainCount = evolved ? this.def.chainCount + 2 : this.def.chainCount;
##
## -- at `evolveLevel` one bolt smites up to THREE distinct foes and each of those
## strikes chains two hops further. Both are read from the def, so Thunder Call is a
## different weapon rather than a bigger number: `verify_weapons.gd` measures the
## population of foes a single fire damages at level 4 and at level 5.
##
## A DEAD FOE IS NOT A TARGET. The original's hop loop does not check, because its dead
## are swept later in the same frame; every other strike in this file skips the dead, so
## this one does too rather than chaining into a corpse.
##
## Returns `[{"foe": Foe, "sparks": int}]`. The burst SIZE travels with the foe because
## the original emits 14 at the strike and 8 at each hop, and the caller draws both.
static func _fire_instant(
	weapon: Dictionary,
	hero: Hero,
	foes: Array,
	reach: float,
	dmg: float,
	level: int,
	rng: RandomNumberGenerator,
	evolved: bool,
	chance: float,
	fx: Fx = null
) -> Array:
	var targets: Array = []
	for foe in foes:
		if foe.dead:
			continue
		var dx: float = foe.x - hero.x
		var dy: float = foe.y - hero.y
		# STRICT `<`: `if (Math.hypot(e.x - player.x, e.y - player.y) < range)`.
		if sqrt(dx * dx + dy * dy) < reach:
			targets.append(foe)
	if targets.is_empty():
		return []

	var hits: Array = []
	#     const strikes = evolved ? Math.min(3, targets.length) : 1;
	var strikes: int = mini(EVOLVED_STRIKES, targets.size()) if evolved else 1
	#     const picked = new Set();
	var picked: Array = []
	for _strike_index in strikes:
		#     let target: Enemy | null = null;
		#     while (picked.size < targets.length) {
		#         const cand = targets[Math.floor(Math.random() * targets.length)];
		#         if (!picked.has(cand)) { target = cand; picked.add(cand); break; }
		#     }
		#     if (!target) break;
		#
		# TRANSLITERATED, rejection sampling and all: a foe already struck by an earlier
		# strike of the same bolt is never struck twice, and when every candidate has
		# been picked the loop falls out and the remaining strikes do not happen. At
		# level 1 this runs exactly once and consumes exactly one draw -- which is what
		# `verify_weapons.gd` pins when it replays a seeded sequence.
		var struck: Foe = null
		while picked.size() < targets.size():
			var candidate: Foe = targets[_pick_index(rng, targets.size())]
			if not picked.has(candidate):
				struck = candidate
				picked.append(candidate)
				break
		if struck == null:
			break
		# PER STRIKE, NOT PER FIRE. `src/weapons.ts:289` is inside
		# `for (let i = 0; i < strikes; i++)`, so an evolved Thunder Call's three strikes are
		# three independent rolls and ONE of them can crit while the others do not. At level
		# 1 `strikes` is 1, so a plain bolt rolls exactly once -- which is the draw count
		# `verify_weapons.gd` replays.
		#
		# THE ORDER OF THE DRAWS IS THE ORIGINAL'S TOO: the rejection-sampling loop above
		# draws its candidate FIRST, and the crit is drawn after the foe is chosen:
		#
		#     const cand = targets[Math.floor(Math.random() * targets.length)];
		#     const dmg = this._rollCrit(player, game, baseDmg, target.x, target.y - 20,
		#                               '#ffff66');
		#
		# AND THE NUMBER GOES OVER THE FOE THAT WAS STRUCK, at `#ffff66`, which is the third
		# of `_rollCrit`'s four call sites. It is drawn BEFORE `take_damage` here, as the
		# original draws it, so the position is the foe's at the moment of the strike.
		var strike_dmg := _roll_crit(
			dmg, chance, rng, fx, struck.x, struck.y + NUMBER_DY, INSTANT_NUMBER
		)
		struck.take_damage(strike_dmg)
		hits.append({"foe": struck, "sparks": 14})

		if not bool(weapon.get("chain", false)) or level < CHAIN_LEVEL:
			continue
		#     const chainCount = evolved ? this.def.chainCount + 2 : this.def.chainCount;
		#
		# EVERY strike of an evolved bolt chains, and each chain is two hops longer --
		# the `hits` list is what the caller draws, so a chain that is not in it is a
		# chain the player cannot see.
		var hops: int = int(weapon.get("chainCount", 0))
		if evolved:
			hops += EVOLVED_CHAIN_BONUS

		var chained: Array = [struck]
		var current: Foe = struck
		for _hop in hops:
			var nearest: Foe = null
			var min_d := CHAIN_RADIUS
			for foe in foes:
				if foe.dead or chained.has(foe):
					continue
				var hx: float = foe.x - current.x
				var hy: float = foe.y - current.y
				var d: float = sqrt(hx * hx + hy * hy)
				# `d < 180 && d < minD`, with `minD` started AT the radius rather than at
				# Infinity: the same candidate set, one comparison instead of two. STRICT,
				# so a foe at exactly 180px is NOT chained -- `verify_weapons.gd` pins it.
				if d < min_d:
					min_d = d
					nearest = foe
			if nearest == null:
				break
			# THE HOP INHERITS THE STRIKE'S ROLL and does not take one of its own:
			# `nearest.takeDamage(dmg * 0.7)` in the original, where `dmg` is the value
			# `_rollCrit` returned for the foe this chain started from. A hop that rolled
			# again would be a fifth `_rollCrit` call site and would change the number of
			# draws a level-4 bolt takes.
			nearest.take_damage(strike_dmg * CHAIN_DAMAGE)
			hits.append({"foe": nearest, "sparks": 8})
			chained.append(nearest)
			current = nearest
	return hits

## A random index in `[0, n)`, from the generator the CALLER supplied when there is one.
##
## The same three lines as `Upgrades._next_index`, deliberately. One shape for "a random
## index a caller can seed" means a test pins a sequence the same way whichever part of
## the game it is driving, and there is one place to look when one of them is wrong.
##
## `rng == null` is the GLOBAL generator. Godot seeds it from the device at startup --
## measured rather than assumed: `randi()` and `RandomNumberGenerator.new().randi()`
## printed a different first value in each of three separate runs -- so the default is
## unpredictable play, and only a caller that passes a seeded generator gets a pinned
## sequence. `Game.step` passes nothing, which is the point of it.
static func _pick_index(rng: RandomNumberGenerator, n: int) -> int:
	if rng == null:
		return randi() % n
	return rng.randi() % n

## The `count` CLOSEST foes within `reach`. Soul Drain and nothing else -- Lightning used
## to be here and is not any more, because the original does not aim it at the nearest:
## `_fire_instant` above is the random smite plus the chain, and the two are different
## weapons. Hitting the furthest would be a third.
##
## Returns `[{"foe": Foe, "damage": float}]` -- the foes it struck AND what each was dealt.
## `_fireDrain` needs both: it draws two sparks at each tether's MIDPOINT, which a count
## cannot give it, and it heals `totalDmg * steal`, which is the sum of the `damage` numbers
## rather than one roll multiplied by `struck.size()` now that the two rolls are independent.
static func _strike_nearest(
	hero: Hero, foes: Array, reach: float, dmg: float, count: int, chance: float,
	rng: RandomNumberGenerator, fx: Fx = null
) -> Array:
	var in_range: Array = []
	for foe in foes:
		if foe.dead:
			continue
		var dx: float = foe.x - hero.x
		var dy: float = foe.y - hero.y
		var d: float = sqrt(dx * dx + dy * dy)
		if d <= reach:
			in_range.append({"foe": foe, "d": d})
	in_range.sort_custom(func(a, b): return a["d"] < b["d"])
	var struck: Array = []
	for i in mini(count, in_range.size()):
		# PER TARGET: `src/weapons.ts:454` is inside `_fireDrain`'s `for (const e of
		# targets)`, so both of the evolved weapon's tethers roll for themselves -- and each
		# draws its OWN number over its own foe, in `#ff66aa`, 16px up rather than 20. WHAT
		# EACH FOE WAS DEALT travels back with it, because the heal is `totalDmg * steal`
		# and `totalDmg` is the sum of THESE numbers rather than one number times a count.
		var dealt := _roll_crit(
			dmg,
			chance,
			rng,
			fx,
			in_range[i]["foe"].x,
			in_range[i]["foe"].y + DRAIN_NUMBER_DY,
			DRAIN_NUMBER
		)
		in_range[i]["foe"].take_damage(dealt)
		struck.append({"foe": in_range[i]["foe"], "damage": dealt})
	return struck

## A public helper because Lightning's `chain` and the tests both want it.
static func nearest_to(x: float, y: float, foes: Array, max_range: float):
	var best = null
	var best_d := max_range
	for foe in foes:
		if foe.dead:
			continue
		var dx: float = foe.x - x
		var dy: float = foe.y - y
		var d: float = sqrt(dx * dx + dy * dy)
		if d <= best_d:
			best_d = d
			best = foe
	return best
