## Proves the SCENE is playable, which `verify_slice.gd` cannot.
##
## WHY THIS FILE EXISTS
##
## The first version of this project shipped with an invisible hero and passed every
## check. `verify_slice.gd` asserts the SIMULATION -- hero position, foe distance,
## kills -- and the simulation was correct: the hero really was at (1200, 800). The
## bug was that nobody could see it, because there was no Camera2D and the default
## viewport is 1152x648.
##
## **A test at the wrong level passes while the game is unplayable.** This one runs
## at the level the bug was at: a real SceneTree, a real Camera2D, a real viewport.
##
##   godot --headless --path godot --script res://verify_scene.gd
extends SceneTree

const FRAME := 1.0 / 60.0

func _init() -> void:
	var packed: PackedScene = load("res://scenes/main.tscn")
	Check.unchanged(packed != null, true, "the scene loads")
	if packed == null:
		_finish()
		return

	var main = packed.instantiate()
	root.add_child(main)
	# One frame, so `_ready` has run and the camera has been aimed.
	await process_frame

	Check.unchanged(main.camera != null, true, "the scene HAS a camera")
	Check.unchanged(main.camera.is_current(), true, "the camera is the active one")

	# The bug, stated as an assertion: the hero must project INSIDE the viewport.
	var view := root.get_visible_rect().size
	var hero_pos: Vector2 = Vector2(main.game.hero.x, main.game.hero.y)
	var screen: Vector2 = (hero_pos - main.camera.position) * main.camera.zoom + view / 2.0
	Check.between(screen.x, 0.0, view.x, "the hero is INSIDE the visible viewport (x)")
	Check.between(screen.y, 0.0, view.y, "and inside it vertically (y)")

	# The camera must FOLLOW, or the hero walks out of view the moment it moves --
	# the same bug wearing a different hat.
	var before: Vector2 = main.camera.position
	for i in 120:
		main.game.step(1.0 / 60.0, Vector2.RIGHT)
		main.camera.position = main.camera.position.lerp(Vector2(main.game.hero.x, main.game.hero.y), 0.15)
	Check.approx(main.camera.position.x, main.game.hero.x, "the camera follows the hero", 60.0)
	Check.rose(before.x, main.camera.position.x, "and actually moved")

	# The menu is what the player sees FIRST. It existed in the original and did not
	# exist here, which is why the port "didn't look like the source material".
	Check.unchanged(main.get_node_or_null("Menu") != null, true, "there IS a menu")
	# The TEXT, not just the node. Existence alone passes on an empty label, which is
	# the kind of check that looks like coverage and is not.
	Check.unchanged(main.get_node("Menu/Title").text, "SURVIVOR", "and the title reads SURVIVOR")

	# ON SCREEN, not merely present. This file asserted the title's TEXT and passed while
	# the title was rendered entirely ABOVE the viewport -- rect y -180..-100 in a 648-tall
	# window, because `anchors_preset = 15` makes the offsets screen-relative while they
	# were written as if they were centre-relative. A behavioural audit measured HIDING
	# the title changing ZERO pixels and moving it on-screen revealing 6229.
	#
	# That is the invisible-hero bug a third time. `text == "SURVIVOR"` cannot see it, so
	# this measures the rect against the viewport the player actually has.
	# The PROJECT's configured window, not `get_viewport_rect()`: headless Godot reports a
	# 64x64 viewport, so measuring against it flagged correct UI as off-screen and would
	# have flagged nothing real. The player's window is what the settings say it is.
	var vp := Vector2(
		float(ProjectSettings.get_setting("display/window/size/viewport_width")),
		float(ProjectSettings.get_setting("display/window/size/viewport_height"))
	)
	for node_path in ["Menu/Title", "Menu/Subtitle", "Menu/Start", "Menu/HowTo"]:
		var c := main.get_node_or_null(node_path) as Control
		if c == null:
			Check.unchanged(false, true, "%s exists" % node_path)
			continue
		var r := c.get_global_rect()
		Check.at_least(r.position.y + r.size.y, 0.0, "%s is not entirely ABOVE the screen" % node_path)
		Check.at_most(r.position.y, vp.y, "%s is not entirely BELOW the screen" % node_path)
		Check.at_most(r.position.x, vp.x, "%s is not entirely off the RIGHT edge" % node_path)
	Check.unchanged(main.get_node_or_null("Menu/Start") != null, true, "and a way to start")
	Check.unchanged(main.state, main.State.MENU, "it is shown first")
	Check.unchanged(main.menu.visible, true, "and is visible")

	# Pressing START must actually start.
	main.get_node("Menu/Start").emit_signal("pressed")
	await process_frame
	Check.unchanged(main.state, main.State.PLAYING, "START begins a run")
	Check.unchanged(main.menu.visible, false, "the menu gets out of the way")
	Check.unchanged(main.hud.visible, true, "and the HUD appears")

	# The loop must CLOSE: die, see what happened, play again. Without this the game
	# stops on death and reads as a crash rather than an ending.
	main.game.hero.hp = 1.0
	main.game.hero.take_damage(9999.0)
	main._process(FRAME)
	Check.unchanged(main.state, main.State.DEAD, "dying ends the run")
	Check.unchanged(main.over.visible, true, "the summary appears")
	Check.unchanged(main.get_node_or_null("Picker/GameOver/Title") != null, true, "with a title")
	Check.unchanged(main.get_node_or_null("Picker/GameOver/Again") != null, true, "and a way back")

	var elapsed_before: float = main.game.elapsed
	main.get_node("Picker/GameOver/Again").emit_signal("pressed")
	await process_frame
	Check.unchanged(main.state, main.State.PLAYING, "PLAY AGAIN starts a fresh run")
	Check.unchanged(main.over.visible, false, "and the summary gets out of the way")
	Check.fell(elapsed_before, main.game.elapsed, "with a NEW run, not the old one")
	Check.approx(main.game.hero.hp, main.game.hero.max_hp, "and a full-health hero")

	# Esc used to QUIT. A player hits it expecting a menu and loses the run -- the most
	# expensive kind of wrong, so it is asserted rather than eyeballed.
	main.state = main.State.PLAYING
	main._start_run()
	var tick := InputEventKey.new()
	tick.keycode = KEY_ESCAPE
	tick.pressed = true
	main._unhandled_input(tick)
	Check.unchanged(main.state, main.State.PAUSED, "Esc PAUSES rather than quitting")
	Check.unchanged(main.paused_panel.visible, true, "and shows a pause panel")

	# The clock must not move while paused.
	Check.frozen(
		60,
		func(_i): main._process(FRAME),
		func(): return main.game.elapsed,
		"and the run does not advance"
	)

	var again_key := InputEventKey.new()
	again_key.keycode = KEY_P
	again_key.pressed = true
	main._unhandled_input(again_key)
	Check.unchanged(main.state, main.State.PLAYING, "P resumes")
	Check.unchanged(main.paused_panel.visible, false, "and hides the panel")

	# A level-up must NOT be pausable: two modals at once, and the pick is the one
	# that has to be answered.
	main.state = main.State.LEVEL_UP
	main._unhandled_input(tick)
	Check.unchanged(main.state, main.State.LEVEL_UP, "a level-up cannot be paused over")

	main.queue_free()
	_finish()

func _finish() -> void:
	var passed := Check.ok
	print("verify_scene: ", "PASS" if passed else "FAIL")
	quit(0 if passed else 1)
