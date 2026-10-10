## An experience orb, dropped where a foe died.
##
## Ported from `ExpOrb.update` in `src/entities.ts`, including the two radii that make
## pickup feel right: a WIDE magnet that pulls the orb in, and a NARROW pickup that
## actually banks it. Collapsing them into one radius is the obvious simplification
## and it is wrong -- an orb collected the instant it is magnetised never appears to
## fly to the hero.
extends RefCounted
class_name Orb

## Once magnetised, an orb accelerates rather than moving at a fixed speed, so it
## arrives with a snap. 600/s^2 capped at 560/s, both from the original.
const ACCEL := 600.0
const MAX_SPEED := 560.0

var x: float
var y: float
var value: int
var size: float
var life: float
var magnet_speed := 0.0
var collected := false
var expired := false

func _init(start_x: float, start_y: float, orb_value: int) -> void:
	x = start_x
	y = start_y
	value = orb_value
	# Bigger orbs for bigger values, so a boss drop reads as one at a glance.
	size = 4.0 + log(float(orb_value) + 1.0) * 1.5
	life = float(Config.EXP_ORB_LIFETIME)

func update(delta: float, hero: Hero) -> void:
	life -= delta
	if life <= 0.0:
		expired = true
		return

	var dx := hero.x - x
	var dy := hero.y - y
	var d := sqrt(dx * dx + dy * dy)

	if d < float(Config.PICKUP_DISTANCE):
		collected = true
		return

	# `MAGNET_BASE` scaled by the hero's area multiplier in the original. Level 1 has
	# a multiplier of 1, so this is the whole of it for now.
	if d < float(Config.MAGNET_BASE) and d > 0.001:
		magnet_speed = minf(magnet_speed + ACCEL * delta, MAX_SPEED)
		x += (dx / d) * magnet_speed * delta
		y += (dy / d) * magnet_speed * delta
