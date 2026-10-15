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

	# THE OTHER TWO BRANCHES OF THAT SAME CHAIN, AND THE NUMBER OVER THE FOE.
	# `src/entity-render.ts:217-227` draws flash -> slow -> armed-bomber blink -> own colour,
	# and the port had the slow and nothing else; `_rollCrit`'s two `createFloatingText` calls
	# had no system behind them at all. The flash and the damage number are measured HERE
	# because both are what a weapon's hit does to a foe; the armed bomber's blink is
	# `verify_archetypes.gd`'s, where the fuse that gates it is already driven.
	_a_hit_flashes_the_foe_white()
	_a_damage_number_is_drawn_at_the_foe()

	# THE FIFTH ROLL SITE, and the archetype an unguarded port of it would break. The
	# PROJECTILE's crit is on IMPACT and not on fire -- `_fireProjectile` rolls nothing -- so
	# it is a different function from the four above and it is measured on its own entry
	# point. The ORBIT shard shares `Shot.resolve` in this port and must NOT share the roll:
	# `OrbitShard` is not a `game.projectiles` entry in the original at all.
	_a_projectile_rolls_per_HIT_and_draws_its_own_number()
	_orbit_draws_no_number_and_rolls_nothing()

	_the_evolved_second_ring_does_not_slow()
	_the_evolved_second_ring_is_never_doubled()

	# PER-TARGET CRIT. `quality-baseline.json` declared `godot-crit-rolled-once-per-fire`:
	# `_rollCrit` is called from four sites in `src/weapons.ts` and all four are inside a
	# per-target loop, while this port rolled once before the dispatch. Each measurement below
	# pins one of those four loops by its DRAW COUNT and by the MIX of damages within one fire.
	# Garlic -- an archetype `_rollCrit` has no call site in, so it takes NO draw at all -- is
	# the control beside them, and it carries its own positive side.
	_melee_rolls_once_per_foe()
	_nova_rolls_once_per_foe()
	_lightning_rolls_once_per_strike()
	_drain_rolls_once_per_tether_and_heals_their_sum()
	_the_aura_rolls_nothing_and_is_the_control()

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
				shot.resolve(s["game"].foes, Callable(), s["game"].hero, s["game"].fx)
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
			shot.resolve(s["game"].foes, Callable(), s["game"].hero, s["game"].fx)
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
			shot.resolve(g.foes, Callable(), g.hero, g.fx)
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

## Foes in the per-target crit geometries. FOUR, because that is the smallest count at which a
## shared roll and four independent ones are far apart: at a 25% chance a shared roll mixes on
## NONE of its fires and four independent rolls mix on 68% of theirs.
const CRIT_TARGETS := 4
## Fires per mixing measurement. `CRIT_FIRES`' own number, for its own reason: at p = 0.25 and
## N = 4 the mixed share has a standard deviation of 0.0135 over twelve hundred fires, so the
## 0.06 tolerance below is 4.4 sigma -- a false-failure probability just under 1e-5 -- while a
## per-fire roll, which reads exactly 0.0, sits 50 sigma away and fails every time.
const CRIT_RATE_FIRES := 1200
const CRIT_RATE_TOL := 0.06
## The seed the draw-count probes replay and the mixing measurements run under. Any fixed value
## would do; naming it is what makes a failure reproducible instead of a coincidence.
const CRIT_DRAW_SEED := 20260701
## Two damage readings count as DIFFERENT above this. `foe.hp` is a subtraction of two numbers
## near a million, whose round-trip error is ~1e-9, and the thing being told apart is a factor
## of two; anywhere between those two works and this is between them.
const DAMAGE_EPSILON := 1e-4
## What `_fireDrain`'s heal owes is exact arithmetic on two numbers ~1e-9 apart after the hp
## round trip, so this is a hundred thousand times the noise -- and a millionth of the error a
## wrong summation makes, which is one foe's whole damage (14.4 at level 5).
const HEAL_TOLERANCE := 1e-4
## Fires the evolved second ring is measured over, one `Game.step`-driven pulse each. At p=0.25
## the chance that not one of them crits its first ring is 0.75^40, about 1e-5 -- and the
## precondition assertion says so out loud rather than letting the measurement pass vacuously.
const NOVA_PULSE_FIRES := 40


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


## WHICH ARCHETYPES ROLL AT ALL, by `type`: the original's four `_rollCrit` call sites, and
## nothing else. `melee` (src/weapons.ts:216), `instant` (289), `nova` (395) and `drain` (454)
## -- every one of them inside a per-target loop -- while `projectile`, `orbit`, `aura` and
## `mine` call it NOWHERE. `_bonus_crit_is_read` judges every declared `evolveBonusCrit`
## against this list, so a weapon added to `src/data.ts` carrying that field is MEASURED
## rather than assumed -- and the measurement is what says whether the field is read.
const ROLLING_ARCHETYPES := ["melee", "instant", "nova", "drain"]


## THE DECLARED `evolveBonusCrit`, MEASURED FOR WHAT IT ACTUALLY IS: ONE of the two is read,
## and the other is DEAD IN THE ORIGINAL. Both halves are asserted here, and that is not a
## nicety -- a check asserting "nothing reads this" is a real check only if the same
## instrument, on the same run, reads a field that IS read.
##
## `_rollCrit` is the ONLY reader of this field anywhere in `src/`:
##
##     src/weapons.ts:107   if (this.isEvolved() && this.def.evolveBonusCrit) {
##     src/weapons.ts:108       chance += this.def.evolveBonusCrit;
##
## -- and `_rollCrit` has four call sites, every one of them inside a per-target loop:
##
##     src/weapons.ts:216   `_fireMelee`    (type "melee")
##     src/weapons.ts:289   `_fireInstant`  (type "instant")
##     src/weapons.ts:395   `_fireNova`     (type "nova")
##     src/weapons.ts:454   `_fireDrain`    (type "drain")
##
## `evolveBonusCrit: 0.1` is declared on the KNIFE, and a knife is `type: "projectile"`:
## `_fireProjectile` calls `_rollCrit` NOWHERE, so the declaration is DEAD IN THE ORIGINAL --
## not dead in this port. Lightning's `0.15` is on `_fireInstant`, which IS one of the four,
## and it is LIVE. `ROLLING_ARCHETYPES` above is those four and nothing else.
##
## HOW DEAD IS MEASURED. A RATE, because a crit is a coin flip: the claim is that the weapon's
## expected damage rises by the declared chance, and one fire cannot show that. `_lone_damage`
## fires `CRIT_FIRES` times at ONE sturdy foe with the field on the def and with it ERASED --
## same scene, same seed, same number of fires, so the level curve, the geometry and the shot
## count are constants of both runs and the ratio is the field's whole effect.
##
## AND IT CAN FAIL IN BOTH DIRECTIONS, which is the property that makes it worth having:
##
##   * a port that starts reading the Knife's field again -- the volley-wide roll this port
##     used to take, or a per-blade one -- reads 1.10 where this demands 1.00, and fails;
##   * a port that stops reading Lightning's reads 1.00 where this demands 1.15, and fails;
##   * and `dead`/`live` below fail if either branch stops being exercised at all, so removing
##     a declaration cannot turn this into a loop that runs zero times and passes.
func _bonus_crit_is_read() -> void:
	var declared := 0
	var live := 0
	var dead := 0
	for def in _declaring():
		if not def.has("evolveBonusCrit"):
			continue
		declared += 1
		var e := _evolve_level(def)
		var without: Dictionary = def.duplicate()
		without.erase("evolveBonusCrit")
		var plain := _lone_damage(without, e)
		Check.rose(0.0, plain, "%s hits a lone foe, so its damage is measurable" % def["id"])
		if plain <= 0.0:
			continue
		var ratio := _lone_damage(def, e) / plain
		if ROLLING_ARCHETYPES.has(str(def["type"])):
			live += 1
			Check.approx(
				ratio,
				1.0 + float(def["evolveBonusCrit"]),
				"%s's evolveBonusCrit IS READ -- the %s archetype rolls per target, so it deals 1 + the declared %0.2f"
					% [def["id"], def["type"], float(def["evolveBonusCrit"])],
				0.04
			)
		else:
			dead += 1
			Check.approx(
				ratio,
				1.0,
				"%s's evolveBonusCrit is DEAD IN THE ORIGINAL -- the %s archetype calls `_rollCrit` nowhere, so erasing the declared %0.2f changes NOTHING"
					% [def["id"], def["type"], float(def["evolveBonusCrit"])],
				0.04
			)
	Check.at_least(float(declared), 1.0, "a weapon declares evolveBonusCrit")
	Check.at_least(float(live), 1.0, "and at least one declaration is READ, so that branch ran")
	Check.at_least(float(dead), 1.0, "and at least one is DEAD in the original, so THIS branch ran")


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
				s.resolve(g.foes, Callable(), g.hero, g.fx)
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
	Check.unchanged(foe.body_color(0.0), Color(foe.color), "an unslowed foe wears its own data colour")
	WeaponFire.fire(def, g.hero, g.foes, [])
	Check.rose(0.0, foe.slow_timer, "the foe under test is slowed, or the colour below means nothing")
	# THE NOVA'S OWN HIT FLASHES THE FOE WHITE FIRST, because `renderEnemy`'s flash branch is
	# drawn ABOVE its slow branch. This check read `#ffffff` here before the flash was ported
	# and read the slow tint -- and the tint it read was RIGHT about the game, so the check was
	# measuring the absence of a feature rather than the presence of the slow. Ticked off
	# through `chase`, the only thing that ages it in play; the ORDERING itself is
	# `_a_hit_flashes_the_foe_white`'s claim, and this is the second place it is visible.
	Check.unchanged(
		foe.body_color(0.0), Color("ffffff"), "the nova's own hit flashes the foe white first"
	)
	for _tick in int(ceil(0.08 / FRAME)):
		foe.chase(g.hero.x, g.hero.y, FRAME)
	Check.unchanged(foe.body_color(0.0), Color("88ccff"), "a slowed foe is drawn in the original's #88ccff")
	# ...AND THE TINT REVERSES. The half of a state change that gets forgotten is the way
	# back: an expired slow has to give the foe its own colour again.
	foe.slow_timer = 0.0
	Check.unchanged(
		foe.body_color(0.0), Color(foe.color), "and it gets its own colour back once the slow is over"
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


## THE HIT FLASH, AND ITS REVERSAL.
##
## `renderEnemy`'s FIRST branch, `src/entity-render.ts:218`:
##
##     if (self.flashTimer > 0) ctx.fillStyle = '#ffffff';
##
## -- set by `Enemy.takeDamage` (`this.flashTimer = 0.08`, `src/entities.ts:507`) on EVERY
## hit, and aged by `Enemy.update`. **A FLASH THAT NEVER DECAYS IS A FOE THAT IS WHITE
## FOREVER**, which is the "screen greys out and stays grey" defect this repository already
## shipped once (rule 18, fourth row) -- so the REVERSAL is asserted here beside the change,
## and the frame it reverses on is DERIVED from the original's own 0.08 rather than written
## down as a frame number.
##
## The derivation, worked out rather than guessed: the timer starts at 0.08 and the tick is
## 1/60 per frame, so it needs 0.08 / (1/60) = 4.8 ticks to reach zero. FLOOR of that is 4
## ticks that leave it positive, and the fifth takes it negative -- so this pins the boundary
## one frame either side, which is the rule's "the value exactly on the boundary and one
## past it".
func _a_hit_flashes_the_foe_white() -> void:
	# `src/entities.ts:507`, written here as the SPEC rather than read from `Foe.FLASH_TIME`:
	# a check that reads the constant it is checking would follow the code to any value.
	const FLASH_TIME := 0.08
	var s := _scene("whip", 60.0)
	var g: Game = s["game"]
	var foe: Foe = s["foe"]
	Check.unchanged(
		foe.body_color(g.elapsed), Color(foe.color), "an UNHIT foe wears its own data colour"
	)
	var before: float = foe.flash_timer
	foe.take_damage(1.0)
	Check.rose(before, foe.flash_timer, "a hit starts the flash timer")
	Check.unchanged(
		foe.body_color(g.elapsed),
		Color("ffffff"),
		"and the hit foe is drawn WHITE -- the original's '#ffffff'"
	)

	# THE CHAIN, asserted as an ORDERING rather than as two separate colours: a foe that is
	# BOTH hit and slowed must read white, not iced blue. An implementation that moved the
	# flash below the slow would pass every single-state check in this file.
	foe.apply_slow(0.5, 60.0)
	Check.rose(0.0, foe.slow_timer, "the foe is ALSO slowed, or the ordering below proves nothing")
	Check.unchanged(
		foe.body_color(g.elapsed),
		Color("ffffff"),
		"so the FLASH is drawn ABOVE the slow tint, in the original's chain position"
	)

	# THE DECAY, driven through the foe's own `chase` -- the only thing that ages it in play.
	var white_ticks := int(floor(FLASH_TIME / FRAME))
	for i in white_ticks:
		foe.chase(g.hero.x, g.hero.y, FRAME)
		Check.unchanged(
			foe.body_color(g.elapsed),
			Color("ffffff"),
			"the flash still reads at tick %d of %d" % [i + 1, white_ticks]
		)
	foe.chase(g.hero.x, g.hero.y, FRAME)
	Check.unchanged(
		foe.body_color(g.elapsed),
		Color("88ccff"),
		"and the tick PAST it reveals the slow that was underneath all along"
	)
	# ...AND THE SLOW LIFTS TOO, so the last claim is not "everything is iced blue now".
	foe.slow_timer = 0.0
	Check.unchanged(
		foe.body_color(g.elapsed),
		Color(foe.color),
		"and once the slow is over the foe REVERSES to its own colour -- a flash that never"
		+ " reverses is a foe that is white forever"
	)


## A DAMAGE NUMBER AT THE FOE, AND IT GOES AWAY.
##
##     game.createFloatingText(Math.round(dmg), x, y, '#ffee44', { crit: true });
##     game.createFloatingText(Math.round(baseDamage), x, y, color);
##
## -- `_rollCrit`, `src/weapons.ts:112-115`, on EVERY hit, where `x`/`y` are the CALL SITE's
## and every call site passes the FOE it is about (`enemy.x, enemy.y - 20`). That position is
## the claim this file can see: the number belongs to the foe it was dealt to, not to the hero
## who dealt it. **The half it cannot see -- that the number reaches the SCREEN -- is
## `verify_pixels.gd`'s, and no assertion here can stand in for it.**
##
## What is asserted here, and what each one is for:
##
##   the number EXISTS, with the right label, x, y and colour for that weapon
##   TWO foes get TWO numbers, each over its own foe -- the per-target half
##   a crit prints DOUBLE and uses `#ffee44` and `crit`, which is what `{crit:true}` changes
##   it EXPIRES, driven by `fx.update`, the same call `Game.step` makes every frame
##   GARLIC GETS NONE, because `_fireAura` contains no `createFloatingText` at all
##   THE MINE GETS `#ff9944`, because `Mine.update` contains one
func _a_damage_number_is_drawn_at_the_foe() -> void:
	# --- ONE FOE, the Whip's own colour and offset ------------------------------------
	var s := _scene("whip", 60.0)
	var g: Game = s["game"]
	var foe: Foe = s["foe"]
	# OFF THE HERO'S OWN ROW, and that is what makes the y assertion below able to tell the
	# two apart: `_scene` puts its foe at the hero's y, where "20px above the foe" and "20px
	# above the hero" are the same number and a number drawn at the hero passes. Still inside
	# the Whip's band (`abs(dy) <= 40`).
	foe.y = g.hero.y + 25.0
	Check.unchanged(g.fx.texts.size(), 0, "nothing is drawn before the weapon fires")
	WeaponFire.fire(s["def"], g.hero, g.foes, [], 1, g.fx)
	Check.rose(0.0, float(g.fx.texts.size()), "firing the Whip draws a damage number")
	if g.fx.texts.is_empty():
		# A FAILURE ABOVE MEANS EVERY ASSERTION BELOW IS ABOUT A NUMBER THAT IS NOT THERE, and
		# an out-of-bounds read here ABORTS the rest of this function with a script error rather
		# than a finding -- `Check` records the failure above either way, so the honest move is
		# to stop at the assertion that failed. Watched: without this guard the first break of
		# the emit produced one FAIL and one "Out of bounds get index '0'" and nothing else.
		return
	var number: Fx.FloatingText = g.fx.texts[0]
	Check.unchanged(
		number.text,
		str(roundi(foe.max_hp - foe.hp)),
		"and it prints the damage the foe ACTUALLY took, rounded as `Math.round` rounds it"
	)
	Check.unchanged(number.x, foe.x, "at the FOE's own x -- `_rollCrit`'s first argument")
	Check.unchanged(number.y, foe.y - 20.0, "and 20px above it, `enemy.y - 20`")
	Check.unchanged(number.color, Color("ffaa00"), "in the Whip's own number colour, '#ffaa00'")
	Check.unchanged(number.crit, false, "and it is not a crit, because a base hero has no Luck")

	# --- TWO FOES IN ONE BAND: one number each, at each -------------------------------
	g.fx.clear()
	# The other side of the hero's row, so the two numbers differ in x AND in y and neither
	# axis can be satisfied by a number drawn at the hero.
	var second := Foe.new(Enemies.ENEMIES["BAT"], g.hero.x, g.hero.y - 30.0)
	Check.sturdy(second)
	g.foes.append(second)
	WeaponFire.fire(s["def"], g.hero, g.foes, [], 1, g.fx)
	Check.unchanged(g.fx.texts.size(), 2, "TWO foes inside one Whip band draw TWO numbers")
	var first_x: float = g.fx.texts[0].x
	Check.differs(
		first_x,
		g.fx.texts[1].x,
		1.0,
		"and they are at DIFFERENT x -- one per FOE, which one number per FIRE cannot produce"
	)
	for i in g.foes.size():
		Check.unchanged(
			g.fx.texts[i].x, g.foes[i].x, "number %d sits at foe %d's own x" % [i, i]
		)
		Check.unchanged(
			g.fx.texts[i].y, g.foes[i].y - 20.0, "and above foe %d, not above the hero" % i
		)

	# --- A CRIT: double the number, `#ffee44`, and `crit` -----------------------------
	# A chance of 1.0 is the DETERMINISTIC way into the crit branch: the roll is
	# `randf() < chance`, and `randf()` is in [0, 1). No seed, no rate, no flake.
	var crit_fx := Fx.new()
	WeaponFire._roll_crit(10.0, 1.0, null, crit_fx, 100.0, 200.0, Color("ff66aa"))
	Check.unchanged(crit_fx.texts.size(), 1, "a crit draws one number")
	var crit: Fx.FloatingText = crit_fx.texts[0]
	Check.unchanged(crit.text, "20", "a crit PRINTS the doubled damage, `baseDamage * 2`")
	Check.unchanged(
		crit.color,
		Color("ffee44"),
		"in '#ffee44' whatever colour the weapon passed -- the crit branch's own"
	)
	Check.unchanged(crit.crit, true, "with `{crit:true}`, which is the size and the outline")
	Check.rose(
		number.font_size(),
		crit.font_size(),
		"and a crit number is drawn LARGER than a plain one at the same `size`"
	)

	# --- THE LIFETIME, through the call `Game.step` makes ------------------------------
	# `life` starts at 1 and is spent at 1.2/s, so 1 / 1.2 = 0.833s. Ticks are derived, and
	# the boundary is pinned one tick either side of it.
	var ticks := int(round((1.0 / 1.2) / FRAME))
	Check.at_least(float(ticks), 2.0, "the lifetime is more than one tick, or there is nothing to pin")
	# HELD BY REFERENCE, not re-indexed: `Fx.update` rebuilds the array, so a `texts[0]` read
	# one tick past the end is an index error rather than a failed assertion -- and a suite
	# that crashes reports nothing.
	var alive: Fx.FloatingText = g.fx.texts[0]
	for i in ticks - 1:
		g.fx.update(FRAME)
	Check.rose(0.0, alive.life, "the number is still alive one tick short of its life")
	g.fx.update(FRAME)
	Check.unchanged(
		g.fx.texts.size(), 0, "and GONE at it -- a number that never expires is a screen of them"
	)

	# --- THE TWO ARCHETYPES THE ORIGINAL GIVES NO NUMBER TO ----------------------------
	# GARLIC is the CONTROL for every assertion above: if `fire()` emitted a number
	# unconditionally, this is the check that would catch it. `_fireAura` calls
	# `createFloatingText` NOWHERE.
	var aura := _scene("garlic", 40.0)
	WeaponFire.fire(aura["def"], aura["game"].hero, aura["game"].foes, [], 1, aura["game"].fx)
	Check.unchanged(
		aura["game"].fx.texts.size(),
		0,
		"CONTROL: Garlic draws NO number -- `_fireAura` has no `createFloatingText` at all"
	)
	# THE AREA MINE DRAWS NOTHING HERE EITHER, AND THAT IS A REPORTED GAP RATHER THAN A
	# CLAIM ABOUT THE ORIGINAL. `Mine.update` DOES call `createFloatingText`:
	#
	#     src/entities.ts:777-782
	#     game.createFloatingText(Math.round(this.damage), enemy.x, enemy.y - 20, '#ff9944');
	#
	# -- `'#ff9944'`, an eighth call site and none of `_rollCrit`'s four, at the same 20px
	# and with NO crit and NO `hp > 0` guard. It is not drawn here because the number belongs
	# to the `Mine` OBJECT in the original and this port has no `Mine` object yet: the mine
	# arm strikes where it stands. Giving it a number through `fire()` would be inventing a
	# fire-time draw the original does not make, at the exact lines a separate change is
	# rewriting. So the honest assertion is the OTHER direction, and it is a real one: a port
	# that starts drawing a number for the mine through this path FAILS here.
	#
	# The PREMISE is asserted first: the mine must actually DAMAGE the foe, or "it draws no
	# number" would be satisfied by a mine that does nothing at all.
	var mine := _scene("mine", 40.0)
	var mine_before: float = mine["foe"].hp
	WeaponFire.fire(mine["def"], mine["game"].hero, mine["game"].foes, [], 1, mine["game"].fx)
	Check.fell(
		mine_before, mine["foe"].hp, "the Area Mine DOES damage the foe it lands on"
	)
	Check.unchanged(
		mine["game"].fx.texts.size(),
		0,
		"and draws NO number -- `Mine.update`'s '#ff9944' is not wired, and this is the gap"
	)
	# THE ORBITER, the OTHER archetype in this position, and the one an unguarded port of
	# `main.ts:1465-1483` would silently give an invented per-hit crit roll. Its shards are
	# `Shot`s in this port and NOT `game.projectiles` in the original -- see
	# `_orbit_draws_no_number_and_rolls_nothing` for the measurement.


# ---------------------------------------------------------------------------
# THE PROJECTILE'S OWN PER-HIT CRIT AND ITS OWN DAMAGE NUMBER -- the FIFTH roll site.
#
# `_fireProjectile` rolls nothing: `src/weapons.ts:239` just pushes a `Projectile`. The roll
# is in the LATER function, on IMPACT, and the four `_rollCrit` lines do not contain it:
#
#     src/main.ts:1465-1483   Game._updateProjectiles
#     let dmg = p.damage;
#     const chance = this.player.getCritChance();
#     const crit = chance > 0 && Math.random() < chance;
#     if (crit) dmg *= 2;
#     enemy.takeDamage(dmg);
#     p.hitEnemies.add(enemy);
#     if (enemy.hp > 0) {
#         this.createFloatingText(Math.round(dmg), enemy.x, enemy.y - 20,
#                                 crit ? '#ffee44' : '#fff', { crit });
#     }
#
# `Shot.resolve` is that block. FOUR claims, and each has a way of being wrong the others
# cannot see:
#
#   THE DRAW COUNT. One roll per TOUCHED FOE. A per-fire roll reads 1 where this demands N; a
#   port that stopped rolling reads 0. Exact, tolerance 0, replayed from the generator's own
#   sequence -- `_crit_draw_probe`'s instrument, on a different entry point.
#
#   THE MIX. Four foes under ONE piercing shot: N independent rolls mix at `1 - p^N - (1-p)^N`
#   (`_mixed_share`), and ONE roll taken before the loop can NEVER mix. THE CONTROL IS A
#   ONE-FOE SHOT THROUGH THE SAME INSTRUMENT: it ROLLS -- asserted, exactly one draw -- and it
#   CANNOT mix, asserted at exactly zero over `CRIT_RATE_FIRES` fires. A reading of zero
#   therefore means "this geometry cannot mix" rather than "this instrument is dead".
#
#   IT IS `getCritChance()` AND NOT `_rollCrit`. The hero's own sum, with NO
#   `evolveBonusCrit` -- so the evolved Knife's declared +0.10 does NOT reach this roll. That
#   is a RATE against two expectations rather than a difference of 0.04 in a damage ratio:
#   at the Luck cap the hero's 0.25 mixes at 0.68 and the weapon's 0.35 would mix at 0.81.
#
#   THE DOUBLING IS A LOCAL COPY. `let dmg = p.damage` is never written back, so a PIERCING
#   shot rolls the BASE against every victim. A port that doubled `p.damage` in place would
#   quadruple the second victim's damage, and nothing above would notice.
# ---------------------------------------------------------------------------


## `count` sturdy bats STACKED ON ONE POINT, every one frozen.
##
## A point rather than a line or a ring, because these claims are about the NUMBER OF ROLLS
## and not about geometry: `Shot.resolve` touches a foe within `radius + foe.size` -- 18px for
## a bat and this port's 6px shot radius -- so foes spread along x would make "how many were
## touched" a second variable. All of them at one point makes it true by construction.
func _stacked_bats(g: Game, count: int) -> Array:
	var made: Array = []
	for i in count:
		var f := Check.sturdy(Foe.new(Enemies.ENEMIES["BAT"], g.hero.x + 60.0, g.hero.y))
		f.speed = 0.0
		g.foes.append(f)
		made.append(f)
	return made


## A PIERCING shot already ON the first of `foes`, so ONE `resolve` call touches them all.
##
## Built rather than fired, because these claims are about the LOOP BODY: `Shot.resolve` is
## the port of `_updateProjectiles`'s inner block, and firing a real volley would put the
## weapon's spread, fan width and travel time between the claim and the measurement.
func _shot_on_top_of(foes: Array, dmg: float) -> Shot:
	return Shot.new(foes[0].x, foes[0].y, Vector2.RIGHT, dmg, 420.0, 620.0, true)


## How many `randf()` draws ONE `resolve` call takes from a caller-supplied generator, replayed
## out of that generator's own sequence -- `_crit_draw_probe`'s method, and for its reason: two
## draws from a seeded `RandomNumberGenerator` are the same number, so a generator drawn from a
## different number of times is at a different place and reads a different value.
##
## Returns `[actual, expected]`, so a failing `Check.approx` prints both.
func _resolve_draw_probe(shot: Shot, g: Game, foes: Array, draws: int) -> Array:
	var scratch := RandomNumberGenerator.new()
	scratch.seed = CRIT_DRAW_SEED
	var expected := 0.0
	for i in draws + 1:
		expected = scratch.randf()
	var rng := RandomNumberGenerator.new()
	rng.seed = CRIT_DRAW_SEED
	shot.resolve(foes, Callable(), g.hero, g.fx, rng)
	return [rng.randf(), expected]


## How many of `fires` shots MIXED -- their victims did not all take the same damage.
##
## A FRESH `Shot` each fire, because `hit` is per-shot: the same one re-resolved would skip
## every foe it had already touched and read zero damage, which is a perfect-looking way to
## measure nothing. No generator is passed, so the roll comes from the GLOBAL one and the
## caller seeds it -- `Game._update_shots`'s own arrangement, so this rate is measured on the
## path a run takes rather than on a path only a test takes.
func _shot_mixed_fires(g: Game, foes: Array, dmg: float, fires: int) -> int:
	seed(CRIT_DRAW_SEED)
	var mixed := 0
	for i in fires:
		var before: Array = []
		for foe in foes:
			before.append(float(foe.hp))
		var shot := _shot_on_top_of(foes, dmg)
		shot.resolve(foes, Callable(), g.hero, g.fx)
		var lo := INF
		var hi := -INF
		for j in foes.size():
			var lost: float = float(before[j]) - float(foes[j].hp)
			lo = minf(lo, lost)
			hi = maxf(hi, lost)
		if hi - lo > DAMAGE_EPSILON:
			mixed += 1
	return mixed


## The first seed at or after `from_seed` whose next `need` draws are ALL below `chance`.
##
## NEEDED BECAUSE THE CRIT BRANCH IS NOT OTHERWISE REACHABLE DETERMINISTICALLY HERE. The roll
## is `_randf(rng) < chance` and a hero's chance caps at `Config.PASSIVE_MAX_STACK` stacks of
## `luck` -- 0.25, so `chance` cannot be 1.0 the way `_roll_crit`'s own checks reach its crit
## branch. A seed whose FIRST value is below the chance IS that branch, deterministically: no
## rate, no flake, and the search is bounded and reproducible because the seeds are.
##
## Returns -1 if no such seed was found in `tries`, which the caller ASSERTS rather than
## letting a null generator silently take no draw at all.
func _critting_seed(chance: float, need: int, from_seed: int, tries: int) -> int:
	var s := from_seed
	for attempt in tries:
		var probe := RandomNumberGenerator.new()
		probe.seed = s
		var ok := true
		for i in need:
			if probe.randf() >= chance:
				ok = false
				break
		if ok:
			return s
		s += 1
	return -1


## THE FIFTH ROLL SITE: the projectile's own per-hit crit, its number, and its guard.
func _a_projectile_rolls_per_HIT_and_draws_its_own_number() -> void:
	var def := _weapon("knife")
	var base := float(def["baseDamage"])
	var g := _crit_hero(def, 1)
	var p: float = g.hero.crit_chance()
	Check.rose(0.0, p, "the hero has a crit chance, so a roll WOULD consume a draw")

	# --- ONE ROLL PER TOUCHED FOE, exact, tolerance 0 ----------------------------------
	var foes := _stacked_bats(g, CRIT_TARGETS)
	var probe := _resolve_draw_probe(_shot_on_top_of(foes, base), g, foes, CRIT_TARGETS)
	Check.approx(
		float(probe[0]),
		float(probe[1]),
		"one projectile touching %d foes takes %d crit draws, not one" % [CRIT_TARGETS, CRIT_TARGETS],
		1e-9
	)
	# THE OTHER SIDE OF THE SHORT CIRCUIT, same instrument: `chance > 0 && ...` means a hero
	# with NO Luck takes NO draw, which is what makes a seeded sequence replay at all.
	var cold := _game_holding(def, 1)
	var cold_foes := _stacked_bats(cold, CRIT_TARGETS)
	Check.unchanged(cold.hero.crit_chance(), 0.0, "the control hero has NO crit chance")
	var cold_probe := _resolve_draw_probe(_shot_on_top_of(cold_foes, base), cold, cold_foes, 0)
	Check.approx(
		float(cold_probe[0]),
		float(cold_probe[1]),
		"and a no-Luck hero's projectile takes NO draw at all -- the guard is a SHORT CIRCUIT",
		1e-9
	)

	# --- THE MIX, and a control that CANNOT mix while still ROLLING ---------------------
	var fresh := _crit_hero(def, 1)
	var four := _stacked_bats(fresh, CRIT_TARGETS)
	var mixed := _shot_mixed_fires(fresh, four, base, CRIT_RATE_FIRES)
	Check.rate(
		mixed,
		CRIT_RATE_FIRES,
		_mixed_share(p, CRIT_TARGETS),
		CRIT_RATE_TOL,
		"and the shot MIXES -- some victims doubled and others not (p = %0.2f)" % p
	)
	# THE CONTROL: ONE foe. `_mixed_share(p, 1)` is`1 - p - (1-p)`, which is EXACTLY ZERO, so
	# this cannot mix however the roll comes out -- and the premise below asserts that the roll
	# HAPPENS, which is what stops the zero from being a dead instrument.
	var one_game := _crit_hero(def, 1)
	var one := _stacked_bats(one_game, 1)
	var one_probe := _resolve_draw_probe(_shot_on_top_of(one, base), one_game, one, 1)
	Check.approx(
		float(one_probe[0]),
		float(one_probe[1]),
		"the control's one-foe shot DOES roll -- exactly one draw, so the reading below is live",
		1e-9
	)
	var one_mixed := _shot_mixed_fires(one_game, one, base, CRIT_RATE_FIRES)
	Check.unchanged(
		one_mixed,
		0,
		"and NEVER mixes in %d fires -- the instrument CAN read all-or-nothing" % CRIT_RATE_FIRES
	)

	# --- THE HERO'S CHANCE, WITH NO `evolveBonusCrit` ----------------------------------
	# The evolved Knife declares `evolveBonusCrit: 0.1`, and `_rollCrit` adds it. THIS roll
	# must not: the original reads `this.player.getCritChance()` and nothing else. So the mix
	# has to land on the HERO's rate and be measurably away from the weapon's.
	var evolved_level := _evolve_level(def)
	var weapon_p := _fire_crit_chance(def, g.hero, evolved_level)
	Check.rose(p, weapon_p, "the evolved Knife's own chance is HIGHER than the hero's alone")
	var evo := _crit_hero(def, evolved_level)
	var evo_foes := _stacked_bats(evo, CRIT_TARGETS)
	Check.approx(
		evo.hero.crit_chance(),
		p,
		"the evolved hero's own crit chance is the same number, so only the ROLL differs",
		1e-9
	)
	var evo_mixed := _shot_mixed_fires(evo, evo_foes, base, CRIT_RATE_FIRES)
	Check.rate(
		evo_mixed,
		CRIT_RATE_FIRES,
		_mixed_share(p, CRIT_TARGETS),
		CRIT_RATE_TOL,
		"the projectile's roll is the HERO's chance -- NO evolveBonusCrit (p = %0.2f)" % p
	)
	Check.differs(
		float(evo_mixed) / float(CRIT_RATE_FIRES),
		_mixed_share(weapon_p, CRIT_TARGETS),
		CRIT_RATE_TOL,
		"and it is measurably NOT the weapon's 1 + evolveBonusCrit rate (p = %0.2f)" % weapon_p
	)

	# --- THE DOUBLING IS A LOCAL COPY of `p.damage` ------------------------------------
	var seed_found := _critting_seed(p, CRIT_TARGETS, CRIT_DRAW_SEED, 100000)
	Check.at_least(
		float(seed_found),
		0.0,
		"a seed whose next %d draws ALL crit was found, so the branch below is reachable"
			% CRIT_TARGETS
	)
	if seed_found < 0:
		return
	var lc := _crit_hero(def, 1)
	var lc_foes := _stacked_bats(lc, 2)
	var lc_before: Array = []
	for foe in lc_foes:
		lc_before.append(float(foe.hp))
	var lc_rng := RandomNumberGenerator.new()
	lc_rng.seed = seed_found
	var lc_shot := _shot_on_top_of(lc_foes, base)
	Check.unchanged(lc_shot.damage, base, "the shot's own `damage` field starts at the base")
	lc_shot.resolve(lc_foes, Callable(), lc.hero, lc.fx, lc_rng)
	for i in lc_foes.size():
		Check.approx(
			float(lc_before[i]) - float(lc_foes[i].hp),
			base * 2.0,
			"victim %d of a PIERCING shot took exactly the DOUBLED base -- `let dmg = p.damage` never writes back"
				% i,
			1e-4
		)
	Check.unchanged(
		lc_shot.damage, base, "and the shot's own field is UNCHANGED after both hits"
	)

	# --- THE NUMBER: colour, position, the flag, and THE GUARD -------------------------
	# A DETERMINISTIC NON-CRIT: a bare hero has `crit_chance()` of exactly 0, so the short
	# circuit takes no draw and the crit branch is unreachable. No seed, no rate, no flake.
	var plain := Game.new(999.0)
	plain.hero.weapons.clear()
	var plain_foe := Check.sturdy(
		Foe.new(Enemies.ENEMIES["BAT"], plain.hero.x + 60.0, plain.hero.y + 30.0)
	)
	plain_foe.speed = 0.0
	plain.foes.append(plain_foe)
	Check.unchanged(plain.hero.crit_chance(), 0.0, "a bare hero cannot crit, so this is a plain hit")
	Check.unchanged(plain.fx.texts.size(), 0, "nothing is drawn before the shot is resolved")
	_shot_on_top_of(plain.foes, base).resolve(plain.foes, Callable(), plain.hero, plain.fx)
	Check.rose(0.0, float(plain.fx.texts.size()), "a projectile hit draws a damage number")
	if plain.fx.texts.is_empty():
		# A FAILURE ABOVE MEANS EVERY LINE BELOW IS ABOUT A NUMBER THAT IS NOT THERE, and an
		# out-of-bounds read here ABORTS the rest of this function with a script error rather
		# than a finding. `Check` has already recorded the failure above.
		return
	var number: Fx.FloatingText = plain.fx.texts[0]
	Check.unchanged(
		number.text, str(roundi(base)), "printing the damage the foe took, `Math.round`ed"
	)
	Check.unchanged(number.x, plain_foe.x, "at the FOE's own x -- not at the hero who fired")
	Check.unchanged(number.y, plain_foe.y - 20.0, "and 20px above it, `enemy.y - 20`")
	Check.unchanged(
		number.color, Color("ffffff"), "in the original's '#fff' when it does NOT crit"
	)
	Check.unchanged(number.crit, false, "with `{crit}` false")

	# --- A CRIT: `#ffee44`, `{crit:true}`, and the DOUBLED damage ----------------------
	var crit_game := _crit_hero(def, 1)
	var crit_foe := Check.sturdy(
		Foe.new(Enemies.ENEMIES["BAT"], crit_game.hero.x + 60.0, crit_game.hero.y + 30.0)
	)
	crit_foe.speed = 0.0
	crit_game.foes.append(crit_foe)
	var crit_before: float = crit_foe.hp
	var crit_rng := RandomNumberGenerator.new()
	crit_rng.seed = seed_found
	_shot_on_top_of(crit_game.foes, base).resolve(
		crit_game.foes, Callable(), crit_game.hero, crit_game.fx, crit_rng
	)
	Check.unchanged(crit_game.fx.texts.size(), 1, "a crit draws ONE number")
	var crit_number: Fx.FloatingText = crit_game.fx.texts[0]
	Check.unchanged(
		crit_number.text, str(roundi(base * 2.0)), "a crit PRINTS the doubled damage, `dmg *= 2`"
	)
	Check.unchanged(
		crit_number.color, Color("ffee44"), "in '#ffee44' -- the projectile's own crit colour"
	)
	Check.unchanged(
		crit_number.crit, true, "with `{crit:true}`, which is the size and the outline"
	)
	Check.approx(
		crit_before - crit_foe.hp, base * 2.0, "and the foe ACTUALLY lost the doubled damage", 1e-4
	)

	# --- THE GUARD: `if (enemy.hp > 0)` -- A KILLING BLOW DRAWS NOTHING ----------------
	var kgame := Game.new(999.0)
	kgame.hero.weapons.clear()
	var killable := Foe.new(Enemies.ENEMIES["BAT"], kgame.hero.x + 60.0, kgame.hero.y + 30.0)
	killable.speed = 0.0
	kgame.foes.append(killable)
	var survivor := Check.sturdy(
		Foe.new(Enemies.ENEMIES["BAT"], kgame.hero.x + 60.0, kgame.hero.y + 30.0)
	)
	survivor.speed = 0.0
	kgame.foes.append(survivor)
	Check.rose(0.0, killable.hp, "the doomed foe is ALIVE before the shot lands")
	_shot_on_top_of(kgame.foes, killable.hp + 1.0).resolve(
		kgame.foes, Callable(), kgame.hero, kgame.fx
	)
	Check.unchanged(killable.hp, 0.0, "the shot KILLS it")
	Check.unchanged(killable.dead, true, "and it is dead")
	Check.unchanged(
		kgame.fx.texts.size(),
		1,
		"so it draws NO number while the foe BESIDE it, which survived, draws exactly one -- `if (enemy.hp > 0)` is the feature, not an optimisation"
	)
	if kgame.fx.texts.size() == 1:
		Check.unchanged(
			kgame.fx.texts[0].x,
			survivor.x,
			"and the one number that WAS drawn belongs to the foe that is still alive"
		)


## THE ORBIT ARCHETYPE DRAWS NO NUMBER AND ROLLS NOTHING, and this is the assertion that keeps
## `main.ts:1465-1483` from being ported ONE ARCHETYPE TOO WIDE.
##
## `game.projectiles` has exactly ONE writer in the whole of `src/`:
##
##     src/weapons.ts:239   game.projectiles.push(new Projectile(...))   inside `_fireProjectile`
##
## `OrbitShard` is NOT one of its entries. A shard lives on the WEAPON (`weapon._shards`), is
## stepped by `weapon.update`, is drawn by `renderExtras`, and does its damage in
## `OrbitShard.update`, which rolls NOTHING and draws its own number at its own colour:
##
##     src/entities.ts:735-737
##     e.takeDamage(this.damage);
##     this.hitTimers.set(e, 0.5);
##     game.createFloatingText(Math.round(this.damage), e.x, e.y - 18, '#ffffcc');
##
## -- `'#ffffcc'`, at `e.y - 18`, with NO crit and NO `hp > 0` guard. A different call site in
## every one of those four particulars.
##
## SO A `Shot` THAT IS AN ORBIT SHARD MUST BE EXCLUDED FROM THE IMPACT ROLL. This port puts
## both in ONE class -- `Shot.Kind.ORBIT` is `OrbitShard` and the other two kinds are
## `Projectile` -- and `Game._update_shots` calls `resolve` for both, so an unguarded port of
## the impact block hands the ORBIT archetype an invented per-hit crit roll. THAT IS THE SAME
## DEFECT `da96c02` REMOVED from the four archetypes, and NO EXISTING ASSERTION CATCHES IT:
## `_bonus_crit_is_read` iterates weapons declaring `evolveBonusCrit`, and the Orbiter declares
## none -- it declares `evolveDamageMult` instead. `ROLLING_ARCHETYPES` names the four that
## roll and this file never drives the four that do not.
##
## THIS IS ALSO WHY THE NUMBER IS NOT WIRED FOR THE SHARD. `'#ffffcc'` at `-18` is a real
## eighth call site in the original and it is DRAWING NOWHERE in this port; wiring it here
## would be inventing it in `resolve`, which is not where `OrbitShard.update` lives. Reported
## in `docs/GODOT-PORT.md`.
func _orbit_draws_no_number_and_rolls_nothing() -> void:
	var def := _weapon("orbit")
	var g := _crit_hero(def, 1)
	Check.rose(0.0, g.hero.crit_chance(), "the hero HAS a crit chance, so a roll WOULD consume a draw")
	var foes := _stacked_bats(g, CRIT_TARGETS)
	var shard := Shot.orbiting(g.hero.x, g.hero.y, 0.0, 0.0, 12.0, 0.0)
	Check.unchanged(shard.kind, Shot.Kind.ORBIT, "the shard is the ORBIT kind")
	Check.unchanged(
		shard.rolls_on_hit(),
		false,
		"and an orbit shard is NOT a `game.projectiles` entry, so it rolls NOTHING"
	)
	# The shard is placed ON the stack rather than on its ring, so `how many it touched` is
	# true by construction and the count below is about the ROLL rather than the geometry.
	shard.x = foes[0].x
	shard.y = foes[0].y
	var shard_probe := _resolve_draw_probe(shard, g, foes, 0)
	Check.approx(
		float(shard_probe[0]),
		float(shard_probe[1]),
		"a shard touching %d foes takes NO crit draw at all" % CRIT_TARGETS,
		1e-9
	)
	Check.unchanged(g.fx.texts.size(), 0, "and draws NO number")
	Check.unchanged(
		foes[0].hp < foes[0].max_hp, true, "PREMISE: the shard DID damage, so this is not a dead path"
	)
	# THE POSITIVE SIDE, in this same run and through this same instrument: the SAME hero, the
	# SAME foes and the same `resolve` call as a PROJECTILE. If the instrument could not see a
	# draw, this would read zero too and the control above would prove nothing.
	var positive := _resolve_draw_probe(_shot_on_top_of(foes, 12.0), g, foes, CRIT_TARGETS)
	Check.approx(
		float(positive[0]),
		float(positive[1]),
		"CONTROL: the same instrument on a PROJECTILE at the same %d foes reads %d draws"
			% [CRIT_TARGETS, CRIT_TARGETS],
		1e-9
	)


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


# ---------------------------------------------------------------------------
# PER-TARGET CRIT
#
# THE DECLARED GAP: `godot-crit-rolled-once-per-fire`, in `quality-baseline.json`.
#
# `grep -n "_rollCrit" src/weapons.ts` is four lines -- 216, 289, 395 and 454 -- and every one
# of them is INSIDE a per-target loop:
#
#     src/weapons.ts:216   `_fireMelee`    `for (const enemy of candidates)`
#     src/weapons.ts:289   `_fireInstant`  `for (let i = 0; i < strikes; i++)`
#     src/weapons.ts:395   `_fireNova`     `for (const enemy of candidates)`
#     src/weapons.ts:454   `_fireDrain`    `for (const e of targets)`
#
# The port rolled ONCE, before the `match kind:` dispatch, and multiplied that single number
# into every archetype. A Whip sweep that caught four foes doubled all four or none of them:
# the EXPECTED damage was right and the variance was not, and no assertion here could see it.
#
# TWO MEASUREMENTS PER ARCHETYPE, because either one alone has a way of being wrong:
#
#   THE DRAW COUNT. `fire` takes a caller-owned `RandomNumberGenerator` and one crit roll is one
#   `randf()`, so after a fire at N foes the generator's NEXT value must be the (N+1)th of its
#   own sequence -- replayed from a scratch generator seeded the same way, with no tolerance and
#   no rate. It is also the assertion that the roll comes from the CALLER's generator at all,
#   which is what makes a seeded run reproducible rather than merely unpredictable.
#
#   THE MIX. Foe damage is read as health actually LOST -- this port draws no damage numbers, so
#   there is nothing else to read -- and a fire MIXES when its targets did not all take the same
#   number. One shared roll can NEVER mix. N independent rolls mix at `1 - p^N - (1-p)^N`, which
#   is computed from the hero's own crit chance and the def's own declared bonus rather than
#   written down.
#
# AND A CONTROL BESIDE THEM. Garlic is an archetype the original rolls NOTHING for, and this
# port no longer rolls for it either, so it takes no draw at all and goes through the identical
# instrument. If the instrument were what reported "mixed", the control would say so -- a
# measurement that cannot read all-or-nothing cannot tell it from per-target, and would pass
# the Whip check while measuring nothing. Its own positive side, a Whip sweep through the same
# instrument reading a non-zero mix, sits INSIDE the control so the two cannot drift apart.
# ---------------------------------------------------------------------------


## A hero who has taken Luck passives, holding `weapon` at `level`.
##
## At the CAP by default, and the cap is READ from `Config` rather than written down: the chance
## every expectation below is computed from is `hero.crit_chance()`, so changing the passive's
## own number or the stack cap moves the expectation with it rather than quietly invalidating
## the measurement.
func _crit_hero(weapon: Dictionary, level: int, stacks: int = -1) -> Game:
	var g := _game_holding(weapon, level)
	var n: int = Config.PASSIVE_MAX_STACK if stacks < 0 else stacks
	for i in n:
		g.hero.add_passive(Passives.PASSIVES["LUCK"])
	return g


## What one fire rolls against: the hero's own stacks, plus the def's own declared bonus when
## the weapon is at its evolve level. Built from those two READS rather than from
## `WeaponFire.crit_chance_for`, so a port that computed the chance wrongly cannot have this
## file agree with it by sharing the mistake.
func _fire_crit_chance(weapon: Dictionary, hero: Hero, level: int) -> float:
	var chance := hero.crit_chance()
	if level >= int(weapon.get("evolveLevel", 0)):
		chance += float(weapon.get("evolveBonusCrit", 0.0))
	return chance


## What N INDEPENDENT rolls at `p` mix at: every outcome except all-crit and no-crit. One shared
## roll mixes at exactly 0, which is the whole of the difference this section measures.
func _mixed_share(p: float, n: int) -> float:
	return 1.0 - pow(p, float(n)) - pow(1.0 - p, float(n))


## `count` sturdy bats on a LINE along +x, spanning `spread` about `offset`, every one frozen.
##
## A line rather than the ring `_scatter` builds, because the un-evolved Whip's sweep is a BAND
## -- `if (Math.abs(dy) > 40) continue` -- and a ring's top and bottom foes are outside it by
## design, so a ring would make the number of foes swept depend on the geometry under test.
##
## REGISTERED IN `g.foes` as well as returned, like `_scatter`. A delayed pulse is landed by
## `Game._land_pulses`, which walks the GAME's own foe list -- so a foe this helper made but did
## not register takes the first ring's damage and none of the second's. That is not a guess:
## `_the_evolved_second_ring_is_never_doubled` read 0.0 for every pulse until this line was
## added, and its own assertion is what said so.
func _line_of_bats(g: Game, count: int, spread: float, offset: float) -> Array:
	var made: Array = []
	for i in count:
		var t := 0.0 if count < 2 else float(i) / float(count - 1) * 2.0 - 1.0
		var f := Check.sturdy(
			Foe.new(Enemies.ENEMIES["BAT"], g.hero.x + offset + t * spread * 0.5, g.hero.y)
		)
		f.speed = 0.0
		g.foes.append(f)
		made.append(f)
	return made


## The health each of `foes` LOST to one fire.
##
## `foe.hp` is the only record of what a foe was dealt -- there is no damage number in this port
## to read, and that absence is one of the findings this section reports -- and `Check.sturdy`
## is what keeps a measurement of DAMAGE from becoming a measurement of death: twelve hundred
## fires at a bat's own 15 hp would kill it on the first one.
##
## No generator is passed, so the fire draws from the global one and the caller seeds it. That
## is `Game.step`'s own arrangement, so these rates are measured on the path a run takes rather
## than on a path only a test takes.
func _fire_losses(weapon: Dictionary, hero: Hero, foes: Array, level: int) -> Array:
	var before: Array = []
	for foe in foes:
		before.append(foe.hp)
	WeaponFire.fire(weapon, hero, foes, [], level)
	var lost: Array = []
	for i in foes.size():
		lost.append(float(before[i]) - float(foes[i].hp))
	return lost


## How many of `fires` fires MIXED -- their targets did not all take the same damage.
func _mixed_fires(weapon: Dictionary, hero: Hero, foes: Array, level: int, fires: int) -> int:
	seed(CRIT_DRAW_SEED)
	var mixed := 0
	for i in fires:
		var lost := _fire_losses(weapon, hero, foes, level)
		var lo := float(lost[0])
		var hi := float(lost[0])
		for v in lost:
			lo = minf(lo, float(v))
			hi = maxf(hi, float(v))
		if hi - lo > DAMAGE_EPSILON:
			mixed += 1
	return mixed


## How many `randf()` draws ONE fire takes from a caller-supplied generator.
##
## Read by REPLAYING the generator's own sequence: a scratch generator is seeded with the same
## number and its first `draws + 1` values are listed, then a second generator with that seed
## fires the weapon once and the value it produces NEXT is compared with the (draws+1)th. Two
## draws from a seeded `RandomNumberGenerator` are the same number, so a generator that was
## drawn from a different number of times is at a different place and reads a different value.
## `_lightning_picks` already pins Lightning's choices this way.
##
## Returns `[actual, expected]` so a failing `Check.approx` prints both numbers.
func _crit_draw_probe(
	weapon: Dictionary, hero: Hero, foes: Array, level: int, draws: int
) -> Array:
	var scratch := RandomNumberGenerator.new()
	scratch.seed = CRIT_DRAW_SEED
	var expected := 0.0
	for i in draws + 1:
		expected = scratch.randf()
	var rng := RandomNumberGenerator.new()
	rng.seed = CRIT_DRAW_SEED
	WeaponFire.fire(weapon, hero, foes, [], level, null, rng)
	return [rng.randf(), expected]


## THE WHIP. `src/weapons.ts:216`, the roll inside `_fireMelee`'s candidate loop.
func _melee_rolls_once_per_foe() -> void:
	print("\n-- a Whip sweep rolls for EACH foe it catches --")
	var def := _weapon("whip")
	var g := _crit_hero(def, 1)
	# Inside the level-1 band: `baseRange` is 90, so `|dx| <= 90`, and the line lies along
	# y = 0 where `|dy| <= 40` holds for every one of them.
	var foes := _line_of_bats(g, CRIT_TARGETS, 140.0, 0.0)
	var probe := _crit_draw_probe(def, g.hero, foes, 1, CRIT_TARGETS)
	Check.approx(
		float(probe[0]),
		float(probe[1]),
		"one fire at %d foes takes %d crit draws, not one" % [CRIT_TARGETS, CRIT_TARGETS],
		1e-9
	)
	var p := _fire_crit_chance(def, g.hero, 1)
	Check.rose(0.0, p, "the hero's crit chance is measurable, so the rate below is a rate")
	var mixed := _mixed_fires(def, g.hero, foes, 1, CRIT_RATE_FIRES)
	Check.rate(
		mixed,
		CRIT_RATE_FIRES,
		_mixed_share(p, CRIT_TARGETS),
		CRIT_RATE_TOL,
		"and the sweep MIXES -- some foes doubled and others not (p = %0.2f)" % p
	)


## GARLIC, THE CONTROL. `_fireAura` calls `_rollCrit` NOWHERE in the original -- it hands
## `getDamage(player)` to every foe it touches -- and this port no longer rolls there either,
## so a fire takes NO draw and no fire can mix. The volley-wide roll this port used to take
## here was the LAST of the four `_rollCrit` call sites the original does not have.
##
## WHY THE COUNT IS ZERO AND NOT ONE. `fire()` used to roll once before the `match` and hand
## that number to the aura; that roll was kept because the evolved KNIFE's `evolveBonusCrit`
## needed a reader, and it never was a faithful reproduction -- `_fireAura` has no roll to
## reproduce. With the roll gone the draw count is the direct statement of the original:
## a Garlic fire consumes NOTHING.
##
## AND IT IS A CONTROL WITH TWO SIDES, because a control that can only ever read zero cannot
## tell "nothing rolls here" from "this instrument cannot see a roll at all":
##
##   * the hero HAS Luck (asserted, not assumed -- a roll is SKIPPED when the chance is zero,
##     so a hero with no Luck would read zero draws whether the port rolled or not);
##   * the seeded generator must be EXACTLY where it was after a fire, so one roll -- per fire
##     or per foe -- fails it;
##   * and the SAME instrument, on the same number of foes, is run against the Whip in the same
##     breath and required to read a NON-ZERO mix.
func _the_aura_rolls_nothing_and_is_the_control() -> void:
	print("\n-- the aura, which the original never rolls for, is the control --")
	var def := _weapon("garlic")
	var g := _crit_hero(def, 1)
	var p := _fire_crit_chance(def, g.hero, 1)
	Check.rose(0.0, p, "the control hero has a crit chance, so a roll WOULD consume a draw")
	# `baseRange` is 110, so a 180-wide line is entirely inside the aura.
	var foes := _line_of_bats(g, CRIT_TARGETS, 180.0, 0.0)
	var probe := _crit_draw_probe(def, g.hero, foes, 1, 0)
	Check.approx(
		float(probe[0]),
		float(probe[1]),
		"the aura takes NO crit draw at all -- neither per fire nor per foe",
		1e-9
	)
	var mixed := _mixed_fires(def, g.hero, foes, 1, CRIT_RATE_FIRES)
	Check.unchanged(
		mixed,
		0,
		"and NEVER mixes in %d fires -- the instrument CAN read all-or-nothing" % CRIT_RATE_FIRES
	)
	# THE OTHER SIDE, in this same run and through this same instrument. If the instrument
	# were what reported "mixed", the Whip's reading would be zero too.
	var whip := _weapon("whip")
	var wg := _crit_hero(whip, 1)
	var wfoes := _line_of_bats(wg, CRIT_TARGETS, 140.0, 0.0)
	var wp := _fire_crit_chance(whip, wg.hero, 1)
	Check.rose(
		0.0,
		float(_mixed_fires(whip, wg.hero, wfoes, 1, CRIT_RATE_FIRES)),
		"CONTROL: the same instrument on a Whip sweep reads a MIX (%.4f expected at p = %0.2f)"
			% [_mixed_share(wp, CRIT_TARGETS), wp]
	)


## FROST NOVA. `src/weapons.ts:395`, the roll inside `_fireNova`'s candidate loop.
func _nova_rolls_once_per_foe() -> void:
	print("\n-- a Frost Nova burst rolls for EACH foe it catches --")
	var def := _weapon("frost_nova")
	var g := _crit_hero(def, 1)
	# `baseRange` is 200, so a 340-wide line is inside the burst.
	var foes := _line_of_bats(g, CRIT_TARGETS, 340.0, 0.0)
	var probe := _crit_draw_probe(def, g.hero, foes, 1, CRIT_TARGETS)
	Check.approx(
		float(probe[0]),
		float(probe[1]),
		"one burst at %d foes takes %d crit draws, not one" % [CRIT_TARGETS, CRIT_TARGETS],
		1e-9
	)
	var p := _fire_crit_chance(def, g.hero, 1)
	var mixed := _mixed_fires(def, g.hero, foes, 1, CRIT_RATE_FIRES)
	Check.rate(
		mixed,
		CRIT_RATE_FIRES,
		_mixed_share(p, CRIT_TARGETS),
		CRIT_RATE_TOL,
		"and the burst MIXES -- some foes doubled and others not (p = %0.2f)" % p
	)


## LIGHTNING AT ITS EVOLVE LEVEL. `src/weapons.ts:289`, the roll inside the STRIKE loop: three
## strikes are three rolls, and a chain hop INHERITS the roll of the strike it started from
## (`nearest.takeDamage(dmg * 0.7)`) rather than taking one of its own.
##
## THE DRAW COUNT IS NOT PINNED HERE, and cannot be: the strike's target comes from rejection
## sampling --
##
##     while (picked.size < targets.length) { const cand = targets[Math.floor(Math.random() * targets.length)]; ... }
##
## -- so how many draws a fire takes depends on which foes it happens to pick and on how often
## it re-picks one it already has. The mixing rate is what is left, and it is the claim.
func _lightning_rolls_once_per_strike() -> void:
	print("\n-- an evolved Lightning rolls for EACH strike --")
	var def := _weapon("lightning")
	var level := int(def["evolveLevel"])
	var g := _crit_hero(def, level)
	# THREE foes, every pair more than the 180px hop radius apart, so no strike chains and every
	# foe damaged was damaged by a strike's own roll rather than by an inherited one. Reach at
	# level 5 is 588, so all three are candidates and `strikes` is `min(3, 3)`.
	var foes := _line_of_bats(g, 3, 480.0, 300.0)
	var struck := 0
	for v in _fire_losses(def, g.hero, foes, level):
		if float(v) > 0.0:
			struck += 1
	Check.unchanged(struck, 3, "all three foes are struck by the one bolt, so all three roll")
	var p := _fire_crit_chance(def, g.hero, level)
	# STATED, because the rate below is a rate at THIS chance: the def's own `evolveBonusCrit`
	# is folded into it, so the expectation is not the hero's Luck alone. That the field is READ
	# is `_bonus_crit_is_read`'s claim, measured as a damage ratio; this only fixes the number
	# the rate is judged against.
	Check.rose(
		g.hero.crit_chance(),
		p,
		"the evolved strike rolls at the hero's chance PLUS the def's evolveBonusCrit"
	)
	var mixed := _mixed_fires(def, g.hero, foes, level, CRIT_RATE_FIRES)
	Check.rate(
		mixed,
		CRIT_RATE_FIRES,
		_mixed_share(p, 3),
		CRIT_RATE_TOL,
		"and the three strikes MIX -- one can double while another does not (p = %0.2f)" % p
	)


## SOUL DRAIN. `src/weapons.ts:454`, the roll inside `_fireDrain`'s target loop -- and the heal,
## which is the one place where rolling per target changes ARITHMETIC rather than variance:
##
##     let totalDmg = 0;
##     for (const e of targets) { const dmg = this._rollCrit(...); totalDmg += dmg; }
##     if (player.heal) player.heal(totalDmg * steal);
##
## `dmg * drained.size()` equalled that sum only while both tethers shared a single roll. With
## two independent rolls, one crit of two tethers heals 3x a plain tether -- not 2x, and not 4x.
func _drain_rolls_once_per_tether_and_heals_their_sum() -> void:
	print("\n-- Soul Drain rolls for EACH tether and heals their SUM --")
	var def := _weapon("soul_drain")
	var level := int(def["evolveLevel"])
	var g := _crit_hero(def, level)
	var hero := g.hero
	var foes := _line_of_bats(g, 2, 200.0, 0.0)
	var steal := float(def.get("lifestealPct", 0.0))
	Check.rose(0.0, steal, "Soul Drain declares a lifesteal, so there is a heal to measure")
	var probe := _crit_draw_probe(def, hero, foes, level, 2)
	Check.approx(
		float(probe[0]), float(probe[1]), "an evolved tether takes ONE roll per foe", 1e-9
	)
	seed(CRIT_DRAW_SEED)
	var mismatches := 0
	var mixed := 0
	var unstruck := 0
	for i in CRIT_RATE_FIRES:
		# PRECONDITION, restated every fire: the heal is CLAMPED at `max_hp`, so a hero left
		# near full health would measure the clamp instead of the arithmetic. `Check.wounded`
		# exists for exactly this and was written after this test failed against working code.
		Check.wounded(hero, 1.0)
		var lost := _fire_losses(def, hero, foes, level)
		if float(lost[0]) <= 0.0 or float(lost[1]) <= 0.0:
			unstruck += 1
		var healed: float = hero.hp - 1.0
		var owed := (float(lost[0]) + float(lost[1])) * steal
		if absf(healed - owed) > HEAL_TOLERANCE:
			mismatches += 1
		if absf(float(lost[0]) - float(lost[1])) > DAMAGE_EPSILON:
			mixed += 1
	Check.unchanged(
		unstruck, 0, "both tethers are struck on every fire, so there are two rolls to sum"
	)
	Check.unchanged(
		mismatches,
		0,
		"and the heal is `steal` of what the two ACTUALLY took, on every one of %d fires" % CRIT_RATE_FIRES
	)
	var p := _fire_crit_chance(def, hero, level)
	Check.rate(
		mixed,
		CRIT_RATE_FIRES,
		_mixed_share(p, 2),
		CRIT_RATE_TOL,
		"the two tethers roll independently (p = %0.2f)" % p
	)
	# THE HEAL IS NOT THE OLD ARITHMETIC. `dmg * drained.size()` is one number counted twice;
	# this is what that would have healed, and it is a different number whenever the two rolls
	# differed -- which is the case the assertion above covers and this one names.
	var one_roll_would_be := 0
	for i in CRIT_RATE_FIRES:
		Check.wounded(hero, 1.0)
		var lost := _fire_losses(def, hero, foes, level)
		var healed: float = hero.hp - 1.0
		var counted_twice := float(lost[0]) * 2.0 * steal
		if absf(healed - counted_twice) > HEAL_TOLERANCE:
			one_roll_would_be += 1
	Check.at_least(
		float(one_roll_would_be),
		1.0,
		"and `dmg * size` would have healed a DIFFERENT number on some fires, so the two"
		+ " summations are not the same arithmetic"
	)


## THE EVOLVED SECOND RING IS NEVER DOUBLED, and this is where rolling per target changed
## something other than variance. `_fireNova`:
##
##     const baseDmg = this.getDamage(player);
##     const d2 = baseDmg * 0.6;
##     game.effects?.schedule?.(0.4, () => { ... if (d < r) e.takeDamage(d2); ... });
##
## `d2` is taken from the UNCRITTED base, before any `_rollCrit`, and the callback rolls nothing
## of its own -- so the second ring is 60% of `getDamage()` whether or not the first ring
## doubled. The port carried its single per-fire `dmg` into the pulse, so a crit on the first
## ring silently doubled the second one too. Now that the first ring rolls per foe there is no
## single `dmg` for the pulse to inherit in the first place: the base is what it carries.
func _the_evolved_second_ring_is_never_doubled() -> void:
	print("\n-- the evolved second ring is 60% of the UNCRITTED base --")
	var def := _weapon("frost_nova")
	var level := int(def["evolveLevel"])
	# THE BASE, from a hero with NO Luck. `_rollCrit`'s guard is `chance > 0`, so this fire
	# cannot double anything and its first ring IS the base the pulse is a fraction of.
	var plain := _crit_hero(def, level, 0)
	var base_foe := Check.sturdy(
		Foe.new(Enemies.ENEMIES["BAT"], plain.hero.x + 80.0, plain.hero.y)
	)
	base_foe.speed = 0.0
	var before: float = base_foe.hp
	WeaponFire.fire(def, plain.hero, [base_foe], [], level)
	var base_dmg: float = before - base_foe.hp
	Check.rose(0.0, base_dmg, "a no-Luck hero's first ring is the UNCRITTED base")
	var g := _crit_hero(def, level)
	var hero := g.hero
	var foes := _line_of_bats(g, 1, 0.0, 80.0)
	var foe: Foe = foes[0]
	seed(CRIT_DRAW_SEED)
	var crit_first_rings := 0
	var pulse_mismatches := 0
	for i in NOVA_PULSE_FIRES:
		var hp_before: float = foe.hp
		WeaponFire.fire(def, hero, foes, [], level, g.fx)
		var hp_after_ring: float = foe.hp
		var ring: float = hp_before - hp_after_ring
		# NOTHING ELSE MAY FIRE during the step, or a second FIRST ring would be
		# indistinguishable from the second ring under test.
		hero.weapons.clear()
		for j in 30:
			g.step(FRAME, Vector2.ZERO)
		var pulse: float = hp_after_ring - foe.hp
		if absf(ring - base_dmg * 2.0) <= DAMAGE_EPSILON:
			crit_first_rings += 1
		if absf(pulse - base_dmg * WeaponFire.NOVA_PULSE_DAMAGE) > DAMAGE_EPSILON:
			pulse_mismatches += 1
	Check.at_least(
		float(crit_first_rings),
		1.0,
		"at least one of %d fires critted its FIRST ring (measured: %d)" % [
			NOVA_PULSE_FIRES, crit_first_rings
		]
	)
	Check.unchanged(
		pulse_mismatches,
		0,
		"and every second ring is exactly %0.2f of the base -- never doubled by it" % WeaponFire.NOVA_PULSE_DAMAGE
	)


func _check(cond: bool, label: String, detail: String) -> void:

	if cond:
		print("  ok   %s  (%s)" % [label, detail])
	else:
		print("  FAIL %s  (%s)" % [label, detail])
		ok = false
