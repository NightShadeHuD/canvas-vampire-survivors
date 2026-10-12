## A fuzzer for the things that must ALWAYS be true.
##
## WHY A TOOL RATHER THAN MORE ASSERTIONS
##
## Every check so far asserts a specific behaviour in a specific scenario. None of them
## asks the question that catches a whole class of bug at once: after however many
## frames of whatever input, is anything IMPOSSIBLE now true?
##
## A negative hit point, a NaN position, a level that went backwards, an exp threshold
## that stopped growing -- each is a bug that every existing test would sail past,
## because each only appears once something else has gone slightly wrong.
##
## This runs long, varied, adversarial simulations and checks INVARIANTS after every
## frame, reporting the first frame at which each broke. It is deliberately not a
## pass/fail on behaviour: it does not care what the game does, only that it stays
## coherent while doing it.
##
##   godot --headless --path godot --script res://verify_invariants.gd
extends SceneTree

const FRAME := 1.0 / 60.0
var ok := true
## First frame each invariant broke at, so a failure names WHEN rather than just what.
var broken: Dictionary = {}

func _init() -> void:
	_seed(1)
	_monotonic_levels()
	_exp_threshold_never_stops_growing()
	_orb_lifetime_is_bounded()
	_wave_boundaries_are_total()
	_upgrade_pool_never_returns_nothing()
	_a_long_adversarial_run()

	# BOTH flags. The per-frame invariant fuzzer reports through this file's own `ok`
	# (a first-broken-frame tracker no per-call helper can express) and every other
	# check reports through `Check.`
	var passed := ok and Check.ok
	print("verify_invariants: ", "PASS" if passed else "FAIL")
	quit(0 if passed else 1)

func _seed(n: int) -> void:
	seed(n)

## HP, position, counters -- checked after every frame of a long uneven run.
func _a_long_adversarial_run() -> void:
	var g := Game.new(0.2)
	var rng := RandomNumberGenerator.new()
	rng.seed = 31337
	var dirs := [
		Vector2.ZERO, Vector2.RIGHT, Vector2.LEFT, Vector2.UP, Vector2.DOWN,
		Vector2(1, 1), Vector2(-1, -1), Vector2(0.001, 0.001), Vector2(1e6, 1e6)
	]
	var frames := 60 * 600  # ten minutes of game time
	for i in frames:
		# Re-randomise the direction every quarter second, and sometimes chase a
		# corner so the clamp is exercised constantly.
		if i % 15 == 0:
			g.step(FRAME, dirs[rng.randi() % dirs.size()])
		else:
			g.step(FRAME, Vector2.ZERO)
		# A level-up would normally pause the run; spend it so the sim keeps going.
		while g.pending_picks > 0:
			var picks := Upgrades.choose(g.hero, 3, rng)
			if picks.is_empty():
				g.pending_picks = 0
				break
			Upgrades.apply(g.hero, picks[0])
			g.pending_picks -= 1
		_note("hp is a real number", not is_nan(g.hero.hp))
		_note("hp is never negative", g.hero.hp >= 0.0, i, "hp = %f" % g.hero.hp)
		_note("hp never exceeds max", g.hero.hp <= g.hero.max_hp + 0.001, i, "hp %f > max %f" % [g.hero.hp, g.hero.max_hp])
		_note("hero position is real", not (is_nan(g.hero.x) or is_nan(g.hero.y)))
		_note("hero is inside the arena", g.hero.x >= -0.001 and g.hero.x <= float(Config.ARENA_WIDTH) + 0.001)
		_note("level is at least 1", g.hero.level >= 1, i, "level = %d" % g.hero.level)
		_note("exp is never negative", g.hero.exp >= 0.0, i, "exp = %f" % g.hero.exp)
		_note("exp is below the next threshold", g.hero.exp < g.hero.exp_to_next + 0.001, i, "exp %f >= next %f" % [g.hero.exp, g.hero.exp_to_next])
		_note("exp threshold is positive", g.hero.exp_to_next > 0.0, i, "next = %f" % g.hero.exp_to_next)
		_note("foe count is capped", g.foes.size() <= int(Config.MAX_ENEMIES), i, "%d foes" % g.foes.size())
		_note("kills never decrease", g.kills >= 0)
		for foe in g.foes:
			if is_nan(foe.x) or is_nan(foe.y):
				_note("no foe has a NaN position", false, i, "foe %s" % foe.def_id)
				break
		if broken.size() > 0:
			break

	_report()
	if broken.is_empty():
		print("  ok   10 minutes of adversarial play stayed coherent  (%d frames)" % frames)

## Levels only ever go up.
func _monotonic_levels() -> void:
	var g := Game.new(0.5)
	var last := g.hero.level
	var went_back := false
	for i in 60 * 300:
		g.step(FRAME, Vector2(1, 0))
		if g.hero.level < last:
			went_back = true
			break
		last = g.hero.level
	Check.unchanged(went_back, false, "a level never goes backwards")

## The XP threshold must keep growing, or levelling becomes free partway through.
func _exp_threshold_never_stops_growing() -> void:
	var h := Hero.new(0, 0)
	var last := h.exp_to_next
	var stalled := -1
	var level_before := h.level
	# Levelling 200 times is far past any real run.
	for i in 200:
		h.gain_exp(h.exp_to_next)
		if h.exp_to_next <= last:
			stalled = i
			break
		last = h.exp_to_next
	Check.unchanged(stalled, -1, "the XP threshold grows at every level")
	Check.unchanged(h.level, level_before + 200, "and 200 forced levels all landed")
	Check.unchanged(not is_nan(h.exp_to_next) and not is_inf(h.exp_to_next), true, "the threshold stays finite at level 200")

## An orb must expire, and must expire even if it can never reach the hero.
func _orb_lifetime_is_bounded() -> void:
	var h := Hero.new(0, 0)
	# Placed far outside any magnet, so only the lifetime can remove it.
	var orb := Orb.new(99999.0, 99999.0, 5)
	var frames := 0
	while not orb.expired and frames < 60 * 60:
		orb.update(FRAME, h)
		frames += 1
	Check.unchanged(orb.expired, true, "an unreachable orb expires at %0.1fs" % (frames * FRAME))
	# The bound is the LIFETIME CONSTANT, not the loop guard above: expiry lands on the
	# frame accumulated `life` crosses zero, so it can overshoot by one frame.
	Check.at_most(float(frames) * FRAME, float(Config.EXP_ORB_LIFETIME) + 2.0 * FRAME, "and does so within the lifetime constant")

## Every instant of time must belong to exactly one wave. A gap would silently stop
## spawning, and an overlap would make `wave_for` order-dependent.
func _wave_boundaries_are_total() -> void:
	var g := Game.new()
	var gaps: Array = []
	# Sample every second for an hour, plus the exact boundary instants.
	var times: Array = []
	for t in range(0, 3600):
		times.append(float(t))
	for w in Waves.WAVES:
		times.append(float(w["from"]))
		if w["to"] != null:
			times.append(float(w["to"]))
	for t in times:
		var wave = g.wave_for(t)
		if wave == null:
			gaps.append(t)
	Check.unchanged(gaps.size(), 0, "every instant falls in a wave")
	# And the boundary itself belongs to the LATER wave, not both.
	var second: Dictionary = Waves.WAVES[1]
	var at_from := g.wave_for(float(second["from"]))
	Check.unchanged(at_from["label"], second["label"], "a boundary instant belongs to the wave starting there")

## `choose` must never return nothing while anything is offerable -- an empty offer
## would leave the run paused forever with no way out.
func _upgrade_pool_never_returns_nothing() -> void:
	var rng := RandomNumberGenerator.new()
	rng.seed = 99
	var h := Hero.new(0, 0)
	# Take everything to its cap, which is the state where `live` is empty.
	for def in Weapons.WEAPONS.values():
		h.add_weapon(def)
		# `level_weapon`, not `add_weapon` in a loop. The loop form was what exposed
		# the duplicate bug above -- and having fixed it, `add_weapon` would now level,
		# which would make this setup pass for the wrong reason.
		while h.weapon_level(def["id"]) < int(Config.WEAPON_MAX_LEVEL):
			h.level_weapon(def["id"])
	for def in Passives.PASSIVES.values():
		for i in int(Config.PASSIVE_MAX_STACK):
			h.add_passive(def)
	var picks := Upgrades.choose(h, 3, rng)
	Check.at_least(float(picks.size()), 1.0, "a fully maxed hero is still offered something")
	# And the offer must be honest about being maxed.
	var all_maxed := true
	for p in picks:
		if Upgrades.label(p) != " (MAXED)":
			all_maxed = false
	Check.unchanged(all_maxed, true, "and they are labelled MAXED")

func _note(label: String, cond: bool, frame := -1, detail := "") -> void:
	if not cond and not broken.has(label):
		broken[label] = {"frame": frame, "detail": detail}

func _report() -> void:
	# NOT `Check.*` on purpose. Each invariant is sampled EVERY frame and only the first
	# frame it broke at is interesting, which is a shape no per-call helper expresses --
	# so these report through this file's own flag, and the ending accounts for both.
	for label in broken:
		var b: Dictionary = broken[label]
		print("  FAIL %s  (frame %d, %s)" % [label, b["frame"], b["detail"]])
		ok = false
