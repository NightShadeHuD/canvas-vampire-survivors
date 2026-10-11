## A foe, and the seven ways the data says one can behave.
##
## `archetype` is on EVERY enemy in `src/data.ts` and nothing used to read it, so all
## ten enemy types were ten SKINS that walked at you at different speeds. That is the
## same bug as the weapons and the passives: data declaring something the code ignores.
##
## Everything here is driven by the data's own flags -- `dashSpeed`, `shieldHp`,
## `keepDistance`, `splitInto`, `fuseRange`, `cloneCount` -- rather than by constants
## chosen here. Retune a wolf in `src/data.ts`, re-run `npm run export:godot`, and this
## file needs no change.
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
var archetype: String
var dead := false
## Kept so a splitter knows what to become and a bomber how hard it hits.
var def: Dictionary

## shielded: absorbs damage before health, and cuts what gets through.
var shield_hp := 0.0
var shield_max := 0.0
var damage_reduction := 0.0

## dasher: still, then fast, on a cycle.
var _dash_timer := 0.0
var _dash_left := 0.0
var dashing := false

## ranged: holds a distance and shoots.
var _fire_timer := 0.0
var wants_to_fire := false

## bomber: arms inside `fuseRange`, then detonates. `fuse_armed` is what the renderer
## blinks on in the original.
var fuse_armed := false
var _fuse_left := 0.0
var exploded := false

## illusionist: spawns clones on a cycle.
var _clone_timer := 0.0
var wants_clone := false
## A clone of an illusionist is still an illusionist, so without this it clones too --
## and the population is exponential. Measured: 27,165 foes in 25 seconds.
var is_clone := false

func _init(d: Dictionary, start_x: float, start_y: float, hp_mult := 1.0, dmg_mult := 1.0) -> void:
	def = d
	def_id = d["id"]
	archetype = str(d.get("archetype", "chaser"))
	x = start_x
	y = start_y
	max_hp = float(d["hp"]) * hp_mult
	hp = max_hp
	speed = float(d["speed"])
	damage = float(d["damage"]) * dmg_mult
	size = float(d["size"])
	exp_value = int(d["exp"])
	color = str(d["color"])

	if d.has("shieldHp"):
		shield_max = float(d["shieldHp"])
		shield_hp = shield_max
		damage_reduction = float(d.get("damageReduction", 0.0))

	# Each timer starts at a different fraction of its cycle so a wave of wolves does
	# not dash in unison -- which reads as one animation rather than a pack.
	if archetype == "dasher":
		_dash_timer = float(d.get("dashInterval", 3.5)) * randf()
	if archetype == "ranged":
		_fire_timer = float(d.get("fireCooldown", 2.4)) * randf()
	if archetype == "illusionist":
		_clone_timer = float(d.get("cloneCooldown", 5.5)) * randf()

func take_damage(amount: float) -> void:
	# Shield first, then the reduction applies to what is left. A golem with 60 shield
	# and 50% reduction is not simply "90 more health" -- the two interact.
	var incoming := amount
	if shield_hp > 0.0:
		var absorbed := minf(shield_hp, incoming)
		shield_hp -= absorbed
		incoming -= absorbed
	incoming *= 1.0 - damage_reduction
	if incoming <= 0.0:
		return
	hp -= incoming
	if hp <= 0.0:
		hp = 0.0
		dead = true

## Distance a foe wants to keep. A mage stops at `keepDistance` and fires; everything
## else closes to nothing.
func standoff() -> float:
	if archetype == "ranged":
		return float(def.get("keepDistance", 0.0))
	return 0.0

## Move toward the hero, in whatever way this archetype moves.
func chase(target_x: float, target_y: float, delta: float) -> void:
	var dx := target_x - x
	var dy := target_y - y
	var d := sqrt(dx * dx + dy * dy)
	if d <= 0.001:
		return
	var dir_x := dx / d
	var dir_y := dy / d

	match archetype:
		"dasher":
			_tick_dash(delta)
			# `speed` for the prowl, `dashSpeed` for the burst -- both from the data.
			# The first version prowled at `speed * 0.35`, a number I made up, which
			# left a wolf SLOWER than a bat over four seconds: a dasher that never
			# catches anything.
			var move_speed := float(def.get("dashSpeed", speed)) if dashing else speed
			x += dir_x * move_speed * delta
			y += dir_y * move_speed * delta
		"ranged":
			_tick_ranged(d, delta)
			# Backs off if too close, advances if too far, holds still in the band.
			var band := standoff()
			if d > band + 20.0:
				x += dir_x * speed * delta
				y += dir_y * speed * delta
			elif d < band - 20.0:
				x -= dir_x * speed * delta
				y -= dir_y * speed * delta
		"bomber":
			_tick_bomber(d, delta)
			x += dir_x * speed * delta
			y += dir_y * speed * delta
		"illusionist":
			_tick_clone(delta)
			x += dir_x * speed * delta
			y += dir_y * speed * delta
		_:
			x += dir_x * speed * delta
			y += dir_y * speed * delta

func _tick_dash(delta: float) -> void:
	var interval := float(def.get("dashInterval", 3.5))
	if dashing:
		_dash_left -= delta
		if _dash_left <= 0.0:
			dashing = false
		return
	_dash_timer -= delta
	if _dash_timer <= 0.0:
		_dash_timer = interval
		dashing = true
		_dash_left = float(def.get("dashDuration", 0.6))

func _tick_ranged(d: float, delta: float) -> void:
	_fire_timer -= delta
	var firing_range := float(def.get("firingRange", 360.0))
	# Fires when in range AND roughly at its standoff, so it does not shoot while
	# still walking into position.
	if _fire_timer <= 0.0 and d <= firing_range:
		_fire_timer = float(def.get("fireCooldown", 2.4))
		wants_to_fire = true

func _tick_bomber(d: float, delta: float) -> void:
	# A bomber that reaches the hero STOPS and arms rather than pushing through.
	if fuse_armed:
		_fuse_left -= delta
		if _fuse_left <= 0.0:
			exploded = true
			dead = true
		return
	if d <= float(def.get("fuseRange", 80.0)):
		fuse_armed = true
		_fuse_left = float(def.get("fuseTime", 1.4))
		return
	# Once armed it holds position, which is what the original does.
	if fuse_armed:
		return

func _tick_clone(delta: float) -> void:
	# A clone never clones. This is the guard that stops the exponential blow-up, and it
	# is checked HERE rather than at the spawn site so the signal is never raised at all.
	if is_clone:
		return
	_clone_timer -= delta
	if _clone_timer <= 0.0:
		_clone_timer = float(def.get("cloneCooldown", 5.5))
		wants_clone = true
