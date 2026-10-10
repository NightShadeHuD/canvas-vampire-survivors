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
## The XP curve, ported from `Player.gainExp` in `src/entities.ts`.
var exp := 0
var level := 1
var exp_to_next := 50.0
var weapons: Array = []
## Passives are COUNTS, not objects -- "x3 of Armor" is the whole state.
var passives: Dictionary = {}

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

## Gain experience and level up for as long as the bar is full.
##
## Returns how many levels were gained, because ONE orb can grant several and the
## caller owes the player a pick for each. The original returns an array of the new
## levels for the same reason.
##
## The heal on level is the original's: `hp = min(hp + 20, maxHp)`.
func gain_exp(amount: float) -> int:
	exp += amount
	var gained := 0
	while exp >= exp_to_next:
		exp -= exp_to_next
		level += 1
		exp_to_next = floor(exp_to_next * 1.2)
		hp = minf(hp + 20.0, max_hp)
		gained += 1
	return gained

func has_weapon(id: String) -> bool:
	for w in weapons:
		if w["id"] == id:
			return true
	return false

func weapon_level(id: String) -> int:
	for w in weapons:
		if w["id"] == id:
			return int(w["level"])
	return 0

func passive_count(id: String) -> int:
	return int(passives.get(id, 0))

## Returns false at the cap, so a caller cannot stack past `PASSIVE_MAX_STACK`.
func add_passive(id: String) -> bool:
	var n := passive_count(id)
	if n >= int(Config.PASSIVE_MAX_STACK):
		return false
	passives[id] = n + 1
	return true

func add_weapon(def: Dictionary) -> void:
	weapons.append({"id": def["id"], "def": def, "level": 1})

## Raise a weapon the hero already holds. Returns false if it is at the cap.
func level_weapon(id: String) -> bool:
	for w in weapons:
		if w["id"] == id:
			if int(w["level"]) >= int(Config.WEAPON_MAX_LEVEL):
				return false
			w["level"] = int(w["level"]) + 1
			return true
	return false

func tick(delta: float) -> void:
	if invincible_timer > 0.0:
		invincible_timer -= delta
		if invincible_timer <= 0.0:
			invincible_timer = 0.0
			invincible = false
