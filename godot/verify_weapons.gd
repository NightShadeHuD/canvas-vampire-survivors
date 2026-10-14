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

	# FROST NOVA'S SLOW. `slowPct`/`slowDuration` are on the data and the TypeScript reads
	# both; the port read neither, so the advertised slow did nothing. See the section at
	# the end of this file for what is measured and for the corpse it is measured against.
	_frost_nova_slows_what_it_hits()

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


func _check(cond: bool, label: String, detail: String) -> void:

	if cond:
		print("  ok   %s  (%s)" % [label, detail])
	else:
		print("  FAIL %s  (%s)" % [label, detail])
		ok = false


# ---------------------------------------------------------------------------
# FROST NOVA'S SLOW -- `slowPct` AND `slowDuration`, WHICH THIS PORT DID NOT READ
#
# `src/data.ts` declares two fields on Frost Nova that no other weapon has:
#
#     slowPct: 0.5,
#     slowDuration: 1.2,
#
# and the data's own description sells them to the player: "Expanding ring of ice slows
# foes caught in the burst." Three places in the TypeScript read them, and this file
# quotes each rather than paraphrasing it:
#
#   `src/weapons.ts` `_fireNova`:
#       const slowPct = this.def.slowPct ?? 0.5;
#       const slowDur = this.def.slowDuration ?? 1.2;
#       ...
#       if (d < range) { ... enemy.takeDamage(dmg);
#           if (!enemy.slowTimer || enemy.slowTimer < slowDur) {
#               enemy.slowTimer = slowDur; enemy.slowPct = slowPct; } }
#
#   `src/entities.ts` `update`, once per frame and BEFORE the archetype branch:
#       if (this.slowTimer > 0) this.slowTimer -= dt;
#       const slowMult = this.slowTimer > 0 ? 1 - (this.slowPct || 0) : 1;
#   and `slowMult` multiplies `this.speed` on every movement branch -- chaser, ranged,
#   dasher and bomber alike.
#
#   `src/entity-render.ts`: `else if (self.slowTimer > 0) ctx.fillStyle = '#88ccff';`
#
# The Godot `Foe` had NO slow state at all, so Frost Nova damaged and did not slow.
# `weapon-fire.gd`'s nova branch said so in a comment and reported it rather than
# inventing it.
#
# WHAT IS MEASURED, AND WHAT IS REFUSED
#
# The claim is "a foe Frost Nova hit MOVES SLOWER, and RECOVERS after `slowDuration`".
# This measures DISTANCE MOVED, through the real simulation. It never asks whether a
# field exists, which function set it, or whether a variable was assigned -- a `Foe`
# handed a `slow_pct` field that `chase()` ignores fails every assertion below, which is
# the whole point of measuring pedestrians rather than declarations.
#
# THE INSTRUMENT. A chaser walks straight at the hero at `speed` px/s, so its displacement
# in one 1/60s frame is exactly `speed * FRAME` -- a CONSTANT. That constancy is asserted
# as a control before anything is concluded from it, because a per-frame distance is only
# an instrument if it reads the same number for a foe nothing has touched. A slowed foe
# reads `speed * FRAME * (1 - slowPct)`, which is a different number the same instrument
# can see. Both scenes are stepped through `Game.step`, so the weapon fires on the game's
# own schedule and the foe walks its own archetype's path.
#
# THE ONE THING THAT MAKES THIS HARD: A CORPSE ALSO STANDS STILL.
#
# Frost Nova DAMAGES. A foe it killed travels 0px for the rest of time, and 0px is exactly
# what a 100% slow would look like -- so a naive before/after distance comparison reads a
# corpse as a PERFECT slow and goes green on a port that never implemented one. Four
# separate things separate the two, and all four are asserted:
#
#   * `Check.sturdy` gives the measured foe a million HP, so the blast's ~28 damage cannot
#     kill it. That is a stated PRECONDITION, not the claim.
#   * the measured foe must be alive, above zero HP AND still in `game.foes` on EVERY
#     measured frame. `_remove_dead` takes a dead foe out of that list in the frame it dies,
#     so presence plus HP is what makes "it moved slowly" a statement about a living foe.
#   * the control scene's foe is required to be alive on every frame too, so "nothing
#     changed" cannot be a corpse on both sides.
#   * a PURPOSE-BUILT CORPSE is measured beside them (`_a_corpse_is_not_a_slow`): the same
#     blast, a 1 HP foe, reading 0px. The slowed foe's step must be strictly GREATER than
#     the corpse's and strictly LESS than the control's -- three distinct numbers, so
#     "slower" cannot be satisfied by "dead".
#
# AND THE DURATION BOUNDARY IS PINNED AT BOTH ENDS, in the project's usual form. The last
# frame that lies wholly inside the declared window must be slow; the first frame that lies
# wholly outside it must be full speed. The single frame ON the arithmetic boundary is
# deliberately NOT pinned: `src/entities.ts` decays the timer BEFORE it reads it, so a port
# that read it first would release one frame later, and failing a correct port over that
# would be this repository's oldest verification mistake. The frame COUNT is asserted to
# within one frame of `slowDuration`, which is the claim a player can actually perceive.
# ---------------------------------------------------------------------------

## How many frames past the declared slow the profile is watched, so the RELEASE lands
## INSIDE the measured window instead of on its edge. Eight is a seventh of a second --
## long enough to watch full speed come back, short enough that the weapon cannot re-fire
## inside the window. Frost Nova's cooldown is 3.2s against a 1.2s slow, and that bound is
## READ from the weapon rather than trusted (`_slowing_window`).
const SLOW_TAIL := 8
## Where "slowed" ends and "full speed" begins, as a fraction of the way between them.
## Half way, so neither reading is near the line: the two values this sorts are
## `speed * FRAME` and `speed * FRAME * (1 - slowPct)`.
const SLOW_MIDPOINT := 0.5
## How many FRAMES of slack a duration assertion allows.
##
## ONE of it is the decay-order difference and is deliberate. `src/entities.ts` writes
## `if (this.slowTimer > 0) this.slowTimer -= dt;` BEFORE it reads the timer, so the frame
## the slow was applied on already burns a frame of it and a 1.2s slow covers 71 frames. A
## port that reads first and decays after covers 72. Both are defensible readings of the
## same two lines, both recover within 1/60s of the declared duration, and failing one of
## them would be this repository's oldest verification mistake -- a check that calls a
## working fix broken. The frame exactly ON the arithmetic boundary is therefore NOT pinned;
## the last frame inside the window and the first frame past it both are.
##
## THE HALF IS FLOAT, AND IT WAS MEASURED. `(1.2 + 0.6) / (1.0 / 60.0)` is
## 107.99999999999999, so a slack of exactly 1.0 rejects a port that is precisely one frame
## over -- which the read-first variant above is. Measured: it read 109 against 108 and
## failed on a 1.0000000000000142 difference.
const SLOW_FRAME_SLACK := 1.5
## How many frames the corpse probe is watched for. One would settle it -- a dead foe never
## moves again -- and ten say so without resting on a single frame.
const CORPSE_FRAMES := 10


## EVERY weapon in the data that declares a slow, in table order.
##
## The sweep is the point of rule 12: a weapon ADDED to `src/data.ts` with a `slowPct` is
## measured by this code the day it is added, rather than the day somebody remembers to
## extend a hand-written list.
func _slowing_weapons() -> Array:
	var out: Array = []
	for def in Weapons.WEAPONS.values():
		if def.has("slowPct") and def.has("slowDuration"):
			out.append(def)
	return out


## THE HEADLINE. For every weapon in the data that declares a slow: a foe it hits must
## move slower than the same foe it did not hit, for the declared duration, and must be
## back to full speed one step past it.
func _frost_nova_slows_what_it_hits() -> void:
	print("\n-- a foe hit by Frost Nova moves SLOWER --")
	var slowness := _slowing_weapons()
	Check.at_least(
		float(slowness.size()),
		1.0,
		"the data declares a slow a weapon is supposed to apply (%d weapon(s))" % slowness.size()
	)
	for def in slowness:
		_one_weapon_slows(def)
	# THE TRAP, measured rather than described, so the discrimination above is demonstrated
	# rather than asserted in a comment.
	if not slowness.is_empty():
		_a_corpse_is_not_a_slow(slowness[0])


## The window a slow is measured over, in frames, in two parts.
##
## `want` is the declared duration plus `SLOW_TAIL`, which puts the release inside the
## measurement. `ceiling` is the weapon's OWN cooldown: the slow is re-applied on every
## fire, so a window that ran past a cooldown would measure a SECOND application and report
## it as a first one. Frost Nova's 3.2s against a 1.2s slow makes that bound loose, and it
## is read from `WeaponFire.cooldown_for` rather than assumed, so a slow retuned past its
## own cooldown fails loudly at `_one_weapon_slows` instead of quietly measuring nonsense.
func _slowing_window(def: Dictionary) -> Dictionary:
	var slow_dur := float(def["slowDuration"])
	var want := int(ceil(slow_dur / FRAME)) + SLOW_TAIL
	var hero := Game.without_spawns().hero
	var cd_frames := int(WeaponFire.cooldown_for(def, hero, 1) / FRAME)
	return {"frames": mini(want, cd_frames - 2), "want": want, "cooldown": cd_frames, "slow_dur": slow_dur}


## PER-FRAME DISPLACEMENT of one foe, driven by the real simulation, with its CONTROL
## scene built in the same loop.
##
## `firing` is the ONLY difference between the two runs: whether the hero holds the weapon.
## Same foe, same distance, same frames, same hero movement -- so a difference between the
## two per-frame distances is the weapon's doing and not the geometry's.
##
## THE HERO RUNS. `Config.PLAYER_SPEED` is 240 against a bat's 110, so the measured foe is
## always left behind and never arrives. A foe that reached the hero would sit inside
## `chase`'s `d <= 0.001` guard and read 0px -- which is the corpse reading this section
## exists to keep out, arrived at from the other direction.
func _slow_profile(def: Dictionary, frames: int) -> Dictionary:
	var out := {}
	for firing in [true, false]:
		var g := Game.without_spawns()
		g.hero.weapons.clear()
		if firing:
			g.hero.add_weapon(def)
		# BEHIND the hero's run and well inside the weapon's reach -- and the reach is READ
		# from the weapon, so a retuned Frost Nova moves the placement with it.
		var reach := WeaponFire.reach_for(def, g.hero, 1)
		var foe := Check.sturdy(Foe.new(Enemies.ENEMIES["BAT"], g.hero.x - reach * 0.6, g.hero.y))
		g.foes.append(foe)
		var hp_before: float = foe.hp
		var disp: Array = []
		var living := 0
		for i in frames:
			var bx: float = foe.x
			var by: float = foe.y
			g.step(FRAME, Vector2.RIGHT)
			disp.append(sqrt(pow(foe.x - bx, 2) + pow(foe.y - by, 2)))
			if not foe.dead and foe.hp > 0.0 and g.foes.has(foe):
				living += 1
		out["firing" if firing else "control"] = {
			"disp": disp,
			"living": living,
			"foe": foe,
			"damage": hp_before - float(foe.hp),
			"steps": _distinct(disp)
		}
	return out


## How many DIFFERENT per-frame distances a run produced, to four decimals.
##
## One is what a foe walking a straight line at a constant speed produces, and it is the
## control that says the instrument is steady. More than one means the foe's speed changed
## for a reason other than the thing under test -- arriving at the hero, or an archetype's
## own cycle -- and the reading is not the clean one the assertions below assume.
func _distinct(values: Array) -> int:
	var seen := {}
	for v in values:
		seen[snappedf(v, 0.0001)] = true
	return seen.size()


## The total distance `values` covers in its first `n` frames.
func _travelled(values: Array, n: int) -> float:
	var total := 0.0
	for i in mini(n, values.size()):
		total += float(values[i])
	return total


## The 1-indexed frames of a run whose step is closer to "slowed" than to "full speed".
func _slowed_frames(nova: Array, control: Array, slow_pct: float) -> Array:
	var out: Array = []
	var cut := 1.0 - slow_pct * SLOW_MIDPOINT
	for i in mini(nova.size(), control.size()):
		if float(nova[i]) <= float(control[i]) * cut:
			out.append(i + 1)
	return out


## The step ONE FOE takes on the frame the weapon first fires, over the step an untouched
## foe takes. The measured `1 - slowPct`, as a single number, so a mutated `slowPct` can be
## compared with the declared one without a second copy of the scene.
func _first_step_ratio(def: Dictionary, frames: int) -> float:
	var p := _slow_profile(def, frames)
	var nova: Array = p["firing"]["disp"]
	var control: Array = p["control"]["disp"]
	if control.is_empty() or float(control[0]) <= 0.0:
		return -1.0
	return float(nova[0]) / float(control[0])


## ONE WEAPON'S SLOW. All of it, from the data's own two numbers.
func _one_weapon_slows(def: Dictionary) -> void:
	var id: String = def["id"]
	var slow_pct := float(def["slowPct"])
	var slow_dur := float(def["slowDuration"])
	var window := _slowing_window(def)
	var frames: int = window["frames"]
	var w := slow_dur / FRAME  # the declared slow, in FRAMES
	print("\n   %s: slowPct %0.3f, slowDuration %0.3fs (%0.1f frames), over %d frames" % [id, slow_pct, slow_dur, w, frames])

	# THE WINDOW MUST COVER THE CLAIM. A window shorter than the declared slow cannot test
	# it, and a window longer than the cooldown measures a second application -- both fail
	# here, by name, rather than being silently measured wrong.
	Check.at_least(
		float(frames),
		w + 2.0,
		"%s: the window covers the declared slow and one step past it" % id
	)
	Check.at_most(
		float(frames),
		float(window["cooldown"]) - 2.0,
		"%s: PRECONDITION -- the window ends before the weapon can fire again" % id
	)

	var profile := _slow_profile(def, frames)
	var nova_run: Dictionary = profile["firing"]
	var ctrl_run: Dictionary = profile["control"]
	var nova: Array = nova_run["disp"]
	var control: Array = ctrl_run["disp"]
	if frames < 2 or nova.size() < frames or control.size() < frames:
		Check.unchanged(false, true, "%s: the profile produced %d frames" % [id, frames])
		return

	# ---- PRECONDITIONS. Each one is a way this measurement could be impossible or
	# ---- meaningless, stated before anything is concluded from it.
	Check.unchanged(
		str(Enemies.ENEMIES["BAT"]["archetype"]),
		"chaser",
		"PRECONDITION: a bat walks a straight line at one speed, which is what makes a step an instrument"
	)
	Check.rose(0.0, float(nova_run["damage"]), "%s: the blast REACHED the foe" % id)
	Check.unchanged(
		int(nova_run["living"]),
		frames,
		"%s: and that foe is ALIVE and in the world on every frame -- a corpse moves 0px too" % id
	)
	Check.unchanged(
		int(ctrl_run["living"]),
		frames,
		"%s: CONTROL -- the un-hit foe is alive and in the world on every frame" % id
	)
	# THE INSTRUMENT ITSELF, against the data rather than against a number written here.
	var full_step := float(Enemies.ENEMIES["BAT"]["speed"]) * FRAME
	Check.approx(
		float(control[0]),
		full_step,
		"%s: CONTROL -- an untouched foe steps `speed * dt`, the data's own speed" % id,
		0.001
	)
	Check.unchanged(
		int(ctrl_run["steps"]),
		1,
		"%s: CONTROL -- and that step is CONSTANT, so a change in the other run is the slow" % id
	)

	# ---- THE CLAIM: the foe that was hit moves slower.
	# FRAMES 1..w COVER THE DECLARED WINDOW (frame k is the half-open interval
	# [(k-1)*dt, k*dt)), so frame w is the frame ON the arithmetic boundary and frame w + 1
	# is the first wholly outside it. `w` ITSELF IS NOT PINNED -- see `SLOW_FRAME_SLACK` --
	# and `still_in` is the last frame EVERY faithful reading must still be slowing.
	var at_boundary := int(floor(w))
	var still_in := at_boundary - 1
	var one_past := at_boundary + 1
	Check.fell(
		_travelled(control, at_boundary),
		_travelled(nova, at_boundary),
		"%s: over the declared slowDuration the hit foe travels LESS" % id
	)
	Check.approx(
		_travelled(nova, at_boundary) / _travelled(control, at_boundary),
		1.0 - slow_pct,
		"%s: ... by the fraction the declared slowPct says" % id,
		0.02
	)
	Check.approx(
		float(nova[0]) / float(control[0]),
		1.0 - slow_pct,
		"%s: the very first frame after the blast is already at 1 - slowPct" % id,
		0.02
	)

	# ---- THE BOUNDARY, pinned at both ends and one frame past each.
	var slowed := _slowed_frames(nova, control, slow_pct)
	var released := (int(slowed[-1]) + 1) if not slowed.is_empty() else -1
	Check.approx(
		float(slowed.size()),
		w,
		"%s: the slow lasts the declared slowDuration, to within one frame" % id,
		SLOW_FRAME_SLACK
	)
	Check.approx(
		float(released),
		w,
		"%s: ... and RELEASES at it (frame %d of %0.1f)" % [id, released, w],
		SLOW_FRAME_SLACK
	)
	Check.approx(
		float(nova[still_in - 1]) / float(control[still_in - 1]),
		1.0 - slow_pct,
		"%s: STILL SLOWED on frame %d, inside the declared window" % [id, still_in],
		0.02
	)
	Check.approx(
		float(nova[one_past - 1]) / float(control[one_past - 1]),
		1.0,
		"%s: and back to FULL SPEED on frame %d, the first frame past it" % [id, one_past],
		0.02
	)

	# ---- THE DATA IS READ, not the numbers 0.5 and 1.2. The same def with ONE field
	# ---- changed, so nothing else about the scene moves.
	var gentler: Dictionary = def.duplicate()
	gentler["slowPct"] = slow_pct * 0.5
	Check.approx(
		_first_step_ratio(gentler, frames),
		1.0 - slow_pct * 0.5,
		"%s: halving slowPct halves the slow -- the number is READ, not hardcoded" % id,
		0.02
	)
	var longer: Dictionary = def.duplicate()
	longer["slowDuration"] = slow_dur + 0.6
	var longer_window := _slowing_window(longer)
	var longer_profile := _slow_profile(longer, int(longer_window["frames"]))
	var longer_slowed := _slowed_frames(
		longer_profile["firing"]["disp"], longer_profile["control"]["disp"], slow_pct
	)
	Check.approx(
		float(longer_slowed.size()),
		(slow_dur + 0.6) / FRAME,
		"%s: and slowDuration + 0.6s is 0.6s more slow -- the duration is READ too" % id,
		SLOW_FRAME_SLACK
	)


## A CORPSE IS NOT A SLOW, MEASURED RATHER THAN ARGUED.
##
## The same weapon and the same blast, on a foe with 1 HP. It dies, `_remove_dead` takes it
## out of `game.foes` in that frame, and it never moves again -- which is EXACTLY the
## reading a naive "did it travel less?" test would accept as a perfect slow. The reading is
## put on the record beside the slowed foe's, and the slowed foe's is required to sit
## strictly between it and the untouched control: three distinct numbers, so "slower" cannot
## be satisfied by "dead".
func _a_corpse_is_not_a_slow(def: Dictionary) -> void:
	print("\n-- a corpse is NOT a slow --")
	var g := Game.without_spawns()
	g.hero.weapons.clear()
	g.hero.add_weapon(def)
	var reach := WeaponFire.reach_for(def, g.hero, 1)
	var corpse := Foe.new(Enemies.ENEMIES["BAT"], g.hero.x - reach * 0.6, g.hero.y)
	corpse.max_hp = 1.0
	corpse.hp = 1.0
	g.foes.append(corpse)
	var moved := 0.0
	var removed := true
	for i in CORPSE_FRAMES:
		var bx: float = corpse.x
		var by: float = corpse.y
		g.step(FRAME, Vector2.RIGHT)
		moved += sqrt(pow(corpse.x - bx, 2) + pow(corpse.y - by, 2))
		if g.foes.has(corpse):
			removed = false
	Check.unchanged(corpse.dead, true, "the same blast KILLS a 1 HP foe")
	Check.approx(moved, 0.0, "and a dead foe travels 0px -- what a naive distance test reads as a 100% slow")
	Check.unchanged(
		removed,
		true,
		"`_remove_dead` takes it OUT of `game.foes` in the frame it dies, which is what `living` counts"
	)

	# THE THREE-WAY SEPARATION, on the frame that matters.
	var window := _slowing_window(def)
	var profile := _slow_profile(def, int(window["frames"]))
	var slowed_step := float(profile["firing"]["disp"][0])
	var full_step := float(profile["control"]["disp"][0])
	Check.differs(slowed_step, moved, 0.01, "the slowed foe MOVED, where the corpse did not")
	Check.differs(full_step, slowed_step, 0.01, "and moved LESS than the foe the nova never touched")
	Check.unchanged(
		[slowed_step > moved, slowed_step < full_step],
		[true, true],
		"so the slowed foe sits strictly BETWEEN a corpse and an untouched one"
	)

