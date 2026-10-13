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

	var dmg := float(weapon["baseDamage"]) * lv_damage * hero.damage_mult()
	# A crit doubles. `luck` is the only source and a base hero has none.
	if hero.crit_chance() > 0.0 and randf() < hero.crit_chance():
		dmg *= 2.0
	var reach := reach_for(weapon, hero, level)
	# +1 projectile per 2 weapon levels, floored -- `src/weapons.ts` `getProjectileCount`.
	var count: int = int(weapon.get("projectileCount", 1)) + int(floor((lv - 1.0) / 2.0))

	match kind:
		"projectile":
			created = _fire_projectiles(weapon, hero, foes, reach, dmg, count)
		"orbit":
			created = _fire_orbit(hero, reach, dmg, count)
		"melee":
			# THE ORIGINAL'S SWEEP IS A BAND, NOT A DISC. See `_strike_sweep`. The two
			# bursts are `_fireMelee`'s own visual, at the two ends of that band.
			_strike_sweep(hero, foes, reach, dmg)
			if fx != null:
				fx.emit_sweep(hero.x, hero.y, reach, MELEE_HALF_HEIGHT, Color("ffaa00"))
				fx.emit_particles(hero.x - reach / 2.0, hero.y, Color("ffaa00"), 5)
				fx.emit_particles(hero.x + reach / 2.0, hero.y, Color("ffaa00"), 5)
		"aura":
			_strike_all_in_range(hero, foes, reach, dmg)
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
			# `slowPct` (0.5) and `slowDuration` (1.2) are on the data and `src/entities.ts`
			# reads them (`slowTimer`/`slowPct`, with `#88ccff` tinting in
			# `entity-render.ts`), but `Foe` here has no slow field at all -- so Frost Nova
			# damages and does not slow. REPORTED, NOT FIXED: a slow is a gameplay change
			# and this round is a drawing one.
			_strike_all_in_range(hero, foes, reach, dmg)
			if fx != null:
				# `createParticles(player.x, player.y, '#aaeeff', 24)`, reproduced. The ring
				# is NOT in the original -- `RingPulse` exists in `src/effects.ts` and nova
				# does not call it -- and it is drawn because a nova IS its radius.
				fx.emit_particles(hero.x, hero.y, Color("aaeeff"), 24)
				fx.emit_ring(hero.x, hero.y, reach, Color("aaeeff"))
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
			var hits := _fire_instant(weapon, hero, foes, reach, dmg, level, rng)
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
			var drained := _strike_nearest(hero, foes, reach, dmg, count)
			# Soul Drain heals on tick -- `lifestealPct` is on the data.
			var pct: float = float(weapon.get("lifestealPct", 0.0))
			if pct > 0.0:
				hero.hp = minf(hero.hp + dmg * pct, hero.max_hp)
			if fx != null:
				for foe in drained:
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
			_strike_all_in_range(hero, foes, reach, dmg)
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
		_:
			push_warning("weapon archetype '%s' has no implementation" % kind)

	shots.append_array(created)
	return created

static func _fire_projectiles(
	weapon: Dictionary, hero: Hero, foes: Array, reach: float, dmg: float, count: int
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
		var spread := 0.0
		if count > 1:
			spread = (float(i) / float(count - 1) - 0.5) * 0.08
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
## At weapon level 5 the original EVOLVES this into `Math.hypot(dx, dy) > range`, a full
## circle. Evolution is not ported at all (no `evolveDamageMult`, no `evolveBonusCrit`, no
## evolved shapes), so this is the level 1-4 sweep at every level. Reported, not assumed.
static func _strike_sweep(hero: Hero, foes: Array, reach: float, dmg: float) -> void:
	for foe in foes:
		if foe.dead:
			continue
		var dx: float = foe.x - hero.x
		var dy: float = foe.y - hero.y
		if absf(dx) > reach:
			continue
		if absf(dy) > MELEE_HALF_HEIGHT:
			continue
		foe.take_damage(dmg)

## Everything within `reach`. Garlic, Frost Nova and Area Mine all land here -- what
## separates them is range and cadence, which is in the data.
static func _strike_all_in_range(hero: Hero, foes: Array, reach: float, dmg: float) -> void:
	for foe in foes:
		if foe.dead:
			continue
		var dx: float = foe.x - hero.x
		var dy: float = foe.y - hero.y
		if sqrt(dx * dx + dy * dy) <= reach:
			foe.take_damage(dmg)

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
## WHAT IS NOT PORTED, named so it is not mistaken for finished. Evolution does not exist
## anywhere in this port -- `evolveLevel` is unread, a registered gap -- so the evolved
## `chainCount + 2` and the evolved `Math.min(3, targets.length)` strikes have no branch
## here: the original's non-evolved `strikes = 1` is what this reproduces. The port used
## to pass a `projectileCount`-derived `count` in and hit TWO foes at weapon level 3,
## which is a different weapon from the original's one smite followed by a chain.
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
	rng: RandomNumberGenerator
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
	var struck: Foe = targets[_pick_index(rng, targets.size())]
	struck.take_damage(dmg)
	hits.append({"foe": struck, "sparks": 14})

	if not bool(weapon.get("chain", false)) or level < CHAIN_LEVEL:
		return hits

	var chained: Array = [struck]
	var current: Foe = struck
	for _hop in int(weapon.get("chainCount", 0)):
		var nearest: Foe = null
		var min_d := CHAIN_RADIUS
		for foe in foes:
			if foe.dead or chained.has(foe):
				continue
			var hx: float = foe.x - current.x
			var hy: float = foe.y - current.y
			var d: float = sqrt(hx * hx + hy * hy)
			# `d < 180 && d < minD`, with `minD` started AT the radius rather than at
			# Infinity: the same candidate set, one comparison instead of two. STRICT, so
			# a foe at exactly 180px is NOT chained -- `verify_weapons.gd` pins that.
			if d < min_d:
				min_d = d
				nearest = foe
		if nearest == null:
			break
		nearest.take_damage(dmg * CHAIN_DAMAGE)
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
## Returns the foes it struck, because `_fireDrain` draws its hit AT the foe -- its two
## sparks are at the tether's midpoint -- and a caller cannot draw that from a count.
static func _strike_nearest(hero: Hero, foes: Array, reach: float, dmg: float, count: int) -> Array:
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
		in_range[i]["foe"].take_damage(dmg)
		struck.append(in_range[i]["foe"])
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
