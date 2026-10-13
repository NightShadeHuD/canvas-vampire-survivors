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

func _check(cond: bool, label: String, detail: String) -> void:
	if cond:
		print("  ok   %s  (%s)" % [label, detail])
	else:
		print("  FAIL %s  (%s)" % [label, detail])
		ok = false
