## Every enemy archetype in the data must actually behave differently.
##
## WHY THIS EXISTS
##
## `archetype` is on every enemy and nothing read it, so ten enemy types were ten
## SKINS that walked at you at different speeds. Same bug as weapons and passives:
## data declaring something the code ignores.
##
## This drives the data table -- a new archetype fails until it is implemented -- and
## then checks each one BEHAVES, not merely that a flag exists.
##
##   godot --headless --path godot --script res://verify_archetypes.gd
extends SceneTree

const FRAME := 1.0 / 60.0
var ok := true

func _init() -> void:
	_every_archetype_is_implemented()
	_dasher_covers_more_ground_than_a_walker()
	_shield_absorbs_before_health()
	_ranged_keeps_its_distance_and_fires()
	_splitter_leaves_children_that_cannot_split_again()
	_bomber_arms_and_hurts_the_hero()
	_illusionist_clones_are_worth_no_experience()

	print("verify_archetypes: ", "PASS" if ok else "FAIL")
	quit(0 if ok else 1)

func _foe_def(id: String) -> Dictionary:
	for d in Enemies.ENEMIES.values():
		if d["id"] == id:
			return d
	push_error("no enemy def for '%s'" % id)
	return Enemies.ENEMIES.values()[0]

func _foe(id: String, x := 0.0, y := 0.0) -> Foe:
	return Foe.new(_foe_def(id), x, y)

## The headline check. An archetype the code does not know about still "works" -- it
## falls through to the chaser default -- so this asserts the KNOWN set explicitly
## rather than trusting a fallthrough.
func _every_archetype_is_implemented() -> void:
	var handled := ["chaser", "dasher", "shielded", "ranged", "splitter", "bomber", "illusionist"]
	var found := {}
	for d in Enemies.ENEMIES.values():
		found[str(d["archetype"])] = true
	var unhandled: Array = []
	for a in found:
		if not handled.has(a):
			unhandled.append(a)
	_check(unhandled.is_empty(), "EVERY archetype in the data is handled", "unhandled: %s" % (", ".join(unhandled) if not unhandled.is_empty() else "none"))

func _dasher_covers_more_ground_than_a_walker() -> void:
	# A wolf must OUTRUN a bat over the same window, or `dashSpeed` is decoration.
	var wolf := _foe("wolf", 0.0, 0.0)
	var bat := _foe("bat", 0.0, 0.0)
	for i in 60 * 4:
		wolf.chase(100000.0, 0.0, FRAME)
		bat.chase(100000.0, 0.0, FRAME)
	_check(wolf.x > bat.x, "a dasher outruns a chaser over 4s", "wolf %0.1f vs bat %0.1f" % [wolf.x, bat.x])
	# And it must be uneven -- a dasher that moved at a constant rate is just fast.
	var samples: Array = []
	var w2 := _foe("wolf", 0.0, 0.0)
	for i in 60 * 4:
		var before := w2.x
		w2.chase(100000.0, 0.0, FRAME)
		samples.append(w2.x - before)
	var fastest: float = samples.max()
	var slowest: float = samples.min()
	_check(fastest > slowest * 2.0, "and moves in BURSTS rather than steadily", "%0.3f vs %0.3f per frame" % [fastest, slowest])

func _shield_absorbs_before_health() -> void:
	var golem := _foe("golem", 0.0, 0.0)
	_check(golem.shield_hp > 0.0, "a golem starts shielded", "%0.0f shield" % golem.shield_hp)
	var hp0 := golem.hp
	golem.take_damage(golem.shield_max - 1.0)
	_check(golem.hp == hp0, "damage inside the shield costs no health", "hp %0.0f" % golem.hp)
	golem.take_damage(1.0)
	_check(golem.hp == hp0, "the last point of shield still holds", "hp %0.0f" % golem.hp)
	# Past the shield, the REDUCTION applies -- a golem is not just 60 extra health.
	golem.take_damage(100.0)
	var lost := hp0 - golem.hp
	_check(lost < 100.0, "and past it, damage is reduced", "100 raw cost %0.1f" % lost)
	_check(is_equal_approx(lost, 50.0), "by exactly the 50% in the data", "%0.1f" % lost)

func _ranged_keeps_its_distance_and_fires() -> void:
	# Placed 30px from the target, NOT on it. At zero distance `chase` returns early --
	# correct behaviour -- and the first version of this test placed it exactly there
	# and then asserted it moved.
	var mage := _foe("mage", 30.0, 0.0)
	var keep := float(mage.def.get("keepDistance", 0.0))
	# Placed well inside its standoff: it must BACK AWAY, not close in.
	for i in 120:
		mage.chase(0.0, 0.0, FRAME)
	_check(mage.x > 30.0, "a mage backs off when too close", "30.0 -> %0.1f" % mage.x)
	# Now well outside: it must advance.
	var far := _foe("mage", keep + 300.0, 0.0)
	var x0 := far.x
	for i in 60:
		far.chase(0.0, 0.0, FRAME)
	_check(far.x < x0, "and advances when out of range", "%0.1f -> %0.1f" % [x0, far.x])
	# And it must SIGNAL a shot rather than firing itself.
	var shooter := _foe("mage", 100.0, 0.0)
	var signalled := false
	for i in 60 * 4:
		shooter.chase(0.0, 0.0, FRAME)
		if shooter.wants_to_fire:
			signalled = true
			break
	_check(signalled, "and signals a shot for the Game to place", "wants_to_fire raised")

func _splitter_leaves_children_that_cannot_split_again() -> void:
	var g := Game.new(999.0)
	var slime := Foe.new(_foe_def("slime"), 100.0, 100.0)
	g.foes.append(slime)
	slime.take_damage(99999.0)
	g.step(FRAME, Vector2.ZERO)
	_check(g.foes.size() > 1, "a slime splits into children", "%d foe(s)" % g.foes.size())
	var recursed := false
	for f in g.foes:
		if f.def_id == "slime":
			recursed = true
	_check(not recursed, "and the children are NOT slimes", "splitInto is a different id")
	# The guard is the absence of the flag, so assert that rather than trust it.
	_check(not _foe_def("slimeling").has("splitInto"), "slimelings carry no splitInto", "no recursion possible")

func _bomber_arms_and_hurts_the_hero() -> void:
	var g := Game.new(999.0)
	g.hero.hp = 100.0
	var bomber := Foe.new(_foe_def("bomber"), g.hero.x + 100.0, g.hero.y)
	g.foes.append(bomber)
	# Walk it in until the fuse arms.
	var armed_at := -1
	for i in 60 * 10:
		g.step(FRAME, Vector2.ZERO)
		if bomber.fuse_armed and armed_at < 0:
			armed_at = i
		if g.hero.hp < 100.0:
			break
	_check(armed_at >= 0, "a bomber arms once in range", "armed at frame %d" % armed_at)
	_check(g.hero.hp < 100.0, "and the blast hurts the HERO, not just foes", "hp %0.1f" % g.hero.hp)

func _illusionist_clones_are_worth_no_experience() -> void:
	var g := Game.new(999.0)
	var ill := Foe.new(_foe_def("illusionist"), 400.0, 100.0)
	g.foes.append(ill)
	# Run the FULL window and look for a clone BY ID. Breaking on `foes.size() > 1`
	# stopped on frame one -- `Game.new(999.0)` still spawns once immediately, because
	# `spawn_timer` starts at 0 -- so the illusionist never got to its 5.5s cooldown.
	# PEAK simultaneous population, not a running total. The first version incremented
	# per clone PER FRAME, so one clone alive for a thousand frames read as a thousand
	# clones -- and 2348 looked like a runaway that was not there.
	var clones_seen := 0
	var clone_xp := -1
	for i in 60 * 25:
		g.step(FRAME, Vector2.ZERO)
		var live := 0
		for f in g.foes:
			if f.def_id == "illusionist" and f != ill:
				live += 1
				# Captured HERE, while a clone is alive. Read afterwards it is always
				# -1: Garlic kills them long before the window ends.
				clone_xp = f.exp_value
		clones_seen = maxi(clones_seen, live)
	var want := int(ill.def.get("cloneCount", 2))
	_check(clones_seen >= want, "an illusionist makes clones", "%d clone(s)" % clones_seen)
	# AND THEY MUST STOP. A clone is the same def, so without a guard a clone clones,
	# and the population is exponential -- measured at 27,165 in 25 seconds. Asked here
	# because "makes clones" passed the whole time that was true.
	var ceiling := want * (1 + int(25.0 / float(ill.def.get("cloneCooldown", 5.5))))
	_check(clones_seen <= ceiling, "and clones do NOT clone", "%d <= %d over 25s" % [clones_seen, ceiling])
	# Checked BY ID, not by "not the original object". `Game.new(999.0)` does not stop
	# the first spawn -- `spawn_timer` starts at 0, so one foe appears immediately --
	# and the first version of this test counted that bat as a clone.
	_check(clone_xp == 0, "and they are worth NO experience", "clone exp = %d" % clone_xp)

func _check(cond: bool, label: String, detail: String) -> void:
	if cond:
		print("  ok   %s  (%s)" % [label, detail])
	else:
		print("  FAIL %s  (%s)" % [label, detail])
		ok = false
