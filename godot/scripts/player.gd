## The hero.
##
## A plain RefCounted, NOT a Node. The original kept its game logic out of the DOM
## for exactly this reason, and the same separation buys the same thing here: the
## simulation can be stepped and asserted without a SceneTree, a window or a frame
## clock. `main.gd` is the only file that knows this is drawn.
##
## Values come from CONFIG, which is GENERATED from `src/config.ts`. Nothing in this
## file is a guess.
extends RefCounted
class_name Hero

var x: float
var y: float
var hp: float
var max_hp: float
var size: float
var speed: float
var dead := false
## Counts down, so a hero standing in a crowd is not deleted in one frame.
var invincible_timer := 0.0
var invincible := false

func _init(start_x: float, start_y: float) -> void:
	x = start_x
	y = start_y
	max_hp = Config.HERO_MAX_HP
	hp = max_hp
	size = Config.PLAYER_SIZE
	speed = Config.PLAYER_SPEED

## Move by a direction vector. The vector is normalised so a diagonal is not faster
## -- the classic bug, and the original normalises for the same reason.
func move(dir: Vector2, delta: float) -> void:
	if dir.length() > 0.0:
		var d := dir.normalized()
		x += d.x * speed * delta
		y += d.y * speed * delta

## Clamp to the arena. Boundaries get pinned on and one past the edge in the tests.
func clamp_to(width: float, height: float) -> void:
	x = clampf(x, size, width - size)
	y = clampf(y, size, height - size)

func take_damage(amount: float) -> void:
	if dead or invincible:
		return
	hp -= amount
	invincible_timer = Config.INVINCIBILITY_TIME
	invincible = true
	if hp <= 0.0:
		hp = 0.0
		dead = true

func tick(delta: float) -> void:
	if invincible_timer > 0.0:
		invincible_timer -= delta
		if invincible_timer <= 0.0:
			invincible_timer = 0.0
			invincible = false
