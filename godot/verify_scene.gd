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

## `String.contains` via `find`, because GDScript has no `contains` on String and a
## missing method is a runtime error rather than a failed check.
## Whether `action` answers a specific key, by PHYSICAL code -- layout-independent, which
## is the whole point of binding WASD physically.
func _has_key(action: String, keycode: int) -> bool:
	for event in InputMap.action_get_events(action):
		if event is InputEventKey and event.physical_keycode == keycode:
			return true
	return false


## Whether `action` answers an ARROW key, which is a LOGICAL keycode rather than physical.
func _has_arrow(action: String) -> bool:
	for event in InputMap.action_get_events(action):
		if event is InputEventKey and event.keycode in [KEY_UP, KEY_DOWN, KEY_LEFT, KEY_RIGHT]:
			return true
	return false


func contains(haystack: String, needle: String) -> bool:
	return haystack.find(needle) != -1


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

	# EVERY SIMULATED THING IS DRAWN.
	#
	# This is the port's most repeated bug: a hero nobody could see, a title rendered above
	# the screen, an 82% scrim over every frame, and hostile bolts that took 14 HP off with
	# nothing on screen. All four were CORRECT SIMULATION with ZERO REPRESENTATION, and all
	# four passed every suite, because the suites assert state.
	#
	# WHAT THIS DOES NOT PROVE, stated because the limit matters: it greps the draw source,
	# so it cannot tell whether the drawn thing is VISIBLE, correctly coloured, or on
	# screen. A pixel diff can, and that is what a behavioural audit used to find the bolts.
	# This is the cheap half -- it fails the moment the loop is deleted, which is the
	# mistake actually made -- and it is honest about being the cheap half.
	# THE KEYS THE GAME ADVERTISES ARE ACTUALLY MAPPED.
	#
	# `main.gd` reads `ui_up/ui_down/ui_left/ui_right`, and Godot's BUILT-IN bindings for
	# those are the ARROW KEYS. There was no `[input]` section in `project.godot` at all,
	# so the HUD printed "WASD / arrows to move" -- in the game and in the how-to screen --
	# while WASD did nothing. Reported by a player, not by any of 280 assertions.
	#
	# THE TEST SEAM IS WHY. Every suite drives movement through `_input_dir_override`,
	# which exists because a headless test has no hardware -- and that override bypasses
	# `Input.is_action_pressed` entirely, so the real input path was never exercised by
	# anything. A seam that makes a thing testable can also make it untested; this checks
	# the CONFIGURATION rather than the keypress, which is the half that can fail silently.
	var advertised := {"ui_up": KEY_W, "ui_down": KEY_S, "ui_left": KEY_A, "ui_right": KEY_D}
	for action in advertised:
		Check.unchanged(InputMap.has_action(action), true, "the action %s exists" % action)
		Check.unchanged(
			_has_key(action, advertised[action]),
			true,
			"%s is bound to the key the HUD advertises" % action
		)
	# And the arrow keys must SURVIVE. Declaring an action in `[input]` REPLACES its
	# built-in binding, so adding WASD is exactly the edit that can silently remove them.
	for action in ["ui_up", "ui_down", "ui_left", "ui_right"]:
		Check.unchanged(
			_has_arrow(action),
			true,
			"%s still answers the ARROW key too" % action
		)

	# THE VIEW STOPS AT THE ARENA EDGE.
	#
	# Two ways to see outside the world, and both are wrong for the same reason: the spawn
	# ring sits OUTSIDE the arena on purpose (spawning off-screen is right), so anything
	# that widens the view past the floor shows a player enemies before they arrive -- and
	# shows them against the engine's default grey.
	#
	# A player reported exactly that: a grey edge, with foes walking in on it.
	#
	# The camera is limited rather than the arena being enlarged, because the arena size is
	# the ORIGINAL's and the port's job is to reproduce it. `Camera2D.limit_*` is the
	# mechanism Godot provides, and it is applied to the final position, after the lerp and
	# the smoothing that this camera does in two stages.
	var cam: Camera2D = main.camera
	Check.unchanged(cam.limit_left, 0, "the camera stops at the arena's LEFT edge")
	Check.unchanged(cam.limit_top, 0, "and its TOP edge")
	Check.unchanged(cam.limit_right, int(Config.ARENA_WIDTH), "and its RIGHT edge")
	Check.unchanged(cam.limit_bottom, int(Config.ARENA_HEIGHT), "and its BOTTOM edge")
	# A limit narrower than the viewport would show the grey on the OPPOSITE side, so the
	# arena has to be at least as big as the window. Asserted rather than assumed, because
	# shrinking the arena is a change somebody might make for a different reason.
	var window := Vector2(
		float(ProjectSettings.get_setting("display/window/size/viewport_width")),
		float(ProjectSettings.get_setting("display/window/size/viewport_height"))
	)
	Check.at_least(float(Config.ARENA_WIDTH), window.x, "the arena is wider than the window")
	Check.at_least(float(Config.ARENA_HEIGHT), window.y, "and taller")

	# AND THE DIM LEAVES THE GAME READABLE. The picker is a modal, and the world behind it
	# is what a player is choosing an upgrade FOR. 0.82 alpha was nearly opaque.
	var shade := main.get_node_or_null("Picker/Shade") as ColorRect
	Check.unchanged(shade != null, true, "the modal dim exists")
	if shade != null:
		Check.at_most(shade.color.a, 0.6, "and leaves the world readable through it")
		Check.at_least(shade.color.a, 0.15, "while still separating the modal from it")

	var draw_src := FileAccess.get_file_as_string("res://scripts/main.gd")
	Check.at_least(float(draw_src.length()), 1.0, "the draw source is readable")
	for simulated in ["game.shots", "game.enemy_shots", "game.foes", "game.orbs"]:
		Check.unchanged(
			contains(draw_src, "for shot in %s" % simulated)
				or contains(draw_src, "for foe in %s" % simulated)
				or contains(draw_src, "for orb in %s" % simulated),
			true,
			"%s is ITERATED by _draw, not merely simulated" % simulated
		)
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
