## The simulation: hero, foes, spawning, and one weapon.
##
## Deliberately headless. This file never touches `_draw`, `_process` or the
## SceneTree, so `verify_slice.gd` can step a thousand frames in a few milliseconds
## and assert what happened. `main.gd` is the only thing that renders it.
##
## Spawning and the weapon come from the GENERATED tables in `godot/data/`.
extends RefCounted
class_name Game

var hero: Hero
var foes: Array[Foe] = []
## Seconds until the next spawn / the next weapon tick.
var spawn_timer := 0.0
var attack_timer := 0.0
var elapsed := 0.0
var kills := 0
var weapon: Dictionary
var foe_def: Dictionary

## `spawn_interval` and the rest are the slice's own pacing, NOT ported constants --
## the original tunes waves through `stages.ts`, which is out of scope here. They are
## named as a parameter so the tests can drive a deterministic rate.
func _init(spawn_interval: float = 0.8) -> void:
	hero = Hero.new(Config.ARENA_WIDTH / 2.0, Config.ARENA_HEIGHT / 2.0)
	weapon = Weapons.WEAPONS["GARLIC"]
	foe_def = Enemies.ENEMIES["BAT"]
	_spawn_interval = spawn_interval
	current_wave = wave_for(0.0)

var _spawn_interval: float
## The difficulty curve, from the original's `_computeDifficultyMults`.
var diff: Dictionary = Difficulty.NORMAL
var current_wave: Dictionary

## `timeDiff = 1 + floor(gameTime / 60) * 0.3`. Enemies gain 30% health every minute,
## which is what eventually outruns any weapon -- and the reason a hero alone with
## Garlic cannot survive forever.
func hp_mult() -> float:
	return float(diff["hpMult"]) * (1.0 + floor(elapsed / 60.0) * 0.3)

func dmg_mult() -> float:
	return float(diff["dmgMult"]) * (1.0 + floor(elapsed / 60.0) * 0.3)

## The wave whose time range covers `elapsed`. The last wave has no upper bound, so
## this always returns something -- there is no "no wave" state to fall through.
func wave_for(t: float) -> Dictionary:
	for w in Waves.WAVES:
		if t >= float(w["from"]) and (w["to"] == null or t < float(w["to"])):
			return w
	return Waves.WAVES.back()

## The definition for an id from a wave pool.
##
## Looked up by the def's OWN `id` field, not by the dictionary key. The pool holds
## `"bat"` and `ENEMIES` is keyed `"BAT"`, and matching on a key would have been a
## guess about casing that happens to be wrong -- `src/data.ts` carries an explicit
## `id` on every def precisely so nothing has to infer one.
func _foe_def(foe_id: String) -> Dictionary:
	for def in Enemies.ENEMIES.values():
		if def["id"] == foe_id:
			return def
	push_warning("no enemy def for id '%s'" % foe_id)
	return Enemies.ENEMIES.values()[0]

## Step the whole simulation. Order matters and is the original's: move, spawn,
## attack, resolve, then clean up.
func step(delta: float, move_dir: Vector2) -> void:
	elapsed += delta
	hero.tick(delta)
	hero.move(move_dir, delta)
	hero.clamp_to(Config.ARENA_WIDTH, Config.ARENA_HEIGHT)

	# The wave is recomputed every step because it changes with TIME, and a slice that
	# picked it once would spawn opening-wave foes for ten minutes.
	current_wave = wave_for(elapsed)
	spawn_timer -= delta
	if spawn_timer <= 0.0 and foes.size() < Config.MAX_ENEMIES:
		# Faster later, and faster still on a harder difficulty -- `spawnMult` is a
		# real field of both the wave and the difficulty row.
		var mult := float(current_wave["spawnMult"]) * float(diff["spawnMult"])
		spawn_timer = _spawn_interval / maxf(mult, 0.05)
		_spawn_foe()

	attack_timer -= delta
	if attack_timer <= 0.0:
		attack_timer = weapon["baseCooldown"]
		_attack()

	for foe in foes:
		if not foe.dead:
			foe.chase(hero.x, hero.y, delta)
			# Contact damage. `take_damage` owns the i-frame rule, so this can be
			# called every frame without the hero melting.
			var dx := foe.x - hero.x
			var dy := foe.y - hero.y
			if sqrt(dx * dx + dy * dy) < foe.size + hero.size:
				hero.take_damage(foe.damage)

	_remove_dead()

## Spawn on a ring outside the view, so foes walk IN rather than appearing beside the
## hero. The original does this through `SPAWN_RADIUS` and so does this.
func _spawn_foe() -> void:
	var angle := randf() * TAU
	var r := Config.SPAWN_RADIUS
	# The wave picks WHICH foe; the curve decides how tough it is.
	var pool: Array = current_wave["pool"]
	var def: Dictionary = _foe_def(pool[randi() % pool.size()])
	foes.append(Foe.new(def, hero.x + cos(angle) * r, hero.y + sin(angle) * r, hp_mult(), dmg_mult()))

## The slice's one weapon: a damaging aura around the hero, which is what GARLIC is.
## `baseRange` and `baseDamage` are the real values from the generated table.
func _attack() -> void:
	for foe in foes:
		if foe.dead:
			continue
		var dx := foe.x - hero.x
		var dy := foe.y - hero.y
		if sqrt(dx * dx + dy * dy) <= weapon["baseRange"]:
			foe.take_damage(weapon["baseDamage"])

func _remove_dead() -> void:
	var survivors: Array[Foe] = []
	for foe in foes:
		if foe.dead:
			kills += 1
		else:
			survivors.append(foe)
	foes = survivors
