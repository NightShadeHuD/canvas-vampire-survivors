## The dynamic half of `check:reach`: drives the RUNNING game and reports what a keyboard can
## actually make happen.
##
## WHY THIS FILE EXISTS
##
## Four player-visible bugs shipped in this project and none of them was a logic error. Two
## were INPUT bugs and both passed every assertion the project had:
##
##   WASD did nothing                 the movement code was right; `project.godot` had no
##                                    `[input]` section, so the HUD advertised letters that
##                                    were bound to nothing
##   the menus could not be answered  `ui_accept` goes to whatever Control has FOCUS, and
##                                    nothing had ever called `grab_focus()`
##
## `verify_scene.gd` asserts the CONFIGURATION (`InputMap` has the key, a focus owner exists)
## and that half is worth having. It cannot see the second-order failure: a focus owner that
## exists but is the WRONG NODE, or a binding that the engine resolves differently, or a
## Control that holds focus and still does not answer. This probe drives the real input path
## and reports what changed, so `scripts/check-reach.mjs` can decide.
##
## IT IS A PROBE, NOT A SUITE. It prints `REACH ...` lines and quits 0; it contains no
## verdicts and does not use `Check`. The gate owns the judgement -- and an assertion floor
## applied to a probe would measure the wrong thing.
##
##   godot --headless --path godot --script res://reach_probe.gd -- \
##       --claim-key=W,87 --declared=ui_up,ui_down
##
## THREE THINGS MEASURED HERE THAT A GATE AUTHOR WOULD OTHERWISE GET WRONG
##
##   1. A focused Button fires `pressed` on the RELEASE of `ui_accept`, not on the press.
##      A probe that pushes only a keydown and asserts the state changed FAILS ON CORRECT
##      CODE. Every key below is driven down AND up.
##
##   2. `Viewport.push_input()` routes a key to the focused Control but does NOT update
##      `Input.is_action_pressed()`. `Input.parse_input_event()` + `Input.flush_buffered_events()`
##      does both, which is why it is the only path used here: it is the only one that can
##      answer "does pressing W move the hero", since the hero is moved by polling an action.
##
##   3. A synthetic `InputEventKey` needs only `keycode` to satisfy `is_action_pressed`; the
##      engine's own `ui_accept` template events carry `physical_keycode = 0`. Events are sent
##      with BOTH fields set, which is what a real keyboard sends.
##
## WHAT THIS PROBE CANNOT SEE, stated because the limit matters: it drives a HEADLESS tree
## with a 64x64 root viewport, so it says nothing about where anything is DRAWN, and nothing
## about whether the thing it activated is legible. `check:pixels` is the tier that asks that.
extends SceneTree

const FRAME := 1.0 / 60.0

## How long a key is HELD when asking whether it moves the hero. Half a second at 60 fps is
## tens of pixels of travel at the hero's speed, so a float-noise reading cannot pass it.
const HOLD_FRAMES := 30

## Frames to let a deferred `_focus_first` land and a Container lay itself out. The project
## has been bitten twice by measuring one frame too early.
const SETTLE_FRAMES := 4

## Button paths whose `pressed` fired, in order. Proves a drive reached a Control rather than
## changing some incidental state.
var _activated: Array = []

## Keys to drive, from `--claim-key=<NAME>,<keycode>`.
var _keys: Array = []

## Actions `project.godot` DECLARES, from `--declared=<name>,<name>`. Passed in rather than
## read from `ProjectSettings`, because Godot's built-in `ui_*` actions are also project
## settings and the two cannot be told apart from inside the engine.
var _declared: Dictionary = {}

## One screen snapshot per distinct state the probe observes.
var _snapshotted: Dictionary = {}

## Buttons whose `pressed` is already wired, by node path. The picker's and the game-over
## panel's buttons are created mid-run, so the walk has to run again after they exist.
var _watched: Dictionary = {}

## The observable state of the game, as a string. Deliberately EXCLUDES the clock: a modal
## stops the simulation, so `elapsed` cannot move while one is up -- and including it would
## make "something changed" true for reasons that have nothing to do with the key.
func _observable(main) -> String:
	var visible_paths: Array = []
	_collect_visible(main, visible_paths)
	visible_paths.sort()
	return "state=%d,pending=%d,visible=%s" % [
		main.state, main.game.pending_picks, "|".join(visible_paths)
	]


func _collect_visible(node: Node, out: Array) -> void:
	if node is Control and (node as Control).is_visible_in_tree():
		out.append(str(node.get_path()))
	for child in node.get_children():
		_collect_visible(child, out)


## Every Control under `node` that can HOLD focus. `focus_mode` is what `grab_focus()`
## requires; a control left at FOCUS_NONE could never be reached however often focus was
## requested, which is the failure this walks for.
func _focusable(node: Node) -> Array:
	var out: Array = []
	for child in node.get_children():
		if child is Control and (child as Control).focus_mode != Control.FOCUS_NONE:
			out.append(child)
		out.append_array(_focusable(child))
	return out


## Every CanvasLayer under `node`. DISCOVERED rather than named, so a modal added on a new
## layer is driven without editing this file.
func _canvas_layers(node: Node, out: Array) -> void:
	for child in node.get_children():
		if child is CanvasLayer:
			out.append(child)
		_canvas_layers(child, out)


## Every button under `node` the player could press. A screen that OFFERS buttons has to let
## the keyboard reach one of them; a Button left at FOCUS_NONE can never be reached, however
## often focus is requested.
func _buttons(node: Node) -> int:
	var n := 0
	for child in node.get_children():
		if child is BaseButton and (child as BaseButton).is_visible_in_tree():
			n += 1
		n += _buttons(child)
	return n


func _send(code: int, down: bool) -> void:
	var e := InputEventKey.new()
	# BOTH fields, like a real keyboard.
	e.keycode = code
	e.physical_keycode = code
	e.pressed = down
	Input.parse_input_event(e)
	Input.flush_buffered_events()


## A full press AND release. See note 1 at the top of the file: a release-only drive would
## pass while the button never answered, and a press-only drive would fail while it did.
func _tap(code: int) -> void:
	_send(code, true)
	_send(code, false)


## A run in a known state, with no key left held from the previous observation.
func _fresh(main) -> void:
	main._input_dir_override = null
	main.state = main.State.PLAYING
	main._start_run()


func _watch_buttons(node: Node) -> void:
	if node is Button and not _watched.has(str(node.get_path())):
		_watched[str(node.get_path())] = true
		(node as Button).pressed.connect(_on_any_pressed.bind(node))
	for child in node.get_children():
		_watch_buttons(child)


func _on_any_pressed(node: Node) -> void:
	_activated.append(str(node.get_path()))


## One screen: a Control that is a direct child of a CanvasLayer and is visible to the player.
## Discovered by WALKING THE SCENE, not by naming the panels -- a fourth modal is driven the
## day it is added, provided the probe reaches the state it appears in.
##
## A screen that owns anything focusable must ANSWER: focus has to be inside it, `ui_accept`
## has to reach a Control inside it, and the observable state has to change. All three, and
## the third is why the first two are not enough.
##
## The failure that made `activated_inside` necessary, measured: on the level-up screen a
## stray focus owner in the MENU took the Enter, started a new run, and the picker closed --
## so `changed=1` while the picker was never answered. A check that only asked "did anything
## change" would have reported the unreachable picker as reachable.
func _screen(main, label: String) -> void:
	var layers: Array = []
	_canvas_layers(main, layers)
	var screens: Array = []
	for canvas in layers:
		for child in canvas.get_children():
			if child is Control and (child as Control).is_visible_in_tree():
				screens.append(child)

	var focus := root.gui_get_focus_owner()
	var with_focus := 0
	for s in screens:
		var control := s as Control
		# The screen ITSELF counts: `Menu/Start` IS the button that answers the menu, and a
		# walk that only looked at children measured it as having nothing focusable.
		var focusable := _focusable(control)
		if control.focus_mode != Control.FOCUS_NONE:
			focusable.push_front(control)
		if focusable.size() > 0:
			with_focus += 1
	print("REACH screens label=%s visible=%d focusable=%d focus=%s" % [
		label, screens.size(), with_focus, "-" if focus == null else str(focus.get_path())
	])

	for s in screens:
		var control := s as Control
		var focusable := _focusable(control)
		if control.focus_mode != Control.FOCUS_NONE:
			focusable.push_front(control)
		var inside := focus != null and (focus == control or control.is_ancestor_of(focus))
		var path := str(control.get_path())
		# EVERY screen is reported, including the ones with nothing focusable. A screen that
		# offers buttons and lets NONE of them take focus is the defect this prints for --
		# and a walk that only reported focusable screens could not see it, because the
		# screen it describes has nothing focusable to report.
		print("REACH screen label=%s path=%s focusable=%d buttons=%d focus_inside=%d focus=%s" % [
			label, path, focusable.size(), _buttons(control), int(inside),
			"-" if focus == null else str(focus.get_path())
		])
		if focusable.size() == 0:
			continue
		# Buttons are re-watched here because the picker's and the game-over panel's are
		# created when a level lands and when the hero dies -- after the startup walk, so a
		# `pressed` handler connected only once would never see them.
		_watch_buttons(main)
		var before := _observable(main)
		var activated_before: int = _activated.size()
		_tap(KEY_ENTER)
		if _observable(main) == before:
			# `ui_accept` is Enter AND Space. A screen that answers one but not the other is
			# half-reachable, so both are tried and the pair is reported as one drive.
			_tap(KEY_SPACE)
		var after := _observable(main)
		var fired := "-"
		if _activated.size() > activated_before:
			fired = str(_activated[-1])
		var fired_inside := fired == path or fired.begins_with(path + "/")
		print("REACH screenaccept path=%s changed=%d activated=%s activated_inside=%d before=[%s] after=[%s]" % [
			path, int(after != before), fired, int(fired_inside), before, after
		])


## What ONE advertised key actually does when a player presses it. Two observations, because
## a key can be advertised for two different verbs:
##
##   hold    the hero's displacement while the key is HELD -- the claim "to move"
##   toggle  the run's state after a press from PLAYING, then after a second -- "to pause"
##           and "to resume" are the two halves of one chain
func _observe_key(main, name: String, code: int) -> void:
	_fresh(main)
	var p0 := Vector2(main.game.hero.x, main.game.hero.y)
	_send(code, true)
	for i in HOLD_FRAMES:
		main._process(FRAME)
	_send(code, false)
	var p1 := Vector2(main.game.hero.x, main.game.hero.y)
	print("REACH hold key=%s dx=%.3f dy=%.3f moved=%d" % [
		name, p1.x - p0.x, p1.y - p0.y, int(not p1.is_equal_approx(p0))
	])

	_fresh(main)
	var s0: int = main.state
	_tap(code)
	await process_frame
	var s1: int = main.state
	# Snapshot whatever screen the transition revealed, once per state: the pause panel is
	# discovered this way rather than being named.
	if s1 != s0 and not _snapshotted.has(s1):
		_snapshotted[s1] = true
		_screen(main, "revealed-by-%s" % name)
	_tap(code)
	await process_frame
	var s2: int = main.state
	print("REACH toggle key=%s playing=%d after_first=%d after_second=%d" % [name, s0, s1, s2])


func _print_states(main) -> void:
	# The game's own state names, so the gate does not have to hardcode MENU=0 / PAUSED=4 to
	# know what "the run paused" means.
	for name in main.State:
		print("REACH state %s=%d" % [name, main.State[name]])


func _print_engine_constants() -> void:
	# The gate holds its own table of Godot's key constants so that the static half can run
	# without Godot at all. This is that table MEASURED, so a wrong value is a failure rather
	# than a silent misreading of `project.godot`.
	for pair in [
		["ESCAPE", KEY_ESCAPE], ["TAB", KEY_TAB], ["ENTER", KEY_ENTER],
		["KP_ENTER", KEY_KP_ENTER], ["SPACE", KEY_SPACE],
		["LEFT", KEY_LEFT], ["UP", KEY_UP], ["RIGHT", KEY_RIGHT], ["DOWN", KEY_DOWN],
	]:
		print("REACH constant %s=%d" % [pair[0], pair[1]])


func _print_actions() -> void:
	var names: Array = []
	for name in InputMap.get_actions():
		names.append(str(name))
	names.sort()
	for name in names:
		var keys: Array = []
		var kinds: Array = []
		for ev in InputMap.action_get_events(name):
			if ev is InputEventKey:
				var k := ev as InputEventKey
				if k.keycode != 0:
					keys.append("%d:keycode" % k.keycode)
				if k.physical_keycode != 0:
					keys.append("%d:physical" % k.physical_keycode)
				kinds.append("key")
			elif ev is InputEventJoypadButton or ev is InputEventJoypadMotion:
				kinds.append("pad")
			else:
				kinds.append("other")
		print("REACH action name=%s declared=%d keys=%s kinds=%s" % [
			name, int(_declared.has(name)), ",".join(keys), ",".join(kinds)
		])


func _parse_args() -> void:
	for raw in OS.get_cmdline_user_args():
		var arg := str(raw)
		if arg.begins_with("--claim-key="):
			var parts := arg.substr("--claim-key=".length()).split(",")
			if parts.size() >= 2:
				_keys.append({"name": parts[0], "code": int(parts[1])})
		elif arg.begins_with("--declared="):
			for name in arg.substr("--declared=".length()).split(","):
				if name != "":
					_declared[name] = true


func _init() -> void:
	_parse_args()
	_print_engine_constants()
	_print_actions()

	var packed: PackedScene = load("res://scenes/main.tscn")
	if packed == null:
		print("REACH error=the scene did not load")
		quit(1)
		return
	var main = packed.instantiate()
	root.add_child(main)
	await process_frame
	await process_frame
	# DRIVEN BY HAND, so the engine's own per-frame `_process` cannot step the simulation
	# between two observations and make a reading depend on scheduling.
	main.set_process(false)
	_watch_buttons(main)
	_print_states(main)

	# 1. The screen the game opens on. Driving `ui_accept` here is also what starts the run,
	#    so this must come before anything that needs a run in progress.
	_screen(main, "startup")

	# 2. Every key the game ADVERTISES, driven in the state its verb is about.
	for entry in _keys:
		await _observe_key(main, entry["name"], entry["code"])

	# 3. A level-up, reached the way the game reaches it: a pending pick on the next frame.
	_fresh(main)
	main.game.pending_picks = 1
	main._process(FRAME)
	for i in SETTLE_FRAMES:
		await process_frame
	print("REACH reached label=level-up state=%d pending=%d picker_visible=%d" % [
		main.state, main.game.pending_picks, int(main.picker.visible)
	])
	_screen(main, "level-up")

	# 4. Death, reached by killing the hero.
	_fresh(main)
	main.game.hero.hp = 1.0
	main.game.hero.take_damage(9999.0)
	main._process(FRAME)
	for i in SETTLE_FRAMES:
		await process_frame
	print("REACH reached label=game-over state=%d over_visible=%d" % [
		main.state, int(main.over.visible)
	])
	_screen(main, "game-over")

	print("REACH done")
	quit(0)
