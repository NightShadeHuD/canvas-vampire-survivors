## The view: draws `Game`, follows the hero with a camera, and runs the screens.
##
## Still contains no rules -- spawning, damage and i-frames all live in `game.gd`,
## which is why `verify_slice.gd` can assert the simulation without a window.
##
## WHAT WAS WRONG IN THE FIRST VERSION
##
## The hero was invisible. The arena is 2400x1600 and the hero starts at its centre,
## (1200, 800), while Godot's default viewport is 1152x648 -- so the camera was
## showing the top-left corner and the hero was 48 pixels off the right edge. There
## was no Camera2D at all. `verify_slice.gd` passed the whole time, because it
## asserts the SIMULATION and the simulation was correct: the hero really was at
## (1200, 800). Nothing tested whether a human could see it.
extends Node2D

enum State { MENU, PLAYING, DEAD, LEVEL_UP, PAUSED }

## `renderMine`'s inline numbers, named so the drawing and any assertion about it read the
## same value: a 10px body with a 1.5px white rim.
const MINE_BODY_RADIUS := 10.0
const MINE_RIM_WIDTH := 1.5
## `performance.now() / 60` in the original, and `performance.now()` is MILLISECONDS -- so
## the armed pulse turns over every 2*PI*0.06 = 0.377s and this divisor is that 60ms in
## seconds. Written as the original's period rather than an invented one.
const MINE_PULSE_PERIOD := 0.06

var game: Game
var state := State.MENU
## The three offers currently on screen, cleared when one is taken.
var _offers: Array = []
## Built in code rather than in the scene: it is a title and three buttons, and a
## `.tscn` that has to be kept in step with `_show_picks` is a second place to be
## wrong. The menu is in the scene because the MENU is the thing you look at first.
var picker: VBoxContainer
## The run-summary panel, hidden until the hero dies.
var over: VBoxContainer
## The pause panel, hidden until Esc or P.
var paused_panel: VBoxContainer

## The dim behind a modal, hidden unless one is up. Set where it is created; a dim that
## outlives its modal is a dim over the whole game, which is what it was.
var shade_rect: ColorRect = null

@onready var camera: Camera2D = $Camera2D
@onready var menu: CanvasLayer = $Menu
@onready var hud: CanvasLayer = $HUD
@onready var stats: Label = $HUD/Stats

func _ready() -> void:
	_start_run()
	_show_menu(true)
	$Menu/Start.pressed.connect(_on_start)

	# A centred column over a dimming panel, above everything else.
	var layer := CanvasLayer.new()
	layer.name = "Picker"
	layer.layer = 2
	add_child(layer)

	var shade := ColorRect.new()
	shade.name = "Shade"
	shade.set_anchors_preset(Control.PRESET_FULL_RECT)
	# 0.82 was nearly opaque: the picker came up over a black screen, so a player choosing
	# an upgrade could not see the fight they were choosing it for. A dim is meant to move
	# the eye to the panel, not to hide the game -- and the picker is already a solid panel
	# with its own contrast.
	shade.color = Color(0.02, 0.02, 0.04, 0.45)
	# HIDDEN BY DEFAULT, and it was not. The shade exists to dim the world BEHIND a modal,
	# but nothing ever hid it, so every frame of the game -- title screen and gameplay
	# alike -- ran under 82% black. Measured before the fix: hiding it changed all
	# 746,496 pixels of a 1152x648 window, HUD contrast was 1.32:1 (WCAG AA needs 4.5:1)
	# and the hero read at 1.47:1 against the floor.
	#
	# Nothing in the twelve suites caught it, because every one of them asserts state,
	# and the state was correct. What was wrong was that a player could not see.
	shade.visible = false
	layer.add_child(shade)
	shade_rect = shade

	# The game-over panel shares the picker's layer and layout: two modal overlays that
	# never appear together, so a second CanvasLayer would be a second thing to keep in
	# step for no gain.
	over = VBoxContainer.new()
	over.name = "GameOver"
	over.set_anchors_preset(Control.PRESET_CENTER)
	# GROW FROM THE CENTRE, not from its top-left.
	#
	# `PRESET_CENTER` sets the ANCHORS to the middle, but a Control's grow direction
	# defaults to END -- so a container whose size is not known until its content exists
	# expands to the RIGHT and DOWN from that centre point. Its top-left lands exactly on
	# the screen centre and the panel sits in the bottom-right quadrant.
	#
	# Measured from a screen recording: `LEVEL 4` and the upgrade panel both sat well right
	# of centre, with the panel's top-left at the centre line. A behavioural audit found
	# the same for all three modals -- picker, game over and pause -- and measured each
	# one's rect starting at exactly (576, 324) in a 1152x648 window.
	over.grow_horizontal = Control.GROW_DIRECTION_BOTH
	over.grow_vertical = Control.GROW_DIRECTION_BOTH
	over.add_theme_constant_override("separation", 18)
	over.alignment = BoxContainer.ALIGNMENT_CENTER
	layer.add_child(over)
	over.visible = false

	paused_panel = VBoxContainer.new()
	paused_panel.name = "Paused"
	paused_panel.set_anchors_preset(Control.PRESET_CENTER)
	# GROW FROM THE CENTRE, not from its top-left.
	#
	# `PRESET_CENTER` sets the ANCHORS to the middle, but a Control's grow direction
	# defaults to END -- so a container whose size is not known until its content exists
	# expands to the RIGHT and DOWN from that centre point. Its top-left lands exactly on
	# the screen centre and the panel sits in the bottom-right quadrant.
	#
	# Measured from a screen recording: `LEVEL 4` and the upgrade panel both sat well right
	# of centre, with the panel's top-left at the centre line. A behavioural audit found
	# the same for all three modals -- picker, game over and pause -- and measured each
	# one's rect starting at exactly (576, 324) in a 1152x648 window.
	paused_panel.grow_horizontal = Control.GROW_DIRECTION_BOTH
	paused_panel.grow_vertical = Control.GROW_DIRECTION_BOTH
	paused_panel.add_theme_constant_override("separation", 18)
	paused_panel.alignment = BoxContainer.ALIGNMENT_CENTER
	layer.add_child(paused_panel)
	paused_panel.visible = false

	picker = VBoxContainer.new()
	picker.name = "Offers"
	picker.set_anchors_preset(Control.PRESET_CENTER)
	# GROW FROM THE CENTRE, not from its top-left.
	#
	# `PRESET_CENTER` sets the ANCHORS to the middle, but a Control's grow direction
	# defaults to END -- so a container whose size is not known until its content exists
	# expands to the RIGHT and DOWN from that centre point. Its top-left lands exactly on
	# the screen centre and the panel sits in the bottom-right quadrant.
	#
	# Measured from a screen recording: `LEVEL 4` and the upgrade panel both sat well right
	# of centre, with the panel's top-left at the centre line. A behavioural audit found
	# the same for all three modals -- picker, game over and pause -- and measured each
	# one's rect starting at exactly (576, 324) in a 1152x648 window.
	picker.grow_horizontal = Control.GROW_DIRECTION_BOTH
	picker.grow_vertical = Control.GROW_DIRECTION_BOTH
	picker.add_theme_constant_override("separation", 18)
	picker.alignment = BoxContainer.ALIGNMENT_CENTER
	layer.add_child(picker)
	picker.visible = false

func _on_start() -> void:
	_show_menu(false)
	state = State.PLAYING
	_start_run()

func _start_run() -> void:
	game = Game.new()
	# A restart must not inherit the previous run's overlays -- a level-up screen left
	# open across a death would offer upgrades to a dead hero.
	_offers = []
	if picker != null:
		picker.visible = false
	if over != null:
		over.visible = false
	_lower_shade()
	if paused_panel != null:
		paused_panel.visible = false
	# Aim the camera at the hero before the first frame is drawn, or the first frame
	# is the black corner the original bug produced.
	camera.position = Vector2(game.hero.x, game.hero.y)
	# STOP AT THE ARENA EDGE. Without this the view runs past the drawn floor whenever the
	# hero is near a border, and what is outside is the engine's default clear colour --
	# a grey band, with the spawn ring visible on it. Enemies appear out there BY DESIGN
	# (spawning off-screen is right); seeing them before they arrive is not.
	#
	# Set here rather than per-frame: the limit is a property of the camera, and clamping
	# the position by hand would fight the lerp below and the smoothing after it.
	camera.limit_left = 0
	camera.limit_top = 0
	camera.limit_right = int(Config.ARENA_WIDTH)
	camera.limit_bottom = int(Config.ARENA_HEIGHT)
	camera.make_current()

func _show_menu(visible_now: bool) -> void:
	menu.visible = visible_now
	hud.visible = not visible_now
	# FOCUS, or the keyboard cannot start the game. Godot's `ui_accept` (Enter/Space) is
	# delivered to whatever Control has FOCUS, and nothing called `grab_focus()` anywhere --
	# so `focus owner` was null on every panel. An audit measured it: pressing Enter and
	# Space at the menu left `state` at MENU.
	#
	# Deferred, because the node may not be in the tree yet on the frame this is called.
	if visible_now:
		_focus_first("Menu")

## Give focus to the first focusable Control under `path`.
##
## Deferred by one frame: a Container sizes its children on the frame after they are added,
## and a Control that is not yet laid out cannot take focus. The first version called
## `grab_focus()` immediately and the picker stayed unfocused -- the same one-frame layout
## delay that made a pixel check read a rect of width zero.
func _focus_first(path: String) -> void:
	var root := get_node_or_null(path)
	if root == null:
		# LOUD, not silent. Every call site here was a no-op for a whole release because the
		# path was wrong (`Picker/Choices` where the node is `Picker/Offers/Choices`) and this
		# returned without a word. **A focus request that silently does nothing is
		# indistinguishable from a focus request that works** -- and the only assertion
		# covering it checked a different panel, so nothing noticed.
		#
		# An error rather than a warning: there is no situation in which asking for focus on a
		# node that does not exist is correct.
		push_error("_focus_first: no node at '%s' -- the keyboard cannot reach this panel" % path)
		return
	await get_tree().process_frame
	for node in _focusable_under(root):
		(node as Control).grab_focus()
		return


## Depth-first walk for the first node that can actually hold focus.
func _focusable_under(node: Node) -> Array:
	var out: Array = []
	for child in node.get_children():
		if child is Control and (child as Control).focus_mode != Control.FOCUS_NONE:
			out.append(child)
			continue
		out.append_array(_focusable_under(child))
	return out


func _process(delta: float) -> void:
	if state == State.MENU:
		return

	if state == State.PLAYING:
		# A level-up PAUSES the run. The original does the same, and it is what makes
		# the choice a decision rather than something that happens while you are being
		# swarmed -- the sim is not stepped at all until a pick is made.
		if game.pending_picks > 0:
			state = State.LEVEL_UP
			_show_picks()
		else:
			# `DT_CLAMP` is a real constant: a tab regaining focus hands you a delta
			# of several seconds. `minf` is the same guard the original applies.
			game.step(minf(delta, Config.DT_CLAMP), _input_dir())
			if game.hero.dead:
				state = State.DEAD
				_show_game_over()

	var hero := game.hero
	# The camera FOLLOWS. Without this the arena scrolls off and the hero walks out
	# of view the moment it moves, which is the same bug wearing a different hat.
	camera.position = camera.position.lerp(Vector2(hero.x, hero.y), 0.15)
	stats.text = "HP %d / %d\nLv.%d   XP %d / %d\nTime %.1fs    Kills %d\nWASD / arrows to move" % [
		int(hero.hp), int(hero.max_hp),
		hero.level, int(hero.exp), int(hero.exp_to_next),
		game.elapsed, game.kills
	]
	queue_redraw()

## Esc or P toggles pause -- the original's binding, taken from `index.html` rather
## than chosen here.
##
## This used to QUIT. That was a placeholder from the first commit and it is the wrong
## behaviour in the most expensive way: a player hits Escape expecting a menu and loses
## the run instead. `verify_scene.gd` now asserts the run survives the key.
func _unhandled_input(event: InputEvent) -> void:
	if not (event is InputEventKey and event.pressed and not event.echo):
		return
	if event.keycode != KEY_ESCAPE and event.keycode != KEY_P:
		return
	# Pausing a level-up would put two modals on screen at once, and the pick is the
	# one that must be answered.
	if state == State.PLAYING:
		state = State.PAUSED
		_show_pause(true)
	elif state == State.PAUSED:
		state = State.PLAYING
		_show_pause(false)

## The pause panel. Reuses the shared overlay layer, like the other two.
func _show_pause(visible_now: bool) -> void:
	# Focus the pause panel too, so a keyboard player is not left with a modal they cannot
	# read the controls of. No button to land on yet -- the deferred walk simply finds
	# nothing and does nothing, which is correct rather than a failure.
	if visible_now and paused_panel.get_child_count() == 0:
		var title := Label.new()
		title.name = "Title"
		title.text = "PAUSED"
		title.add_theme_font_size_override("font_size", 44)
		title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		paused_panel.add_child(title)

		var hint := Label.new()
		hint.name = "Hint"
		hint.text = "Esc / P to resume"
		hint.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		hint.add_theme_font_size_override("font_size", 18)
		paused_panel.add_child(hint)
	paused_panel.visible = visible_now

## Set by `verify_play.gd` so a test can drive input deterministically.
## `Input.is_action_pressed` reads real hardware, which a headless test has none of --
## and a seam is better than the test reaching into `Input` and faking a device.
var _input_dir_override: Variant = null

func _input_dir() -> Vector2:
	if _input_dir_override != null:
		return _input_dir_override
	var d := Vector2.ZERO
	if Input.is_action_pressed("ui_right"):
		d.x += 1.0
	if Input.is_action_pressed("ui_left"):
		d.x -= 1.0
	if Input.is_action_pressed("ui_down"):
		d.y += 1.0
	if Input.is_action_pressed("ui_up"):
		d.y -= 1.0
	return d

## Build and show the three offers. One pick is spent per call, so a multi-level orb
## shows the screen again for the next one rather than silently banking it.
func _show_picks() -> void:
	for child in picker.get_children():
		# DETACH FIRST, then free. `queue_free()` defers removal to the end of the frame, so a
		# child added below in the SAME frame lands while the old one is still attached -- and
		# Godot renames the newcomer `@VBoxContainer@N`. A later lookup by NAME then resolves the
		# corpse, and `_focus_first` throws "previously freed".
		#
		# **This was fixed in #155 and REVERTED during the evolution assembly**: the port's
		# `main.gd` came from a worktree based before that PR, and it was copied wholesale.
		# `verify_scene`'s multi-round assertion caught it -- which is the whole reason that
		# assertion drives the picker three times instead of once.
		picker.remove_child(child)
		child.queue_free()

	var title := Label.new()
	title.name = "Title"
	title.text = "LEVEL %d" % game.hero.level
	title.add_theme_font_size_override("font_size", 40)
	title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	picker.add_child(title)

	var box := VBoxContainer.new()
	box.name = "Choices"
	box.add_theme_constant_override("separation", 10)
	picker.add_child(box)

	_offers = Upgrades.choose(game.hero, 3)
	for i in _offers.size():
		var entry: Dictionary = _offers[i]
		var b := Button.new()
		b.name = "Pick%d" % i
		# A THIRD LINE, which is where the original puts it -- `<div class="evolve-tag">`
		# under the description, not a suffix on the label. It is the only place a player
		# is told that the level they are about to take changes the weapon's SHAPE, and
		# it is empty for every offer that is not an evolution.
		var offer_text := "%s%s\n%s" % [
			entry["def"]["name"], Upgrades.label(entry), entry["def"]["description"]
		]
		var evolve := Upgrades.evolve_tag(entry)
		if evolve != "":
			offer_text += "\n" + evolve
		b.text = offer_text
		b.custom_minimum_size = Vector2(420, 64)
		b.pressed.connect(_on_pick.bind(i))
		box.add_child(b)

	# The shade goes UP with the picker and DOWN with it. A dim that outlives its modal
	# is a dim over the whole game.
	if shade_rect != null:
		shade_rect.visible = true
	picker.visible = true
	# A level-up can only be ANSWERED with the mouse without this. The audit tried Enter,
	# Space, `1`, Down and numpad-1 at the picker and all five left `pending_picks` at 1.
	_focus_first("Picker/Offers/Choices")

## Lower the modal dim. EVERY path that hides the picker must call this, or the dim outlives
## the modal and covers the rest of the run.
##
## This exists because that is precisely what happened: `shade_rect.visible = true` was added
## with the picker and the counterpart edit FAILED, and the failure was seen and moved past.
## Three call sites is three chances to forget, so it is one function.
func _lower_shade() -> void:
	if shade_rect != null and not over.visible:
		shade_rect.visible = false


func _on_pick(index: int) -> void:
	if index < 0 or index >= _offers.size():
		return
	Upgrades.apply(game.hero, _offers[index])
	game.pending_picks -= 1
	_offers = []
	picker.visible = false
	_lower_shade()
	state = State.PLAYING
	# Nothing steps while the offer is up, so `elapsed` has not moved and the camera
	# is already where it should be. Resuming is just changing the state back.

## What the run was, and a way to start another.
##
## The original shows "YOU DIED" with the run's figures -- taken from `index.html`
## rather than invented -- and without this the game simply stops, which reads as a
## crash rather than an ending.
func _show_game_over() -> void:
	for child in over.get_children():
		# Same reason as the picker above: the game-over panel is rebuilt on every death.
		over.remove_child(child)
		child.queue_free()

	var title := Label.new()
	title.name = "Title"
	title.text = "YOU DIED"
	title.add_theme_font_size_override("font_size", 48)
	title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	over.add_child(title)

	var summary := Label.new()
	summary.name = "Summary"
	summary.text = "%s\nSurvived %s\n%d kills   Level %d" % [
		_format_time(game.elapsed), _format_time(game.elapsed), game.kills, game.hero.level
	]
	summary.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	summary.add_theme_font_size_override("font_size", 20)
	over.add_child(summary)

	var again := Button.new()
	again.name = "Again"
	again.text = "PLAY AGAIN"
	again.custom_minimum_size = Vector2(240, 48)
	again.pressed.connect(_restart)
	over.add_child(again)

	over.visible = true
	_focus_first("Picker")

## `m:ss`, matching the original's run timer rather than raw seconds.
func _format_time(seconds: float) -> String:
	var total := int(seconds)
	return "%d:%02d" % [total / 60, total % 60]

func _restart() -> void:
	over.visible = false
	picker.visible = false
	_offers = []
	state = State.PLAYING
	_start_run()

func _draw() -> void:
	# The arena floor, drawn as a grid so movement is legible. The original sits on a
	# dark backdrop with a subtle grid for the same reason.
	draw_rect(Rect2(0, 0, Config.ARENA_WIDTH, Config.ARENA_HEIGHT), Color("141018"))
	var grid := float(Config.GRID_SIZE)
	var gx := 0.0
	while gx <= float(Config.ARENA_WIDTH):
		draw_line(Vector2(gx, 0), Vector2(gx, Config.ARENA_HEIGHT), Color(1, 1, 1, 0.03), 1.0)
		gx += grid
	var gy := 0.0
	while gy <= float(Config.ARENA_HEIGHT):
		draw_line(Vector2(0, gy), Vector2(Config.ARENA_WIDTH, gy), Color(1, 1, 1, 0.03), 1.0)
		gy += grid

	if game == null:
		return

	# The STRIKE SHAPES, on the floor and under the actors: what a weapon's damage
	# covered, drawn where it covered it. A foe standing inside the band has to stay
	# visible, so the shapes go under everything rather than over it.
	for strike in game.fx.strikes:
		_draw_strike(strike)

	# Orbs first, under the actors: a pickup the player cannot see behind a foe is a
	# pickup they will not notice they took.
	for orb in game.orbs:
		_draw_orb(orb)
	# MINES next, which is the original's order (`game-render.ts:80-81` draws `expOrbs`
	# and then `mines`): a mine lies on the ground UNDER the actors that walk over it. It
	# is drawn for its whole fuse, not only once armed, because a mine a player cannot see
	# is a mine they cannot avoid -- and `_draw_mine` below is where the fuse becomes
	# visible.
	for mine in game.mines:
		_draw_mine(mine)
	# Shots UNDER the actors, so a bolt passing behind a foe still reads as passing
	# behind it. Drawn at all because a weapon whose projectile is invisible is the
	# same class of bug as a hero who is -- and that one shipped.
	for shot in game.shots:
		_draw_shot(shot)
	# HOSTILE bolts, in the same pass and UNDER the actors for the same reason. They were
	# simulated every frame and never drawn: an audit measured that removing a Cultist's
	# bolt 88px from the hero changed ZERO pixels, while moving the same shot into the
	# drawn list changed 108. Fourteen damage with nothing on screen to read it from.
	for shot in game.enemy_shots:
		_draw_shot(shot, true)
	for foe in game.foes:
		_draw_foe(foe)
	if not game.hero.dead:
		_draw_hero(game.hero)
	# Sparks LAST and over everything, which is the original's order: `game-render.ts`
	# draws `game.particles` after the player and the projectiles, never before it.
	for spark in game.fx.sparks:
		_draw_spark(spark)

## The hero, matching `src/entity-render.ts`: a soft glow, a solid body, a pale core,
## and the weapon's reach as a pulsing ring.
func _draw_hero(hero: Hero) -> void:
	# The original strobes alpha rather than hiding the hero during i-frames. Drawn
	# as two rings here because Godot's `draw_circle` has no gradient.
	if hero.invincible and int(game.elapsed * 16.0) % 2 == 0:
		draw_circle(Vector2(hero.x, hero.y), hero.size * 2.2, Color(100 / 255.0, 200 / 255.0, 1.0, 0.12))
	else:
		draw_circle(Vector2(hero.x, hero.y), hero.size * 2.2, Color(100 / 255.0, 200 / 255.0, 1.0, 0.35))
	draw_circle(Vector2(hero.x, hero.y), hero.size, Color("44aaff"))
	draw_circle(Vector2(hero.x, hero.y), hero.size * 0.55, Color("cfeaff"))

	# The Garlic ring, pulsing -- `rgba(160,255,160,0.25 + sin(t) * 0.08)` in the
	# original, reproduced with the same period.
	#
	# DRAWN AT THE AURA'S OWN REACH. It used to be drawn at `game.weapon["baseRange"]`,
	# a number the aura never uses: `WeaponFire` fires at baseRange x levelArea x areaMult,
	# so after five Area passives the real reach was 177 while the ring stopped at 110. A
	# behavioural audit measured the consequence exactly -- a foe 150px away, OUTSIDE the
	# drawn ring, took damage. `garlic_reach` asks `WeaponFire.reach_for`, which is the
	# same function the damage comes from, so the ring cannot drift from the aura again.
	var garlic := garlic_reach(hero)
	if garlic > 0.0:
		var t := game.elapsed / 0.4
		draw_arc(
			Vector2(hero.x, hero.y), garlic,
			0.0, TAU, 64, Color(160 / 255.0, 1.0, 160 / 255.0, 0.25 + sin(t) * 0.08), 2.0
		)

## The radius the Garlic aura is FIRING at, or 0.0 when the hero holds no garlic.
##
## The original draws this ring only for a hero who holds the weapon
## (`self.weapons.find((w) => w.id === 'garlic')`) and rings it at `garlic.getRange(self)`
## -- the same call the aura damages with. This delegates to `WeaponFire.reach_for` for
## that reason, and it is PUBLIC so `verify_scene.gd` can compare the ring against the
## aura rather than taking the drawing code's word for it.
func garlic_reach(hero: Hero) -> float:
	for w in hero.weapons:
		if w["id"] == "garlic":
			return WeaponFire.reach_for(w["def"], hero, int(w["level"]))
	return 0.0

## The area one weapon's fire covered. One branch per `Fx.Strike.Kind`, and every branch
## draws at `strike.reach` -- the radius the damage actually used -- because a shape that
## stops short of its own hitbox is a drawing that lies about what the code does. That
## exact lie is what the Garlic ring was doing: reach 177, ring 110.
##
##   SWEEP  the Whip's band. NOT in the original, which throws two particle bursts at the
##          ends of the band and draws no band at all. Drawn here because the band is the
##          one shape in this game a player can be wronged by -- a foe at |dy| == 41 takes
##          nothing -- and the edge is the claim. Fill at 0.10 so a foe inside it is still
##          legible; a 2px edge at 0.65 so the boundary reads as a boundary.
##   RING   a nova, growing from the hero OUT TO the reach, so the moment of maximum
##          danger is the moment the ring arrives at the radius that hurts.
##   BEAM   the drain tether, hero to foe.
##   BLAST  the mine's DETONATION, at the radius the damage used. The mine's own disc, which
##          the original fills for the whole fuse, is `_draw_mine` -- this is the flash at
##          the instant the fuse runs out.
func _draw_strike(strike: Fx.Strike) -> void:
	var a := strike.fade()
	var c := strike.color
	match strike.kind:
		Fx.Strike.Kind.SWEEP:
			var r := Rect2(
				strike.x - strike.reach,
				strike.y - strike.half_height,
				strike.reach * 2.0,
				strike.half_height * 2.0
			)
			draw_rect(r, Color(c.r, c.g, c.b, 0.10 * a))
			draw_rect(r, Color(c.r, c.g, c.b, 0.65 * a), false, 2.0)
		Fx.Strike.Kind.RING, Fx.Strike.Kind.BLAST:
			# GROWS TO THE REACH. `1.0 - a` is elapsed time as a fraction of the life, so
			# the ring is at 25% of the radius on the frame it is born -- visible at once --
			# and at 100% on the frame it dies, which is the frame the damage landed.
			var radius := strike.reach * (0.25 + 0.75 * (1.0 - a))
			if strike.kind == Fx.Strike.Kind.BLAST:
				# The DETONATION, drawn where the mine was. `renderMine` fills this circle
				# for as long as the mine is on the ground and `_draw_mine` above now does
				# exactly that; this is the second fill at the instant the fuse runs out,
				# so the frame the damage lands on is a frame a player can read.
				draw_circle(Vector2(strike.x, strike.y), strike.reach, Color(c.r, c.g, c.b, 0.16 * a))
			draw_arc(Vector2(strike.x, strike.y), radius, 0.0, TAU, 64, Color(c.r, c.g, c.b, 0.7 * a), 3.0)
		Fx.Strike.Kind.BEAM:
			draw_line(
				Vector2(strike.x, strike.y),
				Vector2(strike.x2, strike.y2),
				Color(c.r, c.g, c.b, 0.75 * a),
				3.0
			)

## One particle, matching `renderParticle` in `src/entity-render.ts`: a filled circle in
## the spark's colour, its alpha taken from what is left of its life.
func _draw_spark(spark: Fx.Spark) -> void:
	draw_circle(
		Vector2(spark.x, spark.y),
		spark.size,
		Color(spark.color.r, spark.color.g, spark.color.b, clampf(spark.life, 0.0, 1.0))
	)

## A shot in flight. Orbit shards are drawn as a ring segment, everything else as a
## bright core with a trail, so a boomerang and a knife are distinguishable at a glance.
## A shot. `hostile` tints it RED and gives it a hotter core -- the simulation treats
## friendly and enemy shots as one type, so the only thing distinguishing them on screen is
## this, and a bolt that looks like yours is worse than one you cannot see.
func _draw_shot(shot: Shot, hostile: bool = false) -> void:
	var p := Vector2(shot.x, shot.y)
	if shot.kind == Shot.Kind.ORBIT:
		draw_circle(p, shot.radius, Color("ffd166"))
		draw_circle(p, shot.radius * 0.5, Color(1, 1, 1, 0.8))
		return
	var heading := Vector2(shot.vx, shot.vy)
	if heading.length() > 0.001:
		# A short tail behind the shot, in the direction it came from.
		draw_line(p, p - heading.normalized() * 14.0, Color(1, 1, 1, 0.25), 3.0)
	var tint := Color("ffcc55") if shot.kind == Shot.Kind.BOOMERANG else Color("aaddff")
	if hostile:
		# A halo as well as a colour: hostile shots are the only thing in the game that
		# hurts you at a distance, and colour alone is not a sufficient signal for anyone
		# who cannot separate red from blue.
		draw_circle(p, shot.radius * 2.1, Color(1.0, 0.25, 0.2, 0.22))
		tint = Color("ff5544")
	draw_circle(p, shot.radius, tint)
	draw_circle(p, shot.radius * 0.45, Color(1, 1, 1, 0.9))

## An experience orb: a green core with a soft ring, brighter as it is magnetised.
func _draw_orb(orb: Orb) -> void:
	var p := Vector2(orb.x, orb.y)
	# Fade out over the last second of life, so an orb about to expire looks like it.
	var a := clampf(orb.life, 0.0, 1.0)
	draw_circle(p, orb.size * 2.0, Color(0.4, 1.0, 0.5, 0.18 * a))
	draw_circle(p, orb.size, Color(0.45, 1.0, 0.55, a))
	# A white core once it is moving, which reads as "this one is coming to you".
	if orb.magnet_speed > 0.0:
		draw_circle(p, orb.size * 0.45, Color(1, 1, 1, 0.85 * a))

## A mine on the ground, matching `renderMine` in `src/entity-render.ts:111`:
##
##     export function renderMine(ctx, self) {
##         const armed = self.fuse < self.maxFuse * 0.5;
##         const pulse = armed ? 0.5 + Math.sin(performance.now() / 60) * 0.5 : 0.3;
##         ctx.fillStyle = `rgba(255,80,80,${0.25 + pulse * 0.35})`;
##         ctx.arc(self.x, self.y, self.radius, 0, Math.PI * 2); ctx.fill();
##         ctx.fillStyle = armed ? '#ff4444' : '#aa4444';
##         ctx.arc(self.x, self.y, 10, 0, Math.PI * 2); ctx.fill();
##         ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke();
##     }
##
## TWO THINGS A PLAYER READS OFF THIS FRAME, and both of them are the FUSE:
##
##   * THE DISC IS THE BLAST RADIUS. It is drawn at `self.radius`, which is the number
##     `Mine.update` damages with -- so the circle a player is standing outside is exactly
##     the circle that will not hurt them. Until the fuse was ported this port had no mine
##     at all and drew the blast AFTER the damage landed, which shows a player the radius
##     they have already been hit by.
##   * ARMED IS BRIGHTER. Past half its fuse the body turns `#ff4444` and the disc begins to
##     pulse; before that it is `#aa4444` at a steady alpha. `Mine.armed()` owns that rule,
##     one level down, so the state a suite asserts and the state a player sees are the same
##     value rather than two copies of the same comparison.
##
## THE CLOCK IS `game.elapsed`, NOT `performance.now()`. The original's divisor is in
## MILLISECONDS, so its period is 2*PI*0.06s; `MINE_PULSE_PERIOD` is that in seconds, which
## is the same period. `elapsed` is the port's clock for every other time-driven drawing --
## the Garlic ring reads it too -- and it is what `verify_pixels.gd` pins to 0.0 for BOTH
## halves of a with/without capture. A wall clock here would make those two frames differ
## for a reason that is not the mine.
func _draw_mine(mine: Mine) -> void:
	var armed := mine.armed()
	var pulse := (0.5 + sin(game.elapsed / MINE_PULSE_PERIOD) * 0.5) if armed else 0.3
	draw_circle(
		Vector2(mine.x, mine.y),
		mine.radius,
		Color(1.0, 80.0 / 255.0, 80.0 / 255.0, 0.25 + pulse * 0.35)
	)
	draw_circle(
		Vector2(mine.x, mine.y),
		MINE_BODY_RADIUS,
		Color("ff4444") if armed else Color("aa4444")
	)
	draw_arc(
		Vector2(mine.x, mine.y), MINE_BODY_RADIUS, 0.0, TAU, 32, Color.WHITE, MINE_RIM_WIDTH
	)

## A foe, matching `src/entity-render.ts`: body in its data colour -- or the iced blue of a
## SLOWED one -- a pale core, and an HP bar once it has been hit.
##
## THE BODY COLOUR COMES FROM THE FOE rather than from a second copy of the rule written
## here. `renderEnemy`'s chain is `flashTimer` -> `slowTimer` -> the armed bomber's blink ->
## the data colour, and `Foe.body_color` owns the slow branch of it -- so the colour a suite
## asserts and the colour a player sees are the same value, and a slowed foe cannot be
## simulated without being drawn.
func _draw_foe(foe: Foe) -> void:
	var p := Vector2(foe.x, foe.y)
	draw_circle(p, foe.size, foe.body_color())
	draw_circle(p, foe.size * 0.5, Color(1, 1, 1, 0.25))

	if foe.hp < foe.max_hp:
		var pct := maxf(0.0, foe.hp / foe.max_hp)
		var w := 30.0
		draw_rect(Rect2(p.x - w / 2.0, p.y - foe.size - 8.0, w, 4.0), Color("222222"))
		draw_rect(Rect2(p.x - w / 2.0, p.y - foe.size - 8.0, w * pct, 4.0), Color("44dd44"))
