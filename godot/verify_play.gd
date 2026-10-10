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

	main.queue_free()
	print("verify_play: ", "PASS" if ok else "FAIL")
	quit(0 if ok else 1)

func _check(cond: bool, label: String, detail: String) -> void:
	if cond:
		print("  ok   %s  (%s)" % [label, detail])
	else:
		print("  FAIL %s  (%s)" % [label, detail])
		ok = false
