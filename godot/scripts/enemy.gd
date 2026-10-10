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

func _init(def: Dictionary, start_x: float, start_y: float) -> void:
	def_id = def["id"]
	x = start_x
	y = start_y
	max_hp = def["hp"]
	hp = max_hp
	speed = def["speed"]
	damage = def["damage"]
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
