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
static func fire(
	weapon: Dictionary, hero: Hero, foes: Array, shots: Array, level: int = 1, fx: Fx = null
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
			# TWO THINGS THE ORIGINAL DOES THAT THIS DOES NOT, named so neither is
			# mistaken for finished. `_fireInstant` picks a RANDOM foe from those in range
			# (`targets[Math.floor(Math.random() * targets.length)]`) -- its own data
			# description is "Smites a random foe" -- and from weapon level 3 hops
			# `chainCount` more times, 180px at a time, for 70% damage. This strikes the
			# NEAREST and never chains. Reported, not changed: `verify_weapons.gd` asserts
			# the nearest-target behaviour that is here.
			var struck := _strike_nearest(hero, foes, reach, dmg, count)
			if fx != null:
				# `createParticles(target.x, target.y, '#ffff66', 14)` runs INSIDE the
				# original's strike loop, so a chain of three gets three bursts and the
				# player can see which foes were hit.
				for foe in struck:
					fx.emit_particles(foe.x, foe.y, Color("ffff66"), 14)
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

## The `count` CLOSEST foes within `reach`. Lightning needs this and so does Soul
## Drain: both are described as hitting the nearest, and hitting the furthest would be
## a different weapon.
##
## Returns the foes it struck, because both of those weapons draw their hit AT the foe --
## `_fireInstant` bursts where the bolt landed and `_fireDrain` streaks to the midpoint of
## the tether -- and a caller cannot draw that from a count.
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
