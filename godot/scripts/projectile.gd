## Anything a weapon puts into the world: a wand bolt, a knife, a boomerang, an
## orbiting shard.
##
## ONE class rather than five, because the differences are all fields: a knife is a
## fast piercing projectile, a boomerang is one that turns around, an orbit shard is
## one whose position is computed rather than integrated. Splitting them would
## duplicate the collision and lifetime logic five times.
##
## Ported from `Projectile` and `OrbitShard` in `src/entities.ts`.
extends RefCounted
class_name Shot

enum Kind { STRAIGHT, ORBIT, BOOMERANG }

var x: float
var y: float
var vx := 0.0
var vy := 0.0
var damage: float
var radius: float
var pierce: bool
var kind: int = Kind.STRAIGHT
var life: float
var dead := false
## Which foes this shot has already hit, so `pierce` means "hits several" rather
## than "hits the same one every frame".
var hit: Array = []
## Boomerangs fly out until `life` falls below this, then come back.
var return_after := 0.0
## Orbit shards are placed, not integrated.
var orbit_angle := 0.0
var orbit_radius := 0.0
var orbit_speed := 0.0

func _init(
	at_x: float, at_y: float, dir: Vector2, shot_damage: float,
	reach: float, speed: float, can_pierce: bool
) -> void:
	x = at_x
	y = at_y
	damage = shot_damage
	pierce = can_pierce
	vx = dir.x * speed
	vy = dir.y * speed
	radius = 6.0
	# `reach / speed` is how long it takes to cross its own range, which is a better
	# lifetime than a fixed number: a slow knife and a fast bolt both stop where the
	# data says they should.
	life = maxf(reach / maxf(speed, 1.0), 0.1)

## A shard that circles the hero. Its position is a function of the angle, so it
## cannot drift the way an integrated one would.
static func orbiting(hero_x: float, hero_y: float, angle: float, radius: float, shot_damage: float, speed: float) -> Shot:
	var s := Shot.new(hero_x + cos(angle) * radius, hero_y + sin(angle) * radius, Vector2.ZERO, shot_damage, 0.0, 0.0, true)
	s.kind = Kind.ORBIT
	s.orbit_angle = angle
	s.orbit_radius = radius
	s.orbit_speed = speed
	# Orbiting shards die with the weapon's cooldown, not on a range.
	s.life = 1.0
	return s

func update(delta: float, hero_x: float, hero_y: float, origin_x: float, origin_y: float) -> void:
	life -= delta
	if life <= 0.0:
		dead = true
		return

	match kind:
		Kind.ORBIT:
			orbit_angle += orbit_speed * delta
			x = hero_x + cos(orbit_angle) * orbit_radius
			y = hero_y + sin(orbit_angle) * orbit_radius
		Kind.BOOMERANG:
			# OUT first, then back. The first version reversed on frame one, so the
			# throw travelled zero distance and looked like a weapon that did nothing
			# -- which is exactly how it was found.
			#
			# The return leg aims at the THROWER'S SPOT, not at the hero. That is the
			# original's behaviour and it reads better: walk away and the shard returns
			# to where you were, not to where you are.
			if life > return_after:
				x += vx * delta
				y += vy * delta
				return
			var dx: float = origin_x - x
			var dy: float = origin_y - y
			var d: float = sqrt(dx * dx + dy * dy)
			if d < 24.0:
				dead = true
				return
			var speed: float = sqrt(vx * vx + vy * vy)
			x += (dx / d) * speed * delta
			y += (dy / d) * speed * delta
		_:
			x += vx * delta
			y += vy * delta

## Apply this shot to any foe it is touching. Returns how many it hit.
func resolve(foes: Array, drop: Callable) -> int:
	var hits := 0
	for foe in foes:
		if foe.dead or hit.has(foe):
			continue
		var dx: float = foe.x - x
		var dy: float = foe.y - y
		if sqrt(dx * dx + dy * dy) <= radius + foe.size:
			foe.take_damage(damage)
			hit.append(foe)
			hits += 1
			if not pierce:
				dead = true
				return hits
	if hits > 0 and drop.is_valid():
		drop.call(self)
	return hits
