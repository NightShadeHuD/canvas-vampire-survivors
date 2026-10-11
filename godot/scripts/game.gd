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
var orbs: Array[Orb] = []
## Levels gained but not yet spent on a pick. The run PAUSES while this is non-zero,
## which is what makes a level-up a decision rather than a notification.
var pending_picks := 0
## Set by the view when it has an offer on screen, so the sim does not run on.
var awaiting_pick := false
## Seconds until the next spawn.
var spawn_timer := 0.0
## One cooldown PER WEAPON, keyed by id. A single shared timer would throttle a fast
## knife to whatever the slowest weapon the hero holds happens to be.
var cooldowns: Dictionary = {}
## Shots in flight. Friendly and hostile are separate lists because they hit opposite
## sides -- one list with a flag would need every resolve to know which way round it is.
var shots: Array[Shot] = []
var enemy_shots: Array[Shot] = []
## Foes created DURING a step -- split children, clones. Collected here and appended
## after the loop, because appending to `foes` while iterating it is how a for loop
## over a growing array skips entries.
var spawned: Array[Foe] = []
var elapsed := 0.0
var kills := 0
var weapon: Dictionary
var foe_def: Dictionary
## Lifetime totals from a previous session, which `triple_build` reads.
##
## A Dictionary rather than a typed save object: nothing in the slice persists yet, and
## a field that is always empty is more honest than a save system that only exists to
## satisfy one achievement. `null` means "no save", which `_unique_builds` handles.
var save: Variant = null

## `spawn_interval` and the rest are the slice's own pacing, NOT ported constants --
## the original tunes waves through `stages.ts`, which is out of scope here. They are
## named as a parameter so the tests can drive a deterministic rate.
func _init(spawn_interval: float = 0.8) -> void:
	hero = Hero.new(Config.ARENA_WIDTH / 2.0, Config.ARENA_HEIGHT / 2.0)
	weapon = Weapons.WEAPONS["GARLIC"]
	# Every survivor run starts with one weapon. Which one is a real choice in the
	# original; the slice gives Garlic, matching the first version of this port.
	hero.add_weapon(weapon)
	foe_def = Enemies.ENEMIES["BAT"]
	_spawn_interval = spawn_interval
	# START at the interval, not at zero. `spawn_timer` used to begin at 0, so the first
	# `step` spawned immediately -- which meant `Game.new(999.0)`, the obvious way to say
	# "do not spawn", still produced one foe. Two tests were written against that
	# surprise in a single round. An interval of 999s now means the first spawn is in
	# 999s, which is what it always read as.
	spawn_timer = spawn_interval
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

	for w in hero.weapons:
		var id: String = w["id"]
		# Cooldown passive. `cooldownMult` is NEGATIVE in the data (-0.08), so
		# `1 + effect` is 0.92 and a stack genuinely shortens the timer.
		var cd := float(w["def"]["baseCooldown"]) * hero.cooldown_mult()
		var left := float(cooldowns.get(id, 0.0)) - delta
		if left <= 0.0:
			left = cd
			WeaponFire.fire(w["def"], hero, foes, shots)
		cooldowns[id] = left

	for foe in foes:
		if not foe.dead:
			foe.chase(hero.x, hero.y, delta)
			# Archetypes SIGNAL; the Game acts. A foe cannot spawn its own siblings or
			# damage the hero without reaching back into the world it lives in, and a
			# foe that owns a reference to the Game is a cycle waiting to happen.
			if foe.wants_to_fire:
				foe.wants_to_fire = false
				_hostile_shot(foe)
			if foe.wants_clone:
				foe.wants_clone = false
				_spawn_clones(foe)
			if foe.exploded:
				foe.exploded = false
				_explode(foe)
			# Contact damage. `take_damage` owns the i-frame rule, so this can be
			# called every frame without the hero melting.
			var dx := foe.x - hero.x
			var dy := foe.y - hero.y
			if sqrt(dx * dx + dy * dy) < foe.size + hero.size:
				hero.take_damage(foe.damage)

	_update_shots(delta)
	_update_enemy_shots(delta)
	_update_orbs(delta)
	_remove_dead()
	# Children and clones join AFTER the passes above, so nothing iterates an array it
	# is appending to.
	#
	# THE CAP APPLIES HERE TOO. `_spawn_foe` checks `MAX_ENEMIES`, but a split or a
	# clone bypassed that check entirely and the population went past it -- found by the
	# invariant fuzzer at 302 foes against a cap of 300, ten minutes into a run.
	# A cap that the second spawn path ignores is not a cap.
	for child in spawned:
		if foes.size() >= int(Config.MAX_ENEMIES):
			break
		foes.append(child)
	spawned.clear()

## A Game that never spawns, for a test that drives one foe at a time.
##
## Named rather than passing a large interval, because the intent of `Game.new(999.0)`
## is invisible at the call site -- and it was WRONG until the timer started at the
## interval rather than at zero, so the "obvious" way to disable spawning still produced
## a foe. Two tests were written against that surprise in a single round.
static func without_spawns() -> Game:
	var g := Game.new()
	# `_spawn_interval` is what `step` re-arms to, so INFINITY is a stronger guarantee
	# than a large number -- nothing can accidentally land past it.
	g._spawn_interval = INF
	g.spawn_timer = INF
	return g

## Spawn on a ring outside the view, so foes walk IN rather than appearing beside the
## hero. The original does this through `SPAWN_RADIUS` and so does this.
func _spawn_foe() -> void:
	var angle := randf() * TAU
	var r := Config.SPAWN_RADIUS
	# The wave picks WHICH foe; the curve decides how tough it is.
	var pool: Array = current_wave["pool"]
	var def: Dictionary = _foe_def(pool[randi() % pool.size()])
	foes.append(Foe.new(def, hero.x + cos(angle) * r, hero.y + sin(angle) * r, hp_mult(), dmg_mult()))

## Every shot in flight: move it, then let it hit what it touches.
##
## `bounce_off_walls` is not a thing in this game -- a shot that leaves the arena is
## simply gone, which is what the original does too.
func _update_shots(delta: float) -> void:
	var kept: Array[Shot] = []
	for shot in shots:
		# Orbit shards are placed relative to the hero, so they need it every frame.
		shot.update(delta, hero.x, hero.y, hero.x, hero.y)
		if not shot.dead:
			shot.resolve(foes, Callable())
		if not shot.dead:
			kept.append(shot)
	shots = kept

## Hostile shots: move, then hit the HERO. Separate from `_update_shots` because the
## target is the other side, and a shared routine would need a flag that every line
## then has to respect.
func _update_enemy_shots(delta: float) -> void:
	var kept: Array[Shot] = []
	for shot in enemy_shots:
		shot.update(delta, hero.x, hero.y, hero.x, hero.y)
		if not shot.dead and not hero.dead:
			var dx: float = hero.x - shot.x
			var dy: float = hero.y - shot.y
			if sqrt(dx * dx + dy * dy) <= shot.radius + hero.size:
				hero.take_damage(shot.damage)
				shot.dead = true
		if not shot.dead:
			kept.append(shot)
	enemy_shots = kept

## Superseded by `WeaponFire`, which dispatches on the weapon's archetype. Kept only
## as the aura case it always was -- see `WeaponFire._strike_all_in_range`.
func _unused_attack() -> void:
	# Every weapon the hero holds fires on its own cooldown. A weapon picked at
	# level-up changes this loop and nothing else, which is the point of keeping
	# `weapons` on the hero rather than a single `weapon` field.
	for w in hero.weapons:
		var def: Dictionary = w["def"]
		var reach := float(def["baseRange"])
		var dmg := float(def["baseDamage"])
		for foe in foes:
			if foe.dead:
				continue
			var dx := foe.x - hero.x
			var dy := foe.y - hero.y
			if sqrt(dx * dx + dy * dy) <= reach:
				foe.take_damage(dmg)

## Collection. The orb decides whether it was taken; this banks it and counts the
## levels, because a single big orb can grant more than one.
func _update_orbs(delta: float) -> void:
	var kept: Array[Orb] = []
	for orb in orbs:
		orb.update(delta, hero)
		if orb.collected:
			pending_picks += hero.gain_exp(float(orb.value))
		elif not orb.expired:
			kept.append(orb)
	orbs = kept

## A mage's bolt. Reuses `Shot`, which is why `Shot` was written as one class: a
## hostile projectile and a friendly one differ by which list they hit.
func _hostile_shot(foe: Foe) -> void:
	var spd := float(foe.def.get("projectileSpeed", 220.0))
	var dmg := float(foe.def.get("projectileDamage", 14.0))
	var dir := Vector2(hero.x - foe.x, hero.y - foe.y).normalized()
	enemy_shots.append(Shot.new(foe.x, foe.y, dir, dmg, 900.0, spd, false))

## The `count` clones an illusionist makes, scattered around itself.
func _spawn_clones(foe: Foe) -> void:
	var count := int(foe.def.get("cloneCount", 2))
	for i in count:
		var angle := TAU * float(i) / float(maxi(count, 1)) + randf()
		var clone := Foe.new(foe.def, foe.x + cos(angle) * 30.0, foe.y + sin(angle) * 30.0, hp_mult(), dmg_mult())
		# A clone is worth nothing, so cloning cannot be farmed for experience. The
		# original does this and without it an illusionist is an XP fountain.
		clone.exp_value = 0
		clone.is_clone = true
		# `spawned`, NOT `foes`. Two bugs lived in this one line: appending to `foes`
		# while `step` is iterating it, and bypassing the cap check that only the
		# `spawned` path performs. Found by the invariant fuzzer at 302 foes against a
		# cap of 300 -- and the fuzzer only saw the second, because the first is a
		# silently skipped foe rather than a number out of range.
		spawned.append(clone)

## A bomber's blast: everything in `blastRadius` takes `blastDamage`, INCLUDING the
## hero. A bomber that only hurt enemies would be a gift.
func _explode(foe: Foe) -> void:
	var radius := float(foe.def.get("blastRadius", 120.0))
	var blast := float(foe.def.get("blastDamage", 40.0))
	for other in foes:
		if other == foe or other.dead:
			continue
		var dx: float = other.x - foe.x
		var dy: float = other.y - foe.y
		if sqrt(dx * dx + dy * dy) <= radius:
			other.take_damage(blast)
	var hx: float = hero.x - foe.x
	var hy: float = hero.y - foe.y
	if sqrt(hx * hx + hy * hy) <= radius:
		hero.take_damage(blast)

## A slime becomes `splitCount` of `splitInto`, at the spot it died.
##
## Children are spawned ONCE -- a slimeling that could split again would recurse
## forever, and `splitInto` points at an id with no `splitter` flag precisely so it
## does not.
func _split(foe: Foe) -> void:
	if not foe.def.has("splitInto") or foe.def.get("splitter", false) == false:
		return
	var into := str(foe.def["splitInto"])
	var count := int(foe.def.get("splitCount", 2))
	var child_def: Dictionary = _foe_def(into)
	for i in count:
		var angle := TAU * float(i) / float(maxi(count, 1))
		spawned.append(
			Foe.new(child_def, foe.x + cos(angle) * 18.0, foe.y + sin(angle) * 18.0, hp_mult(), dmg_mult())
		)

func _remove_dead() -> void:
	var survivors: Array[Foe] = []
	for foe in foes:
		if foe.dead:
			# A bomber's death IS its attack, so it does not also drop experience.
			if foe.archetype != "bomber":
				kills += 1
			_split(foe)
			# Every kill drops its experience where it fell. `exp_value` comes from
			# the enemy table, so a golem is worth more than a bat by data, not code.
			orbs.append(Orb.new(foe.x, foe.y, foe.exp_value))
		else:
			survivors.append(foe)
	foes = survivors
