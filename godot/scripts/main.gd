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

enum State { MENU, PLAYING, DEAD, LEVEL_UP }

var game: Game
var state := State.MENU
## The three offers currently on screen, cleared when one is taken.
var _offers: Array = []
## Built in code rather than in the scene: it is a title and three buttons, and a
## `.tscn` that has to be kept in step with `_show_picks` is a second place to be
## wrong. The menu is in the scene because the MENU is the thing you look at first.
var picker: VBoxContainer

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
	shade.color = Color(0.02, 0.02, 0.04, 0.82)
	layer.add_child(shade)

	picker = VBoxContainer.new()
	picker.name = "Offers"
	picker.set_anchors_preset(Control.PRESET_CENTER)
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
	# Aim the camera at the hero before the first frame is drawn, or the first frame
	# is the black corner the original bug produced.
	camera.position = Vector2(game.hero.x, game.hero.y)
	camera.make_current()

func _show_menu(visible_now: bool) -> void:
	menu.visible = visible_now
	hud.visible = not visible_now

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

func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventKey and event.pressed and not event.echo:
		if event.keycode == KEY_ESCAPE or event.keycode == KEY_P:
			get_tree().quit()

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

	picker.visible = true

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
