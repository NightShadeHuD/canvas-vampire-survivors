## Proves the vertical slice PLAYS: steps the simulation and asserts behaviour.
##
## Run by Godot, not by inspection:
##   godot --headless --path godot --script res://verify_slice.gd
##
## A scene that loads proves the scripts parse. This proves the hero moves, foes
## arrive, the weapon kills, and the i-frame rule holds -- which is the difference
## between a project that opens and a game that runs.
extends SceneTree

const FRAME := 1.0 / 60.0

func _init() -> void:
	seed(12345)  # Deterministic: a spawn angle drawn from a fixed seed is repeatable.

	_moves_when_asked()
	_spawns_and_chases()
	_weapon_kills()
	_contact_damage_respects_iframes()
	_clamps_to_the_arena()

	var passed := Check.ok
	print("verify_slice: ", "PASS" if passed else "FAIL")
	quit(0 if passed else 1)

func _moves_when_asked() -> void:
	var g := Game.new()
	var x0 := g.hero.x
	for i in 120:
		g.step(FRAME, Vector2.RIGHT)
	Check.rose(x0, g.hero.x, "hero moves right when asked")
	Check.at_least(g.hero.x - x0, 100.0, "and covers at least 100px in 2s")

	# A diagonal must not be FASTER than a straight line -- the classic bug, and the
	# original normalises for exactly this reason. Compared by DISTANCE TRAVELLED,
	# which is the thing that would actually be wrong.
	var straight := Game.new()
	var diagonal := Game.new()
	# READ the start, do not assume it. This test hardcoded `ARENA_HEIGHT / 2` as 400
	# and was wrong -- the arena is 1600 tall, so the hero starts at 800. A test that
	# writes down a value it could have read fails on the truth and blames the code.
	var start := Vector2(straight.hero.x, straight.hero.y)
	for i in 60:
		straight.step(FRAME, Vector2.RIGHT)
		diagonal.step(FRAME, Vector2(1, 1))
	var straight_dist := absf(straight.hero.x - start.x)
	var diagonal_dist := sqrt(
		pow(diagonal.hero.x - start.x, 2) + pow(diagonal.hero.y - start.y, 2)
	)
	Check.approx(straight_dist, diagonal_dist, "a diagonal is not faster than a straight line", 0.5)

func _spawns_and_chases() -> void:
	var g := Game.new(0.5)
	for i in 120:
		g.step(FRAME, Vector2.ZERO)
	Check.at_least(float(g.foes.size()), 1.0, "foes spawn")

	# A foe must CLOSE THE DISTANCE, not merely exist.
	var f: Foe = g.foes[0]
	var before := sqrt(pow(f.x - g.hero.x, 2) + pow(f.y - g.hero.y, 2))
	for i in 30:
		g.step(FRAME, Vector2.ZERO)
	var after := sqrt(pow(f.x - g.hero.x, 2) + pow(f.y - g.hero.y, 2))
	Check.fell(before, after, "foe closes on the hero")

func _weapon_kills() -> void:
	var g := Game.new(0.2)
	for i in 600:
		g.step(FRAME, Vector2.ZERO)
	Check.at_least(float(g.kills), 1.0, "the weapon kills")

func _contact_damage_respects_iframes() -> void:
	var h := Hero.new(0, 0)
	h.take_damage(10.0)
	Check.approx(h.hp, h.max_hp - 10.0, "a hit costs hp")
	Check.unchanged(h.invincible, true, "a hit grants i-frames")

	# The rule, stated: a second hit DURING the window is free. Without this the
	# hero melts in a crowd and the slice is not playable.
	var hp_before := h.hp
	h.take_damage(10.0)
	Check.unchanged(hp_before, h.hp, "a hit during i-frames is free")

	# ...and one past the window is not.
	h.tick(Config.INVINCIBILITY_TIME + FRAME)
	h.take_damage(10.0)
	Check.approx(h.hp, h.max_hp - 20.0, "a hit past i-frames lands")

func _clamps_to_the_arena() -> void:
	# Boundary and one past it, which is how this project pins an edge.
	var g := Game.new()
	for i in 100000:
		g.step(FRAME, Vector2.RIGHT)
	Check.approx(g.hero.x, Config.ARENA_WIDTH - g.hero.size, "hero stops at the right edge", 0.001)
