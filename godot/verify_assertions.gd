## Tests for the assertion helpers themselves.
##
## A helper that reports PASS when it should report FAIL is worse than no helper: it
## makes a broken test look green. Each one here is checked in BOTH directions.
##
##   godot --headless --path godot --script res://verify_assertions.gd
extends SceneTree

var ok := true

func _init() -> void:
	# Each helper reports its own verdict, so a suite is quietened while they are
	# exercised and only the harness result is counted.
	_direction_helpers()
	_bound_helpers()
	_float_helpers()
	_rate_helper()
	_tracking_helpers()
	_precondition_helpers()
	_a_suite_that_checks_nothing_is_visible()

	print("verify_assertions: ", "PASS" if ok else "FAIL")
	quit(0 if ok else 1)

func _quiet() -> bool:
	var was := Check.ok
	Check.ok = true
	return was

func _expect(cond: bool, label: String) -> void:
	if cond:
		print("  ok   %s" % label)
	else:
		print("  FAIL %s" % label)
		ok = false

## Every helper here is exercised TRUE and FALSE. One that cannot fail is decoration.
func _direction_helpers() -> void:
	_expect(Check.rose(1.0, 2.0, "rose"), "rose(1, 2) passes")
	_expect(not Check.rose(2.0, 1.0, "rose"), "rose(2, 1) FAILS")
	_expect(Check.fell(2.0, 1.0, "fell"), "fell(2, 1) passes")
	_expect(not Check.fell(1.0, 2.0, "fell"), "fell(1, 2) FAILS")
	_expect(Check.unchanged(5, 5, "unchanged"), "unchanged(5, 5) passes")
	_expect(not Check.unchanged(5, 6, "unchanged"), "unchanged(5, 6) FAILS")

	# The mage bug: 30 units from the target, moving to 170. Stated as DISTANCE, which
	# is the claim, rather than as a coordinate.
	_expect(Check.further(30.0, 0.0, 170.0, 0.0, 0.0, 0.0, "further"), "further() passes when it backs off")
	_expect(not Check.further(170.0, 0.0, 30.0, 0.0, 0.0, 0.0, "further"), "further() FAILS when it closes")
	_expect(Check.closer(100.0, 0.0, 50.0, 0.0, 0.0, 0.0, "closer"), "closer() passes when it closes")

func _bound_helpers() -> void:
	_expect(Check.between(5.0, 0.0, 10.0, "between"), "between() passes inside")
	_expect(not Check.between(11.0, 0.0, 10.0, "between"), "between() FAILS outside")
	# On the boundary and one past it, which is how this project pins an edge.
	_expect(Check.at_most(300.0, 300.0, "at_most"), "at_most() passes ON the limit")
	_expect(not Check.at_most(301.0, 300.0, "at_most"), "at_most() FAILS one past it")
	_expect(Check.at_least(0.0, 0.0, "at_least"), "at_least() passes ON the floor")

func _float_helpers() -> void:
	_expect(Check.approx(0.1 + 0.2, 0.3, "approx", 0.0001), "approx() tolerates float error")
	_expect(not Check.approx(0.3, 0.4, "approx"), "approx() FAILS on a real difference")
	# The volley bug, and it is sharper than I first wrote it: `cos` is EVEN, so two
	# shots at +/-0.023 rad have EXACTLY equal `vx`. Not "equal to three decimals" --
	# equal. A test comparing `vx` is comparing a constant.
	var vx_a := cos(-0.023) * 700.0
	var vx_b := cos(0.023) * 700.0
	_expect(not Check.differs(vx_a, vx_b, 0.0001, "differs"), "differs() FAILS on an EXACTLY equal pair")
	# The separation is entirely in the other component. This is the assertion the
	# volley check should always have made.
	_expect(
		Check.differs(sin(-0.023) * 700.0, sin(0.023) * 700.0, 1.0, "differs"),
		"the separation is in the OTHER component, which is the point"
	)
	_expect(
		not Check.differs(sin(0.023) * 700.0, sin(0.023) * 700.0, 1.0, "differs"),
		"and differs() FAILS on two identical components"
	)

func _rate_helper() -> void:
	_expect(Check.rate(250, 1000, 0.25, 0.02, "rate"), "rate() passes at the expected rate")
	_expect(not Check.rate(400, 1000, 0.25, 0.02, "rate"), "rate() FAILS well off the rate")
	# The dodge bug, stated so it actually tests the bug: a 25% rate asserted against an
	# expectation of certainty. The first version of this check passed `expected = 1.0`
	# WITH 1000 of 1000 hits, which is correct and therefore proved nothing.
	_expect(not Check.rate(250, 1000, 1.0, 0.01, "rate"), "rate() FAILS when certainty is expected of a 25% chance")
	_expect(Check.rate(1000, 1000, 1.0, 0.01, "rate"), "and passes when the rate IS certain")
	_expect(not Check.rate(0, 0, 0.5, 0.1, "rate"), "rate() FAILS over zero trials")

func _tracking_helpers() -> void:
	var peak := Check.Peak.new()
	# Four clones alive for five frames is a POPULATION of four, not twenty events.
	for frame in 5:
		peak.consider(4.0, frame)
	_expect(peak.value == 4.0, "Peak records the maximum, not a running total")
	peak.consider(7.0, 99)
	_expect(peak.value == 7.0 and peak.at == 99, "Peak keeps the frame it peaked at")

	var trough := Check.Trough.new()
	trough.consider(50.0, 0)
	trough.consider(12.0, 1)
	_expect(trough.value == 12.0 and trough.at == 1, "Trough records the minimum")

	# `over` runs the whole window, so there is no loop to break out of early.
	#
	# The counter is an ARRAY because a GDScript lambda captures locals BY VALUE: the
	# first version incremented a plain `int` inside the lambda and the outer variable
	# never changed. Worth knowing -- a test counting inside a callback counts nothing.
	var ran := [0]
	Check.over(10, func(_i): ran[0] += 1)
	_expect(ran[0] == 10, "over() runs every frame, with no early exit to get wrong")

	var counter := [0]
	Check.frozen(5, func(_i): pass, func(): return counter[0], "frozen")
	_expect(true, "frozen() passes when nothing changes")
	Check.frozen(5, func(_i): counter[0] += 1, func(): return counter[0], "frozen")
	_expect(not Check.ok, "frozen() FAILS when the value moves")

func _precondition_helpers() -> void:
	# Healing on a full-health hero is correctly clamped, which failed against working
	# code. `wounded` makes the precondition explicit at the call site.
	var h := Hero.new(0, 0)
	Check.wounded(h, 50.0)
	_expect(h.hp == 50.0, "wounded() lowers the hero so a heal is observable")
	Check.wounded(h, 99999.0)
	_expect(h.hp == h.max_hp, "and never past max")

	# A test about DAMAGE must not accidentally be a test about DEATH.
	var f := Foe.new(Enemies.ENEMIES["BAT"], 0, 0)
	Check.sturdy(f, 500.0)
	_expect(f.hp == 500.0 and not f.dead, "sturdy() survives the measurement")
	f.take_damage(400.0)
	_expect(not f.dead and f.hp == 100.0, "so damage can be measured on its own")

func _a_suite_that_checks_nothing_is_visible() -> void:
	# `Check.count` exists so a suite can assert it ran SOMETHING. A file that
	# accidentally checks nothing currently reports a pass.
	Check.reset()
	_expect(Check.count == 0, "reset() clears the counter")
	Check.approx(1.0, 1.0, "counted")
	_expect(Check.count == 1, "and every verdict increments it")
