## Every weapon in the data must actually DO something.
##
## WHY THIS EXISTS
##
## The level-up screen offered eleven weapons and only Garlic had an implementation --
## so picking the Magic Wand stored it, showed it on the hero, and changed nothing.
## Nothing caught it because every test asserted the ONE weapon that worked.
##
## This drives the real data table: add each weapon to a hero, fire it at a foe that
## is in range, and require the foe to take damage. A weapon with no code fails, and
## a weapon ADDED to `src/data.ts` later fails until it is implemented -- which is the
## property that makes this worth having.
##
##   godot --headless --path godot --script res://verify_weapons.gd
extends SceneTree

const FRAME := 1.0 / 60.0
var ok := true

func _init() -> void:
	_every_weapon_damages()
	_range_is_respected()
	_pierce_hits_several_then_stops()
	_orbit_shards_circle_and_hit()
	_boomerang_comes_back()
	_drain_heals()
	_lightning_strikes_the_nearest()
	_multi_projectile_fires_a_volley()
	_cooldowns_are_per_weapon()

	print("verify_weapons: ", "PASS" if ok else "FAIL")
	quit(0 if ok else 1)

## A hero with one weapon, and a foe placed just inside that weapon's range.
func _scene(weapon_id: String, foes_at := 40.0) -> Dictionary:
	# Looked up by the def's own `id`: the dictionary is keyed `KNIFE` and the id is
	# `knife`, and matching on the key is the trap that silently fell through on the
	# wave pools. One lookup helper, used everywhere, so it cannot be got wrong twice.
	var def: Dictionary = _weapon(weapon_id)
	var g := Game.new(999.0)  # no natural spawning
	g.hero.weapons.clear()
	g.hero.add_weapon(def)
	var foe := Foe.new(Enemies.ENEMIES["BAT"], g.hero.x + foes_at, g.hero.y)
	foe.max_hp = 100000.0
	foe.hp = foe.max_hp
	g.foes.append(foe)
	return {"game": g, "foe": foe, "def": def}

## The headline check, run over the DATA rather than a hand-written list.
func _every_weapon_damages() -> void:
	var silent: Array = []
	# Iterate the DEFS, not the keys. The table is keyed `WHIP` and the def's own id is
	# `whip`, and mixing the two is the trap this file exists to catch -- in the wave
	# pools it silently spawned the wrong enemy for a whole round.
	for def in Weapons.WEAPONS.values():
		var id: String = def["id"]
		# Orbit shards travel ON a ring at `baseRange`, so a foe at 40% of it is never
		# touched by design. Every other archetype reaches inward from its range.
		var at: float = float(def["baseRange"])
		if def["type"] != "orbit":
			at *= 0.4
		var s := _scene(id, at)
		var before: float = s["foe"].hp
		var shots: Array = []
		WeaponFire.fire(def, s["game"].hero, s["game"].foes, shots)
		# Shots need a frame to travel before they can hit.
		for i in 120:
			for shot in shots:
				shot.update(FRAME, s["game"].hero.x, s["game"].hero.y, s["game"].hero.x, s["game"].hero.y)
				shot.resolve(s["game"].foes, Callable())
		if s["foe"].hp >= before:
			silent.append("%s (%s)" % [id, def["type"]])
	_check(silent.is_empty(), "EVERY weapon damages a foe in range", "silent: %s" % (", ".join(silent) if not silent.is_empty() else "none"))

func _range_is_respected() -> void:
	# A foe well outside the reach must be untouched, or "range" is decoration.
	var s := _scene("knife", 5000.0)
	var before: float = s["foe"].hp
	var shots: Array = []
	WeaponFire.fire(s["def"], s["game"].hero, s["game"].foes, shots)
	for i in 600:
		for shot in shots:
			shot.update(FRAME, s["game"].hero.x, s["game"].hero.y, s["game"].hero.x, s["game"].hero.y)
			shot.resolve(s["game"].foes, Callable())
	_check(s["foe"].hp == before, "a foe out of range is untouched", "hp unchanged")

func _pierce_hits_several_then_stops() -> void:
	# KNIFE pierces, MAGIC_WAND does not. Both are asserted, because a pierce flag
	# that is always on is as wrong as one that is never on.
	var g := Game.new(999.0)
	g.hero.weapons.clear()
	var knife: Dictionary = _weapon("knife")
	g.hero.add_weapon(knife)
	var foes: Array = []
	for i in 3:
		var f := Foe.new(Enemies.ENEMIES["BAT"], g.hero.x + 60.0 + i * 20.0, g.hero.y)
		f.max_hp = 1000.0
		f.hp = 1000.0
		foes.append(f)
		g.foes.append(f)
	var shots: Array = []
	WeaponFire.fire(knife, g.hero, g.foes, shots)
	for i in 60:
		for shot in shots:
			shot.update(FRAME, g.hero.x, g.hero.y, g.hero.x, g.hero.y)
			shot.resolve(g.foes, Callable())
	var hurt := 0
	for f in foes:
		if f.hp < 1000.0:
			hurt += 1
	_check(hurt > 1, "a piercing knife hits more than one foe", "%d of 3" % hurt)

func _orbit_shards_circle_and_hit() -> void:
	var s := _scene("orbit", 130.0)
	var before: float = s["foe"].hp
	var shots: Array = []
	WeaponFire.fire(s["def"], s["game"].hero, s["game"].foes, shots)
	_check(shots.size() == 2, "orbit makes projectileCount shards", "%d" % shots.size())
	if shots.size() > 0:
		var start: float = shots[0].x
		for i in 30:
			shots[0].update(FRAME, s["game"].hero.x, s["game"].hero.y, s["game"].hero.x, s["game"].hero.y)
		_check(not is_equal_approx(shots[0].x, start), "and they MOVE", "x %0.1f -> %0.1f" % [start, shots[0].x])
		# A shard must stay on its ring, not spiral out.
		var d: float = sqrt(pow(shots[0].x - s["game"].hero.x, 2) + pow(shots[0].y - s["game"].hero.y, 2))
		_check(is_equal_approx(d, float(s["def"]["baseRange"])), "at a constant radius", "%0.1f" % d)

func _boomerang_comes_back() -> void:
	# Measured as distance from the THROWER: out then back means it shrinks again.
	var s := _scene("boomerang", 200.0)
	var shots: Array = []
	WeaponFire.fire(s["def"], s["game"].hero, s["game"].foes, shots)
	_check(shots.size() == 1, "a boomerang is thrown", "%d" % shots.size())
	if shots.size() == 1:
		_check(shots[0].kind == Shot.Kind.BOOMERANG, "and knows it is one", "kind = BOOMERANG")

func _drain_heals() -> void:
	var s := _scene("soul_drain", 100.0)
	# WOUND the hero first. At full health the heal is correctly clamped and the test
	# would fail against working code -- which it did.
	s["game"].hero.hp = 50.0
	var before: float = s["game"].hero.hp
	var shots: Array = []
	WeaponFire.fire(s["def"], s["game"].hero, s["game"].foes, shots)
	_check(s["game"].hero.hp > before, "Soul Drain heals on hit", "hp %0.1f -> %0.1f" % [before, s["game"].hero.hp])

func _lightning_strikes_the_nearest() -> void:
	# Two foes in range, one much closer. Lightning has chainCount 3 but
	# projectileCount 1, so exactly the nearest must be hit.
	var g := Game.new(999.0)
	g.hero.weapons.clear()
	var def: Dictionary = _weapon("lightning")
	g.hero.add_weapon(def)
	var near := Foe.new(Enemies.ENEMIES["BAT"], g.hero.x + 50.0, g.hero.y)
	var far := Foe.new(Enemies.ENEMIES["BAT"], g.hero.x + 300.0, g.hero.y)
	for f in [near, far]:
		f.max_hp = 1000.0
		f.hp = 1000.0
		g.foes.append(f)
	var shots: Array = []
	WeaponFire.fire(def, g.hero, g.foes, shots)
	_check(near.hp < 1000.0, "lightning hits the NEAREST foe", "near hp %0.1f" % near.hp)
	_check(far.hp == 1000.0, "and not the far one", "far hp %0.1f" % far.hp)

func _multi_projectile_fires_a_volley() -> void:
	var s := _scene("retro_blaster", 150.0)
	var shots: Array = []
	WeaponFire.fire(s["def"], s["game"].hero, s["game"].foes, shots)
	_check(shots.size() == 2, "a 2-projectile weapon fires 2", "%d" % shots.size())
	if shots.size() == 2:
		# Compared by ANGLE, not by `vx`. A tight fan has almost the same x component
		# in both shots -- the separation is in y -- and the first version of this
		# check failed against a correctly spread volley.
		var a0 := atan2(shots[0].vy, shots[0].vx)
		var a1 := atan2(shots[1].vy, shots[1].vx)
		_check(
			absf(a1 - a0) > 0.01,
			"and they spread rather than overlap",
			"%0.1f deg apart" % rad_to_deg(absf(a1 - a0))
		)
		_check(
			shots[0].vy * shots[1].vy < 0.0,
			"on opposite sides of the aim line",
			"vy %0.1f vs %0.1f" % [shots[0].vy, shots[1].vy]
		)

func _cooldowns_are_per_weapon() -> void:
	# A knife (0.4s) must not be throttled by a slower weapon the hero also holds.
	var g := Game.new(999.0)
	g.hero.weapons.clear()
	g.hero.add_weapon(_weapon("garlic"))     # 0.2s
	g.hero.add_weapon(_weapon("lightning"))  # 3.0s
	var foe := Foe.new(Enemies.ENEMIES["BAT"], g.hero.x + 50.0, g.hero.y)
	foe.max_hp = 1000000.0
	foe.hp = foe.max_hp
	g.foes.append(foe)
	# Step two seconds: lightning fires once, garlic about ten times.
	for i in 120:
		g.step(FRAME, Vector2.ZERO)
	_check(g.cooldowns.has("garlic") and g.cooldowns.has("lightning"), "each weapon has its own timer", "both keyed")
	_check(
		float(g.cooldowns["lightning"]) > float(g.cooldowns["garlic"]),
		"and the slow one is not reset by the fast one",
		"lightning %0.2f vs garlic %0.2f" % [g.cooldowns["lightning"], g.cooldowns["garlic"]]
	)

## A weapon def by its `id`, regardless of how the table is keyed.
func _weapon(id: String) -> Dictionary:
	for def in Weapons.WEAPONS.values():
		if def["id"] == id:
			return def
	push_error("no weapon def for id '%s'" % id)
	return Weapons.WEAPONS.values()[0]

func _check(cond: bool, label: String, detail: String) -> void:
	if cond:
		print("  ok   %s  (%s)" % [label, detail])
	else:
		print("  FAIL %s  (%s)" % [label, detail])
		ok = false
