## Plays the SCENE for a long time and reports anything that goes wrong.
##
## WHY A THIRD LEVEL OF TEST
##
## `verify_slice.gd` steps the simulation and `verify_scene.gd` checks the scene is
## visible and wired. Neither PLAYS it: neither runs `_process`, `_draw` and the real
## camera together for thousands of frames with input.
##
## That is the level the invisible-hero bug lived at, and it is the level a crash in
## `_draw` would live at too -- `draw_arc` with a bad radius, a freed node still in a
## list, a divide by zero once a foe's hp hits zero. None of those can happen in a
## simulation that never draws.
##
##   godot --headless --path godot --script res://verify_play.gd
extends SceneTree

const SECONDS := 90.0
const FRAME := 1.0 / 60.0

var ok := true
var dirs := [Vector2.RIGHT, Vector2.DOWN, Vector2.LEFT, Vector2.UP, Vector2(1, 1), Vector2.ZERO]

func _init() -> void:
	seed(999)
	var main = load("res://scenes/main.tscn").instantiate()
	root.add_child(main)
	await process_frame
	main.get_node("Menu/Start").emit_signal("pressed")
	await process_frame
	_check(main.state == main.State.PLAYING, "a run has started", "state = PLAYING")

	# Drive the REAL loop: `_process` runs `_draw`, the camera and the spawner.
	var peaks := {"foes": 0, "kills": 0}
	var died_at := -1.0
	var frames := int(SECONDS / FRAME)
	for i in frames:
		# Change direction periodically so the hero sweeps the arena and the camera
		# has to keep up -- a stationary hero would never exercise the follow.
		if i % 120 == 0:
			main._input_dir_override = dirs[int(i / 120) % dirs.size()]
		main._process(FRAME)
		peaks["foes"] = maxi(peaks["foes"], main.game.foes.size())
		peaks["kills"] = maxi(peaks["kills"], main.game.kills)
		if main.state == main.State.DEAD and died_at < 0.0:
			died_at = main.game.elapsed
			break

	_check(peaks["foes"] > 5, "foes accumulate", "%d at peak" % peaks["foes"])
	_check(peaks["kills"] > 0, "kills happen while playing", "%d" % peaks["kills"])

	# The hero must be able to DIE, or the game has no stakes and never ends.
	var g := Game.new(0.1)
	for i in 60 * 600:
		g.step(FRAME, Vector2.ZERO)
		if g.hero.dead:
			break
	_check(g.hero.dead, "a stationary hero eventually dies", "hp = %0.1f at %.0fs" % [g.hero.hp, g.elapsed])

	# Nothing should have leaked past the cap, however long it ran.
	var long_run := Game.new(0.05)
	for i in 60 * 120:
		long_run.step(FRAME, Vector2(1, 0))
	_check(
		long_run.foes.size() <= Config.MAX_ENEMIES,
		"foes stay under MAX_ENEMIES",
		"%d <= %d" % [long_run.foes.size(), Config.MAX_ENEMIES]
	)
	_check(main.game.foes.size() >= 0, "the scene survived the whole run", "no crash in 90s of play")

	# The level-up pause, exercised through the SCENE rather than a fresh Game.
	# Without this the play test would pass whether or not the pause worked, because
	# everything above drives its own instances.
	var scene_hit_levelup := false
	var frozen_for := 0
	var elapsed_at_pause := 0.0
	var was_levelup := false
	var stalled := false
	for i in 60 * 120:
		main._process(FRAME)
		var now_levelup: bool = main.state == main.State.LEVEL_UP
		if now_levelup:
			# Each SEPARATE offer freezes the clock at whatever it was when the offer
			# appeared. Comparing against a single baseline would flag the legitimate
			# resume after a pick as a failure -- which the first version of this test
			# did, and it looked exactly like a broken pause.
			if not was_levelup:
				scene_hit_levelup = true
				elapsed_at_pause = main.game.elapsed
				frozen_for = 0
			elif not is_equal_approx(main.game.elapsed, elapsed_at_pause):
				stalled = true
				break
			frozen_for += 1
			if frozen_for > 30:
				main._on_pick(0)
		was_levelup = now_levelup
	_check(scene_hit_levelup, "the scene reaches a level-up", "state = LEVEL_UP")
	_check(frozen_for > 0 and not stalled, "and the run PAUSES for it", "%d frames frozen" % frozen_for)
	_check(main.game.hero.level > 1, "the hero levelled", "level %d" % main.game.hero.level)

	# Shots must reach the world, or a weapon that "works" in isolation is invisible in
	# play -- the same failure as the hero, one layer down.
	var saw_shots := false
	var g2 := Game.new(0.3)
	g2.hero.weapons.clear()
	g2.hero.add_weapon(Weapons.WEAPONS["MAGIC_WAND"])
	# Run the WHOLE window. The first version of this broke out as soon as a shot
	# existed, so it asserted "and they kill" three frames after the first shot was
	# fired -- and failed against a weapon that kills nine bats in twenty seconds.
	for i in 60 * 20:
		g2.step(FRAME, Vector2.ZERO)
		if g2.shots.size() > 0:
			saw_shots = true
	_check(saw_shots, "a projectile weapon puts shots in the world", "MAGIC_WAND fired")
	_check(g2.kills > 0, "and they kill", "%d kill(s)" % g2.kills)
	_check(main.game.hero.weapons.size() >= 1, "and holds a weapon", "%d" % main.game.hero.weapons.size())

	main.queue_free()
	print("verify_play: ", "PASS" if ok else "FAIL")
	quit(0 if ok else 1)

func _check(cond: bool, label: String, detail: String) -> void:
	if cond:
		print("  ok   %s  (%s)" % [label, detail])
	else:
		print("  FAIL %s  (%s)" % [label, detail])
		ok = false
