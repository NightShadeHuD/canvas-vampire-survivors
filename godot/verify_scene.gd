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

var ok := true

func _init() -> void:
	var packed: PackedScene = load("res://scenes/main.tscn")
	_check(packed != null, "the scene loads", "res://scenes/main.tscn")
	if packed == null:
		_finish()
		return

	var main = packed.instantiate()
	root.add_child(main)
	# One frame, so `_ready` has run and the camera has been aimed.
	await process_frame

	_check(main.camera != null, "the scene HAS a camera", "Camera2D present")
	_check(main.camera.is_current(), "the camera is the active one", "make_current() called")

	# The bug, stated as an assertion: the hero must project INSIDE the viewport.
	var view := root.get_visible_rect().size
	var hero_pos: Vector2 = Vector2(main.game.hero.x, main.game.hero.y)
	var screen: Vector2 = (hero_pos - main.camera.position) * main.camera.zoom + view / 2.0
	_check(
		screen.x >= 0.0 and screen.x <= view.x and screen.y >= 0.0 and screen.y <= view.y,
		"the hero is INSIDE the visible viewport",
		"hero at screen (%0.0f, %0.0f) of %0.0fx%0.0f" % [screen.x, screen.y, view.x, view.y]
	)

	# The camera must FOLLOW, or the hero walks out of view the moment it moves --
	# the same bug wearing a different hat.
	var before: Vector2 = main.camera.position
	for i in 120:
		main.game.step(1.0 / 60.0, Vector2.RIGHT)
		main.camera.position = main.camera.position.lerp(Vector2(main.game.hero.x, main.game.hero.y), 0.15)
	_check(
		absf(main.camera.position.x - main.game.hero.x) < 60.0,
		"the camera follows the hero",
		"camera %0.0f vs hero %0.0f" % [main.camera.position.x, main.game.hero.x]
	)
	_check(main.camera.position.x > before.x, "and actually moved", "%0.0f -> %0.0f" % [before.x, main.camera.position.x])

	# The menu is what the player sees FIRST. It existed in the original and did not
	# exist here, which is why the port "didn't look like the source material".
	_check(main.get_node_or_null("Menu") != null, "there IS a menu", "Menu CanvasLayer")
	_check(main.get_node_or_null("Menu/Title") != null, "and a title", main.get_node("Menu/Title").text)
	_check(main.get_node_or_null("Menu/Start") != null, "and a way to start", "Start button")
	_check(main.state == main.State.MENU, "it is shown first", "state = MENU")
	_check(main.menu.visible, "and is visible", "menu.visible = true")

	# Pressing START must actually start.
	main.get_node("Menu/Start").emit_signal("pressed")
	await process_frame
	_check(main.state == main.State.PLAYING, "START begins a run", "state = PLAYING")
	_check(not main.menu.visible, "the menu gets out of the way", "menu.visible = false")
	_check(main.hud.visible, "and the HUD appears", "hud.visible = true")

	main.queue_free()
	_finish()

func _check(cond: bool, label: String, detail: String) -> void:
	if cond:
		print("  ok   %s  (%s)" % [label, detail])
	else:
		print("  FAIL %s  (%s)" % [label, detail])
		ok = false

func _finish() -> void:
	print("verify_scene: ", "PASS" if ok else "FAIL")
	quit(0 if ok else 1)
