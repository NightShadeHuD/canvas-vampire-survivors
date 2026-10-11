## Assertion helpers, each one built from a mistake this port actually made.
##
## WHY THIS EXISTS
##
## Half the red tests in this project were the TEST being wrong, and they were not
## random. They fell into a handful of shapes, and every shape has a correct assertion
## that is slightly more work to write than the wrong one:
##
##   asserted a MAGNITUDE where the claim was a DIRECTION
##     a mage 30px from its target was asserted to be "at x > 20" instead of "further
##     away than it started", so a correct standoff read as a bug
##
##   counted EVENTS where the claim was a POPULATION
##     four clones alive for a thousand frames counted as two thousand clones, and an
##     exponential blow-up that was not there looked like one that was
##
##   read state AFTER it had changed
##     a clone's experience was read once they had all been killed
##
##   wrote down a value it could have READ
##     a hero's start was hardcoded as `ARENA_HEIGHT / 2` = 400 when the arena is 1600
##     tall, so the test failed against correct movement
##
##   compared floats for EQUALITY
##     two volley shots were compared by `vx` across a 4.6-degree spread, where the
##     components agree to three decimal places and the separation is entirely in `vy`
##
##   expected a RATE to be a certainty
##     five stacks of Evasion is 25%, and the test expected 100% -- against code with a
##     correct cap
##
##   assumed a precondition that was not set
##     healing was tested on a hero at full health, where the heal is correctly clamped
##
## `Check` makes the right form the SHORT form. `Check.rose(before, after, ...)` is no
## longer than `assert(before < 20.0)` and it cannot be wrong about which direction the
## claim was.
##
## Every helper prints the values it compared. A failure that says only "expected true"
## costs another round trip to diagnose; one that says "0.25 vs 0.25 over 4000 trials"
## does not.
##
## @module godot/assertions
extends RefCounted
class_name Check
## Set false by any failure, so a caller can `quit(0 if Check.ok else 1)`.
static var ok := true

## The number of checks that have run, so a suite can assert it checked SOMETHING.
## A suite that silently runs zero assertions passes; this makes that visible.
static var count := 0

static func reset() -> void:
	ok = true
	count = 0

# ---------------------------------------------------------------------------
# Direction -- for claims about which way something went
# ---------------------------------------------------------------------------

## `after` is greater than `before`.
static func rose(before: float, after: float, label: String) -> bool:
	return _verdict(after > before, label, "%s -> %s" % [_fmt(before), _fmt(after)])

static func fell(before: float, after: float, label: String) -> bool:
	return _verdict(after < before, label, "%s -> %s" % [_fmt(before), _fmt(after)])

## `after` equals `before`. For "this had no effect", which is a claim in its own right.
static func unchanged(before: Variant, after: Variant, label: String) -> bool:
	return _verdict(_same(before, after), label, "%s -> %s" % [_fmt(before), _fmt(after)])

## Moved CLOSER to a point. The claim a chase makes, stated as distance rather than
## as a coordinate -- the coordinate form is what a mage test got wrong.
static func closer(
	before_x: float, before_y: float, after_x: float, after_y: float,
	target_x: float, target_y: float, label: String
) -> bool:
	var d0 := _dist(before_x, before_y, target_x, target_y)
	var d1 := _dist(after_x, after_y, target_x, target_y)
	return _verdict(d1 < d0, label, "%s -> %s" % [_fmt(d0), _fmt(d1)])

static func further(
	before_x: float, before_y: float, after_x: float, after_y: float,
	target_x: float, target_y: float, label: String
) -> bool:
	var d0 := _dist(before_x, before_y, target_x, target_y)
	var d1 := _dist(after_x, after_y, target_x, target_y)
	return _verdict(d1 > d0, label, "%s -> %s" % [_fmt(d0), _fmt(d1)])

# ---------------------------------------------------------------------------
# Bounds -- for claims that something stays inside a range
# ---------------------------------------------------------------------------

static func between(value: float, lo: float, hi: float, label: String) -> bool:
	return _verdict(value >= lo and value <= hi, label, "%s in [%s, %s]" % [_fmt(value), _fmt(lo), _fmt(hi)])

static func at_most(value: float, limit: float, label: String) -> bool:
	return _verdict(value <= limit, label, "%s <= %s" % [_fmt(value), _fmt(limit)])

static func at_least(value: float, floor_value: float, label: String) -> bool:
	return _verdict(value >= floor_value, label, "%s >= %s" % [_fmt(value), _fmt(floor_value)])

## Within a tolerance. The ONLY way floats should be compared for equality -- `==` on a
## computed float is a bug waiting for a compiler that rounds differently.
static func approx(actual: float, expected: float, label: String, tol := 0.0001) -> bool:
	return _verdict(absf(actual - expected) <= tol, label, "%s vs %s (tol %s)" % [_fmt(actual), _fmt(expected), _fmt(tol)])

## Meaningfully DIFFERENT. For `vx` across a small rotation, where `!=` is true and
## useless: the values differ in the twelfth decimal and agree on the claim.
static func differs(a: float, b: float, min_delta: float, label: String) -> bool:
	return _verdict(absf(a - b) >= min_delta, label, "|%s - %s| >= %s" % [_fmt(a), _fmt(b), _fmt(min_delta)])

# ---------------------------------------------------------------------------
# Rates -- for anything probabilistic
# ---------------------------------------------------------------------------

## A rate over many trials, within a tolerance.
##
## The form a dodge or a crit needs. Asserting one trial is a coin flip; asserting
## "always" fails against a correct cap. Both were tried here.
static func rate(hits: int, trials: int, expected: float, tol: float, label: String) -> bool:
	if trials <= 0:
		return _verdict(false, label, "no trials run -- a rate over nothing is not a rate")
	var observed := float(hits) / float(trials)
	return _verdict(
		absf(observed - expected) <= tol,
		label,
		"%s vs expected %s (tol %s, %d trials)" % [_fmt(observed), _fmt(expected), _fmt(tol), trials]
	)

# ---------------------------------------------------------------------------
# Tracking -- for claims about a whole window rather than an instant
# ---------------------------------------------------------------------------

## Tracks a maximum (or minimum) across a run, so "it peaked at" is measurable without
## a hand-rolled counter. The hand-rolled version incremented once per FRAME and read
## four clones as two thousand.
class Peak:
	var value := -INF
	var at := -1

	func consider(v: float, frame: int) -> void:
		if v > value:
			value = v
			at = frame

## Tracks a minimum, for "the closest it ever got".
class Trough:
	var value := INF
	var at := -1

	func consider(v: float, frame: int) -> void:
		if v < value:
			value = v
			at = frame

## Runs `frames` steps of `body`, so no test hand-rolls a loop it can `break` out of
## too early -- which is exactly what the volley check did, asserting kills three frames
## after the first shot.
static func over(frames: int, body: Callable) -> void:
	for i in frames:
		body.call(i)

## Asserts `read` reports the same thing before and after `frames` steps of `body`.
## The claim "this is paused" or "this does not advance".
static func frozen(frames: int, body: Callable, read: Callable, label: String) -> bool:
	var before = read.call()
	over(frames, body)
	var after = read.call()
	return unchanged(before, after, label)

# ---------------------------------------------------------------------------
# Preconditions -- so a test cannot pass for the wrong reason
# ---------------------------------------------------------------------------

## A hero set up so the thing under test is actually observable.
##
## Healing cannot be measured on a full-health hero, and a dodge cannot be measured on
## one with no Evasion. Both were got wrong here, and both failed against working code.
static func wounded(hero: Hero, to_hp: float) -> Hero:
	hero.hp = minf(to_hp, hero.max_hp)
	return hero

## A foe with enough health to survive the measurement, so a test about DAMAGE is not
## accidentally a test about DEATH.
static func sturdy(foe: Foe, hp := 1_000_000.0) -> Foe:
	foe.max_hp = hp
	foe.hp = hp
	return foe

# ---------------------------------------------------------------------------

static func _dist(ax: float, ay: float, bx: float, by: float) -> float:
	return sqrt(pow(ax - bx, 2) + pow(ay - by, 2))

static func _same(a: Variant, b: Variant) -> bool:
	if a is float and b is float:
		return is_equal_approx(a, b)
	return a == b

static func _fmt(v: Variant) -> String:
	if v is float:
		return "%0.4f" % v
	return str(v)

static func _verdict(cond: bool, label: String, detail: String) -> bool:
	count += 1
	if cond:
		print("  ok   %s  (%s)" % [label, detail])
	else:
		print("  FAIL %s  (%s)" % [label, detail])
		ok = false
	return cond
