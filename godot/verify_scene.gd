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


## Every Control under `root`, depth-first. Used to assert that a menu's leading edges are
## inside the viewport -- a claim nothing checked until two player-visible geometry defects
## shipped green.
func _all_controls(root: Node) -> Array:
	var out: Array = []
	for child in root.get_children():
		if child is Control:
			out.append(child)
		out.append_array(_all_controls(child))
	return out


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

	# THE DIM MUST NOT OUTLIVE ITS MODAL.
	#
	# The assertions above check the ALPHA and passed while the shade was stuck visible for
	# the whole run: the counterpart to `shade_rect.visible = true` was never written, so a
	# player's screen greyed out at the first level-up and STAYED grey. Reported from play.
	#
	# **Alpha is a property of the dim; visibility is its LIFECYCLE.** A check on the colour
	# cannot see a dim that is correctly coloured and permanently on, which is the state the
	# game was actually in. So this drives the real picker open and shut and reads the flag.
	#
	# Nothing below leaves state behind: the picker is opened by a level-up and closed by a
	# real pick, which is the path a player takes.
	Check.unchanged(shade.visible, false, "the dim starts LOWERED, before any level-up")

	# DRIVEN BY CALLING THE DRAW PATH DIRECTLY, because the natural route does not work here:
	# `hero.gain_exp(100000)` leaves `pending_picks` at 0 in this harness, so `_process` never
	# reaches `_show_picks` and the first version of this check silently tested nothing --
	# "RAISES the dim" failed while the picker was also never opened. **A harness that cannot
	# reach the state under test reports the state as absent, which looks exactly like a bug.**
	main._show_picks()
	await process_frame
	await process_frame
	Check.unchanged(main.picker.visible, true, "the picker is up")
	Check.unchanged(shade.visible, true, "and the dim is RAISED with it")

	# AND IT CAN ACTUALLY BE ANSWERED. The block above checks the menu's focus, and for a whole
	# release that was the ONLY focus assertion -- so `_focus_first("Picker/Choices")` was a
	# no-op (the node is at `Picker/Offers/Choices`) and nothing noticed. **A commit whose
	# message read "the keyboard can start a run and answer a level-up" shipped a picker no
	# keyboard could answer**, and every assertion was green.
	#
	# `focus owner != null` is not enough on its own: focus could be on a node OUTSIDE the
	# picker, left over from the menu, which would leave the panel just as unanswerable. So
	# this asserts the owner is INSIDE the picker.
	var pick_focus := main.get_viewport().gui_get_focus_owner()
	Check.unchanged(pick_focus != null, true, "the level-up picker has a focus owner")
	Check.unchanged(
		pick_focus != null and main.picker.is_ancestor_of(pick_focus),
		true,
		"and it is INSIDE the picker, not left behind on the menu"
	)
	# And the buttons can hold focus at all -- `grab_focus()` on a FOCUS_NONE node is a no-op,
	# which is the other way this can silently do nothing.
	var picks := 0
	for node in main._focusable_under(main.picker):
		if (node as Control).focus_mode != Control.FOCUS_NONE:
			picks += 1
	Check.at_least(float(picks), 1.0, "and has a control that FOCUS_NONE does not exclude")

	# AND IT STILL WORKS ON THE SECOND ONE.
	#
	# Every check above drives the picker ONCE. The panel is REBUILT on each level-up --
	# `_show_picks` frees the old children and adds new ones -- and `queue_free()` defers the
	# removal to the end of the frame, so the new child landed while the old one was still
	# attached and Godot renamed it `@VBoxContainer@N` to avoid the clash. `_focus_first` then
	# resolved the OLD node and the focus walk died on it with "previously freed".
	#
	# **Measured before the fix: round 0 had focus, round 1 had NONE, round 2 had focus.**
	# A keyboard player could not answer every second level-up -- and a single-round check
	# cannot see it, which is why this one loops. Fixed by `remove_child` before `queue_free`.
	var stranded: Array = []
	for round_index in range(3):
		main._show_picks()
		await process_frame
		await process_frame
		var round_focus := main.get_viewport().gui_get_focus_owner()
		if round_focus == null or not main.picker.is_ancestor_of(round_focus):
			stranded.append("round %d" % round_index)
		main._on_pick(0)
		await process_frame
	Check.unchanged(
		stranded,
		[],
		"the picker is answerable on EVERY level-up, not just the first -- the panel is " +
			"rebuilt each time, and a node rebuilt in the same frame as its predecessor is " +
			"renamed out from under any lookup by name"
	)

	main._on_pick(0)
	await process_frame
	Check.unchanged(main.picker.visible, false, "an upgrade choice closes the picker")
	Check.unchanged(
		shade.visible,
		false,
		"and LOWERS the dim -- the bug this assertion exists for: a dim that outlives its " +
			"modal is a dim over the rest of the run"
	)
	Check.unchanged(main.state, main.State.PLAYING, "and the run resumes")

	# PUT THE WORLD BACK. This block drives the picker, which changes `state` and the menu's
	# visibility -- and the menu assertions that follow it read both. **The first version of
	# this check did not restore, and broke "it is shown first" three sections later**, which
	# is the same mistake made earlier in this file and written down at the time as "a test
	# that changes the world for the next test is a test that lies about the next test."
	#
	# The assertions above are complete before this runs, so restoring here cannot mask a
	# failure -- and if it could, the restore would be the thing to move, not the assertion.
	main._show_menu(true)
	main.state = main.State.MENU
	await process_frame

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

	# EVERY VISIBLE CONTROL'S LEADING EDGE IS INSIDE THE VIEWPORT.
	#
	# The existing check is `r.position.y + r.size.y >= 0` -- "not ENTIRELY above the screen" --
	# and it passed while `Menu/HowTo` rendered 96% off the top with only the descender tips of
	# "How to play" visible, and while `Menu/Start` was a 1352x692 panel starting at x = -100
	# that washed the title out 54%. **`-20 + 758 >= 0` is true.** Two player-visible defects,
	# 26 gates green.
	#
	# The claim is the LEADING EDGE, not the trailing one. A full-rect Control may legitimately
	# extend past the bottom (HowTo is 758px tall in a 648px window and only its top 130px carry
	# ink), so the trailing edge is not asserted; the leading edge always is, because nothing
	# drawn at a negative position is read by anyone.
	#
	# Found by an adversarial audit that rendered the menu and measured it -- neither this suite
	# nor the pixel tier had ever captured the menu at all.
	var frame: Vector2 = main.get_viewport_rect().size
	var offscreen: Array = []
	var seen := 0
	for node in _all_controls(main.get_node("Menu")):
		var c := node as Control
		if not c.visible:
			continue
		seen += 1
		if c.position.x < 0.0 or c.position.y < 0.0:
			offscreen.append(
				"%s at (%.0f, %.0f)" % [c.name, c.position.x, c.position.y]
			)
	Check.at_least(float(seen), 4.0, "the menu has visible controls to check")
	Check.unchanged(
		offscreen,
		[],
		"and NO visible control starts off-screen -- a leading edge above or left of the " +
			"viewport is content the player cannot read"
	)
	# The panel that did the damage, asserted directly: a button must be the size it reads as.
	var start_button := main.get_node_or_null("Menu/Start") as Control
	# ABSOLUTE BOUNDS, not a fraction of the viewport: `get_viewport_rect()` returns the
	# headless surface (a few dozen pixels), so a proportional bound would fail on correct code
	# -- which is exactly what the first version of this did. A button is a button.
	if start_button != null:
		Check.at_most(start_button.size.x, 400.0, "START is a button, not a full-width panel")
		Check.at_most(start_button.size.y, 120.0, "and not a full-height one either")
		Check.at_least(start_button.size.y, 24.0, "and it is big enough to hit")

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

	# AND A SLOWED FOE IS DRAWN SLOWED. `Foe.body_color` owns `renderEnemy`'s slow branch
	# -- `else if (self.slowTimer > 0) ctx.fillStyle = '#88ccff'`. This is the cheap STATIC
	# half of "the player can see it": `verify_weapons.gd` pins the value and
	# `verify_pixels.gd` measures the pixel, and neither of them can notice a `_draw` that
	# stopped calling the function -- which is the "state correct, representation wrong"
	# defect this repository has shipped four times.
	Check.unchanged(
		contains(draw_src, "foe.body_color()"),
		true,
		"the foe's body is drawn in the colour its slow changes"
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
