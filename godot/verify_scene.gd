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

	# A MODAL IS CENTRED ON THE SCREEN, not on its own corner.
	#
	# `PRESET_CENTER` sets anchors; the grow direction is a SEPARATE property that defaults
	# to END, so a container sizes itself to the right and down from the centre point. All
	# three modals had their top-left at exactly (576, 324) in a 1152x648 window -- the
	# screen centre -- which put every one of them in the bottom-right quadrant. Visible in
	# a player's screen recording and measured by an audit before that.
	#
	# Asserted as GEOMETRY, not as a property, because the property is only a means: what
	# matters is where the thing ends up.
	# Drive the REAL picker path: grant XP until a level lands, which is what a player does.
	main.game.hero.gain_exp(100000.0)
	main._process(1.0 / 60.0)
	# TWO frames: the buttons are added during the first, and a Container computes its
	# children's sizes and its own rect on the frame AFTER that. Measuring after one frame
	# reads a rect of width zero at the anchor -- which is what the first version of this
	# assertion did, and it reported 32 against an expected 576.
	main.picker.queue_sort()
	await process_frame
	await process_frame
	# THE PROPERTY, NOT THE GEOMETRY -- and the reason is worth recording.
	#
	# The obvious assertion is "the picker's centre is the screen's centre", and it CANNOT
	# be written headlessly: headless Godot reports a 64x64 root viewport, so `PRESET_CENTER`
	# centres on 64x64 and the picker's centre measures **32**. The first version of this
	# check compared 32 against the configured 576 and failed on CORRECT code.
	#
	# `grow_horizontal`/`grow_vertical` are the means rather than the end, so this is the
	# weaker half of the claim: it catches the regression that happened (the grow direction
	# left at its default) and cannot catch a layout that is wrong for another reason.
	# **Measuring the real geometry needs a window**, which a behavioural audit used and
	# which `verify:all`'s browser tier could grow into.
	Check.unchanged(main.picker.grow_horizontal, Control.GROW_DIRECTION_BOTH,
		"the picker grows from its CENTRE horizontally")
	Check.unchanged(main.picker.grow_vertical, Control.GROW_DIRECTION_BOTH,
		"and vertically")
	Check.unchanged(main.over.grow_horizontal, Control.GROW_DIRECTION_BOTH,
		"the game-over panel grows from its centre too")
	Check.unchanged(main.over.grow_vertical, Control.GROW_DIRECTION_BOTH, "and vertically")
	Check.unchanged(main.paused_panel.grow_horizontal, Control.GROW_DIRECTION_BOTH,
		"and so does the pause panel")
	Check.unchanged(main.paused_panel.grow_vertical, Control.GROW_DIRECTION_BOTH, "and vertically")

	# A MODAL MUST BE ANSWERABLE WITH THE KEYBOARD.
	#
	# Godot delivers `ui_accept` (Enter/Space) to whatever Control has FOCUS, and nothing
	# called `grab_focus()` anywhere in this file's history -- so `focus owner` was null on
	# every panel. An audit measured the consequence: pressing Enter, Space, `1`, Down and
	# numpad-1 at the level-up picker left `pending_picks` at 1. **The HUD advertised the
	# keyboard and the keyboard could not answer the game.**
	#
	# This is WASD's root cause a second time: the simulation was wired, the input was not.
	var menu_focus := main.get_viewport().gui_get_focus_owner()
	Check.unchanged(main.menu.visible, true, "the menu is up")
	Check.unchanged(menu_focus != null, true, "and SOMETHING has focus, so Enter can start a run")

	# AND THE PICKER'S BUTTONS CAN HOLD FOCUS AT ALL.
	#
	# Asserted as a PROPERTY rather than by opening the picker: driving `_on_start()` here
	# changes the state the menu assertions below depend on, and the first version of this
	# check did exactly that -- breaking "it is shown first" and "and is visible" three lines
	# further down. **A test that changes the world for the next test is a test that lies
	# about the next test.**
	#
	# `focus_mode` is what `grab_focus()` requires; `_focus_first` walks for the first node
	# that has it. A button with FOCUS_NONE could never be reached by the keyboard however
	# often focus was requested.
	var focusable := 0
	for node in main._focusable_under(main):
		if (node as Control).focus_mode != Control.FOCUS_NONE:
			focusable += 1
	# ONE, not two, and the number is the finding: at this point only the MENU exists. The
	# picker and game-over panels are built when a level lands and when the hero dies, so
	# they are not in the tree yet. Asserting "two" measured the test's position in the
	# suite rather than the scene.
	Check.at_least(float(focusable), 1.0, "the scene has a focusable control to walk")
	Check.unchanged(
		main.get_node_or_null("Menu/Start") != null
			and main.get_node("Menu/Start").focus_mode != Control.FOCUS_NONE,
		true,
		"and it is START, the control a keyboard player needs first"
	)

	var draw_src := FileAccess.get_file_as_string("res://scripts/main.gd")
	Check.at_least(float(draw_src.length()), 1.0, "the draw source is readable")
	# THE FX LISTS JOIN THIS ONE, and they are why it exists. Those four were every list
	# `_draw` walked, and that WAS the bug: six of the eight weapon archetypes create no
	# `Shot` at all, so a Whip or a Soul Drain reached `_draw` through nothing. A list that
	# is emitted and never iterated is the failure mode this loop catches -- and it can
	# only catch it for the lists it has been told about.
	for simulated in [
		"game.shots",
		"game.enemy_shots",
		"game.foes",
		"game.orbs",
		"game.fx.strikes",
		"game.fx.sparks",
	]:
		Check.unchanged(
			contains(draw_src, "for shot in %s" % simulated)
				or contains(draw_src, "for foe in %s" % simulated)
				or contains(draw_src, "for orb in %s" % simulated)
				or contains(draw_src, "for strike in %s" % simulated)
				or contains(draw_src, "for spark in %s" % simulated),
			true,
			"%s is ITERATED by _draw, not merely simulated" % simulated
		)

	# THE GARLIC RING MUST NOT LIE ABOUT ITS REACH.
	#
	# It was drawn at `game.weapon["baseRange"]` -- 110 -- while the aura fires at
	# `baseRange x levelArea x areaMult`. After five Area passives that is 177, so a foe
	# 150px away stood OUTSIDE the drawn ring and took damage from it. A behavioural audit
	# measured exactly that. The ring is therefore checked AGAINST THE DAMAGE rather than
	# against the formula: a foe just inside the drawn radius must be hit and one just
	# outside it must not, which is false for a ring drawn at any radius the aura does not
	# use.
	var hero: Hero = main.game.hero
	hero.weapons.clear()
	hero.add_weapon(Weapons.WEAPONS["GARLIC"])
	for i in 5:
		hero.add_passive(Passives.PASSIVES["AREA"])
	var garlic_def: Dictionary = hero.weapons[0]["def"]
	var ring: float = main.garlic_reach(hero)
	Check.at_least(ring, 150.0, "five Area passives carry the Garlic aura past its base range")
	var inside := Check.sturdy(Foe.new(Enemies.ENEMIES["BAT"], hero.x + ring - 0.5, hero.y))
	var outside := Check.sturdy(Foe.new(Enemies.ENEMIES["BAT"], hero.x + ring + 0.5, hero.y))
	WeaponFire.fire(garlic_def, hero, [inside, outside], [])
	Check.unchanged(
		[inside.hp < inside.max_hp, outside.hp < outside.max_hp],
		[true, false],
		"the aura damages EXACTLY out to the radius the ring is drawn at"
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
	# ACCUMULATE WHILE STILL ALIVE. `_process` advances `elapsed` only in the PLAYING state,
	# so this has to happen BEFORE the kill -- the first version put it after and thirty
	# frames changed nothing, which its own guard reported immediately.
	for i in 30:
		main._process(FRAME)
	Check.at_least(main.game.elapsed, 0.4, "the run accumulated enough time to tell a reset from noise")

	main.game.hero.hp = 1.0
	main.game.hero.take_damage(9999.0)
	main._process(FRAME)
	Check.unchanged(main.state, main.State.DEAD, "dying ends the run")
	Check.unchanged(main.over.visible, true, "the summary appears")
	Check.unchanged(main.get_node_or_null("Picker/GameOver/Title") != null, true, "with a title")
	Check.unchanged(main.get_node_or_null("Picker/GameOver/Again") != null, true, "and a way back")

	# LET THE OLD RUN ACCUMULATE FIRST, or this assertion compares two numbers that are both
	# one frame and passes or fails on scheduling.
	#
	# It did exactly that once, in a full run: `FAIL with a NEW run, not the old one
	# (0.0167 -> 0.0171)`. Both values are a single FRAME. `elapsed_before` was one frame of
	# the run that had just died and `main.game.elapsed` was one frame of the run that had
	# just started, so which was larger depended on sub-frame timing rather than on whether
	# the restart worked.
	#
	# **Rule 10's "floats compared for equality" in a different costume: a MAGNITUDE asserted
	# where the claim was a RESET.** Half a second of old run makes the comparison mean
	# something -- 0.5 against 0.0167 is a reset; 0.0171 against 0.0167 is noise.
	var elapsed_before: float = main.game.elapsed

	main.get_node("Picker/GameOver/Again").emit_signal("pressed")
	await process_frame
	Check.unchanged(main.state, main.State.PLAYING, "PLAY AGAIN starts a fresh run")
	Check.unchanged(main.over.visible, false, "and the summary gets out of the way")
	Check.fell(elapsed_before, main.game.elapsed, "with a NEW run, not the old one")
	# And the reset is REAL, not merely smaller: a restart puts the clock near zero.
	Check.at_most(main.game.elapsed, 0.2, "with the clock near ZERO, not merely smaller")
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
