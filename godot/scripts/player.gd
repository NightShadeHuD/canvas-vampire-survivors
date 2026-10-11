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
## Passives, keyed by id, holding the DEF and the count.
##
## The first version stored a bare count, which cannot compute anything -- an effect
## lives on the def, so "x3 of Armor" with no def is a number with no meaning. The bug
## was invisible because nothing read the counts yet.
var passives: Dictionary = {}
## Cached totals, recomputed when a passive is taken rather than every frame.
var _base_max_hp := 100.0

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
		# Swiftness multiplies SPEED rather than the step, so the normalisation above
		# still holds and a diagonal stays the same length as a straight line.
		var step := speed * speed_mult() * delta
		x += d.x * step
		y += d.y * step

## Clamp to the arena. Boundaries get pinned on and one past the edge in the tests.
func clamp_to(width: float, height: float) -> void:
	x = clampf(x, size, width - size)
	y = clampf(y, size, height - size)

## Dodge, then armor, then damage reduction -- the original's order, and the order
## matters: a dodged hit must not be reduced to zero, it must not land at all.
##
## Returns what happened, so a caller can show it.
func take_damage(amount: float) -> String:
	if dead or invincible:
		return "ignored"
	# `-=` the original: a dodged hit also does not burn an i-frame window.
	var dodge := dodge_chance()
	if dodge > 0.0 and randf() < dodge:
		return "dodged"

	var taken := amount
	taken -= armor()
	taken *= 1.0 - damage_reduction()
	# Floored at 1, so a tanky build cannot become literally immortal. The original
	# does this and it is the difference between a good build and a broken one.
	taken = maxf(taken, 1.0)

	hp -= taken
	invincible_timer = Config.INVINCIBILITY_TIME
	invincible = true
	if hp <= 0.0:
		hp = 0.0
		dead = true
	return "hit"

## Gain experience and level up for as long as the bar is full.
##
## Returns how many levels were gained, because ONE orb can grant several and the
## caller owes the player a pick for each. The original returns an array of the new
## levels for the same reason.
##
## The heal on level is the original's: `hp = min(hp + 20, maxHp)`.
func gain_exp(amount: float) -> int:
	exp += amount * exp_mult()
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
	if not passives.has(id):
		return 0
	return int(passives[id]["count"])

## Returns false at the cap, so a caller cannot stack past `PASSIVE_MAX_STACK`.
func add_passive(def: Dictionary) -> bool:
	var id: String = def["id"]
	if passive_count(id) >= int(Config.PASSIVE_MAX_STACK):
		return false
	if passives.has(id):
		passives[id]["count"] = passive_count(id) + 1
	else:
		passives[id] = {"def": def, "count": 1}
	_recompute()
	return true

## Additive effects: `armor`, `hpRegen`, `critChance`. Summed, scaled by count.
##
## Ported from `Player._passiveSum`.
func passive_sum(key: String) -> float:
	var total := 0.0
	for id in passives:
		var e: Dictionary = passives[id]["def"].get("effect", {})
		if e.has(key):
			total += float(e[key]) * float(passives[id]["count"])
	return total

## Multiplicative effects: `damageMult`, `areaMult`, `speedMult`. COMPOUNDED per
## stack -- two Armor passives are `1.2 * 1.2`, not `1.4` -- which is the original's
## behaviour and the difference between a passive that scales and one that does not.
##
## Ported from `Player._passiveMult`.
func passive_mult(key: String) -> float:
	var mult := 1.0
	for id in passives:
		var e: Dictionary = passives[id]["def"].get("effect", {})
		if e.has(key):
			mult *= pow(1.0 + float(e[key]), float(passives[id]["count"]))
	return mult

## Everything a passive can change, read through one place.
func damage_mult() -> float: return passive_mult("damageMult")
func area_mult() -> float: return passive_mult("areaMult")
func speed_mult() -> float: return passive_mult("speedMult")
func exp_mult() -> float: return passive_mult("expMult")
func cooldown_mult() -> float: return passive_mult("cooldownMult")
func magnet_mult() -> float: return passive_mult("magnetMult")

func max_hp_mult() -> float: return passive_mult("maxHpMult")
func armor() -> float: return passive_sum("armor")
func dodge_chance() -> float: return passive_sum("dodgeChance")
func crit_chance() -> float: return passive_sum("critChance")
func hp_regen() -> float: return passive_sum("hpRegen")
func damage_reduction() -> float: return passive_sum("damageReduction")
func magnet_range() -> float: return float(Config.MAGNET_BASE) * magnet_mult()

## Vitality raises the CEILING and heals by the same amount, so taking it is not a
## downgrade -- the original raises both together.
func _recompute() -> void:
	var before := max_hp
	max_hp = _base_max_hp * max_hp_mult()
	hp = minf(hp + maxf(max_hp - before, 0.0), max_hp)

## Give the hero a weapon, or LEVEL the one they already hold.
##
## The first version appended unconditionally, so calling it twice created two copies
## of the same weapon at level 1 -- and `has_weapon` then reported the first, so the
## second was invisible state that the level-up screen could still offer. Found by the
## invariant fuzzer asking what a fully-maxed hero is offered, not by any behavioural
## test: every one of those went through `Upgrades.apply`, which checks first.
func add_weapon(def: Dictionary) -> void:
	var id: String = def["id"]
	if has_weapon(id):
		level_weapon(id)
		return
	weapons.append({"id": id, "def": def, "level": 1})

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
	# Recovery. Applied before the i-frame countdown so a hero healing through a fight
	# is not gated on being out of invincibility.
	var regen := hp_regen()
	if regen > 0.0 and not dead:
		hp = minf(hp + regen * delta, max_hp)

	if invincible_timer > 0.0:
		invincible_timer -= delta
		if invincible_timer <= 0.0:
			invincible_timer = 0.0
			invincible = false
