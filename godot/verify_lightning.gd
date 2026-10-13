## LIGHTNING'S TARGET IS RANDOM, AND IT CHAINS FROM LEVEL 3.
##
## WHY THIS EXISTS
##
## `_fireInstant` in `src/weapons.ts`:
##
##     const cand = targets[Math.floor(Math.random() * targets.length)];   // RANDOM, not nearest
##     if (this.def.chain && this.level >= 3) {                            // chains from level 3
##         ... nearest unchained foe within 180px, dmg * 0.7 per hop ...
##
## and `src/data.ts` describes the weapon as "Smites a random foe. Lv3+ chains." with
## `chain: true` and `chainCount: 3` on the def.
##
## The port struck the NEAREST foe and never chained -- and `verify_weapons.gd` PINNED that
## behaviour with an assertion reading "lightning hits the NEAREST foe", a test defending
## exactly what the data contradicts. Rule 12, inverted.
##
## WHY THIS IS A MEASUREMENT AND NOT A COIN FLIP
##
##   * The random claim is a DISTRIBUTION, not a hit. "It hit one of the foes" proves nothing:
##     the nearest-foe bug hits a foe too. 200 bolts against four foes at distinct distances
##     give the nearest a 1-in-4 share under a uniform pick and ALL of them under the bug,
##     and `Check.rate` accepts a share in [0.05, 0.45]: a false-failure probability of
##     2.6e-10 from the binomial tail, against a bug that misses by 0.55.
##   * EVERY foe in range must be struck by some bolt (4 x (3/4)^200 = 4.1e-25 by chance). A
##     pick restricted to two or three of the four still scores 0.50 or 0.33 -- which the
##     rate above CAN accept -- and this is what catches it: the outer foes are never hit.
##   * The chain is a POPULATION, not a count of events: at level 3 a bolt into a tight
##     SIX-foe cluster damages `1 + chainCount` of them -- four -- however the random pick
##     falls; one level lower the same scene loses exactly one foe. Each is the other's
##     control, and the cluster holds more foes than the chain can reach, so the hop COUNT is
##     measured rather than assumed.
##
## CONTROLS, because a check whose subject is silently broken passes just as green:
##
##   * Soul Drain -- "Beam that tethers the NEAREST foe" on its own data -- runs through the
##     SAME strike helper and the same way of deciding which foe was hit, and must strike the
##     nearest in every trial. Without it, Lightning's "not the nearest" verdict could be a
##     harness that cannot see a nearest-targeted weapon at all.
##   * The hop's reach is pinned at BOTH ends, with an origin that cannot move: the probe is
##     outside the hero's own reach, so only a hop can touch it. 150px must be reached,
##     240px must not.
##   * Every measurement states its activity precondition -- a weapon that fired at nothing
##     would score a nearest-share of ZERO, which `Check.rate` would happily accept.
##
## THIS FILE DELIBERATELY DOES NOT TEST EVOLUTION. `evolveLevel` is 5 and the port has no
## evolution path at all, so level 5's three strikes and `chainCount + 2` hops are a
## different, unported claim. Levels 1-3 only.
##
##   godot --headless --path godot --script res://verify_lightning.gd
extends SceneTree

## Bolts per measurement. One hundred would halve the evidence; twenty would be a coin flip.
const TRIALS := 200
## How far the nearest foe's share may sit from the uniform 1/K and still be called random.
const NEAREST_TOL := 0.20
## `if (this.def.chain && this.level >= 3)` in `src/weapons.ts`. The THRESHOLD is the
## original's own condition rather than a field on the data (`chain` and `chainCount` are,
## and both are read).
const CHAIN_LEVEL := 3
## `nearest.takeDamage(dmg * 0.7)`: also the original's literal, also not on the data.
const HOP_DAMAGE_MULT := 0.7
## The two ends of the hop radius, which `src/weapons.ts` writes as `d < 180` with no name to
## read. A matched pair can pin a constant this file must not know: 180 satisfies both.
const HOP_MUST_REACH := 150.0
const HOP_MUST_NOT_REACH := 240.0
## A fixed seed, so the verdict does not move between runs while the code under test draws
## from Godot's global RNG. It cannot control a fix that owns a `RandomNumberGenerator`; the
## probabilities in the header are what covers that case.
const TRIAL_SEED := 20260214

const FRAME := 1.0 / 60.0

var lightning: Dictionary


func _init() -> void:
	Check.reset()
	seed(TRIAL_SEED)
	lightning = _weapon("lightning")

	# The claim rests on two fields of the DATA, so they are stated rather than assumed. If
	# `chain` ever leaves the def, every chain check below would pass by testing nothing.
	Check.unchanged(bool(lightning.get("chain", false)), true, "the data declares Lightning chains")
	Check.at_least(float(lightning.get("chainCount", 0)), 1.0, "and says how many hops")

	_target_is_random()
	_chain_starts_at_its_level()
	_chain_reach_is_bounded()
	_a_nearest_targeted_weapon_is_the_control()

	# ONE verdict source: every assertion in this file is a `Check.*` call, so `Check.ok` IS
	# the suite result. (A suite mixing two harnesses once printed FAIL and reported PASS; a
	# second flag here would be a second thing to keep in step, for no gain.)
	var passed := Check.ok
	print("verify_lightning: ", "PASS" if passed else "FAIL")
	quit(0 if passed else 1)


# ---------------------------------------------------------------------------
# The claim: a RANDOM foe in range
# ---------------------------------------------------------------------------

## Which of four in-range foes a level-1 bolt picks, over `TRIALS` bolts.
##
## The foes sit at DISTINCT distances and are added in an order that is NOT their distance
## order, so a harness that treated `foes[0]` as "the nearest" would be measuring itself.
func _target_is_random() -> void:
	var hero := _hero_holding(lightning, 1)
	var distances := [240.0, 80.0, 330.0, 150.0]
	var angles := [250.0, 20.0, 310.0, 130.0]
	var nearest := _nearest_index(distances)

	var nearest_hits := 0
	var in_range_hits := 0
	var multi_hits := 0
	var far_hits := 0
	var per_foe: Array = []
	for i in distances.size():
		per_foe.append(0)

	for trial in TRIALS:
		var foes: Array = []
		for i in distances.size():
			foes.append(_foe_at(hero, distances[i], angles[i]))
		# Far outside every reach this weapon has, so it can only be struck by a pick that
		# IGNORES range -- which "a random foe IN RANGE" forbids.
		foes.append(_foe_at(hero, 2000.0, 0.0))

		var loss := _strike(lightning, hero, foes, 1)
		var hit := 0
		for i in distances.size():
			if loss[i] > 0.0:
				hit += 1
				in_range_hits += 1
				per_foe[i] = int(per_foe[i]) + 1
		if hit > 1:
			multi_hits += 1
		if loss[nearest] > 0.0:
			nearest_hits += 1
		if loss[distances.size()] > 0.0:
			far_hits += 1

	print(
		"  ....   %d bolts, foes at %s px, strikes per foe %s, nearest-foe share %0.4f"
		% [TRIALS, str(distances), str(per_foe), float(nearest_hits) / float(TRIALS)]
	)

	# THE ACTIVITY PRECONDITION, first. A weapon that did nothing would give a nearest share
	# of zero, and zero is inside the rate's tolerance -- so without this the randomness
	# check would pass against a bolt that never struck anything.
	Check.unchanged(in_range_hits, TRIALS, "one bolt strikes exactly one foe at level 1")
	Check.unchanged(multi_hits, 0, "and never more than one: no chain below level %d" % CHAIN_LEVEL)
	# THE BUG. The nearest-foe implementation scores 1.00 here; a uniform pick scores 0.25.
	Check.rate(
		nearest_hits,
		TRIALS,
		1.0 / float(distances.size()),
		NEAREST_TOL,
		"the target is RANDOM: the nearest foe takes its 1-in-%d share" % distances.size()
	)
	# The other half of "random", and the half a pick from the two near foes cannot satisfy.
	var distinct := 0
	for n in per_foe:
		if int(n) > 0:
			distinct += 1
	Check.unchanged(distinct, distances.size(), "EVERY foe in range is struck by some bolt")
	Check.unchanged(far_hits, 0, "and a foe out of range is never struck")


# ---------------------------------------------------------------------------
# The claim: it chains from level 3
# ---------------------------------------------------------------------------

## Six foes in a tight cluster, fired at from one level below and one level at the chain
## threshold.
##
## Every pair of the six is inside the hop radius and `1 + chainCount` is four, so a bolt that
## chains damages exactly FOUR of them from whichever one the random pick chose -- while a
## chain that never stopped would reach all six. A claim about a RANDOM target is assertable
## exactly because the cluster's damage does not depend on the pick, only on whether the
## chain happened and how far it went.
func _chain_starts_at_its_level() -> void:
	# SIX foes, not four. `1 + chainCount` is 4, so the cluster holds more foes than the
	# chain can reach and the NUMBER of hops is measurable: a four-foe cluster looks
	# identical whether the chain stopped at `chainCount` or never stopped at all.
	# Every pair is inside the hop radius (the far corners are 134px apart), so a bolt that
	# chains three times damages four of the six from WHICHEVER one the random pick chose --
	# which is what makes an assertion about a random target deterministic.
	var offsets := [
		Vector2(90.0, -30.0), Vector2(150.0, -30.0), Vector2(210.0, -30.0),
		Vector2(90.0, 30.0), Vector2(150.0, 30.0), Vector2(210.0, 30.0)
	]
	var chain_count := int(lightning.get("chainCount", 0))
	var expected := mini(1 + chain_count, offsets.size())

	var below := _cluster_losses(offsets, CHAIN_LEVEL - 1)
	var at := _cluster_losses(offsets, CHAIN_LEVEL)

	# The scene can tell a BOUNDED chain from an unbounded one only while it holds more foes
	# than the chain can reach -- a precondition, so a later edit that shrinks the cluster
	# fails here rather than quietly turning the count below into a tautology.
	Check.at_least(
		float(offsets.size()),
		float(expected + 1),
		"the cluster holds more foes than 1 + chainCount, so the bound is testable"
	)
	Check.unchanged(_damaged(below), 1, "below level %d the bolt strikes ONE foe and stops" % CHAIN_LEVEL)
	Check.unchanged(
		_damaged(at),
		expected,
		"at level %d it CHAINS: 1 + chainCount(%d) = %d of the %d foes" % [CHAIN_LEVEL, chain_count, expected, offsets.size()]
	)
	# `dmg * 0.7` per hop. A chain at FULL damage is four times the weapon it is, so the
	# hop's damage is part of the claim -- and the ratio is what carries it, because the
	# magnitude itself is level-scaled.
	if _damaged(at) >= 2:
		var losses := _positive(at)
		var top := 0.0
		var bottom := INF
		for v in losses:
			top = maxf(top, float(v))
			bottom = minf(bottom, float(v))
		# DIRECTION first, then the factor. A chain at full damage fails both; a chain at the
		# wrong factor fails only the second, and the two numbers it prints say which.
		Check.fell(top, bottom, "a chained foe takes LESS than the foe the bolt itself struck")
		Check.approx(
			bottom / top,
			HOP_DAMAGE_MULT,
			"and the hop's share is the original's 0.7 of the bolt",
			0.05
		)


## HOW FAR A HOP REACHES, pinned at both ends by a probe that only a hop can touch.
##
## The probe sits outside the hero's own reach, so it can never be the bolt's first target at
## any level -- the sole in-range foe is the origin every time. That makes a claim about a
## radius deterministic without this file having to name the constant, which is 180 in
## `src/weapons.ts` and is not on the data.
func _chain_reach_is_bounded() -> void:
	# `baseRange * (1 + (level - 1) * 0.1)`: 462 at level 2 and 504 at level 3. The origin at
	# 380px is inside both (and inside the unscaled 420), the probes at 530 and 620 are
	# outside both -- so the probe is unreachable as a first target whether or not the fix
	# scales its reach with the level.
	var origin := 380.0
	var near_probe := origin + HOP_MUST_REACH
	var far_probe := origin + HOP_MUST_NOT_REACH

	var at := _pair_losses(origin, near_probe, CHAIN_LEVEL)
	Check.rose(0.0, at[0], "the only foe in the hero's reach is struck at level %d" % CHAIN_LEVEL)
	Check.rose(0.0, at[1], "the chain REACHES a foe %dpx from it, outside the hero's own reach" % int(HOP_MUST_REACH))

	# The control for the line above: same scene, same probe, one level lower.
	var below := _pair_losses(origin, near_probe, CHAIN_LEVEL - 1)
	Check.rose(0.0, below[0], "and below level %d the in-reach foe is still struck" % CHAIN_LEVEL)
	Check.unchanged(below[1], 0.0, "but the %dpx probe is NOT: the chain starts at level %d" % [int(HOP_MUST_REACH), CHAIN_LEVEL])

	# The control for the reach itself: a chain that hops to anything in range would take
	# this one too, and "within 180px" would be decoration.
	var far := _pair_losses(origin, far_probe, CHAIN_LEVEL)
	Check.rose(0.0, far[0], "the in-reach foe is struck with the far probe present")
	Check.unchanged(far[1], 0.0, "and a hop does NOT reach %dpx -- 180 is a bound, not a formality" % int(HOP_MUST_NOT_REACH))


# ---------------------------------------------------------------------------
# The control: a weapon that IS nearest-targeted still measures as nearest
# ---------------------------------------------------------------------------

## Soul Drain's own data says "Beam that tethers the NEAREST foe", so it must strike the
## nearest in EVERY trial -- through the same helper, the same foe placement and the same
## way of reading which foe took damage as Lightning's measurement above.
##
## This is what makes Lightning's verdict evidence rather than a harness artefact: if this
## file could not see a nearest-targeted weapon, "Lightning is not the nearest" would mean
## nothing at all. It also fails if a fix makes the SHARED nearest-strike helper random,
## which would silently turn Soul Drain into a different weapon.
func _a_nearest_targeted_weapon_is_the_control() -> void:
	var drain := _weapon("soul_drain")
	var hero := _hero_holding(drain, 1)
	var distances := [190.0, 80.0, 240.0, 130.0]
	var angles := [200.0, 10.0, 300.0, 120.0]
	var nearest := _nearest_index(distances)

	var nearest_hits := 0
	var in_range_hits := 0
	var far_hits := 0
	for trial in TRIALS:
		var foes: Array = []
		for i in distances.size():
			foes.append(_foe_at(hero, distances[i], angles[i]))
		foes.append(_foe_at(hero, 2000.0, 0.0))
		var loss := _strike(drain, hero, foes, 1)
		for i in distances.size():
			if loss[i] > 0.0:
				in_range_hits += 1
		if loss[nearest] > 0.0:
			nearest_hits += 1
		if loss[distances.size()] > 0.0:
			far_hits += 1

	Check.unchanged(in_range_hits, TRIALS, "CONTROL: the nearest-targeted weapon fires every trial")
	Check.unchanged(nearest_hits, TRIALS, "CONTROL: Soul Drain strikes the NEAREST foe in all %d trials" % TRIALS)
	Check.unchanged(far_hits, 0, "CONTROL: and never a foe outside its range")


# ---------------------------------------------------------------------------
# Scenes
# ---------------------------------------------------------------------------

## A hero HOLDING `weapon` at `level`: the level the hero has and the level handed to
## `fire()` are the same number, so an implementation that reads either one agrees with this
## file about what level is being measured.
func _hero_holding(weapon: Dictionary, level: int) -> Hero:
	var g := Game.without_spawns()
	g.hero.weapons.clear()
	g.hero.add_weapon(weapon)
	for i in level - 1:
		g.hero.level_weapon(str(weapon["id"]))
	return g.hero


## A foe `distance` px from `hero` on `angle_deg`, with health it cannot lose -- so a check
## about DAMAGE is never accidentally a check about DEATH.
func _foe_at(hero: Hero, distance: float, angle_deg: float) -> Foe:
	var a := deg_to_rad(angle_deg)
	return Check.sturdy(
		Foe.new(Enemies.ENEMIES["BAT"], hero.x + cos(a) * distance, hero.y + sin(a) * distance)
	)


## One fire of `weapon` at `level`, returning every foe's HP loss in the order given.
##
## A fix that routes the bolt through a travelling `Shot` instead of applying the damage
## where it stands is stepped to its landing before the loss is read: the claim is about
## which FOE is struck, and it must not depend on how the bolt gets there.
func _strike(weapon: Dictionary, hero: Hero, foes: Array, level: int) -> Array:
	var before: Array = []
	for f in foes:
		before.append(float(f.hp))
	var shots: Array = []
	WeaponFire.fire(weapon, hero, foes, shots, level)
	for i in 120:
		for s in shots:
			s.update(FRAME, hero.x, hero.y, hero.x, hero.y)
			s.resolve(foes, Callable())
	var loss: Array = []
	for i in foes.size():
		loss.append(float(before[i]) - float(foes[i].hp))
	return loss


## The HP loss of one fire at one level, over a cluster at `offsets` from the hero.
func _cluster_losses(offsets: Array, level: int) -> Array:
	var hero := _hero_holding(lightning, level)
	var foes: Array = []
	for off in offsets:
		foes.append(Check.sturdy(Foe.new(Enemies.ENEMIES["BAT"], hero.x + off.x, hero.y + off.y)))
	return _strike(lightning, hero, foes, level)


## The HP loss of one fire at one level, over an origin foe and one probe foe on the +x axis.
func _pair_losses(origin_distance: float, probe_distance: float, level: int) -> Array:
	var hero := _hero_holding(lightning, level)
	var foes: Array = [
		Check.sturdy(Foe.new(Enemies.ENEMIES["BAT"], hero.x + origin_distance, hero.y)),
		Check.sturdy(Foe.new(Enemies.ENEMIES["BAT"], hero.x + probe_distance, hero.y))
	]
	return _strike(lightning, hero, foes, level)


# ---------------------------------------------------------------------------
# Small readings
# ---------------------------------------------------------------------------

## The index of the smallest of `distances`. Computed, never written down: a hand-copied
## index is a value this file could have READ.
func _nearest_index(distances: Array) -> int:
	var best := 0
	for i in distances.size():
		if float(distances[i]) < float(distances[best]):
			best = i
	return best


## How many of `losses` are damage rather than nothing.
func _damaged(losses: Array) -> int:
	var n := 0
	for v in losses:
		if float(v) > 0.0:
			n += 1
	return n


## The damage entries of `losses`, for the hop's share.
func _positive(losses: Array) -> Array:
	var out: Array = []
	for v in losses:
		if float(v) > 0.0:
			out.append(float(v))
	return out


## A weapon def by its `id`, regardless of how the table is keyed. The table is keyed
## `LIGHTNING` and the def's own id is `lightning`; matching on the key is the trap that
## silently fell through on the wave pools, so it is done by id here too.
func _weapon(id: String) -> Dictionary:
	for def in Weapons.WEAPONS.values():
		if def["id"] == id:
			return def
	push_error("no weapon def for id '%s'" % id)
	return Weapons.WEAPONS.values()[0]
