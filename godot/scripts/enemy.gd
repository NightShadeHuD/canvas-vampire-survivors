## A foe that walks at the hero.
##
## Stats come from the GENERATED enemy table, so `godot/data/enemies.gd` is the only
## place a bat's speed lives. Tune it in `src/data.ts` and re-run `npm run export:godot`.
extends RefCounted
class_name Foe

var x: float
var y: float
var hp: float
var max_hp: float
var speed: float
var damage: float
var size: float
var exp_value: int
var color: String
var def_id: String
var dead := false

## `hp_mult` and `dmg_mult` are the difficulty curve, applied AT SPAWN.
##
## This is what the original does and it is the whole reason the game gets hard:
## `timeDiff = 1 + floor(gameTime / 60) * 0.3`, so a foe spawned at minute three has
## 1.9x the health of one spawned at the start. Without it the first weapon holds
## forever and the hero is immortal -- measured, not assumed: 600 seconds of being
## swarmed cost exactly zero health before this existed.
func _init(def: Dictionary, start_x: float, start_y: float, hp_mult := 1.0, dmg_mult := 1.0) -> void:
	def_id = def["id"]
	x = start_x
	y = start_y
	max_hp = float(def["hp"]) * hp_mult
	hp = max_hp
	speed = def["speed"]
	damage = float(def["damage"]) * dmg_mult
	size = def["size"]
	exp_value = def["exp"]
	color = def["color"]

## Walk toward a point. `archetype` is in the data and a chaser is all this slice
## implements; anything else falls through to the same behaviour rather than
## silently standing still.
func chase(target_x: float, target_y: float, delta: float) -> void:
	var dx := target_x - x
	var dy := target_y - y
	var d := sqrt(dx * dx + dy * dy)
	if d <= 0.001:
		return
	x += (dx / d) * speed * delta
	y += (dy / d) * speed * delta

func take_damage(amount: float) -> void:
	hp -= amount
	if hp <= 0.0:
		hp = 0.0
		dead = true
