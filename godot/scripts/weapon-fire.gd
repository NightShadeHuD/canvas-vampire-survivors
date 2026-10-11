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

## Fire one weapon. Returns the shots it created, which the caller owns.
##
## `nearest` is the foe to aim at, or null. A projectile with no target is not fired
## rather than fired at nothing -- the original does the same, and a knife thrown into
## empty space reads as a bug to the player.
static func fire(
	weapon: Dictionary, hero: Hero, foes: Array, shots: Array
) -> Array:
	var created: Array = []
	var kind: String = str(weapon["type"])
	var dmg := float(weapon["baseDamage"])
	var reach := float(weapon["baseRange"])
	var count: int = int(weapon.get("projectileCount", 1))

	match kind:
		"projectile":
			created = _fire_projectiles(weapon, hero, foes, reach, dmg, count)
		"orbit":
			created = _fire_orbit(hero, reach, dmg, count)
		"melee":
			_strike_all_in_range(hero, foes, reach, dmg)
		"aura":
			_strike_all_in_range(hero, foes, reach, dmg)
		"nova":
			_strike_all_in_range(hero, foes, reach, dmg)
		"instant":
			_strike_nearest(hero, foes, reach, dmg, count)
		"drain":
			_strike_nearest(hero, foes, reach, dmg, count)
			# Soul Drain heals on tick -- `lifestealPct` is on the data.
			var pct: float = float(weapon.get("lifestealPct", 0.0))
			if pct > 0.0:
				hero.hp = minf(hero.hp + dmg * pct, hero.max_hp)
		"mine":
			# A mine this slice treats as a delayed nova: the fuse is real in the data
			# and the arming behaviour is not ported, so it strikes immediately rather
			# than pretending to arm. Named here so it is not mistaken for finished.
			_strike_all_in_range(hero, foes, reach, dmg)
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

## Everything within `reach`. Whip, Garlic and Frost Nova all land here -- what
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
static func _strike_nearest(hero: Hero, foes: Array, reach: float, dmg: float, count: int) -> void:
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
	for i in mini(count, in_range.size()):
		in_range[i]["foe"].take_damage(dmg)

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
