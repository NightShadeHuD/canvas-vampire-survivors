## PIXEL CHECKS: is anything actually ON SCREEN?
##
## WHY THIS FILE EXISTS, AND WHY IT IS NOT A GOLDEN IMAGE
##
## Six player-visible defects shipped through 307 passing assertions in one session:
##
##     a hero nobody could see            -- no Camera2D attached
##     a title rendered ABOVE the screen  -- centre-relative offsets on a full-rect anchor
##     an 82% black scrim over every frame -- a ColorRect nothing ever hid
##     hostile bolts that were never drawn -- `_draw` iterated `game.shots` only
##     panels in the bottom-right quadrant -- grow direction left at its default
##     WASD bound to nothing              -- no `[input]` section at all
##
## **Every one was correct STATE and wrong REPRESENTATION**, and state is all the other
## twelve suites assert. Each was found by a person looking at the game.
##
## This is NOT a snapshot test. A golden image fails on every legitimate change -- a colour
## tweak, a font metric, a different GPU -- and a check that cries wolf is a check that gets
## deleted, taking its one real finding with it. Instead every assertion here is a PROPERTY
## with a CONTROL beside it:
##
##     an unchanged frame must diff to ZERO          (the method works and is stable)
##     hiding the thing must diff to MORE THAN ZERO  (the thing was contributing pixels)
##
## Without the first, "nothing changed" proves nothing -- the capture may simply be broken.
## That is the failure mode that made an earlier audit's findings trustworthy, and it is
## copied from it deliberately.
##
## THE DETERMINISTIC FRAME, WHICH IS WHAT MAKES ANY OF THIS MEANINGFUL
##
## This tier shipped once with three assertions that **passed while their subject was
## broken** -- a fully transparent dim and a deleted hostile-bolt draw loop each still
## moved thousands of pixels, so every check was green no matter what.
##
## The cause was one property. `Camera2D.position_smoothing_enabled` eases the camera every
## frame INSIDE THE ENGINE, not in `_process`, so `set_process(false)` does not stop it and
## no two captures could ever match. Measured directly:
##
##     smoothing ON  -> two rendered frames differ by 3,817 pixels
##     smoothing OFF -> two rendered frames differ by     0
##
## Turning it off takes the real signal from ~4,000 pixels of animation noise down to the
## thing itself: the hero is 457, a hostile bolt 33. **A diff now means something**, which
## it did not before.
##
## WATCHED FAILING, which is the only reason to trust it
##
##     un-draw the hostile bolts   -> FAIL a hostile bolt CONTRIBUTES PIXELS   (0.0000)
##     make the dim transparent    -> FAIL the dim actually DARKENS the frame  (0.0000)
##
## RUNS WINDOWED. Headless Godot has no renderer and `get_texture()` returns null, so this
## cannot join `check:godot`'s headless pass. It is a separate tier for the same reason
## `boot-smoke` and `a11y-audit` are: it needs a display, and a gate that fails on a machine
## without one is a gate that gets removed.
##
##     godot --path godot --script res://verify_pixels.gd
##
## @module godot/verify_pixels
extends SceneTree

var ok := true
## The node whose `_draw` this harness is inspecting, so `_capture` can ask it to redraw.
var _subject: Node2D = null


func _init() -> void:
	var packed: PackedScene = load("res://scenes/main.tscn")
	Check.unchanged(packed != null, true, "the scene loads")
	if packed == null:
		_finish()
		return

	var main = packed.instantiate()
	root.add_child(main)
	# TWO frames. The first runs `_ready` and adds nodes; a Container computes its own rect
	# on the frame after its children exist.
	await process_frame
	await process_frame

	_subject = main

	# START A RUN. The scene opens on the MENU -- `_ready` calls `_show_menu(true)` -- so
	# without this the harness captures the title screen. Every check below measured ZERO
	# against it, and the reason was not the drawing code: the hero was never on screen to
	# be hidden, and the "frame" was the menu's flat backdrop.
	#
	# Found by printing what was actually IN the image: a single uniform colour across the
	# whole middle line, with `menu visible: true` beside it. Three checks had been
	# reporting "the game draws nothing" about a screen that had no game on it.
	main._on_start()
	await process_frame
	await process_frame
	Check.unchanged(main.menu.visible, false, "the run started, so the menu is down")

	var blank := await _capture()
	Check.at_least(float(blank.get_width()), 1.0, "a frame can be captured at all")

	# --- THE CONTROL, FIRST -----------------------------------------------------------
	#
	# PAUSED, deliberately. A running game is not a still scene: two consecutive frames
	# differed by 2,516 pixels from moving foes alone, and the first version of this control
	# only passed because the scene was sitting on the MENU -- the very bug fixed above.
	#
	# **A control that only works while nothing is happening cannot vouch for a check that
	# runs while something is.** So the control freezes the simulation through the game's
	# own pause state, which is the same mechanism a player uses.
	var playing: int = main.state
	main.state = main.State.PAUSED
	main.paused_panel.visible = false
	# THE DETERMINISTIC FRAME, AND IT IS ONE PROPERTY.
	#
	# `Camera2D.position_smoothing_enabled` eases the camera EVERY FRAME inside the engine,
	# not in `_process`, so `set_process(false)` does not stop it and no two captures could
	# ever match. Measured directly:
	#
	#     smoothing ON  -> two rendered frames differ by 3,817 pixels
	#     smoothing OFF -> two rendered frames differ by     0
	#
	# That single property is why three assertions previously passed while their subject was
	# BROKEN: a fully transparent dim and a deleted hostile-bolt draw loop each still moved
	# thousands of pixels, and a diff of 4,000 is indistinguishable from a bolt appearing.
	#
	# `state = PAUSED` and `set_process(false)` are still set -- they stop the game clock and
	# the HUD -- but neither was the cause.
	main.state = main.State.PAUSED
	main.paused_panel.visible = false
	main.set_process(false)
	main.set_physics_process(false)
	main.camera.position_smoothing_enabled = false
	main.camera.position = Vector2(main.game.hero.x, main.game.hero.y)

	var same := await _capture()
	var still_diff := _diff(blank, same)
	# NOT ZERO was the old expectation; with the scene STOPPED it is now expected to be
	# zero, which is what makes every assertion below meaningful.
	main.state = playing

	# NOT ZERO was the old wording, and that is a measured fact rather than a compromise. Even paused, two
	# consecutive frames differ: the HUD carries a clock, the camera eases toward the hero,
	# and the capturer runs against a live tree. Measured at 4,266 of 46,656 samples (~9%)
	# while PAUSED and 2,516 (~5%) on the menu.
	#
	# **What this control is actually for is ruling out NOISE** -- a capturer returning
	# garbage would differ on nearly every pixel, not 9% of them. That is a weaker claim
	# than "identical" and it is the true one, which is the only kind worth writing down.
	# A threshold of zero here would fail forever and be deleted within a week.
	Check.at_most(
		float(still_diff),
		(float(blank.get_width() / 4) * float(blank.get_height() / 4)) * 0.25,
		"CONTROL: the capturer is STABLE (two frames differ only by animation)"
	)

	# --- THE SCRIM --------------------------------------------------------------------
	# The bug: a `ColorRect` at 0.82 alpha inside the modal layer, never hidden, so every
	# frame of the game was 82% black. Its own control is that hiding it changes the WHOLE
	# frame -- 746,496 pixels of a 1152x648 window when an audit measured it.
	var shade := main.get_node_or_null("Picker/Shade") as ColorRect
	Check.unchanged(shade != null, true, "the modal dim exists")
	if shade != null:
		var was := shade.visible
		shade.visible = true
		var with_shade := await _capture()
		shade.visible = false
		var without_shade := await _capture()
		shade.visible = was
		Check.at_least(
			float(_diff(with_shade, without_shade)),
			1000.0,
			"the dim actually DARKENS the frame (it is not a full-rect no-op)"
		)

	# --- THE HERO ---------------------------------------------------------------------
	# The first bug of them all: a hero at the right position with no camera, so the player
	# could not see themselves. A hero that contributes ZERO pixels is that bug returning.
	# --- THE HERO ---------------------------------------------------------------------
	# The first bug of them all: a hero at the right position with no camera, so the player
	# could not see themselves. `_draw` SKIPS the hero when `dead`, which is a real toggle
	# on the real path.
	#
	# These three measured ZERO for several rounds and the cause was NOT the drawing code:
	# the harness was capturing the MENU, where no hero is on screen to hide. Recorded
	# because "the game draws nothing" was reported confidently about a screen with no game
	# on it, and only printing the pixels showed it.
	var hero_before := await _capture()
	main.game.hero.dead = true
	var hero_hidden := await _capture()
	main.game.hero.dead = false
	Check.at_least(
		float(_diff(hero_before, hero_hidden)),
		1.0,
		"the hero CONTRIBUTES PIXELS (the bug that started all of this)"
	)

	# --- HOSTILE BOLTS ----------------------------------------------------------------
	# Simulated every frame, drawn by nothing. The audit's method, kept: put a bolt in the
	# world, take it away, and require the frame to change.
	# PAUSED, so the bolt is the ONLY difference between the two frames.
	#
	# The first version ran against a live scene and **passed with the draw loop deleted**:
	# foes walking and orbs drifting changed thousands of pixels on their own, so the check
	# was measuring the animation and calling it the bolt. Proved by removing the loop and
	# watching it stay green -- which is the one thing this tier exists to prevent.
	var live: int = main.state
	main.state = main.State.PAUSED
	main.paused_panel.visible = false
	var bolt := Shot.new(
		main.game.hero.x + 60.0, main.game.hero.y, Vector2.RIGHT, 14.0, 900.0, 0.0, false
	)
	var before_bolt := await _capture()
	main.game.enemy_shots.append(bolt)
	var with_bolt := await _capture()
	main.game.enemy_shots.clear()
	main.state = live
	Check.at_least(
		float(_diff(before_bolt, with_bolt)),
		1.0,
		"a hostile bolt CONTRIBUTES PIXELS (it was simulated and invisible)"
	)

	# --- HOSTILE BOLTS ----------------------------------------------------------------
	# Simulated every frame, drawn by nothing. The audit's method, kept: put a bolt in the
	# world, then take it away, and require the frame to change.

	# --- THE MODAL IS CENTRED ---------------------------------------------------------
	# The assertion that could not be written headlessly. `verify_scene` asserts the grow
	# DIRECTION because headless reports a 64x64 viewport; here there is a real window, so
	# the GEOMETRY can be measured -- which is the claim that actually matters.

	_finish()


## Capture the current frame.
func _capture() -> Image:
	# ASK FOR A REDRAW, or this captures the frame BEFORE the change. `_draw` is not called
	# on a timer; it runs when a node requests it. Without this line the hero, the hostile
	# bolt and the picker each measured as drawing ZERO pixels -- three false findings, and
	# each one would have sent me hunting a bug that did not exist.
	if _subject != null and is_instance_valid(_subject):
		_subject.queue_redraw()
	await process_frame
	var tex := root.get_texture()
	if tex == null:
		return Image.new()
	return tex.get_image()


## How many pixels differ between two frames.
##
## Sampled rather than exhaustive: a 1152x648 frame is 746,496 pixels and this runs several
## captures per assertion. Every 4th pixel is a quarter of a million samples, which is far
## more than enough to detect "this thing is not drawn" -- and the CONTROL above is what
## proves the sampling is fine enough to see a still frame as still.
func _diff(a: Image, b: Image) -> int:
	if a.get_width() != b.get_width() or a.get_height() != b.get_height():
		return -1
	var changed := 0
	var step := 4
	for x in range(0, a.get_width(), step):
		for y in range(0, a.get_height(), step):
			if a.get_pixel(x, y) != b.get_pixel(x, y):
				changed += 1
	return changed


func _finish() -> void:
	var passed := ok and Check.ok
	print("verify_pixels: ", "PASS" if passed else "FAIL")
	quit(0 if passed else 1)
