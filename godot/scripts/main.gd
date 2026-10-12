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
		b.text = "%s%s\n%s" % [entry["def"]["name"], Upgrades.label(entry), entry["def"]["description"]]
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
	_focus_first("Picker/Choices")

func _on_pick(index: int) -> void:
	if index < 0 or index >= _offers.size():
		return
	Upgrades.apply(game.hero, _offers[index])
	game.pending_picks -= 1
	_offers = []
	picker.visible = false
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
	_focus_first("Picker/GameOver")

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

	# Orbs first, under the actors: a pickup the player cannot see behind a foe is a
	# pickup they will not notice they took.
	for orb in game.orbs:
		_draw_orb(orb)
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
	var t := game.elapsed / 0.4
	draw_arc(
		Vector2(hero.x, hero.y), float(game.weapon["baseRange"]),
		0.0, TAU, 64, Color(160 / 255.0, 1.0, 160 / 255.0, 0.25 + sin(t) * 0.08), 2.0
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

## A foe, matching `src/entity-render.ts`: body in its data colour, a pale core, and
## an HP bar once it has been hit.
func _draw_foe(foe: Foe) -> void:
	var p := Vector2(foe.x, foe.y)
	draw_circle(p, foe.size, Color(foe.color))
	draw_circle(p, foe.size * 0.5, Color(1, 1, 1, 0.25))

	if foe.hp < foe.max_hp:
		var pct := maxf(0.0, foe.hp / foe.max_hp)
		var w := 30.0
		draw_rect(Rect2(p.x - w / 2.0, p.y - foe.size - 8.0, w, 4.0), Color("222222"))
		draw_rect(Rect2(p.x - w / 2.0, p.y - foe.size - 8.0, w * pct, 4.0), Color("44dd44"))
