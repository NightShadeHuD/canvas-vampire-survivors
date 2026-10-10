## The view: draws `Game` and feeds it input. Contains no rules.
##
## Everything interesting lives in `game.gd`, which is why `verify_slice.gd` can
## assert the simulation without a window. This file knows two things -- how to read
## a direction from the keyboard, and how to draw circles.
extends Node2D

var game: Game

func _ready() -> void:
	game = Game.new()

func _process(delta: float) -> void:
	# `DT_CLAMP` is a real constant from the generated config: a tab regaining focus
	# hands you a delta of several seconds, and the original clamps for that reason.
	game.step(minf(delta, Config.DT_CLAMP), _input_dir())
	queue_redraw()

func _input_dir() -> Vector2:
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

func _draw() -> void:
	draw_rect(Rect2(0, 0, Config.ARENA_WIDTH, Config.ARENA_HEIGHT), Color("141018"))

	for foe in game.foes:
		# The colour is the one in `src/data.ts`, not one chosen here.
		draw_circle(Vector2(foe.x, foe.y), foe.size, Color(foe.color))

	var hero := game.hero
	# Blink while invincible, so the i-frame rule is visible rather than inferred.
	var hero_color := Color("6ee7ff")
	if hero.invincible and int(game.elapsed * 20.0) % 2 == 0:
		hero_color = Color("2a6b7a")
	draw_circle(Vector2(hero.x, hero.y), hero.size, hero_color)

	# The weapon's reach, drawn faintly -- the slice's one attack, made legible.
	draw_arc(
		Vector2(hero.x, hero.y),
		float(game.weapon["baseRange"]),
		0.0, TAU, 48, Color(1, 1, 1, 0.08), 2.0
	)

	var font := ThemeDB.fallback_font
	draw_string(font, Vector2(16, 28), "HP %d / %d" % [int(hero.hp), int(hero.max_hp)], HORIZONTAL_ALIGNMENT_LEFT, -1, 20, Color("ffffff"))
	draw_string(font, Vector2(16, 54), "Time %.1fs    Kills %d    Foes %d" % [game.elapsed, game.kills, game.foes.size()], HORIZONTAL_ALIGNMENT_LEFT, -1, 18, Color("aabbcc"))
	draw_string(font, Vector2(16, 78), "WASD or arrows to move", HORIZONTAL_ALIGNMENT_LEFT, -1, 16, Color("667788"))
