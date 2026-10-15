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
	# ...AND THE DRAW SITE THAT FUSE WAS FOR. `renderEnemy` blinks an armed bomber's body in
	# `src/entity-render.ts`, and the port had the fuse and no drawing of it -- so a bomber
	# about to detonate in your face looked exactly like one that was not.
	_an_armed_bomber_blinks_on_the_clock()
	_illusionist_clones_are_worth_no_experience()

	# BOTH harnesses. `Check.*` sets its own flag, and a suite that printed a FAIL
	# while reporting PASS is a false green -- the failure mode this tooling exists
	# to remove, introduced by the tooling itself.
	var passed := ok and Check.ok
	print("verify_archetypes: ", "PASS" if passed else "FAIL")
	quit(0 if passed else 1)

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
	# `Check.further` states the claim as DISTANCE from the target. The hand-rolled form
	# asserted a coordinate, and the version before that placed the mage exactly ON its
	# target -- where `chase` correctly returns early.
	var mage_start := mage.x
	Check.over(120, func(_i): mage.chase(0.0, 0.0, FRAME))
	Check.further(mage_start, 0.0, mage.x, 0.0, 0.0, 0.0, "a mage backs off when too close")
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

## THE ARMED BOMBER BLINKS, AND IT BLINKS *ON A PERIOD*.
##
## `renderEnemy`'s third branch, `src/entity-render.ts:222-225`:
##
##     } else if (self.bomber && self.fuseArmed) {
##         const blink = Math.floor(performance.now() / 120) % 2 === 0;
##         ctx.fillStyle = blink ? '#ffffff' : self.color;
##
## -- the DRAW SITE this port did not have, gated on the fuse it did. What the blink depends
## on is worth answering in an assertion rather than in a comment: it is TIME and nothing else.
## Not the fuse's remaining seconds, not the health, not the moment it armed -- 120ms white,
## 120ms own colour, for as long as `fuse_armed` holds, and the phase is whatever the clock
## reads when the frame is drawn. A "fuse gauge" that reddened as the timer ran down would look
## plausible and would be a different feature.
##
## THE TWO WAYS THIS CAN BE WRONG ARE BOTH HERE: a bomber that never changes colour (no draw
## site at all, which is what the port had), and one that changes and never changes BACK (a
## one-way tint). The third sample exists for the second: 0 -> 0.12 -> 0.24 must read
## white -> own colour -> WHITE, and a check that stopped at two samples cannot tell a blink
## from a single white state that happens to be sitting there.
func _an_armed_bomber_blinks_on_the_clock() -> void:
	# `performance.now() / 120` -- 120 MILLISECONDS is the HALF period. The spec literal is
	# written here rather than read from `Foe.BLINK_HALF_PERIOD`, so a check cannot follow the
	# constant it is checking to any value at all.
	const HALF_PERIOD := 0.12
	var g := Game.without_spawns()
	var bomber := Foe.new(_foe_def("bomber"), g.hero.x + 60.0, g.hero.y)
	g.foes.append(bomber)

	# THE PRECONDITION, ASSERTED. Nothing below means anything unless the fuse arms, and the
	# port has no blink flag to set by hand -- it is `fuse_armed` or nothing. Driven through
	# `chase`, which is what arms it in play: it starts 60px from the hero, inside `fuseRange`.
	Check.unchanged(bomber.fuse_armed, false, "a bomber that has not closed is NOT armed")
	Check.unchanged(
		bomber.body_color(0.0),
		Color(bomber.color),
		"so it wears its own colour even in the blink's white half -- an unarmed bomber never blinks"
	)
	bomber.chase(g.hero.x, g.hero.y, FRAME)
	Check.unchanged(
		bomber.fuse_armed, true, "inside fuseRange the fuse ARMS, or nothing below is reachable"
	)

	# THE BLINK: two samples half a period apart, a third a full period on.
	var white: Color = bomber.body_color(0.0)
	var colour: Color = bomber.body_color(HALF_PERIOD)
	Check.unchanged(white, Color("ffffff"), "an armed bomber is drawn WHITE in one half of the blink")
	# THE CHANNEL IS DERIVED, and this is not tidiness. The first version of this line read
	# `white.r` against `colour.r` -- and the bomber is `#ff6644`, whose RED is 1.0, so the
	# assertion failed at |1.0000 - 1.0000| against a blink that was working perfectly. The
	# difference between white and this foe lives in GREEN (0.4 -> 1.0) and BLUE (0.267 -> 1.0).
	# A hand-picked channel is the magnitude-asserted-where-the-claim-was-a-change trap from
	# `assertions.gd`, one level down: the claim is "the colour changed", so what is compared
	# is the LARGEST change across the channels rather than a channel chosen in advance.
	Check.differs(
		_channel_gap(white, colour),
		0.0,
		0.1,
		"and a different colour in the other half -- it CHANGES by at least 0.1 somewhere"
	)
	Check.unchanged(colour, Color(bomber.color), "and what it changes to is its own data colour")
	Check.unchanged(
		bomber.body_color(HALF_PERIOD * 2.0),
		Color("ffffff"),
		"and it is WHITE AGAIN one full period later -- a BLINK, not a one-way tint"
	)
	# THE PERIOD ITSELF, not merely "it differs twice": a sample inside each half has to stay
	# in that half, which is what separates a 240ms cycle from a repaint on every frame.
	Check.unchanged(
		bomber.body_color(HALF_PERIOD * 0.5), white, "half a half-period in, it is STILL the same white"
	)
	Check.unchanged(
		bomber.body_color(HALF_PERIOD * 1.5),
		colour,
		"and half a period on from that, STILL its own colour"
	)

	# THE CHAIN, one ordering at a time and all on this ONE foe. Each of these fails for an
	# implementation that reordered `body_color`'s branches, and none of them fails for an
	# implementation that draws the blink correctly by itself.
	bomber.apply_slow(0.5, 60.0)
	Check.rose(
		0.0, bomber.slow_timer, "the bomber is ALSO slowed now, or the ordering below proves nothing"
	)
	Check.unchanged(
		bomber.body_color(HALF_PERIOD),
		Color("88ccff"),
		"so the SLOW is drawn above the blink: the armed bomber is iced blue, not its own colour"
	)
	Check.unchanged(
		bomber.body_color(0.0),
		Color("88ccff"),
		"and in the blink's WHITE half too -- the blink does not show through a slow at all"
	)
	bomber.take_damage(1.0)
	Check.rose(0.0, bomber.flash_timer, "and now the bomber has been HIT as well")
	Check.unchanged(
		bomber.body_color(HALF_PERIOD),
		Color("ffffff"),
		"so the FLASH is drawn above both: white in the half the slow was showing in"
	)


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
	# `Peak` for the population -- the hand-rolled counter incremented once per clone
	# PER FRAME and read four clones as two thousand.
	#
	# `clone_xp` is captured INSIDE the window. Read afterwards it is always -1: Garlic
	# kills them long before the run ends.
	var peak := Check.Peak.new()
	# An ARRAY, because a GDScript lambda captures locals BY VALUE. The plain `int` this
	# replaced was assigned inside the callback and never escaped -- so the check read
	# its initial -1 and failed against correct code. Second time this bit me today.
	var clone_xp := [-1]
	Check.over(60 * 25, func(i):
		g.step(FRAME, Vector2.ZERO)
		var live := 0
		for f in g.foes:
			if f.def_id == "illusionist" and f != ill:
				live += 1
				clone_xp[0] = f.exp_value
		peak.consider(float(live), i)
	)
	var clones_seen := int(peak.value)
	var want := int(ill.def.get("cloneCount", 2))
	Check.at_least(float(clones_seen), float(want), "an illusionist makes clones")
	# AND THEY MUST STOP. A clone is the same def, so without a guard a clone clones,
	# and the population is exponential -- measured at 27,165 in 25 seconds. Asked here
	# because "makes clones" passed the whole time that was true.
	var ceiling := want * (1 + int(25.0 / float(ill.def.get("cloneCooldown", 5.5))))
	Check.at_most(float(clones_seen), float(ceiling), "and clones do NOT clone")
	# Checked BY ID, not by "not the original object". `Game.new(999.0)` does not stop
	# the first spawn -- `spawn_timer` starts at 0, so one foe appears immediately --
	# and the first version of this test counted that bat as a clone.
	Check.approx(float(clone_xp[0]), 0.0, "and they are worth NO experience", 0.5)

## The largest per-channel difference between two colours.
##
## The channel a change lands on is a property of the TWO COLOURS, not of the claim: white
## against the bomber's `#ff6644` moves green (0.4 -> 1.0) and blue (0.267 -> 1.0) while red is
## 1.0 in both. Asserting on a channel chosen in advance is a magnitude pinned where the claim
## was a change, and it fails against correct code -- which is how this helper got here.
func _channel_gap(a: Color, b: Color) -> float:
	return maxf(maxf(absf(a.r - b.r), absf(a.g - b.g)), absf(a.b - b.b))


func _check(cond: bool, label: String, detail: String) -> void:
	if cond:
		print("  ok   %s  (%s)" % [label, detail])
	else:
		print("  FAIL %s  (%s)" % [label, detail])
		ok = false
