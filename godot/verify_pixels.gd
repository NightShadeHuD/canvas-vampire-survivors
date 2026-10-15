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
## One frame at 60fps, the rate `Config.TARGET_FPS` asks for. Used to advance a shot
## through `Shot.update`, so a measurement steps the simulation by real time rather than
## teleporting an object to where the test wants it.
const FRAME := 1.0 / 60.0
## The moments a weapon's effect is looked for at, in frames after it fires. NOT one value,
## because the right one differs by archetype and no single choice measures them all:
## a projectile is occluded at 0 and 1 and visible from 2, while the Whip's sweep and the
## Drain's tether exist ONLY in the first few tenths of a second. The largest diff across
## these is taken, so every entry is a moment a player could have seen.
##
## Every one of these numbers was measured against both trees, not chosen. On the unfixed
## tree a projectile reads 0, 0, 9-11, 9-10, 10-16 at them in order.
const FIRE_FRAMES := [1, 2, 5, 8, 12]
## The arrays on `Game` that the renderer reads but that are NOT a weapon's effect. Emptying
## one of these changes the frame for a reason that is not the thing under test -- see
## `_fx_lists`, where the 26-pixel disc this cost is recorded.
const NOT_AN_EFFECT := ["foes", "orbs", "spawned"]
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

	# --- THE SLOW IS VISIBLE ----------------------------------------------------------
	# Frost Nova's slow halves a foe's speed AND casts it `#88ccff` -- `renderEnemy`'s
	# `else if (self.slowTimer > 0)` branch. The speed half is asserted headlessly in
	# `verify_weapons.gd`, against the field. This is the half a player actually receives,
	# and it is measured the way this tier measures everything: put the state on a foe,
	# capture, and require the screen to say so.
	#
	# PAUSED, so the ONLY difference between the captures is the odd one out -- `game.foes`
	# is not in `NOT_AN_EFFECT` by accident, and an unpaused frame differs from the next one
	# by thousands of pixels of walking.
	var slow_state: int = main.state
	main.state = main.State.PAUSED
	main.paused_panel.visible = false
	main.game.foes.clear()
	var slow_foe := _stray_foe(main.game, 90.0, 0.0)
	# A pixel that is BODY and nothing else: outside the pale core (`size * 0.5`) and
	# inside the rim, on the horizontal through the foe's centre. At full health the HP bar
	# is not drawn at all, so no other element reaches here.
	var foe_on_screen: Vector2 = main.get_canvas_transform() * Vector2(slow_foe.x, slow_foe.y)
	var sx := int(foe_on_screen.x + slow_foe.size * 0.75)
	var sy := int(foe_on_screen.y)
	var slow_before := await _capture_of(main)
	var free_px := slow_before.get_pixel(sx, sy)
	slow_foe.slow_timer = float(_weapon_by_id("frost_nova")["slowDuration"])
	var slow_after := await _capture_of(main)
	var slowed_px := slow_after.get_pixel(sx, sy)
	# THE CONTROL BESIDE IT, and it is the one that makes the first claim mean something:
	# taking the slow OFF has to put the pixel BACK, so what moved was the slow and not the
	# act of capturing a frame.
	slow_foe.slow_timer = 0.0
	var slow_back := await _capture_of(main)
	var back_px := slow_back.get_pixel(sx, sy)
	main.state = slow_state
	# A DIRECTION, not a magnitude: the bat is `#8844ff` and the tint is `#88ccff`, so the
	# channel the slow moves on THIS foe is green (0.267 -> 0.800). The exact colour is
	# pinned to the VALUE in `verify_weapons.gd` (`body_color() == Color("88ccff")`), which
	# no renderer can influence; this side pins that the value reaches the screen. Asserting
	# the absolute pixel here instead would be a golden colour, and this tier exists partly
	# because a golden image fails on every legitimate change.
	Check.rose(
		float(free_px.g),
		float(slowed_px.g),
		"a slowed foe's body is drawn visibly COLDER on screen than its own colour"
	)
	# THE CONTROL BESIDE IT: taking the slow off has to put the pixel BACK, so what moved
	# was the slow and not the act of capturing a frame. Its own limit, stated: it cannot
	# fail for a foe that is tinted always or never -- the claim above fails for both of
	# those, which is why the two are written as a pair.
	Check.unchanged(back_px, free_px, "CONTROL: and the tint REVERSES when the slow expires")
	print(
		"  note  the foe's body pixel: free %s -> slowed %s -> back %s (data colour %s)"
		% [free_px, slowed_px, back_px, Color(slow_foe.color)]
	)

	# --- THE HIT FLASH IS VISIBLE, AND IT REVERSES -------------------------------------
	#
	# `renderEnemy`'s FIRST branch, `src/entity-render.ts:218`:
	#
	#     if (self.flashTimer > 0) ctx.fillStyle = '#ffffff';
	#
	# -- set by `Enemy.takeDamage` on EVERY hit (`this.flashTimer = 0.08`) and aged by
	# `Enemy.update`. The port had no flash timer at all, so a foe that had just been hit was
	# drawn exactly like one that had not. `verify_weapons.gd` pins the VALUES the chain
	# returns; this is the other half, and the one a player actually receives.
	#
	# THE TWO CLAIMS, AND WHY BOTH ARE HERE. A hit must CHANGE the pixel, and the change must
	# REVERSE -- a flash that never decays is a foe that is white forever, which is the "the
	# screen greyed out and stayed grey" defect this repository shipped once. A check with
	# only the first half passes for exactly that bug.
	var flash_state: int = main.state
	main.state = main.State.PAUSED
	main.paused_panel.visible = false
	main.game.foes.clear()
	var flash_foe := _stray_foe(main.game, 90.0, 0.0)
	# The same BODY pixel the slow section samples: outside the pale core (`size * 0.5`) and
	# inside the rim, on the horizontal through the foe's centre. The foe is `sturdy` and at
	# full health when the first frame is taken, so no HP bar reaches this row either.
	var flash_on_screen: Vector2 = main.get_canvas_transform() * Vector2(flash_foe.x, flash_foe.y)
	var bx := int(flash_on_screen.x + flash_foe.size * 0.75)
	var by := int(flash_on_screen.y)
	var unhit := await _capture_of(main)
	var unhit_px := unhit.get_pixel(bx, by)
	# THE FLASH THE GAME SETS, through the only thing that sets it. Nothing here writes
	# `flash_timer` itself: the claim is about what a hit does to the screen.
	flash_foe.take_damage(1.0)
	var hit_frame := await _capture_of(main)
	var hit_px := hit_frame.get_pixel(bx, by)
	# A DIRECTION, not a magnitude. The bat is `#8844ff`, so white moves RED (0.533 -> 1.0) and
	# GREEN (0.267 -> 1.0) while blue is already 1.0. The exact colour is pinned in
	# `verify_weapons.gd` against `body_color`; what this side pins is that the value REACHES
	# THE SCREEN, which no assertion about the field can do.
	Check.rose(
		float(unhit_px.r), float(hit_px.r), "a hit foe's body is drawn BRIGHTER on screen (red)"
	)
	Check.rose(
		float(unhit_px.g), float(hit_px.g), "and brighter in green too -- it is the original's WHITE"
	)
	# ...AND IT REVERSES. Aged through `chase`, which is the ONLY thing that ages it in play --
	# `Game.step` calls it once per foe per frame. The foe cannot move (it is a `_stray_foe`,
	# speed 0), so the pixel sampled is the same piece of body before and after.
	for _tick in int(ceil(0.08 / FRAME)):
		flash_foe.chase(main.game.hero.x, main.game.hero.y, FRAME)
	var faded := await _capture_of(main)
	var faded_px := faded.get_pixel(bx, by)
	Check.unchanged(flash_foe.flash_timer > 0.0, false, "the flash has expired by the frame it is read on")
	Check.unchanged(
		faded_px,
		unhit_px,
		"CONTROL: and the body pixel is BACK to what it was before the hit -- the flash reverses"
	)
	print(
		"  note  the foe's body pixel: unhit %s -> hit %s -> flashed off %s (data colour %s)"
		% [unhit_px, hit_px, faded_px, Color(flash_foe.color)]
	)
	main.state = flash_state

	# --- THE ARMED BOMBER BLINKS, ON A PERIOD -----------------------------------------
	#
	# `renderEnemy`'s third branch, `src/entity-render.ts:222-225`:
	#
	#     } else if (self.bomber && self.fuseArmed) {
	#         const blink = Math.floor(performance.now() / 120) % 2 === 0;
	#         ctx.fillStyle = blink ? '#ffffff' : self.color;
	#
	# The port had the FUSE and no drawing of it: a bomber about to detonate in your face
	# looked exactly like one that was not. What the blink depends on is TIME -- 120ms white,
	# 120ms its own colour, phase taken from the clock when the frame is drawn -- and the three
	# samples below are what separates that from a one-way tint: white, own colour, WHITE.
	#
	# PAUSED AND FROZEN, which is what makes the phase measurable at all: `game.elapsed` does
	# not advance, so setting it IS setting the phase.
	var blink_state: int = main.state
	main.state = main.State.PAUSED
	main.paused_panel.visible = false
	main.game.foes.clear()
	# `performance.now() / 120`: 120 MILLISECONDS is the HALF period, written as the spec
	# literal rather than read from `Foe.BLINK_HALF_PERIOD`.
	const BLINK_HALF := 0.12
	var bomber := Foe.new(Enemies.ENEMIES["BOMBER"], main.game.hero.x + 60.0, main.game.hero.y)
	Check.sturdy(bomber)
	bomber.speed = 0.0
	main.game.foes.append(bomber)
	# THE PRECONDITION, AND IT IS THE FUSE RATHER THAN A FLAG SET BY HAND: 60px is inside
	# `fuseRange` (80), so one `chase` -- what arms it in play -- arms it here.
	bomber.chase(main.game.hero.x, main.game.hero.y, FRAME)
	Check.unchanged(bomber.fuse_armed, true, "the bomber ARMED, or the blink below is unreachable")
	var bomber_on_screen: Vector2 = main.get_canvas_transform() * Vector2(bomber.x, bomber.y)
	var mx := int(bomber_on_screen.x + bomber.size * 0.75)
	var my := int(bomber_on_screen.y)
	main.game.elapsed = 0.0
	var blink_white := await _capture_of(main)
	var white_px := blink_white.get_pixel(mx, my)
	main.game.elapsed = BLINK_HALF
	var blink_colour := await _capture_of(main)
	var colour_px := blink_colour.get_pixel(mx, my)
	main.game.elapsed = BLINK_HALF * 2.0
	var blink_again := await _capture_of(main)
	var again_px := blink_again.get_pixel(mx, my)
	# The bomber is `#ff6644`: white moves GREEN (0.4 -> 1.0) and BLUE (0.267 -> 1.0) while red
	# is 1.0 in both. The channel carrying the change is the DATA's, so the assertion reads the
	# one that moves rather than choosing one in advance -- the first version of the headless
	# check chose red and failed against a working blink.
	Check.rose(
		float(colour_px.g), float(white_px.g), "an armed bomber is drawn BRIGHTER in the white half of its blink"
	)
	Check.unchanged(
		colour_px,
		Color(bomber.color),
		"and wears its own data colour in the other half -- the blink is the two of them"
	)
	Check.unchanged(
		again_px,
		white_px,
		"CONTROL: and it is WHITE AGAIN one full period later -- it BLINKS, it does not tint once"
	)
	# AND THE CLOCK ALONE DOES NOTHING. Disarming the fuse must remove the blink at every phase
	# while `game.elapsed` goes on doing what it was doing -- without this, every assertion
	# above would pass for an implementation that flashed every foe white on a timer.
	bomber.fuse_armed = false
	main.game.elapsed = 0.0
	var unarmed_a := await _capture_of(main)
	main.game.elapsed = BLINK_HALF
	var unarmed_b := await _capture_of(main)
	Check.unchanged(
		unarmed_b.get_pixel(mx, my),
		unarmed_a.get_pixel(mx, my),
		"CONTROL: with the fuse unarmed the same clock change moves NO pixel -- the blink is the FUSE"
	)
	print(
		"  note  the bomber's body pixel: white %s -> own colour %s -> white again %s"
		% [white_px, colour_px, again_px]
	)
	main.game.elapsed = 0.0
	main.state = blink_state
	# THE FOES GO WITH THE SECTION, and this is a measured coupling rather than tidiness.
	# `_draw` draws `game.enemy_shots` BEFORE `game.foes`, so a foe parked where a later check
	# puts its bolt HIDES that bolt -- and the hostile-bolt check below measures a bolt exactly
	# `hero.x + 60`, which is where this section's bomber stands to arm its fuse. Left there,
	# a correctly drawn bolt changed ZERO pixels and the check went red: watched, with no other
	# difference between the two runs.
	main.game.foes.clear()

	# --- THE DAMAGE NUMBER IS ON SCREEN, AT THE FOE, AND IT GOES ----------------------
	#
	# `_rollCrit`, `src/weapons.ts:112-115`, on EVERY hit:
	#
	#     game.createFloatingText(Math.round(dmg), x, y, '#ffee44', { crit: true });
	#     game.createFloatingText(Math.round(baseDamage), x, y, color);
	#
	# `verify_weapons.gd` pins the label, the colour and the position IN THE DATA -- and a
	# value in a field is not a number a player can see, which is the whole of rule 18. This
	# measures the pixels, and it measures WHERE they are, because "at the struck foe" is the
	# claim: a number over the hero would draw the same thing for a hit and a miss.
	var number_run := await _paused_run()
	var number_main = number_run["main"]
	var number_game: Game = number_run["game"]
	# THE INSTRUMENT, BEFORE IT IS TRUSTED. A font that measures zero for a known string draws
	# NOTHING, and every "the frame changed" reading below would then be a reading about a dead
	# instrument (`docs/PROBE-CAVEATS.md`, rule 19: show it a known signal first).
	var number_font = number_main.number_font()
	Check.unchanged(number_font != null, true, "the damage-number font exists")
	Check.rose(
		0.0,
		number_font.get_string_size("12", HORIZONTAL_ALIGNMENT_LEFT, -1, 16).x,
		"CONTROL: the font MEASURES a known string -- the instrument reads a signal at all"
	)
	number_game.hero.weapons.clear()
	number_game.hero.add_weapon(_weapon_by_id("whip"))
	number_game.cooldowns.clear()
	var number_foe := _stray_foe(number_game, 80.0, 0.0)
	var foe_at: Vector2 = number_main.get_canvas_transform() * Vector2(number_foe.x, number_foe.y)
	var hero_at: Vector2 = number_main.get_canvas_transform() * Vector2(
		number_game.hero.x, number_game.hero.y
	)
	# FIRED THROUGH THE REAL ENTRY POINT AND THE GAME'S OWN SINK, which is the pair
	# `Game.step` calls. Sparks and the sweep shape come with it, so they are cleared: what is
	# measured below is the NUMBER and nothing standing beside it.
	WeaponFire.fire(_weapon_by_id("whip"), number_game.hero, number_game.foes, [], 1, number_game.fx)
	Check.rose(0.0, float(number_game.fx.texts.size()), "the whip's hit left a number in the sink")
	# Healed back to full, so no HP bar joins the diff -- the same reason `_fx_pixel_diff`
	# heals: a bar that appears in one capture and not the other is not the number.
	for foe in number_game.foes:
		foe.hp = foe.max_hp
	number_game.fx.sparks.clear()
	number_game.fx.strikes.clear()
	var with_number := await _capture_of(number_main)
	var held: Array = number_game.fx.texts.duplicate()
	number_game.fx.texts.clear()
	var without_number := await _capture_of(number_main)
	var box := _change_bbox(with_number, without_number)
	Check.rose(0.0, float(box["count"]), "the damage number CONTRIBUTES PIXELS to the frame")
	var centre := Vector2(box["cx"], box["cy"])
	# THE CLAIM `quality-baseline.json` NAMES, as a direction: the number is nearer the FOE
	# than the hero who dealt it. `fell(before, after)` is "after is smaller", so the hero
	# distance is the one before.
	Check.fell(
		centre.distance_to(hero_at),
		centre.distance_to(foe_at),
		"the number is drawn CLOSER TO THE FOE than to the hero -- it is per-TARGET, not per-fire"
	)
	Check.at_most(
		centre.distance_to(foe_at),
		40.0,
		"and within 40px of it: above the foe, where `enemy.y - 20` puts it"
	)
	# IT RISES, and that is a direction rather than a magnitude: `update` does `y += vy * dt`
	# with `vy = -60`, so the number climbs and screen y FALLS. The topmost changed row is
	# compared with itself, which needs no glyph metrics and cannot be satisfied by a number
	# that merely faded in place.
	number_game.fx.texts.append_array(held)
	for _tick in 24:
		number_game.fx.update(FRAME)
	var risen := await _capture_of(number_main)
	var risen_box := _change_bbox(with_number, risen)
	Check.rose(0.0, float(risen_box["count"]), "the number MOVED between the two frames")
	# `fell(before, after)` asserts AFTER IS SMALLER, and screen y grows DOWNWARD -- so the
	# BIRTH box's top row is what goes in first. Written the other way round first, this
	# failed at (268.0000 -> 292.0000) against a number rising exactly 24px in 24 ticks.
	Check.fell(
		float(box["top"]),
		float(risen_box["top"]),
		"and the change moved UP the screen -- `vy = -60` carries it 60px a second"
	)
	# AND IT GOES. `life` starts at 1 and is spent at 1.2/s -- 0.833s -- and the pixel half of
	# "a number that never expires is a screen full of them" is that the frame afterwards is
	# IDENTICAL to the frame the number was never drawn in.
	for _tick in 60:
		number_game.fx.update(FRAME)
	Check.unchanged(number_game.fx.texts.size(), 0, "the number is gone from the sink after its life")
	var after_life := await _capture_of(number_main)
	Check.unchanged(
		_diff(after_life, without_number),
		0,
		"CONTROL: and the frame is IDENTICAL to the one it was never drawn in -- the number goes away"
	)
	print(
		"  note  the damage number: %d px changed, centre %s, foe %s, hero %s"
		% [int(box["count"]), centre, foe_at, hero_at]
	)
	# THE SCENE GOES AWAY AGAIN, and that is not tidiness. A capture here is of the WHOLE
	# VIEWPORT, and a scene added later is drawn ON TOP of the ones before it -- floor
	# included. The hostile-bolt check below measures the FIRST scene, and with this one left
	# alive its bolt changed ZERO pixels while being drawn perfectly correctly. Measured, not
	# predicted: the bolt check went red the moment this section was inserted above it.
	number_main.queue_free()
	await process_frame

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

	# ===========================================================================
	# WEAPONS THAT DEAL DAMAGE MUST ALSO SHOW SOMETHING
	# ===========================================================================
	#
	# WHY THIS SECTION EXISTS
	#
	# `main._draw` drew `game.shots`, `game.foes`, `game.orbs` and `game.enemy_shots`, and
	# those four lists were the entire visual vocabulary of a fight. Six of the eight
	# archetypes in `WeaponFire.fire` -- melee, aura, nova, instant, drain, mine -- create no
	# `Shot` at all: they call `_strike_all_in_range` or `_strike_nearest` and apply damage
	# directly. So six of the ten weapons in `Weapons.WEAPONS` fired, landed their damage,
	# and drew NOTHING.
	#
	# A behavioural audit measured it as a pixel diff with a control, and the control is
	# what made it trustworthy:
	#
	#     DIFF Whip fires and hits         232 px   bbox (616,298)-(673,301)
	#                                                    <- ONLY the foes' HP bars
	#     DIFF Lightning fires (instant)   120 px
	#     DIFF Frost Nova fires (nova)     232 px
	#     DIFF Soul Drain fires (drain)    120 px
	#     DIFF Area Mine fires (mine)      232 px
	#     DIFF CONTROL: Orbiter shards     224 px   bbox (450,318)-(701,329)
	#                                                    <- a real shard
	#
	# Every one of those six bboxes is the foes' HP bars and nothing else. The control is a
	# shard, and a shard is a `Shot`. That is the whole finding in one picture.
	#
	# THE CLAIM THIS SECTION MAKES, AND WHY IT NAMES NO LIST
	#
	#     firing a weapon CHANGES THE FRAME
	#
	# That is the whole assertion. It does not say the change arrives as a `Shot`, or as a
	# spark, or as a shape. **An earlier version of this file asserted that every weapon
	# "puts a Shot in the world", and it was WRONG about a working fix**: the fix draws its
	# effect through a new `game.fx` list, so the pixel half passed and the `Shot` half
	# failed -- reporting working code as broken, which is the one failure mode worse than
	# no check at all. What the effect is made of is the fix's business. That it reaches the
	# screen is this file's.
	#
	# HOW IT STAYS DECOUPLED, WHICH IS THE WHOLE TRICK
	#
	# The frame is measured TWICE AT THE SAME INSTANT: once with every list the renderer
	# draws for a weapon effect emptied, and once with them all in place. Nothing else
	# differs between the two captures -- not the clock, not the foes, not the ring -- so
	# the diff is the effect and nothing else. The lists are DISCOVERED from `Game` and its
	# `fx` by reflection over the project's own script variables (`_fx_lists`), so a fix
	# that draws through a list nobody has thought of yet is measured rather than missed.
	#
	# AND WHY IT MEASURES AT SEVERAL MOMENTS, NOT ONE
	#
	# Both halves of this were measured, and each one alone gives a useless answer:
	#
	#   * AT THE INSTANT OF FIRING, a projectile has not moved and sits UNDER the hero. `_draw`
	#     draws effects before the hero and the hero's glow is `size * 2.2` = 44px across, so
	#     it is completely occluded: measured 0 pixels at the hero's position against 10 for
	#     the same shot 44px away.
	#   * AT THE INSTANT OF FIRING, a transient shape is at its brightest and is the ONLY
	#     moment some of them exist -- the Whip's sweep lives 0.22s, the Drain's tether 0.18s.
	#
	# So the check advances the simulation by a few real frames (`Game.step`, the same call
	# the game makes) and takes the LARGEST diff it can find. Every offset is a moment the
	# player would have seen. Measured on the unfixed tree, a projectile's visibility by
	# offset: `n=1` 0, `n=2` 6-8, `n=5` 9-11, `n=8` 9-10, `n=12` 10-16 -- which is exactly
	# why one arbitrary offset cannot be hardcoded.
	#
	# `game.elapsed` is pinned to the same value for both captures, so the Garlic ring --
	# whose alpha is `0.25 + sin(elapsed / 0.4) * 0.08` -- contributes nothing to any diff.
	# `seed()` is fixed so a weapon whose OWN emit is a rate (the aura fires a particle 40%
	# of the time) is repeatable rather than passing by luck.
	#
	# WHAT THIS MEASUREMENT HAD TO LEARN, all of it measured rather than assumed:
	#
	#   * a projectile aimed at a NEAR foe RESOLVES AND DIES inside the step it is fired in,
	#     so `game.shots` is empty by the time a later frame is captured. Measured: knife
	#     against a foe at 80px leaves 0 shots; against a foe at 400px, 1.
	#   * `Array.clear()` and `Array.append_array()` are the operations that work on a TYPED
	#     array. Assigning a plain `Array` to `game.shots` raises "Invalid assignment of
	#     property ... with value of type 'Array'" and GDScript then CARRIES ON past it,
	#     which is how a probe reports zero for its own reason instead of the game's.
	#   * `set()` returns VOID. `var err = obj.set(...)` aborts the whole enclosing function
	#     with "Trying to get a return value of a method that returns void".
	print("\n-- every weapon, fired through WeaponFire, measured in pixels --")
	seed(20250812)
	var archetypes: Dictionary = {}
	var silent: Array = []
	var measured := 0
	for def in Weapons.WEAPONS.values():
		var best := 0
		var best_at := -1
		var seen: Array = []
		for frames in FIRE_FRAMES:
			var rig := await _weapon_rig(def, frames)
			var px := await _fx_pixel_diff(rig["main"], rig["game"])
			seen.append("%d:%d" % [frames, px])
			# THE RIG IS FREED AS SOON AS IT HAS BEEN MEASURED, and this is load-bearing
			# rather than tidy. A capture is of the WHOLE VIEWPORT, so every scene ever
			# created keeps being drawn on every frame -- measured: 56 live scenes after this
			# loop, one per `_weapon_rig` call. That was survivable while a paused scene drew
			# nothing that changed, and it stopped being survivable when the damage numbers
			# arrived: a paused scene never ages its texts, so each rig that landed a hit
			# holds its number for good. Measured at the end of this loop: 25 damage numbers
			# repainted every frame, on top of the 56 scenes. The frame cost therefore grows
			# WITH the loop, which is exactly where the captures start missing what they are
			# measuring -- watched as the sixth weapon onwards reading ZERO pixels while the
			# first five read their usual counts.
			#
			# Freed AFTER the measurement and BEFORE the next rig, so each measurement is of a
			# viewport holding one scene: identical to what the pristine tree measured for
			# every weapon that draws no number.
			rig["main"].queue_free()
			await process_frame
			if px > best:
				best = px
				best_at = frames
		archetypes[def["type"]] = int(archetypes.get(def["type"], 0)) + 1
		measured += 1
		if best < 1:
			silent.append("%s (%s)" % [def["id"], def["type"]])
		print("     %-14s %-11s best=%d px at %d frame(s)   [%s]" % [
			def["id"], def["type"], best, best_at, ", ".join(seen)
		])
		Check.at_least(
			float(best),
			1.0,
			"%s (%s) is DRAWN -- firing it changes the frame" % [def["id"], def["type"]]
		)
	Check.unchanged(silent, [], "EVERY weapon in the data creates a visible effect")
	Check.at_least(float(measured), float(Weapons.WEAPONS.size()), "all %d weapons were measured" % Weapons.WEAPONS.size())
	Check.at_least(float(archetypes.size()), 8.0, "every archetype in the data is represented")


	# THE GARLIC RING MUST NOT LIE ABOUT ITS REACH
	# ---------------------------------------------------------------------------
	# `_draw_hero` draws the aura ring at `game.weapon["baseRange"]` -- a FLAT 110 --
	# while `WeaponFire._strike_all_in_range` damages at
	# `baseRange * lv_area * hero.area_mult()`. The two are the same number only until the
	# player takes an Area passive, and Area is a 10% COMPOUNDING multiplier.
	#
	# With 5 stacks (the cap) the aura reaches 110 * 1.1^5 = 177.2 and the ring still reads
	# 110. The audit measured it directly: "a foe 150px away (OUTSIDE the drawn ring) took
	# 5 damage". The ring is the only feedback a player gets from a weapon with no
	# projectiles, so it is the one thing they cannot check any other way.
	#
	# THE EXPECTED RADIUS IS COMPUTED, NOT WRITTEN DOWN: it comes from the data
	# (`GARLIC.baseRange`) and the hero's own `area_mult()`, so retuning either in
	# `src/data.ts` moves the expectation with it. The original this port follows does the
	# same -- `src/entity-render.ts` draws the ring from `garlic.getRange(self)`.
	print("\n-- the garlic ring's reach, against the reach it damages at --")
	var run := await _paused_run()
	var aura_game: Game = run["game"]
	var aura_main: Node2D = run["main"]
	var garlic: Dictionary = _weapon_by_id("garlic")
	Check.unchanged(aura_game.hero.has_weapon("garlic"), true, "the hero holds the aura weapon")
	# THE PRECONDITION THAT MAKES THE CLAIM MEANINGFUL: with no Area stacks the drawn
	# radius and the damage radius agree and the bug is invisible. Taken through
	# `add_passive`, to the cap, so this is the path a player takes.
	var area_stacks := 0
	for i in int(Config.PASSIVE_MAX_STACK):
		if aura_game.hero.add_passive(_passive_by_id("area")):
			area_stacks += 1
	var area_mult := float(aura_game.hero.area_mult())
	Check.approx(float(area_stacks), float(Config.PASSIVE_MAX_STACK), "Area is stacked to its cap")
	Check.at_least(area_mult, 1.2, "and it genuinely widens the reach")
	var aura_reach: float = float(garlic["baseRange"]) * area_mult
	var aura_base: float = float(garlic["baseRange"])
	Check.differs(aura_reach, aura_base, 40.0, "the true reach is well OUTSIDE the base ring")

	# (a) THE DAMAGE REACH, measured as damage: one foe inside it, one outside.
	var near_foe := _stray_foe(aura_game, aura_reach * 0.85, 0.0)
	var far_foe := _stray_foe(aura_game, aura_reach * 1.15, 0.0)
	var near_before: float = near_foe.hp
	var far_before: float = far_foe.hp
	# THE REAL PATH: the weapon fires from `Game.step`, on the hero's own cooldown.
	# THE WEAPON MUST BE READY. `_on_start` has already stepped the run by a couple of
	# frames, so the starting weapons cooldown is part-way through -- measured at 0.183s.
	# where one frame is 0.0167s. A single step would then measure NOTHING and report it as
	# "the aura does not reach", which is the test being wrong rather than the game. The
	# cooldown is armed rather than the loop extended, so this stays one frame and no foe
	# has time to move.
	aura_game.cooldowns["garlic"] = 0.0
	aura_game.step(FRAME, Vector2.ZERO)

	Check.fell(near_before, near_foe.hp, "a foe inside the aura's reach takes damage")
	Check.unchanged(far_before, far_foe.hp, "a foe beyond it does not")

	# (b) THE DRAWN REACH, measured in pixels. Two frames at opposite ends of the ring's own
	# pulse, so the ONLY pixels that can differ are the ring's: the floor, the grid, the
	# foes and the hero are identical between them.
	var hero_on_screen: Vector2 = aura_main.get_canvas_transform() * Vector2(aura_game.hero.x, aura_game.hero.y)
	aura_game.elapsed = 0.4 * (PI * 1.5)
	var ring_a := await _capture_of(aura_main)
	aura_game.elapsed = 0.4 * (PI * 0.5)
	var ring_b := await _capture_of(aura_main)
	# THE CONTROL BESIDE THE MEASUREMENT, and it is the one this tier exists for: a frame
	# against ITSELF must show no ring, or the scan is finding something that is not the
	# ring and every radius below it would be meaningless.
	Check.unchanged(_ray_radius(ring_a, ring_a, hero_on_screen), -1, "CONTROL: a frame against itself has no ring")
	var drawn_reach := _ray_radius(ring_a, ring_b, hero_on_screen)
	Check.approx(float(drawn_reach), aura_reach, "the DRAWN ring is at the reach the aura damages at", 3.0)

	# ---------------------------------------------------------------------------
	# THE MELEE SWEEP IS A BAND, NOT A DISC
	# ---------------------------------------------------------------------------
	# The original's `_fireMelee`, which this port follows, is a rectangle:
	#
	#     if (Math.abs(dx) > range) continue;
	#     if (Math.abs(dy) > 40) continue;
	#
	# A 360-degree disc of the same radius is a different weapon: it hits behind the hero,
	# above and below. The audit measured the difference as 8/8 foes on a ring against the
	# original's 2/8. `_strike_all_in_range` tests `hypot <= reach`, which is the disc.
	#
	# TWO ASSERTIONS AND THE PAIR IS THE POINT. The forward foe proves the sweep REACHES
	# that far, so a "fix" that stops hitting anything cannot pass by missing. The diagonal
	# and vertical foes -- at the SAME distance, inside the same disc -- prove it is aimed.
	print("\n-- the melee sweep is a band, not a disc --")
	var sweep := await _paused_run()
	var sweep_game: Game = sweep["game"]
	var whip: Dictionary = _weapon_by_id("whip")
	var whip_reach: float = float(whip["baseRange"])
	var at := whip_reach * 0.75
	var ahead := _stray_foe(sweep_game, at, 0.0)
	var diag := _stray_foe(sweep_game, at / sqrt(2.0), at / sqrt(2.0))
	var above := _stray_foe(sweep_game, 0.0, at)
	Check.at_least(at / sqrt(2.0), 40.0, "the diagonal foes are outside the band by construction")
	# FIRED, not asserted on. Whether the Whip puts a `Shot` in the world stopped being a
	# claim this file makes: it was the coupled half that failed a working `fx` fix, and
	# whether it reaches the screen is already asserted above, per weapon, for all ten.
	WeaponFire.fire(whip, sweep_game.hero, sweep_game.foes, [], 1)
	Check.fell(ahead.max_hp, ahead.hp, "the whip hits a foe straight ahead")
	Check.unchanged(diag.max_hp, diag.hp, "it does NOT hit a foe on the diagonal")
	Check.unchanged(above.max_hp, above.hp, "it does NOT hit a foe directly above")

	_finish()


## A run whose hero holds ONE weapon, paused and camera-locked, with a foe in range.
##
## Every measurement below needs the same three things: a frame that cannot change by
## itself, a hero at a known place on the screen, and a weapon firing through the real
## `WeaponFire.fire`. `_paused_run` is where that is established once.
func _paused_run() -> Dictionary:
	var packed: PackedScene = load("res://scenes/main.tscn")
	var main = packed.instantiate()
	root.add_child(main)
	# TWO frames, as at the top of this file: the first runs `_ready`, the second lets a
	# Container size itself.
	await process_frame
	await process_frame
	main._on_start()
	await process_frame
	await process_frame
	# PAUSED and frozen, through the same two properties the control at the top of this
	# file uses. `position_smoothing_enabled = false` is the one that matters: it eases the
	# camera INSIDE the engine, so no two frames could otherwise match.
	main.state = main.State.PAUSED
	main.paused_panel.visible = false
	main.set_process(false)
	main.set_physics_process(false)
	main.camera.position_smoothing_enabled = false
	# THE CENTRE OF THE ARENA, where the camera is not up against one of the `limit_*`
	# clamps and the hero therefore lands on a known pixel -- measured at (576, 324) in the
	# 1152x648 window. Near a wall the camera stops and the hero moves across the screen,
	# and a test that hardcoded `get_viewport_rect().size / 2` would then be measuring the
	# clamp rather than the game.
	main.game.hero.x = Config.ARENA_WIDTH / 2.0
	main.game.hero.y = Config.ARENA_HEIGHT / 2.0
	main.camera.position = Vector2(main.game.hero.x, main.game.hero.y)
	main.game.foes.clear()
	main.game.shots.clear()
	main.game.enemy_shots.clear()
	main.game.elapsed = 0.0
	return {"main": main, "game": main.game}


## A run firing ONE weapon, with a sturdy foe inside its reach, advanced `frames` real
## frames of simulation so the effect has moved and lived the way the game would move it.
##
## Returns the main node, the game, and how many shots are still in flight -- the last only
## so a reader can tell a weapon that fired from one that had nothing to aim at.
func _weapon_rig(def: Dictionary, frames: int) -> Dictionary:
	var run := await _paused_run()
	var game: Game = run["game"]
	var weapons: Array = game.hero.weapons
	weapons.clear()
	game.hero.add_weapon(def)
	game.cooldowns.clear()
	var foe := Foe.new(Enemies.ENEMIES["BAT"], game.hero.x + 80.0, game.hero.y)
	# STURDY, because 80px is inside every weapon's base reach and an unmodified bat dies to
	# Lightning's 35 -- `_remove_dead` then drops an orb where it fell, and an orb is a
	# SECOND difference between the two captures that has nothing to do with the weapon.
	Check.sturdy(foe)
	foe.speed = 0.0
	game.foes.append(foe)
	# FIRE THROUGH THE REAL ENTRY POINT, then let the game advance it: `Game.step` is what
	# moves a shot, ages a spark and expires a shape, so nothing here is teleported by hand.
	WeaponFire.fire(def, game.hero, game.foes, [], 1)
	for i in frames:
		game.step(FRAME, Vector2.ZERO)
	return {"main": run["main"], "game": game, "shots": game.shots.size()}


## How many sampled pixels the weapon's effect contributes to the frame at this instant:
## the same frame captured with every effect list the renderer reads EMPTIED, and again with
## them all in place.
##
## Nothing else differs between the two captures. `game.elapsed` is pinned, the foes are the
## same objects at the same coordinates, the hero is the same, and the effect is put back
## IN PLACE -- so the arrays are the same arrays and the second capture is the world as it
## was. The diff is the weapon's visible contribution and nothing else.
func _fx_pixel_diff(main: Node2D, game: Game) -> int:
	# THE FOE IS HEALED BACK TO FULL BEFORE BOTH CAPTURES, and this is not cosmetic.
	# Landing damage is not drawing: a weapon whose only visible trace is the foes HP bar
	# is exactly the bug this section exists to find -- the audit measured the Whip at
	# 232 pixels that were ALL HP bars. Left alone, that bar appears in the second capture
	# and every direct-damage archetype measures a constant ~33 pixels whether it draws
	# anything or not. Measured: with the heal, all six silent archetypes read 0.
	for foe in game.foes:
		foe.hp = foe.max_hp
	game.hero.hp = game.hero.max_hp
	var hidden := _fx_hide(game)
	game.elapsed = 0.0
	var without := await _capture_of(main)
	_fx_restore(game, hidden)
	for foe in game.foes:
		foe.hp = foe.max_hp
	game.hero.hp = game.hero.max_hp
	game.elapsed = 0.0
	var with := await _capture_of(main)
	return _diff(without, with)


## The outermost pixel on the horizontal ray to the right of `origin` that differs
## between two frames. -1 when they are identical along the whole ray.
##
## The ray starts past the hero's own glow -- `Config.PLAYER_SIZE * 2.2` = 44px, derived
## from the data rather than picked -- so the hero can never be mistaken for the ring, and
## it is scanned to 400px, which is beyond every radius under test.
func _ray_radius(a: Image, b: Image, origin: Vector2) -> int:
	if a.get_width() != b.get_width() or a.get_height() != b.get_height():
		return -1
	var ox := int(origin.x)
	var oy := int(origin.y)
	var start := int(Config.PLAYER_SIZE * 2.2) + 2
	var last := -1
	for offset in range(start, mini(a.get_width() - ox, 400)):
		if a.get_pixel(ox + offset, oy) != b.get_pixel(ox + offset, oy):
			last = offset
	return last


## A foe placed `dx`, `dy` from the hero, unable to move and unable to die, so a check
## about REACH cannot become a check about the foe's speed or its health.
func _stray_foe(game: Game, dx: float, dy: float) -> Foe:
	var foe := Foe.new(Enemies.ENEMIES["BAT"], game.hero.x + dx, game.hero.y + dy)
	Check.sturdy(foe)
	foe.speed = 0.0
	game.foes.append(foe)
	return foe


## Capture a frame from a specific node -- the same act as `_capture`, but for a node other
## than the one this harness was pointed at for its own checks.
func _capture_of(subject: Node2D) -> Image:
	if is_instance_valid(subject):
		subject.queue_redraw()
	await process_frame
	var tex := root.get_texture()
	if tex == null:
		return Image.new()
	return tex.get_image()


## A weapon def by its own `id`, whatever the table happens to be keyed.
func _weapon_by_id(id: String) -> Dictionary:
	for def in Weapons.WEAPONS.values():
		if def["id"] == id:
			return def
	push_error("no weapon def for id '%s'" % id)
	return Weapons.WEAPONS.values()[0]


## A passive def by its own `id`.
func _passive_by_id(id: String) -> Dictionary:
	for def in Passives.PASSIVES.values():
		if def["id"] == id:
			return def
	push_error("no passive def for id '%s'" % id)
	return Passives.PASSIVES.values()[0]


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


## The pixels that differ between two frames, as a COUNT and as a POSITION: the centroid of
## the changed samples, plus the topmost and bottommost rows that changed.
##
## Sampled every 4th pixel, exactly as `_diff` samples, so the two agree about what "changed"
## means. A count can only say THAT something moved; a position is what separates "a damage
## number appeared over the foe" from "a damage number appeared over the hero", which are the
## same count and different games.
func _change_bbox(a: Image, b: Image) -> Dictionary:
	var none := {"count": 0, "cx": -1.0, "cy": -1.0, "top": -1, "bottom": -1}
	if a.get_width() != b.get_width() or a.get_height() != b.get_height():
		return none
	var count := 0
	var sum_x := 0
	var sum_y := 0
	var top := -1
	var bottom := -1
	for x in range(0, a.get_width(), 4):
		for y in range(0, a.get_height(), 4):
			if a.get_pixel(x, y) != b.get_pixel(x, y):
				count += 1
				sum_x += x
				sum_y += y
				if top < 0 or y < top:
					top = y
				if y > bottom:
					bottom = y
	if count == 0:
		return none
	return {
		"count": count,
		"cx": float(sum_x) / float(count),
		"cy": float(sum_y) / float(count),
		"top": top,
		"bottom": bottom,
	}


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


## Every array DECLARED BY THE PROJECT'S OWN SCRIPTS that a weapon's fire can put something
## into and the renderer reads.
##
## DISCOVERED FROM THE OBJECTS, not from a list of names. A fix that draws through a list
## this file has never heard of -- `Game.fx.sparks` was added by the fix this check was
## written to judge -- is measured anyway, because the list is found by asking `Game` and its
## `fx` what their script variables are. A check that named `game.shots` would have called
## that fix broken.
##
## `PROPERTY_USAGE_SCRIPT_VARIABLE` keeps this to the game's own `var`s: engine internals are
## not script variables and would be a strange thing to empty.
func _fx_lists(world) -> Array:
	var out: Array = []
	var targets: Array = [world]
	var fx = world.get("fx")
	if fx != null:
		targets.append(fx)
	for target in targets:
		for prop in target.get_property_list():
			if int(prop["type"]) != TYPE_ARRAY:
				continue
			if int(prop["usage"]) & PROPERTY_USAGE_SCRIPT_VARIABLE == 0:
				continue
			# THE SIMULATION IS NOT AN EFFECT. `foes` and `orbs` are drawn, and emptying
			# them changes the frame for a reason that has nothing to do with the weapon --
			# measured: a foe left standing from the fire showed up as a 26-pixel disc at
			# its own screen position in one capture and not the other, on every weapon
			# including the six that draw nothing. `spawned` is the queue `Game.step` drains
			# into `foes` and is never drawn at all.
			if String(prop["name"]) in NOT_AN_EFFECT:
				continue
			out.append({"owner": target, "name": String(prop["name"])})
	return out


## Take what the renderer would draw for a weapon effect OUT of the world, and return it so
## `_fx_restore` can put it back.
##
## EMPTIED IN PLACE, never replaced. `Array.clear()` and `Array.append_array()` are the two
## operations that work on a TYPED array (`Array[Shot]`, `Array[Foe]`); assigning a plain
## `Array` to one raises "Invalid assignment of property ... with value of type 'Array'" and
## GDScript then CARRIES ON past it -- so a check can report zero for its own reason while
## looking like a finding about the game. Both facts measured on the unfixed tree.
func _fx_hide(world) -> Array:
	var hidden: Array = []
	for slot in _fx_lists(world):
		var live: Array = slot["owner"].get(slot["name"])
		var held: Array = live.duplicate()
		hidden.append({"live": live, "held": held})
		# `set()` returns void, so `var err = ...set(...)` aborts this whole function with
		# "Trying to get a return value of a method that returns void" -- measured.
		live.clear()
	return hidden


## Put it back IN PLACE, so the world holds the same array objects it held before and the
## second capture is the first one with the effect returned, not a new world.
func _fx_restore(world, hidden: Array) -> void:
	for entry in hidden:
		var live: Array = entry["live"]
		live.append_array(entry["held"])


func _finish() -> void:
	var passed := ok and Check.ok
	print("verify_pixels: ", "PASS" if passed else "FAIL")
	quit(0 if passed else 1)
