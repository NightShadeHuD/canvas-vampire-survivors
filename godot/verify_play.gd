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

var dirs := [Vector2.RIGHT, Vector2.DOWN, Vector2.LEFT, Vector2.UP, Vector2(1, 1), Vector2.ZERO]

func _init() -> void:
	seed(999)
	var main = load("res://scenes/main.tscn").instantiate()
	root.add_child(main)
	await process_frame
	main.get_node("Menu/Start").emit_signal("pressed")
	await process_frame
	Check.unchanged(main.state, main.State.PLAYING, "a run has started")

	# Drive the REAL loop: `_process` runs `_draw`, the camera and the spawner.
	var foe_peak := Check.Peak.new()
	var kill_peak := Check.Peak.new()
	var frames := int(SECONDS / FRAME)
	# The WHOLE window, with no early exit: a loop that stops at the first
	# interesting frame measures a different run from the one it claims to have played.
	Check.over(frames, func(i):
		# Change direction periodically so the hero sweeps the arena and the camera
		# has to keep up -- a stationary hero would never exercise the follow.
		if i % 120 == 0:
			main._input_dir_override = dirs[int(i / 120) % dirs.size()]
		main._process(FRAME)
		foe_peak.consider(float(main.game.foes.size()), i)
		kill_peak.consider(float(main.game.kills), i)
	)

	Check.at_least(foe_peak.value, 6.0, "foes accumulate")
	Check.at_least(kill_peak.value, 1.0, "kills happen while playing")

	# The hero must be able to DIE, or the game has no stakes and never ends.
	# This one DOES stop at the event: "it eventually dies" is a claim about the first
	# frame it dies at, and the bound is there so a hero that never dies fails loudly.
	var g := Game.new(0.1)
	for i in 60 * 600:
		g.step(FRAME, Vector2.ZERO)
		if g.hero.dead:
			break
	Check.unchanged(g.hero.dead, true, "a stationary hero eventually dies")

	# Nothing should have leaked past the cap, however long it ran.
	var long_run := Game.new(0.05)
	Check.over(60 * 120, func(_i): long_run.step(FRAME, Vector2(1, 0)))
	Check.at_most(float(long_run.foes.size()), float(Config.MAX_ENEMIES), "foes stay under MAX_ENEMIES")
	# This used to be `foes.size() >= 0`, which is true of every array -- a check that
	# could not fail, so the 90s window proved nothing about surviving it. These assert
	# what a crash or a stalled spawner WOULD break.
	Check.at_least(main.game.elapsed, 1.0, "the scene is still simulating after the run")
	Check.at_least(float(foe_peak.value), 1.0, "and foes appeared during it")

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
	Check.unchanged(scene_hit_levelup, true, "the scene reaches a level-up")
	Check.at_least(float(frozen_for), 1.0, "and the run PAUSES for it")
	Check.unchanged(stalled, false, "without the clock moving during an offer")
	Check.at_least(float(main.game.hero.level), 2.0, "the hero levelled")

	# Shots must reach the world, or a weapon that "works" in isolation is invisible in
	# play -- the same failure as the hero, one layer down.
	var g2 := Game.new(0.3)
	g2.hero.weapons.clear()
	g2.hero.add_weapon(Weapons.WEAPONS["MAGIC_WAND"])
	# Run the WHOLE window. The first version of this broke out as soon as a shot
	# existed, so it asserted "and they kill" three frames after the first shot was
	# fired -- and failed against a weapon that kills nine bats in twenty seconds.
	var shot_peak := Check.Peak.new()
	Check.over(60 * 20, func(i):
		g2.step(FRAME, Vector2.ZERO)
		shot_peak.consider(float(g2.shots.size()), i)
	)
	Check.at_least(shot_peak.value, 1.0, "a projectile weapon puts shots in the world")
	Check.at_least(float(g2.kills), 1.0, "and they kill")
	Check.at_least(float(main.game.hero.weapons.size()), 1.0, "and holds a weapon")

	main.queue_free()
	var passed := Check.ok
	print("verify_play: ", "PASS" if passed else "FAIL")
	quit(0 if passed else 1)
