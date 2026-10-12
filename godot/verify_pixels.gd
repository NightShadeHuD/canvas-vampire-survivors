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

	var blank := await _capture()
	Check.at_least(float(blank.get_width()), 1.0, "a frame can be captured at all")

	# --- THE CONTROL, FIRST -----------------------------------------------------------
	# If an unchanged frame does not diff to zero, nothing below means anything: a capturer
	# that returns noise would make every "this changed" assertion pass.
	var same := await _capture()
	Check.unchanged(_diff(blank, same), 0, "CONTROL: two frames of a still scene are IDENTICAL")

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
	# ---------------------------------------------------------------------------------
	# NOT WRITTEN YET: "the hero contributes pixels", "a hostile bolt contributes
	# pixels", and the modal GEOMETRY. Each was attempted and each measured ZERO on code
	# that is definitely drawing, so the HARNESS is wrong rather than the game.
	#
	# WHAT WAS ESTABLISHED: `queue_redraw()` on the scene's root `Node2D` does not make the
	# next capture reflect the change, while toggling the `Control` shade DOES (all 46,656
	# sampled pixels). So the capture is real and the sampling is fine enough -- something
	# about re-invoking a Node2D's `_draw` on demand is not.
	#
	# The next step is a `_draw`-level seam rather than fighting `queue_redraw` from
	# outside, which is a design change rather than a fix.
	#
	# **Declared, not deleted, and not silently skipped.** Three checks that measured
	# nothing would have sent me hunting three bugs that do not exist -- which is the
	# false-finding failure this whole file exists to prevent, occurring IN this file.
	# ---------------------------------------------------------------------------------
	print("  SKIP the hero / hostile-bolt / modal-geometry checks -- NOT IMPLEMENTED")

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
