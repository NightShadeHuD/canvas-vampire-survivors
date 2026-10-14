## Every weapon in the data must actually DO something.
##
## WHY THIS EXISTS
##
## The level-up screen offered eleven weapons and only Garlic had an implementation --
## so picking the Magic Wand stored it, showed it on the hero, and changed nothing.
## Nothing caught it because every test asserted the ONE weapon that worked.
##
## This drives the real data table: add each weapon to a hero, fire it at a foe that
## is in range, and require the foe to take damage. A weapon with no code fails, and
## a weapon ADDED to `src/data.ts` later fails until it is implemented -- which is the
## property that makes this worth having.
##
## THE SAME MOVE APPLIES TO THE EVOLUTION FIELDS, and that is the section at the end of
## this file. `evolveLevel`, `evolveDamageMult`, `evolveBonusCrit` and `evolveCooldownMult`
## were declared on ten of the eleven weapons and read by NOTHING here: a weapon at its
## evolve level was the weapon below it with 20% more damage. `_declaring()` iterates the
## table, so a weapon added with an `evolveLevel` fails there until it evolves -- and every
## measurement in that section is taken at ONE level, with the declaration on the def and
## off it, so ordinary level scaling cannot produce the difference it looks for.
##
##   godot --headless --path godot --script res://verify_weapons.gd
extends SceneTree

const FRAME := 1.0 / 60.0
## Where the three smite-test foes stand, in px from the hero. All three are inside the
## weapon's own reach at level 1 (420), so all three are candidates, and they are at three
## different distances so "the nearest" is ONE foe rather than a tie.
const SMITE_AT := [50.0, 200.0, 380.0]
## The seed the randomness tests pin. Any value would do; it is fixed so a failure is
## reproducible and a pass is not luck.
const SMITE_SEED := 20260425
## How many times the randomness test fires. Named, because it is the DENOMINATOR of the
## rate below and a rate over "however many hits there were" is not a rate over fires -- a
## chain at level 1 would silently change what was being divided by what.
const SMITE_TRIALS := 300
var ok := true

func _init() -> void:
	_every_weapon_damages()
	_range_is_respected()
	_pierce_hits_several_then_stops()
	_orbit_shards_circle_and_hit()
	_boomerang_comes_back()
	_drain_heals()
	_lightning_smites_a_random_foe()
	_lightning_chains_from_level_three()
	_lightning_shows_every_hop()
	_multi_projectile_fires_a_volley()
	_every_weapon_scales_with_its_level()
	_cooldowns_are_per_weapon()
	_melee_sweeps_a_band()
	_every_weapon_leaves_something_to_draw()

	# EVOLUTION. `src/data.ts` declares it on ten of the eleven weapons and nothing in
	# `godot/` read any of it -- see the section at the end of this file for what each of
	# these measures and for the control that sits beside every measurement.
	_evolution_is_declared_in_the_data()
	_every_declaring_weapon_changes_at_its_level()
	_the_trigger_is_the_declared_level()
	_the_declared_numbers_are_obeyed()
	_melee_evolves_into_a_circle()
	_instant_evolves_into_a_storm()

	# FROST NOVA'S SLOW. `src/data.ts` declares `slowPct` and `slowDuration` on the def,
	# `src/weapons.ts` reads both, `src/entities.ts` applies them to the foe's speed and
	# `src/entity-render.ts` tints the result. `Foe` had no slow field at all, so the
	# nova's own description -- "Expanding ring of ice slows foes caught in the burst" --
	# was a promise nothing kept. Every measurement below drives the real table.
	_the_slow_is_read_from_the_data()
	_a_slowed_foe_moves_slower()
	_a_slowed_foe_is_drawn_iced_blue()
	_the_slow_expires_exactly_on_its_duration()
	_the_evolved_second_ring_does_not_slow()

	# BOTH harnesses. `Check.*` sets its own flag, and a suite that printed a FAIL
	# while reporting PASS is a false green -- the failure mode this tooling exists
	# to remove, introduced by the tooling itself.
	var passed := ok and Check.ok
	print("verify_weapons: ", "PASS" if passed else "FAIL")
	quit(0 if passed else 1)

## A hero with one weapon, and a foe placed just inside that weapon's range.
func _scene(weapon_id: String, foes_at := 40.0) -> Dictionary:
	# Looked up by the def's own `id`: the dictionary is keyed `KNIFE` and the id is
	# `knife`, and matching on the key is the trap that silently fell through on the
	# wave pools. One lookup helper, used everywhere, so it cannot be got wrong twice.
	var def: Dictionary = _weapon(weapon_id)
	var g := Game.new(999.0)  # no natural spawning
	g.hero.weapons.clear()
	g.hero.add_weapon(def)
	var foe := Foe.new(Enemies.ENEMIES["BAT"], g.hero.x + foes_at, g.hero.y)
	foe.max_hp = 100000.0
	foe.hp = foe.max_hp
	g.foes.append(foe)
	return {"game": g, "foe": foe, "def": def}

## The headline check, run over the DATA rather than a hand-written list.
func _every_weapon_damages() -> void:
	var silent: Array = []
	# Iterate the DEFS, not the keys. The table is keyed `WHIP` and the def's own id is
	# `whip`, and mixing the two is the trap this file exists to catch -- in the wave
	# pools it silently spawned the wrong enemy for a whole round.
	for def in Weapons.WEAPONS.values():
		var id: String = def["id"]
		# Orbit shards travel ON a ring at `baseRange`, so a foe at 40% of it is never
		# touched by design. Every other archetype reaches inward from its range.
		var at: float = float(def["baseRange"])
		if def["type"] != "orbit":
			at *= 0.4
		var s := _scene(id, at)
		var before: float = s["foe"].hp
		var shots: Array = []
		WeaponFire.fire(def, s["game"].hero, s["game"].foes, shots)
		# Shots need a frame to travel before they can hit.
		for i in 120:
			for shot in shots:
				shot.update(FRAME, s["game"].hero.x, s["game"].hero.y, s["game"].hero.x, s["game"].hero.y)
				shot.resolve(s["game"].foes, Callable())
		if s["foe"].hp >= before:
			silent.append("%s (%s)" % [id, def["type"]])
	_check(silent.is_empty(), "EVERY weapon damages a foe in range", "silent: %s" % (", ".join(silent) if not silent.is_empty() else "none"))

func _range_is_respected() -> void:
	# A foe well outside the reach must be untouched, or "range" is decoration.
	var s := _scene("knife", 5000.0)
	var before: float = s["foe"].hp
	var shots: Array = []
	WeaponFire.fire(s["def"], s["game"].hero, s["game"].foes, shots)
	for i in 600:
		for shot in shots:
			shot.update(FRAME, s["game"].hero.x, s["game"].hero.y, s["game"].hero.x, s["game"].hero.y)
			shot.resolve(s["game"].foes, Callable())
	_check(s["foe"].hp == before, "a foe out of range is untouched", "hp unchanged")

func _pierce_hits_several_then_stops() -> void:
	# KNIFE pierces, MAGIC_WAND does not. Both are asserted, because a pierce flag
	# that is always on is as wrong as one that is never on.
	var g := Game.new(999.0)
	g.hero.weapons.clear()
	var knife: Dictionary = _weapon("knife")
	g.hero.add_weapon(knife)
	var foes: Array = []
	for i in 3:
		var f := Foe.new(Enemies.ENEMIES["BAT"], g.hero.x + 60.0 + i * 20.0, g.hero.y)
		f.max_hp = 1000.0
		f.hp = 1000.0
		foes.append(f)
		g.foes.append(f)
	var shots: Array = []
	WeaponFire.fire(knife, g.hero, g.foes, shots)
	for i in 60:
		for shot in shots:
			shot.update(FRAME, g.hero.x, g.hero.y, g.hero.x, g.hero.y)
			shot.resolve(g.foes, Callable())
	var hurt := 0
	for f in foes:
		if f.hp < 1000.0:
			hurt += 1
	_check(hurt > 1, "a piercing knife hits more than one foe", "%d of 3" % hurt)

func _orbit_shards_circle_and_hit() -> void:
	var s := _scene("orbit", 130.0)
	var before: float = s["foe"].hp
	var shots: Array = []
	WeaponFire.fire(s["def"], s["game"].hero, s["game"].foes, shots)
	_check(shots.size() == 2, "orbit makes projectileCount shards", "%d" % shots.size())
	if shots.size() > 0:
		var start: float = shots[0].x
		for i in 30:
			shots[0].update(FRAME, s["game"].hero.x, s["game"].hero.y, s["game"].hero.x, s["game"].hero.y)
		_check(not is_equal_approx(shots[0].x, start), "and they MOVE", "x %0.1f -> %0.1f" % [start, shots[0].x])
		# A shard must stay on its ring, not spiral out.
		var d: float = sqrt(pow(shots[0].x - s["game"].hero.x, 2) + pow(shots[0].y - s["game"].hero.y, 2))
		_check(is_equal_approx(d, float(s["def"]["baseRange"])), "at a constant radius", "%0.1f" % d)

func _boomerang_comes_back() -> void:
	# Measured as distance from the THROWER: out then back means it shrinks again.
	var s := _scene("boomerang", 200.0)
	var shots: Array = []
	WeaponFire.fire(s["def"], s["game"].hero, s["game"].foes, shots)
	_check(shots.size() == 1, "a boomerang is thrown", "%d" % shots.size())
	if shots.size() == 1:
		_check(shots[0].kind == Shot.Kind.BOOMERANG, "and knows it is one", "kind = BOOMERANG")

func _drain_heals() -> void:
	var s := _scene("soul_drain", 100.0)
	# `Check.wounded` states the precondition. At full health the heal is correctly
	# clamped and the test fails against working code -- which it did.
	Check.wounded(s["game"].hero, 50.0)
	var before: float = s["game"].hero.hp
	var shots: Array = []
	WeaponFire.fire(s["def"], s["game"].hero, s["game"].foes, shots)
	_check(s["game"].hero.hp > before, "Soul Drain heals on hit", "hp %0.1f -> %0.1f" % [before, s["game"].hero.hp])

## LIGHTNING SMITES A RANDOM FOE, WHICH IS WHAT ITS OWN DATA SAYS IT DOES.
##
## `_fireInstant` in `src/weapons.ts`:
##
##     const cand = targets[Math.floor(Math.random() * targets.length)];
##
## and `src/data.ts`: "Smites a random foe. Lv3+ chains." The port smote the NEAREST and
## this suite ASSERTED it -- a test on the side of the bug, which is rule 12 inverted: the
## data declared one thing, the code did another, and the test wrote the code's version
## down as the specification. That assertion is GONE. Run against this code it fails about
## two runs in three -- measured, on this tree -- because a 50/50 draw lands on the near foe
## half the time. Which is also why it could never have seen the bug: it fires ONCE, and one
## draw is not a distribution.
##
## WHAT A RATE PROVES THAT "IT HIT ONE OF THEM" DOES NOT
##
## "One of the three foes was hit" is satisfied by hitting the same foe every single time,
## which is exactly what the bug did. Three foes at three distances are fired at
## `SMITE_TRIALS` times through a SEEDED generator and each must be struck about a third of
## the time: nearest-only reads 1.00 / 0.00 / 0.00, and only a draw from the whole in-range
## set reads a third each. What is counted is the POPULATION of foes hit per fire.
func _lightning_smites_a_random_foe() -> void:
	print("\n-- lightning smites a RANDOM foe --")
	var def: Dictionary = _weapon("lightning")
	var picks := _lightning_picks(def, SMITE_SEED, SMITE_TRIALS)
	Check.unchanged(picks.size(), SMITE_TRIALS, "one foe is smitten per fire -- no chain at level 1")
	var hits := [0, 0, 0]
	for pick in picks:
		hits[pick] += 1
	for i in SMITE_AT.size():
		Check.rate(
			hits[i],
			SMITE_TRIALS,
			1.0 / float(SMITE_AT.size()),
			0.1,
			"the foe at %dpx is smitten about a third of the time" % int(SMITE_AT[i])
		)

	# THE INJECTED GENERATOR IS THE ONE THAT DRAWS, and it is consumed in LOCKSTEP: the first
	# twelve picks of this SMITE_TRIALS-fire run are the twelve picks a fresh generator with
	# seed produces, one draw per fire. A pick taken from `randf()`, or from the global
	# generator the game itself uses, cannot reproduce them -- so the repeatability every
	# number in this file leans on is a property of the code rather than of luck. A prefix,
	# not the whole run, because a failure prints the two sequences and 300 numbers is not a
	# diagnostic; twelve differing picks out of 3^12 possibilities is not an accident.
	Check.unchanged(
		picks.slice(0, 12),
		_lightning_picks(def, SMITE_SEED, 12),
		"and a seeded rng REPLAYS the same picks, one draw per fire"
	)

## Which foe Lightning smites on each of `trials` fires, as a list of indices.
##
## The SEQUENCE, not a count: the rate above counts it and the replay above compares it with
## another run, so both claims are about the same measurement rather than about two
## hand-rolled loops that could drift apart.
func _lightning_picks(def: Dictionary, seed_value: int, trials: int) -> Array:
	var g := Game.without_spawns()
	g.hero.weapons.clear()
	g.hero.add_weapon(def)
	var foes: Array = []
	for at in SMITE_AT:
		# STURDY, because this measures WHICH foe is chosen and not whether it dies: 300
		# smites is 16,800 damage, and a corpse leaves the candidate list and silently
		# changes what is being measured.
		var f := Check.sturdy(Foe.new(Enemies.ENEMIES["BAT"], g.hero.x + at, g.hero.y))
		foes.append(f)
		g.foes.append(f)
	var rng := RandomNumberGenerator.new()
	rng.seed = seed_value
	var picks: Array = []
	for i in trials:
		var before: Array = []
		for f in foes:
			before.append(f.hp)
		WeaponFire.fire(def, g.hero, g.foes, [], 1, null, rng)
		for j in foes.size():
			if foes[j].hp < before[j]:
				picks.append(j)
	return picks

## THE CHAIN, WHICH THE PORT DID NOT HAVE AT ALL.
##
##     if (this.def.chain && this.level >= 3) {
##         for (let c = 0; c < chainCount; c++) { ... d < 180 ... nearest.takeDamage(dmg * 0.7); }
##
## Four claims, each pinned where the wrong code cannot also satisfy it.
##
##   THE LEVEL GATE. A tight line of five foes, every one within 180px of every other, so
##   WHICHEVER foe the random smite picks there is an un-chained neighbour for each hop.
##   The count is therefore the same for any draw and does not depend on the seed. One foe
##   at level 1 and at level 2; 1 + chainCount at level 3.
##
##   THE DATA FIELDS ARE READ. The same def with `chain` off chains nowhere, and with
##   `chainCount` cut to 1 it hops exactly once. A hardcoded 3 satisfies neither, which is
##   the property rule 12 exists for.
##
##   THE HOP RADIUS, at the boundary and one past it: two foes `sep` apart, both inside the
##   reach, so whichever is smitten the other is reachable only by a hop. `d < 180` is
##   STRICT in the original, so 180.0 is out and 179.999 is in.
##
##   THE HOP DAMAGE, as a RATIO against what the strike itself dealt: 0.7. A ratio, so this
##   is the original's `dmg * 0.7` and not a second copy of the level curve that
##   `_every_weapon_scales_with_its_level` already covers.
func _lightning_chains_from_level_three() -> void:
	print("\n-- lightning chains at level 3 --")
	var def: Dictionary = _weapon("lightning")
	var hops := int(def["chainCount"])
	var line: Array = [40.0, 60.0, 80.0, 100.0, 120.0]
	Check.unchanged(_smitten(def, line, 1).size(), 1, "level 1: one foe smitten, no chain")
	Check.unchanged(_smitten(def, line, 2).size(), 1, "level 2: still one -- the chain is Lv3+")
	Check.unchanged(
		_smitten(def, line, 3).size(), 1 + hops, "level 3: the strike plus chainCount=%d hops" % hops
	)

	var unlinked := def.duplicate()
	unlinked["chain"] = false
	Check.unchanged(_smitten(unlinked, line, 3).size(), 1, "chain: false -- no chain at level 3")
	var single := def.duplicate()
	single["chainCount"] = 1
	Check.unchanged(_smitten(single, line, 3).size(), 2, "chainCount: 1 -- exactly one hop")

	Check.unchanged(
		[_chained_at(def, 179.999), _chained_at(def, 180.0), _chained_at(def, 180.001)],
		[2, 1, 1],
		"the hop radius is 180 STRICT: 179.999 chains, 180.0 and 180.001 do not"
	)
	Check.approx(_hop_damage_ratio(def), 0.7, "a hop deals 0.7x the damage the strike dealt")

## The indices of the DISTINCT foes a Lightning fire damages, in a line of foes at those px
## offsets from the hero. A population, not a count of damage events: a chain that re-hit
## the foe it started from reads as one here and as two in a counter.
func _smitten(def: Dictionary, line: Array, level: int) -> Array:
	var g := Game.without_spawns()
	g.hero.weapons.clear()
	g.hero.add_weapon(def)
	var foes: Array = []
	for off in line:
		var f := Check.sturdy(Foe.new(Enemies.ENEMIES["BAT"], g.hero.x + off, g.hero.y))
		foes.append(f)
		g.foes.append(f)
	WeaponFire.fire(def, g.hero, g.foes, [], level)
	var hurt: Array = []
	for i in foes.size():
		if foes[i].hp < foes[i].max_hp:
			hurt.append(i)
	return hurt

## How many foes are damaged when the only other one is `sep` px from the foe that was
## smitten -- the hop radius, measured as a population rather than as a distance.
func _chained_at(def: Dictionary, sep: float) -> int:
	return _smitten(def, [50.0, 50.0 + sep], 3).size()

## The damage a hop deals, over the damage the smite itself dealt.
##
## The smitten foe is at 400px, the ONLY one inside the level-3 reach (420 * 1.2 = 504), so
## the smite is deterministic without a seed; the foe at 550px is outside that reach and
## reachable only by a hop. A ratio of what actually landed, so the claim under test is the
## original's `dmg * 0.7`.
func _hop_damage_ratio(def: Dictionary) -> float:
	var g := Game.without_spawns()
	g.hero.weapons.clear()
	g.hero.add_weapon(def)
	var smitten := Check.sturdy(Foe.new(Enemies.ENEMIES["BAT"], g.hero.x + 400.0, g.hero.y))
	var hopped := Check.sturdy(Foe.new(Enemies.ENEMIES["BAT"], g.hero.x + 550.0, g.hero.y))
	g.foes.append(smitten)
	g.foes.append(hopped)
	WeaponFire.fire(def, g.hero, g.foes, [], 3)
	var direct: float = smitten.max_hp - smitten.hp
	var chained: float = hopped.max_hp - hopped.hp
	if direct <= 0.0:
		return -1.0
	return chained / direct

## AND EVERY HOP IS SHOWN. `_fireInstant` bursts at each foe the bolt touches:
##
##     game.createParticles(target.x, target.y, '#ffff66', 14);     <- the smite
##     game.createParticles(nearest.x, nearest.y, '#ffff66', 8);    <- every hop
##
## The port emitted one burst per struck foe and its comment claimed "a chain of three gets
## three bursts and the player can see which foes were hit" -- true of the original and,
## before the chain existed, of nothing here. A chain that damages four foes and draws one
## of them is the Garlic ring's lie again: the drawing not matching what the code did.
##
## MEASURED AT EACH FOE'S OWN POSITION, not as a total. A count of sparks would pass for
## four bursts all emitted at the hero, which shows the player nothing about WHICH foes were
## hit. The line is 150px apart, so a burst at one foe cannot be counted at another, and
## every one of the 1 + chainCount foes must have sparks at its own feet.
func _lightning_shows_every_hop() -> void:
	print("\n-- a chain SHOWS each hop --")
	var def: Dictionary = _weapon("lightning")
	var hops := int(def["chainCount"])
	# 400px is the only offset inside the level-3 reach (504), and each 150px step after it
	# is inside the 180px hop radius of the one before and outside the reach itself -- so
	# the smitten foe is deterministic and every other foe is reachable only by a hop.
	var line: Array = []
	var at := 400.0
	for i in 1 + hops:
		line.append(at)
		at += 150.0
	var g := Game.without_spawns()
	g.hero.weapons.clear()
	g.hero.add_weapon(def)
	var foes: Array = []
	for off in line:
		var f := Check.sturdy(Foe.new(Enemies.ENEMIES["BAT"], g.hero.x + off, g.hero.y))
		foes.append(f)
		g.foes.append(f)
	WeaponFire.fire(def, g.hero, g.foes, [], 3, g.fx)

	var hurt := 0
	for f in foes:
		if f.hp < f.max_hp:
			hurt += 1
	Check.unchanged(hurt, 1 + hops, "the chain hit every foe in the line")

	var bursts: Array = []
	for f in foes:
		var n := 0
		for spark in g.fx.sparks:
			if is_equal_approx(spark.x, f.x) and is_equal_approx(spark.y, f.y):
				n += 1
		bursts.append(n)
	# The smite's own burst first, then one per hop: the original's 14 and 8.
	var want: Array = [14]
	for i in hops:
		want.append(8)
	Check.unchanged(bursts, want, "one burst AT EACH foe: 14 for the smite, 8 for every hop")

func _multi_projectile_fires_a_volley() -> void:
	var s := _scene("retro_blaster", 150.0)
	var shots: Array = []
	WeaponFire.fire(s["def"], s["game"].hero, s["game"].foes, shots)
	_check(shots.size() == 2, "a 2-projectile weapon fires 2", "%d" % shots.size())
	if shots.size() == 2:
		# Compared by ANGLE, not by `vx`. A tight fan has almost the same x component
		# in both shots -- the separation is in y -- and the first version of this
		# check failed against a correctly spread volley.
		Check.differs(shots[0].vy, shots[1].vy, 1.0, "and they spread rather than overlap")
		# `vy`, not `vx`. `cos` is EVEN, so the x components of a symmetric fan are
		# EXACTLY equal -- the original check compared a constant with itself.
		Check.differs(shots[0].vy * shots[1].vy, 0.0, 1.0, "on opposite sides of the aim line")

## EVERY weapon gets STRONGER with its own level.
##
## This was absent: a behavioural audit measured knife and whip at weapon level 1 and
## level 5 producing IDENTICAL damage (12.0), identical shot life (0.677s) and identical
## rates (24 shots in 10s), because `WeaponFire.fire()` had no level parameter at all.
## The level-up UI offers "Lv.2", "Lv.3" and "MAXED" -- the most common offer in the game
## -- and every one of them did nothing.
##
## DRIVEN BY THE DATA TABLE, not by one weapon that happens to work. A weapon added
## without a level-scaling path fails here the moment it is added, which is the pattern
## the other suites in this port already use.
func _every_weapon_scales_with_its_level() -> void:
	var scaled := 0
	var not_scaling: Array = []
	for def in Weapons.WEAPONS.values():
		var g := Game.without_spawns()
		# A target INSIDE the weapon's reach, so each archetype actually fires.
		var foe := Foe.new(Enemies.ENEMIES["BAT"], g.hero.x + 40.0, g.hero.y)
		g.foes.append(foe)
		# MEASURED AS DAMAGE TO THE FOE, not as projectiles created.
		#
		# The first version counted shots, which only sees the four archetypes that
		# RETURN one. Whip, Lightning, Mine, Garlic, Frost Nova and Soul Drain apply
		# damage directly and return nothing, so they were reported as not scaling when
		# the measurement could not see them at all. What a player experiences is the
		# foe losing health, so that is what this measures.
		var lo := _damage_at(def, 1)
		var hi := _damage_at(def, 5)
		var lo_n := _shots_at(def, 1)
		var hi_n := _shots_at(def, 5)
		# EITHER signal counts, and both are real. Damage rising is a harder hit; COUNT
		# rising is better coverage. Orbit is the case that proves they are different
		# claims: its shards go 2 -> 3 -> 4 while single-target damage does NOT rise,
		# because a foe's re-hit window caps how often any one of them can land. Asserting
		# only damage would call a correctly-scaling weapon broken.
		if hi > lo + 0.001 or hi_n > lo_n:
			scaled += 1
		else:
			not_scaling.append("%s (dmg %0.1f -> %0.1f, n %d -> %d)" % [def["id"], lo, hi, lo_n, hi_n])
	Check.unchanged(not_scaling, [], "EVERY weapon in the data scales with its level")
	Check.at_least(float(scaled), float(Weapons.WEAPONS.size()), "all %d were measured" % Weapons.WEAPONS.size())

	# And the cooldown curve, which the game applies at its own call site.
	var knife: Dictionary = Weapons.WEAPONS["KNIFE"]
	var cd1 := float(knife["baseCooldown"]) * pow(0.92, 0.0)
	var cd5 := float(knife["baseCooldown"]) * pow(0.92, 4.0)
	# `Check.fell(before, after)`. This was written the other way round, and the suite
	# said so immediately -- 0.2866 -> 0.4000 is a RISE, and the helper is not wrong.
	Check.fell(cd1, cd5, "a higher weapon level SHORTENS its cooldown")


## Total damage one shot of `def` does to a lone foe at weapon level `level`.
##
## Fires through the REAL archetype path and then steps the simulation, so projectiles
## travel and strike weapons land. Returns the foe's HP loss, which is the thing a player
## perceives -- and it is archetype-blind, so a new weapon type is measured rather than
## silently skipped.
## How many projectiles/shards `def` creates at `level`.
func _shots_at(def: Dictionary, level: int) -> int:
	var g := Game.without_spawns()
	g.foes.append(Foe.new(Enemies.ENEMIES["BAT"], g.hero.x + 40.0, g.hero.y))
	return WeaponFire.fire(def, g.hero, g.foes, [], level).size()


func _damage_at(def: Dictionary, level: int) -> float:
	var g := Game.without_spawns()
	var foe := Foe.new(Enemies.ENEMIES["BAT"], g.hero.x + 40.0, g.hero.y)
	foe.hp = 100000.0
	foe.max_hp = 100000.0
	g.foes.append(foe)
	var before: float = foe.hp
	var made: Array = WeaponFire.fire(def, g.hero, g.foes, [], level)
	for s in made:
		g.shots.append(s)
	for i in 90:
		g.step(1.0 / 60.0, Vector2.ZERO)
	return before - float(foe.hp)


func _cooldowns_are_per_weapon() -> void:
	# A knife (0.4s) must not be throttled by a slower weapon the hero also holds.
	var g := Game.new(999.0)
	g.hero.weapons.clear()
	g.hero.add_weapon(_weapon("garlic"))     # 0.2s
	g.hero.add_weapon(_weapon("lightning"))  # 3.0s
	var foe := Foe.new(Enemies.ENEMIES["BAT"], g.hero.x + 50.0, g.hero.y)
	foe.max_hp = 1000000.0
	foe.hp = foe.max_hp
	g.foes.append(foe)
	# Step two seconds: lightning fires once, garlic about ten times.
	for i in 120:
		g.step(FRAME, Vector2.ZERO)
	_check(g.cooldowns.has("garlic") and g.cooldowns.has("lightning"), "each weapon has its own timer", "both keyed")
	_check(
		float(g.cooldowns["lightning"]) > float(g.cooldowns["garlic"]),
		"and the slow one is not reset by the fast one",
		"lightning %0.2f vs garlic %0.2f" % [g.cooldowns["lightning"], g.cooldowns["garlic"]]
	)

## THE WHIP'S SWEEP IS A BAND, AND THE BAND DRAWN IS THE BAND THAT DAMAGED.
##
## `_fireMelee` in `src/weapons.ts`:
##
##     if (Math.abs(dx) > range) continue;
##     if (Math.abs(dy) > 40) continue;
##
## The port damaged a 360-degree disc. A behavioural audit measured what that costs: on a
## ring of eight foes the original hits the two on the horizontal axis, and the disc hits
## all eight -- so the Whip was eight times the weapon it is, and the shape a player was
## shown (none) could not have told them either way.
##
## Pinned at BOTH edges and one past each, which is the only form of this claim a disc
## cannot also satisfy.
func _melee_sweeps_a_band() -> void:
	var def: Dictionary = _weapon("whip")
	var reach := float(def["baseRange"])

	# Eight foes on a ring at 90% of the reach. The diagonal ones are ~57px off the
	# horizontal axis: outside the 40px band, inside the disc the port used to damage.
	var g := Game.without_spawns()
	g.hero.weapons.clear()
	g.hero.add_weapon(def)
	var ring: Array = []
	for i in 8:
		var angle := TAU * float(i) / 8.0
		var f := Check.sturdy(
			Foe.new(
				Enemies.ENEMIES["BAT"],
				g.hero.x + cos(angle) * reach * 0.9,
				g.hero.y + sin(angle) * reach * 0.9
			)
		)
		ring.append(f)
		g.foes.append(f)

	# The FIRE, through the real archetype, with the real visual sink attached.
	WeaponFire.fire(def, g.hero, g.foes, [], 1, g.fx)

	var hurt := 0
	for f in ring:
		if f.hp < f.max_hp:
			hurt += 1
	Check.unchanged(g.foes.size(), 8, "the ring being measured holds eight foes")
	Check.unchanged(hurt, 2, "the Whip sweeps a BAND: 2 of 8 on a ring, not 8 of 8")

	# THE DRAWN SHAPE ANSWERS THE SAME QUESTION THE DAMAGE DID. Read out of the emitted
	# record rather than out of the constant, so a sweep DRAWN at one height and APPLIED
	# at another fails here -- which is the class of lie the Garlic ring was telling.
	Check.at_least(float(g.fx.strikes.size()), 1.0, "and the sweep is recorded for _draw")
	if g.fx.strikes.size() > 0:
		var sweep: Fx.Strike = g.fx.strikes[0]
		var agree := true
		for f in ring:
			var inside: bool = (
				absf(f.x - sweep.x) <= sweep.reach and absf(f.y - sweep.y) <= sweep.half_height
			)
			var damaged: bool = f.hp < f.max_hp
			if inside != damaged:
				agree = false
		Check.unchanged(agree, true, "the band DRAWN is the band that DAMAGED, foe for foe")

	# ONE PAST EACH EDGE. `>` and not `>=`: a foe at exactly `dy == 40` or `dx == reach` is
	# swept, and one at 40.001 or reach + 0.001 is not. The original's own comparison, so
	# the boundary is the original's boundary.
	Check.unchanged(
		_sweep_hits(def, [Vector2(60.0, 40.0), Vector2(60.0, 40.001), Vector2(reach, 0.0), Vector2(reach + 0.001, 0.0)]),
		[true, false, true, false],
		"pinned at both edges: dy 40 in, 40.001 out, dx reach in, reach + 0.001 out"
	)


## Which of `offsets` the Whip's sweep damages, one fresh sturdy foe per offset.
func _sweep_hits(def: Dictionary, offsets: Array) -> Array:
	var g := Game.without_spawns()
	g.hero.weapons.clear()
	g.hero.add_weapon(def)
	var foes: Array = []
	for off in offsets:
		var f := Check.sturdy(Foe.new(Enemies.ENEMIES["BAT"], g.hero.x + off.x, g.hero.y + off.y))
		foes.append(f)
		g.foes.append(f)
	WeaponFire.fire(def, g.hero, g.foes, [])
	var out: Array = []
	for f in foes:
		out.append(f.hp < f.max_hp)
	return out


## EVERY WEAPON'S FIRE LEAVES SOMETHING FOR `_draw` TO ITERATE.
##
## This is the whole bug in one assertion. `_draw` walked `game.shots`, `game.foes`,
## `game.orbs` and `game.enemy_shots`; six of the eight archetypes create no `Shot` at all,
## so firing a Whip, a Garlic, a Frost Nova, a Lightning, an Area Mine or a Soul Drain put
## NOTHING in any of those lists. A behavioural audit measured the Whip's frame moving 232
## pixels -- every one of them a foe's HP bar -- against 224 for a single Orbiter shard.
##
## DRIVEN BY THE DATA, so a weapon added to `src/data.ts` later fails here until its fire
## is visible. The claim is "a shot OR an effect": the pure-projectile archetypes are
## already drawn as shots, and demanding fx from them would be a different, false claim.
func _every_weapon_leaves_something_to_draw() -> void:
	var silent: Array = []
	for def in Weapons.WEAPONS.values():
		var g := Game.without_spawns()
		g.hero.weapons.clear()
		g.hero.add_weapon(def)
		# Inside the weapon's reach, so every archetype actually fires -- the same
		# placement `_every_weapon_damages` uses, and for the same reason.
		var at: float = float(def["baseRange"])
		if def["type"] != "orbit":
			at *= 0.4
		g.foes.append(Foe.new(Enemies.ENEMIES["BAT"], g.hero.x + at, g.hero.y))

		# The AURA emits on 40% of its fires -- a rate in the original too, so a single
		# fire proves nothing either way. Fifty of them make "the aura draws nothing" a
		# 1-in-10^11 accident rather than a coin flip. Every other archetype emits on
		# every fire, so the repetition costs them nothing.
		var fires := 50 if str(def["type"]) == "aura" else 1
		var visible := 0
		for i in fires:
			var shots: Array = []
			g.fx.clear()
			WeaponFire.fire(def, g.hero, g.foes, shots, 1, g.fx)
			if not shots.is_empty() or not g.fx.is_empty():
				visible += 1
		if visible == 0:
			silent.append("%s (%s)" % [def["id"], def["type"]])
	Check.unchanged(silent, [], "EVERY weapon's fire leaves something to DRAW")


## A weapon def by its `id`, regardless of how the table is keyed.
func _weapon(id: String) -> Dictionary:
	for def in Weapons.WEAPONS.values():
		if def["id"] == id:
			return def
	push_error("no weapon def for id '%s'" % id)
	return Weapons.WEAPONS.values()[0]

# ---------------------------------------------------------------------------
# EVOLUTION
#
# `src/data.ts` declares an evolution on ten of the eleven weapons, and NOTHING in
# `godot/` read any of it: `evolveLevel`, `evolveName`, and the payload fields
# `evolveDamageMult`, `evolveBonusCrit` and `evolveCooldownMult`. A weapon at its evolve
# level was the weapon below it with 20% more damage. `verify_lightning.gd` said so in its
# own header -- "THIS FILE DELIBERATELY DOES NOT TEST EVOLUTION" -- and the archetype
# dispatch said so in a comment instead of closing it.
#
# THE TRAP, AND HOW EVERY MEASUREMENT BELOW AVOIDS IT
#
# A weapon at level 5 ALREADY hits harder than the same weapon at level 4. Damage is
# `base * (1 + (level - 1) * 0.2)`, the cooldown falls 8% a level and the projectile count
# rises every other level -- so "it hits harder at 5" is not evidence of evolution, and a
# check that compares level 5 with level 4 is measuring the level curve.
#
# So every measurement here is taken AT ONE LEVEL. The same def is measured twice -- once
# as the data declares it, once with `evolveLevel` taken off the def -- in the same scene,
# with the same seed and the same number of frames. Level scaling is a CONSTANT of both
# runs, so it cannot produce a difference between them. The CONTROL one level below the
# declaration, where the field is still on the def and must change nothing, is what says
# the difference above is the THRESHOLD being crossed rather than the field existing.
#
# WHAT IS DRIVEN BY THE DATA, AND WHAT IS NOT
#
#   * The weapon list: `_declaring()` iterates `Weapons.WEAPONS`, so a weapon added to
#     `src/data.ts` with an `evolveLevel` fails the sweep below until it evolves.
#   * The level: `_evolve_level()` reads `evolveLevel`. It is 5 today and this file does not
#     know that -- `_the_trigger_is_the_declared_level` moves it in BOTH directions.
#   * The numbers: every payload field is compared against the number the DEF states, so a
#     hardcoded 1.1, 0.15 or 0.95 cannot satisfy it.
#   * The shape claims that are not on the data -- three strikes, `chainCount + 2` hops, a
#     circle instead of a band -- are quoted from `src/weapons.ts` in the section that
#     measures them, because for those the reference implementation IS the specification.
#   * `evolveName` is deliberately NOT asserted, and that is a GAP rather than a judgement:
#     `src/ui.ts` reads it -- the level-up card's "-> Bloody Sweep" tag and its "Evolves
#     into ..." line -- and nothing in `godot/` does, so the port shows the base name at
#     every level. Text in a card is not weapon BEHAVIOUR, and the round that produced this
#     file lost a round to a check that read a button's NAME and missed its description --
#     so it is reported here rather than asserted.
# ---------------------------------------------------------------------------

## How long a fireprint watches the world, in frames. Four seconds is several fires of every
## weapon in the data (the slowest cooldown is 3.2s), so a difference in cadence or in a
## second blast has room to land -- and it is short enough to measure the whole table.
const EVOLVE_FRAMES := 240
## The seed BOTH runs of a comparison share. Lightning picks a random foe, and two runs that
## drew different numbers would differ for a reason that has nothing to do with evolution.
const EVOLVE_SEED := 20260426
## Where the foes stand, as a multiple of the weapon's own `baseRange`. The rings span every
## archetype's geometry: a melee band reaches the inner ones, a nova reaches everything
## inside its radius, and an orbiter's shards travel ON a ring at `reach` -- which is 1.4x
## baseRange at level 5 -- so the outer ring is where its shards actually pass.
const SCATTER_RADII := [0.45, 0.8, 1.05, 1.35]
## Foes per ring.
const SCATTER_PER_RING := 8
## A hop distance `verify_lightning.gd` PROVES a chain reaches (its probe at 150px is struck;
## 240px is not). Used to place a cluster, not to assert a radius -- naming 180 here would be
## a second copy of a number that suite already pins at both ends.
const HOP_PROVEN_REACH := 150.0
## Fires per crit measurement. One fire is a coin flip; twelve hundred make the difference
## between "sometimes doubled" and "never doubled" a rate rather than an anecdote, and make
## the tolerance below tight enough that a SWAPPED pair of declared crit bonuses fails.
const CRIT_FIRES := 1200
## How long a shot is stepped before its damage is read. A blade at 620px/s covers the 60px
## to the target in six frames; forty is generous and cannot make a hit look like a miss.
const CRIT_SETTLE := 40


## THE DATA'S OWN GUARD: this section is worth nothing if the table stops declaring anything.
##
## Stated first and separately, because every claim below is a claim ABOUT these entries --
## an empty list would make all of them vacuously true.
func _evolution_is_declared_in_the_data() -> void:
	print("\n-- the data declares an evolution --")
	var declaring := _declaring()
	Check.at_least(
		float(declaring.size()),
		2.0,
		"`evolveLevel` is declared on more than one weapon (%d of %d)" % [
			declaring.size(), Weapons.WEAPONS.size()
		]
	)
	Check.at_least(float(_declaring_of_type("melee").size()), 1.0, "a melee weapon declares one")
	Check.at_least(float(_declaring_of_type("instant").size()), 1.0, "an instant weapon declares one")


## EVERY weapon that declares an evolution, in table order.
##
## `> 1`, because the control beside the sweep measures the level BELOW the declaration and a
## weapon that evolved at level 1 would have no level below it.
func _declaring() -> Array:
	var out: Array = []
	for def in Weapons.WEAPONS.values():
		if _evolve_level(def) > 1:
			out.append(def)
	return out


## The declaring weapons of one ARCHETYPE. Selecting by `type` rather than by id is what makes
## a second melee weapon -- or a second instant one -- measured by the same code the day it is
## added to `src/data.ts`, which is the property rule 12 asks a suite to have. Today there is
## one of each; the loops below do not know that.
func _declaring_of_type(kind: String) -> Array:
	var out: Array = []
	for def in _declaring():
		if str(def["type"]) == kind:
			out.append(def)
	return out


## The level the DEF declares, read rather than written down.
func _evolve_level(def: Dictionary) -> int:
	return int(def.get("evolveLevel", 0))


## THE SAME DEF WITH THE EVOLUTION DECLARATION TAKEN AWAY, and nothing else changed.
##
## The reference gate is `!!this.def.evolveLevel && this.level >= this.def.evolveLevel`, so
## removing the level removes every evolved branch at once -- the damage scalar, the crit
## bonus, the cooldown and the shapes. That is what makes the two runs of a comparison differ
## in exactly one thing a player can see.
func _without_evolution(def: Dictionary) -> Dictionary:
	var bare: Dictionary = def.duplicate()
	bare.erase("evolveLevel")
	return bare


## A running Game whose hero HOLDS `weapon` at `level`. The hero's level and the level handed
## to `fire()` are the same number, so an implementation that reads either one agrees with
## this file about what is being measured.
func _game_holding(weapon: Dictionary, level: int) -> Game:
	var g := Game.without_spawns()
	g.hero.weapons.clear()
	g.hero.add_weapon(weapon)
	for i in level - 1:
		g.hero.level_weapon(str(weapon["id"]))
	return g


## Foes on rings around the hero, FROZEN where they stand.
##
## Frozen for the same reason `Check.sturdy` exists. A chaser walks at the hero, and after
## four seconds every foe in the scene is standing ON it -- where a band and a circle damage
## exactly the same ones, and the difference this whole section exists to measure disappears
## into the enemy AI. The world a weapon fires into is held still; the weapon is what varies.
func _scatter(g: Game, base_range: float) -> Array:
	var made: Array = []
	for r in SCATTER_RADII:
		for i in SCATTER_PER_RING:
			var a := TAU * float(i) / float(SCATTER_PER_RING)
			var f := Check.sturdy(
				Foe.new(
					Enemies.ENEMIES["BAT"],
					g.hero.x + cos(a) * base_range * float(r),
					g.hero.y + sin(a) * base_range * float(r)
				)
			)
			f.speed = 0.0
			g.foes.append(f)
			made.append(f)
	return made


## The TOTAL DAMAGE `weapon` deals in `EVOLVE_FRAMES` of real simulation at `level`.
##
## Driven through `Game.step` rather than through `WeaponFire.fire`, so a second blast or a
## delayed pulse that the GAME has to schedule is measured rather than lost, and so the
## cooldown the game applies is part of what a player receives.
func _window_damage(weapon: Dictionary, level: int) -> float:
	var g := _game_holding(weapon, level)
	var foes := _scatter(g, float(weapon["baseRange"]))
	seed(EVOLVE_SEED)
	for i in EVOLVE_FRAMES:
		g.step(FRAME, Vector2.ZERO)
	var lost := 0.0
	for f in foes:
		lost += float(f.max_hp) - float(f.hp)
	return lost


## The SECONDS THE GAME SETS BETWEEN TWO SHOTS, read from its own timer immediately after the
## first one. `evolveCooldownMult` is a claim about this interval and about nothing else, and
## `g.cooldowns` is the same surface `_cooldowns_are_per_weapon` already reads.
func _interval(weapon: Dictionary, level: int) -> float:
	var g := _game_holding(weapon, level)
	g.step(FRAME, Vector2.ZERO)
	return float(g.cooldowns.get(str(weapon["id"]), -1.0))


## WHAT ONE FIRE THROWS: how many, and in which directions.
##
## A count alone cannot see a fan, and the fan is half of what a projectile weapon sells
## ("wide 5-blade fan", "triple volley"). Directions rather than a constant: two shots that
## leave at the same angle are the same shot to a player, whatever the code did to get there.
func _shot_aim(weapon: Dictionary, level: int) -> Array:
	var g := _game_holding(weapon, level)
	var foes := _scatter(g, float(weapon["baseRange"]))
	var shots: Array = []
	WeaponFire.fire(weapon, g.hero, foes, shots, level)
	var out: Array = [shots.size()]
	for s in shots:
		out.append(snappedf(atan2(s.vy, s.vx), 0.0001))
	return out


## EVERYTHING ONE WEAPON AT ONE LEVEL DOES that a player could see, as one comparable value:
## how often it fires, how much it hurts, and what it throws. Two runs are "the same weapon"
## when all three agree, so this is the thing a claim about evolution has to move.
func _fireprint(weapon: Dictionary, level: int) -> Dictionary:
	return {
		"interval": snappedf(_interval(weapon, level), 0.0001),
		"damage": snappedf(_window_damage(weapon, level), 0.001),
		"aim": _shot_aim(weapon, level)
	}


## How many DISTINCT foes at `offsets` px from the hero a single fire damages.
##
## A POPULATION, not a count of damage events: a bolt that struck the same foe twice reads as
## one here, which is what makes "three strikes" measurable rather than "three hits".
func _fire_hits(weapon: Dictionary, level: int, offsets: Array) -> int:
	var g := _game_holding(weapon, level)
	var foes: Array = []
	for off in offsets:
		var f := Check.sturdy(Foe.new(Enemies.ENEMIES["BAT"], g.hero.x + off.x, g.hero.y + off.y))
		foes.append(f)
		g.foes.append(f)
	WeaponFire.fire(weapon, g.hero, foes, [], level)
	var hurt := 0
	for f in foes:
		if f.hp < f.max_hp:
			hurt += 1
	return hurt


## A ring of `count` foes at `radius`, as offsets from the hero.
func _ring_offsets(radius: float, count: int) -> Array:
	var out: Array = []
	for i in count:
		var a := TAU * float(i) / float(count)
		out.append(Vector2(cos(a) * radius, sin(a) * radius))
	return out


## A LINE of `count` foes `origin` px out on the +x axis, `spacing` apart.
func _line_offsets(origin: float, spacing: float, count: int) -> Array:
	var out: Array = []
	for i in count:
		out.append(Vector2(origin + spacing * float(i), 0.0))
	return out


## A TIGHT GRID of `count` foes centred `distance` px along +x.
##
## Tight on purpose: every pair is inside the hop distance the line section PROVES is
## reachable, so a chain cannot stop early for want of a neighbour and the count read is the
## chain's length rather than the cluster's shape.
func _cluster_offsets(distance: float, count: int) -> Array:
	var out: Array = []
	for i in count:
		out.append(Vector2(distance + float(i % 3) * 30.0, float(i / 3) * 30.0 - 15.0))
	return out


## THE HEADLINE CLAIM, OVER THE WHOLE DATA TABLE.
##
## For EVERY weapon that declares `evolveLevel`: at that level it must DO something the same
## weapon at the same level cannot do without the declaration. Both runs are at ONE level, so
## this cannot be satisfied by level scaling; and the control one level below -- same field,
## same def, same scene -- must show NO difference, so a harness that reacted to the field
## merely being present would fail here rather than pass above.
##
## A weapon added to `src/data.ts` with an `evolveLevel` and no implementation lands in
## `unchanged` and fails, by name, which is the property rule 12 asks for.
func _every_declaring_weapon_changes_at_its_level() -> void:
	print("\n-- every weapon that declares an evolution changes at IT --")
	var unchanged: Array = []
	var control_broke: Array = []
	var measured := 0
	for def in _declaring():
		var id: String = def["id"]
		var e := _evolve_level(def)
		var bare := _without_evolution(def)
		measured += 1
		# THE MEASUREMENT, at the level the DATA declares.
		if _fireprint(def, e) == _fireprint(bare, e):
			unchanged.append("%s (%s, level %d)" % [id, def["type"], e])
		# THE CONTROL, one level below it.
		var at_e := _fireprint(def, e - 1)
		var bare_e := _fireprint(bare, e - 1)
		if at_e != bare_e:
			control_broke.append("%s (level %d: %s vs %s)" % [id, e - 1, at_e, bare_e])
	Check.at_least(float(measured), 2.0, "the sweep measured %d declaring weapon(s)" % measured)
	Check.unchanged(unchanged, [], "EVERY weapon declaring evolveLevel behaves differently AT it")
	Check.unchanged(control_broke, [], "CONTROL: below the declaration the same field changes NOTHING")


## THE TRIGGER IS THE NUMBER IN THE DATA, NOT THE NUMBER 5.
##
## `isEvolved()` is `level >= def.evolveLevel`, and the two directions below are the two ways
## to get that wrong. Both were MEASURED against a working transcription, and each catches a
## different mistake:
##
##   * a hardcoded `level >= 5`, which is what a check written from the two weapons in front of
##     you invites: the declaration no longer decides anything, so REMOVING `evolveLevel` from
##     the def changes nothing and all ten weapons land in the sweep's list above -- and a
##     weapon declaring 4 does not evolve at 4, which is the second control here.
##   * evolving on the mere PRESENCE of the field, at any level: the first control catches it,
##     because a weapon whose declaration has been raised to one level above must be ordinary
##     at the level it used to evolve at.
func _the_trigger_is_the_declared_level() -> void:
	print("\n-- the trigger is the declared level, not 5 --")
	var missed_raise: Array = []
	var missed_lower: Array = []
	var declaring := _declaring()
	for def in declaring:
		var e := _evolve_level(def)
		var up: Dictionary = def.duplicate()
		up["evolveLevel"] = e + 1
		if _fireprint(up, e) != _fireprint(_without_evolution(up), e):
			missed_raise.append("%s still evolves at %d with evolveLevel %d" % [def["id"], e, e + 1])
		var down: Dictionary = def.duplicate()
		down["evolveLevel"] = e - 1
		if _fireprint(down, e - 1) == _fireprint(_without_evolution(down), e - 1):
			missed_lower.append("%s does not evolve at %d with evolveLevel %d" % [def["id"], e - 1, e - 1])
	Check.at_least(float(declaring.size()), 2.0, "measured on all %d declaring weapon(s)" % declaring.size())
	Check.unchanged(missed_raise, [], "CONTROL: raising evolveLevel by one silences the evolution")
	Check.unchanged(missed_lower, [], "and lowering it by one takes the evolution down with it")


## THE DECLARED NUMBERS, OBEYED.
##
## Rule 12: if the data declares it, a check must prove the code READS it. Each comparison
## below is two runs of the same def, at the same level, in the same scene, differing in ONE
## payload field -- so the number the data states is the number the game must produce, and a
## hardcoded 1.1, 0.15 or 0.95 fails.
func _the_declared_numbers_are_obeyed() -> void:
	print("\n-- the declared evolution numbers are obeyed --")
	_damage_scalar_is_read()
	_cooldown_scalar_is_read()
	_bonus_crit_is_read()


## `getDamage`: `if (this.isEvolved() && this.def.evolveDamageMult) base *= ...`
##
## Same def, same level, same scene, one field apart -- so the geometry, the shard count and
## the number of hits are identical between the two runs and the damage ratio IS the scalar.
func _damage_scalar_is_read() -> void:
	var declared := 0
	for def in _declaring():
		if not def.has("evolveDamageMult"):
			continue
		declared += 1
		var e := _evolve_level(def)
		var without: Dictionary = def.duplicate()
		without.erase("evolveDamageMult")
		var plain := _window_damage(without, e)
		Check.rose(0.0, plain, "%s deals damage without the scalar, so the ratio is measurable" % def["id"])
		if plain > 0.0:
			Check.approx(
				_window_damage(def, e) / plain,
				float(def["evolveDamageMult"]),
				"%s deals its evolveDamageMult" % def["id"],
				0.02
			)
	Check.at_least(float(declared), 1.0, "a weapon declares evolveDamageMult")


## `getCooldown`: `if (this.isEvolved() && this.def.evolveCooldownMult) cd *= ...`
func _cooldown_scalar_is_read() -> void:
	var declared := 0
	for def in _declaring():
		if not def.has("evolveCooldownMult"):
			continue
		declared += 1
		var e := _evolve_level(def)
		var without: Dictionary = def.duplicate()
		without.erase("evolveCooldownMult")
		var plain := _interval(without, e)
		Check.rose(0.0, plain, "%s fires at all, so its interval is measurable" % def["id"])
		if plain > 0.0:
			Check.approx(
				_interval(def, e) / plain,
				float(def["evolveCooldownMult"]),
				"%s fires on its evolveCooldownMult of that interval" % def["id"],
				0.005
			)
	Check.at_least(float(declared), 1.0, "a weapon declares evolveCooldownMult")


## `_rollCrit`: `if (this.isEvolved() && this.def.evolveBonusCrit) chance += ...`
##
## A RATE, because a crit is a coin flip: the claim is that the weapon's expected damage rises
## by the declared chance, and one fire cannot show that. Both runs share a seed, so the two
## are compared on the same rolls -- and a port that draws its crit from its own generator
## still lands inside the tolerance, which is what makes this a measurement rather than a
## reading of the code.
func _bonus_crit_is_read() -> void:
	var declared := 0
	for def in _declaring():
		if not def.has("evolveBonusCrit"):
			continue
		declared += 1
		var e := _evolve_level(def)
		var without: Dictionary = def.duplicate()
		without.erase("evolveBonusCrit")
		var plain := _lone_damage(without, e)
		Check.rose(0.0, plain, "%s hits a lone foe, so its crit rate is measurable" % def["id"])
		if plain > 0.0:
			Check.approx(
				_lone_damage(def, e) / plain,
				1.0 + float(def["evolveBonusCrit"]),
				"%s deals 1 + its evolveBonusCrit of that damage" % def["id"],
				0.04
			)
	Check.at_least(float(declared), 1.0, "a weapon declares evolveBonusCrit")


## The damage `weapon` deals to ONE sturdy foe over `CRIT_FIRES` fires at `level`, with the
## shots stepped to their landing.
##
## A lone foe, so every strike of a multi-strike weapon lands on the same target and what is
## measured is a rate over rolls rather than a geometry -- and a crit is read as the extra
## damage it dealt rather than as a flag somewhere.
func _lone_damage(weapon: Dictionary, level: int) -> float:
	var g := _game_holding(weapon, level)
	var foe := Check.sturdy(Foe.new(Enemies.ENEMIES["BAT"], g.hero.x + 60.0, g.hero.y))
	foe.speed = 0.0
	g.foes.append(foe)
	seed(EVOLVE_SEED)
	var before: float = foe.hp
	for i in CRIT_FIRES:
		var made: Array = []
		WeaponFire.fire(weapon, g.hero, g.foes, made, level)
		for f in CRIT_SETTLE:
			for s in made:
				s.update(FRAME, g.hero.x, g.hero.y, g.hero.x, g.hero.y)
				s.resolve(g.foes, Callable())
	return before - float(foe.hp)


## THE WHIP'S SWEEP BECOMES A FULL CIRCLE.
##
## `_fireMelee` in `src/weapons.ts`:
##
##     if (evolved) { if (Math.hypot(dx, dy) > range) continue; }
##     else { if (Math.abs(dx) > range) continue; if (Math.abs(dy) > 40) continue; }
##
## A BAND crosses a ring of eight foes at exactly TWO points, and that does not change with
## the weapon's level: the reach grows 10% a level and the band's half-height never grows at
## all. So the same ring is measured at EVERY level from 1 to the declaration and the reading
## must be two at each of them -- that is the scaling control, and it is why "it hits more at
## 5" cannot be explained away by range.
##
## `_melee_sweeps_a_band` above already pins the band at level 1, and both its edges. What it
## did not have -- and what the port did not do -- is the level at which the shape CHANGES.
func _melee_evolves_into_a_circle() -> void:
	print("\n-- a melee sweep becomes a circle --")
	var melee := _declaring_of_type("melee")
	Check.at_least(float(melee.size()), 1.0, "a melee weapon declares an evolution")
	for def in melee:
		var e := _evolve_level(def)
		var radius := float(def["baseRange"]) * 0.9
		var ring := _ring_offsets(radius, 8)
		var band: Array = []
		for level in range(1, e):
			band.append(_fire_hits(def, level, ring))
		Check.unchanged(
			band.count(2),
			band.size(),
			"the band still crosses the ring at exactly two points at EVERY level below %d" % e
		)
		Check.unchanged(_fire_hits(def, e, ring), 8, "and at level %d the WHOLE ring is swept" % e)
		# BOUNDED. A sweep that hit everything in the scene would pass the ring reading, so a
		# foe far out along the diagonal -- outside any reach this weapon has at any level --
		# is probed at the evolve level and must be untouched.
		Check.unchanged(
			_fire_hits(def, e, [Vector2(radius * 1.4142, radius * 1.4142)]),
			0,
			"and the circle is still BOUNDED: a foe twice the ring radius out is not swept"
		)


## LIGHTNING'S EVOLVED STORM: THREE STRIKES, AND TWO MORE HOPS.
##
## `_fireInstant` in `src/weapons.ts`:
##
##     const strikes = evolved ? Math.min(3, targets.length) : 1;
##     const chainCount = evolved ? this.def.chainCount + 2 : this.def.chainCount;
##
## TWO SCENES, because those are two claims and one scene cannot see both.
##
##   THE LINE. One foe inside the hero's own reach, and seven strung out at 150px -- further
##   than the bolt itself reaches, nearer than a hop -- so however the RANDOM pick falls the
##   strike is deterministic and only the chain's LENGTH is measured: `1 + chainCount` below
##   the level and `1 + chainCount + 2` at it. The line holds one foe MORE than the chain can
##   reach, so an unbounded chain is visible as a wrong number rather than as the same one.
##
##   THE CLUSTER, where `chain: false` isolates the STRIKE count: one foe below the level,
##   THREE at it -- and they must be three DISTINCT foes, because three hits on one foe is a
##   different weapon from three strikes.
func _instant_evolves_into_a_storm() -> void:
	print("\n-- an instant weapon evolves into a storm --")
	var instant := _declaring_of_type("instant")
	Check.at_least(float(instant.size()), 1.0, "an instant weapon declares an evolution")
	for def in instant:
		var e := _evolve_level(def)
		var hops := int(def.get("chainCount", 0))
		Check.at_least(float(hops), 1.0, "%s declares chainCount, so the chain is the data's" % def["id"])
		var g := _game_holding(def, e)
		var reach_below := WeaponFire.reach_for(def, g.hero, e - 1)
		var reach_at := WeaponFire.reach_for(def, g.hero, e)

		# THE LINE. Its first foe is the last one inside the reach at the level BELOW the
		# declaration, so it is a target at both levels and the rest never are.
		var line := _line_offsets(reach_below - 1.0, HOP_PROVEN_REACH, hops + 4)
		Check.at_least(
			line[1].x - reach_at,
			0.001,
			"PRECONDITION: only the line's first foe is inside the hero's own reach at level %d" % e
		)
		Check.unchanged(
			_fire_hits(def, e - 1, line),
			1 + hops,
			"below the level: one foe struck, then chainCount(%d) hops" % hops
		)
		Check.unchanged(
			_fire_hits(def, e, line),
			1 + hops + 2,
			"at level %d: one foe struck, then chainCount + 2 (%d) hops" % [e, hops + 2]
		)
		# AND THE HOP COUNT IS THE DATA'S. A branch that chained a hardcoded six would satisfy
		# the line above and fail this: one declared hop is one hop.
		var single: Dictionary = def.duplicate()
		single["chainCount"] = 1
		Check.unchanged(
			_fire_hits(single, e, line),
			1 + 1 + 2,
			"chainCount: 1 -- the evolved chain is 1 + 2 hops, not a constant"
		)

		# THE CLUSTER, for the strike count.
		var cluster := _cluster_offsets(reach_below * 0.5, hops + 3)
		Check.at_least(
			float(cluster.size()),
			float(hops + 2),
			"PRECONDITION: the cluster holds more foes than the chain below the level reaches"
		)
		Check.unchanged(
			_fire_hits(def, e - 1, cluster),
			1 + hops,
			"in a cluster, below the level: one strike and its %d hops" % hops
		)
		Check.unchanged(
			_fire_hits(def, e, cluster),
			cluster.size(),
			"and at level %d the whole cluster: three strikes, %d hops each" % [e, hops + 2]
		)
		var no_chain: Dictionary = def.duplicate()
		no_chain["chain"] = false
		Check.unchanged(_fire_hits(no_chain, e - 1, cluster), 1, "chain: false below the level -- one foe")
		Check.unchanged(
			_fire_hits(no_chain, e, cluster),
			3,
			"and at level %d, THREE DISTINCT foes: `strikes = Math.min(3, targets.length)`" % e
		)


# ---------------------------------------------------------------------------
# FROST NOVA'S SLOW
#
# `src/data.ts` declares `slowPct: 0.5` and `slowDuration: 1.2` on Frost Nova, and the
# description on that def is a promise: "Expanding ring of ice slows foes caught in the
# burst." `src/weapons.ts` reads BOTH fields, `src/entities.ts` declares `slowPct`/
# `slowTimer` and multiplies the foe's movement by them, and `src/entity-render.ts` tints
# a slowed foe `#88ccff`. The Godot `Foe` had no slow field at all -- the nova damaged and
# did not slow, and the field was invisible as well as absent.
#
# Every claim below drives the DATA rather than a hardcoded 0.5/1.2, so a retuned nova is
# measured at its new numbers and a second weapon that declares a slow fails here until
# its own branch reads it. The ways a slow can be wrong are each asserted: it never
# applies, it applies but changes no speed, it changes the speed but nothing on screen, it
# never expires, and -- the one a careful port adds rather than discovers -- the evolved
# second ring slows when the original's does not.
# ---------------------------------------------------------------------------

## Every weapon whose def carries a `slowPct` must slow what its fire caught, by the
## declared fraction, for the declared duration.
##
## Rule 12's shape -- iterate the real table. `declaring` keeps the loop from being
## vacuous: a table where nothing declared a slow would otherwise pass by checking nothing.
func _the_slow_is_read_from_the_data() -> void:
	print("\n-- the frost nova slow: declared, applied, visible, expired --")
	var declaring := 0
	for def in Weapons.WEAPONS.values():
		if not def.has("slowPct"):
			continue
		declaring += 1
		var id: String = def["id"]
		var s := _scene(id, float(def["baseRange"]) * 0.4)
		var foe: Foe = s["foe"]
		Check.unchanged(
			foe.slow_timer, 0.0, "%s's target starts unslowed, so a slow is attributable" % id
		)
		WeaponFire.fire(def, s["game"].hero, s["game"].foes, [])
		Check.rose(0.0, foe.slow_timer, "%s SLOWS the foe its fire caught" % id)
		if foe.slow_timer <= 0.0:
			continue
		Check.approx(
			foe.slow_timer, float(def["slowDuration"]), "%s slows for its declared slowDuration" % id
		)
		Check.approx(
			foe.slow_pct, float(def["slowPct"]), "%s removes its declared slowPct of speed" % id
		)
	Check.at_least(float(declaring), 1.0, "a weapon declares slowPct, so the loop above is not vacuous")


## How far the scene's foe travels in ONE frame of `chase`, with or without the slow.
##
## Both runs are the SAME scene -- same foe, same standoff, same frame, same direction --
## and differ in exactly one thing: whether the nova was fired first. So the ratio between
## them is the slow, and not the geometry, the speed or the aim.
func _frame_step(def: Dictionary, slowed: bool) -> float:
	var s := _scene(str(def["id"]), float(def["baseRange"]) * 0.4)
	var g: Game = s["game"]
	var foe: Foe = s["foe"]
	if slowed:
		WeaponFire.fire(def, g.hero, g.foes, [])
	var before: float = foe.x
	foe.chase(g.hero.x, g.hero.y, FRAME)
	return absf(foe.x - before)


## THE CLAIM A PLAYER CAN ACTUALLY SEE: a slowed foe moves slower, by the fraction the data
## declares. Measured as DISTANCE PER FRAME, because distance is what the player sees and
## it is the number the slow is supposed to change.
func _a_slowed_foe_moves_slower() -> void:
	var def := _weapon("frost_nova")
	var free_step := _frame_step(def, false)
	var slowed_step := _frame_step(def, true)
	Check.rose(0.0, free_step, "an unslowed foe moves at all, so the comparison is measurable")
	Check.approx(
		slowed_step / free_step,
		1.0 - float(def["slowPct"]),
		"a slowed foe moves at `1 - slowPct` of its speed",
		0.001
	)


## A SLOW THE PLAYER CANNOT SEE IS HALF A FEATURE. `renderEnemy`, `src/entity-render.ts`:
##
##     } else if (self.slowTimer > 0) {
##         ctx.fillStyle = '#88ccff';
##
## `Foe.body_color` is that branch and `main.gd`'s `_draw_foe` draws its result, so this
## asserts the colour a player would see rather than one worked out for the test.
func _a_slowed_foe_is_drawn_iced_blue() -> void:
	var def := _weapon("frost_nova")
	var s := _scene("frost_nova", float(def["baseRange"]) * 0.4)
	var g: Game = s["game"]
	var foe: Foe = s["foe"]
	Check.unchanged(foe.body_color(), Color(foe.color), "an unslowed foe wears its own data colour")
	WeaponFire.fire(def, g.hero, g.foes, [])
	Check.rose(0.0, foe.slow_timer, "the foe under test is slowed, or the colour below means nothing")
	Check.unchanged(foe.body_color(), Color("88ccff"), "a slowed foe is drawn in the original's #88ccff")
	# ...AND THE TINT REVERSES. The half of a state change that gets forgotten is the way
	# back: an expired slow has to give the foe its own colour again.
	foe.slow_timer = 0.0
	Check.unchanged(
		foe.body_color(), Color(foe.color), "and it gets its own colour back once the slow is over"
	)


## THE SLOW MUST EXPIRE, and `slowDuration` is 1.2s -- so the edge is the tick that lands
## elapsed exactly ON that number.
##
## Pinned BOTH ways, because either half alone is satisfied by a wrong implementation: a
## slow that never expires passes "still slowed before the edge", and a slow that never
## applies passes "free at the edge". The countdown is driven frame by frame through the
## foe's own `chase`, which is the only thing that ages it in play.
func _the_slow_expires_exactly_on_its_duration() -> void:
	var def := _weapon("frost_nova")
	var pct := float(def["slowPct"])
	var dur := float(def["slowDuration"])
	# DERIVED from the data and the frame rate rather than written as 72, so a retuned
	# `slowDuration` moves the edge with it.
	var steps := int(round(dur / FRAME))
	var free_step := _frame_step(def, false)

	# THE EDGE WITHOUT ANY ACCUMULATION IN IT, first, because this half cannot be a float
	# accident in either direction: a timer of exactly one frame is slowed, and ONE tick of
	# exactly that frame takes it to exactly zero (`x - x` is exact in IEEE 754).
	var edge := Foe.new(Enemies.ENEMIES["BAT"], 0.0, 0.0)
	edge.slow_pct = pct
	edge.slow_timer = FRAME
	Check.unchanged(edge.slow_mult(), 1.0 - pct, "a timer of exactly one frame is still slowed")
	edge.chase(100.0, 0.0, FRAME)
	Check.approx(edge.slow_timer, 0.0, "and one tick of that frame lands it on exactly zero", 0.0)
	Check.unchanged(edge.slow_mult(), 1.0, "so zero is the boundary: NOT slowed")

	# ...and the same edge driven from the data, through a real fire.
	var s := _scene("frost_nova", float(def["baseRange"]) * 0.4)
	var g: Game = s["game"]
	var foe: Foe = s["foe"]
	WeaponFire.fire(def, g.hero, g.foes, [])
	Check.approx(foe.slow_timer, dur, "the nova arms the timer at its declared slowDuration")

	# ONE STEP SHORT OF THE EDGE: still slowed, and still moving at the slowed rate.
	for i in steps - 2:
		foe.chase(g.hero.x, g.hero.y, FRAME)
	var x_last: float = foe.x
	foe.chase(g.hero.x, g.hero.y, FRAME)
	Check.approx(
		absf(foe.x - x_last),
		free_step * (1.0 - pct),
		"the frame one step short of slowDuration is still SLOWED",
		1e-9
	)

	# THE EDGE ITSELF: elapsed == slowDuration, to the frame.
	var x_edge: float = foe.x
	foe.chase(g.hero.x, g.hero.y, FRAME)
	Check.approx(foe.slow_timer, 0.0, "the timer reaches zero at exactly slowDuration", 1e-9)
	Check.unchanged(foe.slow_mult(), 1.0, "so AT exactly slowDuration the slow is OVER")
	Check.approx(
		absf(foe.x - x_edge), free_step, "and that frame covers the full UNSLOWED distance", 1e-9
	)

	# ONE STEP PAST IT: still over, and the countdown stops rather than running away.
	var x_past: float = foe.x
	foe.chase(g.hero.x, g.hero.y, FRAME)
	Check.unchanged(foe.slow_mult(), 1.0, "one step PAST the boundary it is still over")
	Check.unchanged(foe.slow_timer, 0.0, "and the timer stopped at zero instead of counting on")
	Check.approx(absf(foe.x - x_past), free_step, "and that frame is unslowed too", 1e-9)


## THE EVOLVED SECOND RING DOES NOT SLOW, and that is the ORIGINAL'S asymmetry rather than
## an omission here. `_fireNova`'s scheduled callback, from `src/weapons.ts`:
##
##     game.effects?.schedule?.(0.4, () => {
##         ...
##         for (const e of cands) {
##             const d = Math.hypot(e.x - player.x, e.y - player.y);
##             if (d < r) e.takeDamage(d2);
##         }
##         game.createParticles(player.x, player.y, '#88ccff', 16);
##     });
##
## `takeDamage` and NOTHING ELSE: no `slowTimer` write appears inside it, unlike the first
## ring's loop three lines above it in the same function. The evolved Glacial Cascade is
## more damage, not more ice -- and a port that slowed on both rings would be kinder than
## the original and wrong.
func _the_evolved_second_ring_does_not_slow() -> void:
	var def := _weapon("frost_nova")
	var level := int(def["evolveLevel"])
	var s := _scene("frost_nova", float(def["baseRange"]) * 0.4)
	var g: Game = s["game"]
	var foe: Foe = s["foe"]
	var full: float = foe.hp
	WeaponFire.fire(def, g.hero, g.foes, [], level, g.fx)
	Check.fell(full, foe.hp, "at level %d the first ring lands" % level)
	Check.rose(0.0, foe.slow_timer, "and the first ring slows")
	# PRECONDITION: the first ring's slow is cleared, so a slow found after the pulse can
	# only have come from the pulse. Without this the pulse's own silence is unobservable.
	foe.slow_timer = 0.0
	foe.slow_pct = 0.0
	# Nothing may fire during the step either, or a second FIRST ring would be
	# indistinguishable from the second ring under test.
	g.hero.weapons.clear()
	var before: float = foe.hp
	# 0.5s of real play, past the 0.4s the pulse is scheduled for. `Game.step` is what lands
	# it, so this drives the same path a run drives.
	for i in 30:
		g.step(FRAME, Vector2.ZERO)
	Check.fell(before, foe.hp, "the evolved second ring lands its damage 0.4s later")
	Check.unchanged(
		foe.slow_timer, 0.0, "and it does NOT slow -- the original's callback writes no slowTimer"
	)


func _check(cond: bool, label: String, detail: String) -> void:

	if cond:
		print("  ok   %s  (%s)" % [label, detail])
	else:
		print("  FAIL %s  (%s)" % [label, detail])
		ok = false
