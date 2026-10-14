## Firing one weapon, by archetype.
##
## Split out of `game.gd` because the eight archetypes are eight small behaviours and
## `game.gd` is the loop that owns them. Everything here is a pure function of the
## world it is handed -- no nodes, no drawing -- so `verify_weapons.gd` can fire each
## archetype at a known target and assert what happened.
##
## Ported from `Weapon.fire` and its per-type branches in `src/weapons.ts`.
extends RefCounted
class_name WeaponFire

## How fast a projectile travels. `speed` is on the weapon data where it has one; the
## rest fall back to this, which is the original's default for a thrown attack.
const DEFAULT_SPEED := 420.0
## How fast an orbiting shard sweeps, in radians per second.
const ORBIT_SPIN := 2.4
## The original's melee sweep half-height: `if (Math.abs(dy) > 40) continue;` in
## `_fireMelee`. Named rather than written twice, because the band that DAMAGES and the
## band that is DRAWN have to be the same band.
const MELEE_HALF_HEIGHT := 40.0
## How far a Lightning chain hop reaches: `if (d < 180 && d < minD)` in `_fireInstant`.
const CHAIN_RADIUS := 180.0
## What a hop deals, as a fraction of the strike's damage: `nearest.takeDamage(dmg * 0.7)`.
const CHAIN_DAMAGE := 0.7
## The weapon level the chain starts at: `if (this.def.chain && this.level >= 3)`.
const CHAIN_LEVEL := 3

# ---------------------------------------------------------------------------
# EVOLUTION
#
# `Weapon.isEvolved` in `src/weapons.ts`:
#
#     return !!this.def.evolveLevel && this.level >= this.def.evolveLevel;
#
# -- ONE threshold, read once per fire and passed to every branch below, rather than
# each archetype re-deriving "is this weapon level 5". The five `evolve*` fields are on
# the defs in `src/data.ts` and reach this file through `godot/data/weapons.gd`, which
# the exporter generates from the same source, so there is nothing to hand-copy.
#
# Every constant below is a literal the ORIGINAL writes inline. They are named here so
# the number has one home, and `verify_weapons.gd` drives the real table rather than a
# hand-written list of weapons -- a def added with `evolveLevel` and no branch fails
# there the moment it is added.
# ---------------------------------------------------------------------------

## How much wider the evolved projectile fan is: `_fireProjectile`'s
## `const spreadDeg = count > 1 ? (this.isEvolved() ? 24 : 14) : 0;`. A RATIO, because
## the fan this port draws is a fraction of the original's absolute one -- see the
## note at the spread itself for why that absolute width is not reproduced.
const FAN_EVOLVED_RATIO := 24.0 / 14.0
## `_fireInstant`: `const strikes = evolved ? Math.min(3, targets.length) : 1;`
const EVOLVED_STRIKES := 3
## `_fireInstant`: `const chainCount = evolved ? this.def.chainCount + 2 : ...`
const EVOLVED_CHAIN_BONUS := 2
## `getOrbitShardCount`: `if (this.isEvolved()) n = n * 2;`
const EVOLVED_SHARD_MULT := 2
## `getOrbitShardCount`'s own bound: `return Math.min(12, n + extra);`
const SHARD_CAP := 12
## The passive whose stacks buy an extra shard: `player.passives?.cooldown?.count`.
const SHARD_PASSIVE := "cooldown"
## `_fireDrain`: `const targetCount = this.isEvolved() ? 2 : 1;`
const EVOLVED_DRAIN_TARGETS := 2
## `_fireMine`'s evolved cluster: a second charge `60` px away at `radius * 0.8`.
const CLUSTER_OFFSET := 60.0
const CLUSTER_RADIUS_MULT := 0.8
## `_fireNova`'s evolved second ring: `schedule(0.4, ...)` at `baseDmg * 0.6`.
const NOVA_PULSE_DELAY := 0.4
const NOVA_PULSE_DAMAGE := 0.6

## The reach a weapon fires with, in ONE place.
##
##     baseRange * (1 + (level - 1) * 0.1) * areaMult
##
## -- `Weapon.getRange` in `src/weapons.ts`. A function rather than a line inside `fire`
## because `main.gd` DRAWS one of these: the Garlic ring. That ring was drawn at
## `weapon["baseRange"]`, so after five Area passives the aura reached 177 and the ring
## stopped at 110 -- a behavioural audit measured a foe 150px away taking damage from
## outside the drawn ring, which is a drawing that lies about what the code does. One
## formula with two callers cannot disagree with itself.
static func reach_for(weapon: Dictionary, hero: Hero, level: int) -> float:
	var lv: float = maxf(1.0, float(level))
	return float(weapon["baseRange"]) * (1.0 + (lv - 1.0) * 0.1) * hero.area_mult()

## IS THIS WEAPON EVOLVED?
##
##     return !!this.def.evolveLevel && this.level >= this.def.evolveLevel;
##
## -- `Weapon.isEvolved` in `src/weapons.ts`. `>=` and not `==`, so a weapon that is
## somehow pushed past its evolve level stays evolved; the `!!` is a truthiness guard
## on an OPTIONAL field, reproduced as `> 0.0` -- absent and `0` both mean "this
## weapon does not evolve", which is Garlic in `src/data.ts`.
static func is_evolved(weapon: Dictionary, level: int) -> bool:
	var at := float(weapon.get("evolveLevel", 0))
	return at > 0.0 and float(level) >= at

## The cooldown a weapon re-arms to, in ONE place.
##
##     baseCooldown * 0.92^(level - 1) * player.cooldownMult()   [* evolveCooldownMult]
##
## -- `Weapon.getCooldown` in `src/weapons.ts`. `game.gd` held this formula inline and
## is its only caller; it calls this now, because the evolves-cooldown branch is a
## second reader of the same curve and two call sites is how a timer and a number
## drift apart. Twin Arc's `evolveCooldownMult` (0.95) is the only one in the data.
static func cooldown_for(weapon: Dictionary, hero: Hero, level: int) -> float:
	var lv: float = maxf(1.0, float(level))
	var cd := float(weapon["baseCooldown"]) * pow(0.92, lv - 1.0) * hero.cooldown_mult()
	if is_evolved(weapon, level) and float(weapon.get("evolveCooldownMult", 0.0)) != 0.0:
		cd *= float(weapon["evolveCooldownMult"])
	return cd

## HOW MANY ORBIT SHARDS: `Weapon.getOrbitShardCount`.
##
##     let n = (base ? base : 0) + Math.floor((this.level - 1) / 2);
##     if (this.isEvolved()) n = n * 2;
##     const extra = Math.floor((player.passives?.cooldown?.count || 0) / 2);
##     return Math.min(12, n + extra);
##
## Orbit is the one archetype whose projectile count is NOT `_fireProjectile`'s: the
## original reads this function for it, and the doubled evolved count is the whole of
## Twin Halo's shape change. All four lines are here, including the Cooldown-passive
## synergy, which is a real term of the same expression rather than a separate claim.
static func orbit_count(weapon: Dictionary, hero: Hero, level: int) -> int:
	var lv: float = maxf(1.0, float(level))
	var n: int = int(weapon.get("projectileCount", 0)) + int(floor((lv - 1.0) / 2.0))
	if is_evolved(weapon, level):
		n *= EVOLVED_SHARD_MULT
	var extra := int(floor(float(hero.passive_count(SHARD_PASSIVE)) / 2.0))
	return mini(SHARD_CAP, n + extra)

## Fire one weapon. Returns the shots it created, which the caller owns.
##
## `nearest` is the foe to aim at, or null. A projectile with no target is not fired
## rather than fired at nothing -- the original does the same, and a knife thrown into
## empty space reads as a bug to the player.
##
## `rng` is the generator an archetype draws from when it needs one -- Lightning's random
## target is the only one today. Null means the GLOBAL generator: Godot seeds it from the
## device when the project runs, so play stays unpredictable, and only a caller that
## passes a seeded generator gets a pinned sequence. `Upgrades._next_index` is the same
## contract, and `verify_weapons.gd` is the caller that pins one.
static func fire(
	weapon: Dictionary, hero: Hero, foes: Array, shots: Array, level: int = 1, fx: Fx = null,
	rng: RandomNumberGenerator = null
) -> Array:
	# `fx` is the visual sink: the caller owns it, and a caller with no interest in
	# drawing (the headless suites) passes nothing. A weapon that applies damage directly
	# creates no `Shot`, and without this it left nothing on screen at all.
	var created: Array = []
	var kind: String = str(weapon["type"])
	# The hero's passives, applied HERE rather than at each archetype. This is the hook
	# the weapon commit recorded as missing: `damageMult`, `areaMult` and `cooldownMult`
	# had no port, so Might/Area/Cooldown did nothing when taken.
	# THE WEAPON'S OWN LEVEL, from `src/weapons.ts`.  A behavioural audit measured this
	# as absent: knife and whip at weapon level 1 and level 5 produced identical damage
	# (12.0), identical shot life (0.677s) and identical rates (24 shots in 10s).
	#
	# The level-up UI offers "Lv.2", "Lv.3" and "MAXED", so a player was choosing between
	# offers that did nothing. The original scales damage +20%/level, cooldown x0.92^(n-1),
	# range +10%/level and +1 projectile per 2 levels; only the passives were ported.
	var lv: float = maxf(1.0, float(level))
	var lv_damage := 1.0 + (lv - 1.0) * 0.2
	# THE THRESHOLD, read once. Every branch below takes it as a parameter rather than
	# asking again -- a second derivation of "is this weapon evolved" is a second thing
	# to keep in step, and `src/weapons.ts` has exactly one (`Weapon.isEvolved`).
	var evolved := is_evolved(weapon, level)

	var dmg := float(weapon["baseDamage"]) * lv_damage * hero.damage_mult()
	# `getDamage`: `if (this.isEvolved() && this.def.evolveDamageMult) base *= ...`.
	# Twin Halo's +10% is the only one in the data, and it is a SCALAR on the damage
	# the level curve already produced, not a replacement for it.
	if evolved and float(weapon.get("evolveDamageMult", 0.0)) != 0.0:
		dmg *= float(weapon["evolveDamageMult"])
	# A crit doubles. `luck` is the only source and a base hero has none -- and the
	# guard is on the SUM, because `_rollCrit` adds the weapon's own bonus BEFORE it
	# rolls:
	#
	#     let chance = player.getCritChance();
	#     if (this.isEvolved() && this.def.evolveBonusCrit) chance += ...;
	#     if (chance > 0 && Math.random() < chance) { const dmg = baseDamage * 2; ... }
	#
	# An evolved Knife (+10%) or Thunder Call (+15%) therefore rolls for a hero with no
	# Luck at all. Guarding on `hero.crit_chance() > 0.0` -- which is what this line did
	# -- would make `evolveBonusCrit` unreachable for exactly the hero it was written
	# for, and the field would look ported while doing nothing.
	var crit := hero.crit_chance()
	if evolved and float(weapon.get("evolveBonusCrit", 0.0)) != 0.0:
		crit += float(weapon["evolveBonusCrit"])
	if crit > 0.0 and randf() < crit:
		dmg *= 2.0
	var reach := reach_for(weapon, hero, level)
	# +1 projectile per 2 weapon levels, floored -- `_fireProjectile`'s own count.
	var count: int = int(weapon.get("projectileCount", 1)) + int(floor((lv - 1.0) / 2.0))
	# And its two evolved id-specific bonuses, as the original's own two `if`s. A Knife
	# becomes Blade Fan at no fewer than FIVE blades; a Magic Wand gains two.
	if evolved and str(weapon["id"]) == "knife":
		count = maxi(count, 5)
	if evolved and str(weapon["id"]) == "magic_wand":
		count += 2

	match kind:
		"projectile":
			created = _fire_projectiles(weapon, hero, foes, reach, dmg, count, evolved)
		"orbit":
			# `getOrbitShardCount`, NOT the projectile count above: orbit is the one
			# archetype the original counts differently, and at level 5 it DOUBLES.
			created = _fire_orbit(hero, reach, dmg, orbit_count(weapon, hero, level))
		"melee":
			# THE ORIGINAL'S SWEEP IS A BAND, NOT A DISC -- until level 5, where the band
			# is replaced by `Math.hypot(dx, dy) > range`, a full circle. `_strike_sweep`
			# owns both shapes and both bursts, so the shape DRAWN and the shape APPLIED
			# cannot come from two different places.
			_strike_sweep(hero, foes, reach, dmg, evolved)
			if fx != null:
				if evolved:
					# `game.createParticles(player.x, player.y, '#ff6644', 12)` -- the
					# MIRRORED burst, at the hero rather than at the two ends of a band
					# that no longer exists, and in `#ff6644` rather than `#ffaa00`. The
					# circle the damage covered is drawn at `reach` for the same reason
					# the band is at level 1-4: a shape applied one way and drawn another
					# is a drawing that lies about what the code did.
					fx.emit_particles(hero.x, hero.y, Color("ff6644"), 12)
					fx.emit_ring(hero.x, hero.y, reach, Color("ff6644"))
				else:
					fx.emit_sweep(hero.x, hero.y, reach, MELEE_HALF_HEIGHT, Color("ffaa00"))
					fx.emit_particles(hero.x - reach / 2.0, hero.y, Color("ffaa00"), 5)
					fx.emit_particles(hero.x + reach / 2.0, hero.y, Color("ffaa00"), 5)
		"aura":
			_strike_all_in_range(hero, foes, reach, dmg)
			# `createParticles(player.x + cos(a) * r, player.y + sin(a) * r, '#88ff88', 1)`
			# on 40% of fires -- a RATE in the original too, so a fire that emits nothing
			# is correct rather than broken. The ring `main.gd` draws is the constant, and
			# it is drawn at `reach_for`, which is the same number this struck with.
			if fx != null and randf() < 0.4:
				var aura_angle := randf() * TAU
				var aura_r := randf() * reach
				fx.emit_particles(
					hero.x + cos(aura_angle) * aura_r,
					hero.y + sin(aura_angle) * aura_r,
					Color("88ff88"),
					1
				)
		"nova":
			# `slowPct` (0.5) and `slowDuration` (1.2) are on the data and `src/entities.ts`
			# reads them (`slowTimer`/`slowPct`, with `#88ccff` tinting in
			# `entity-render.ts`), but `Foe` here has no slow field at all -- so Frost Nova
			# damages and does not slow. REPORTED, NOT FIXED: a slow is a gameplay change
			# and this round is a drawing one.
			_strike_all_in_range(hero, foes, reach, dmg)
			if fx != null:
				# `createParticles(player.x, player.y, '#aaeeff', 24)`, reproduced. The ring
				# is NOT in the original -- `RingPulse` exists in `src/effects.ts` and nova
				# does not call it -- and it is drawn because a nova IS its radius.
				fx.emit_particles(hero.x, hero.y, Color("aaeeff"), 24)
				fx.emit_ring(hero.x, hero.y, reach, Color("aaeeff"))
			# THE EVOLVED SECOND RING. `_fireNova`:
			#
			#     const r = range;
			#     const d2 = baseDmg * 0.6;
			#     game.effects?.schedule?.(0.4, () => { ... if (d < r) e.takeDamage(d2); ... });
			#
			# `r` and `d2` are captured at FIRE time -- the original says so in as many
			# words, "so a stat change between pulses doesn't retro-buff" -- and the
			# CENTRE is read when the callback RUNS, so a hero who walked away takes the
			# second ring where they are standing. The pulse carries those two numbers
			# and `Game.step` lands it, which is the port of `effects.schedule`.
			if evolved and fx != null:
				fx.schedule_pulse(NOVA_PULSE_DELAY, reach, dmg * NOVA_PULSE_DAMAGE)
		"instant":
			# A RANDOM foe, and then the chain. `_fireInstant` in `src/weapons.ts`:
			#
			#     const cand = targets[Math.floor(Math.random() * targets.length)];
			#     if (this.def.chain && this.level >= 3) { ... d < 180 ... dmg * 0.7 ... }
			#
			# The port used to strike the NEAREST and never chain, and `verify_weapons.gd`
			# ASSERTED that nearest-target behaviour -- a test pinning what the data
			# contradicts. `src/data.ts` says "Smites a random foe. Lv3+ chains." The code
			# and that assertion are replaced together; `_fire_instant` below carries the
			# rest of the original, quoted rather than invented.
			var hits := _fire_instant(weapon, hero, foes, reach, dmg, level, rng, evolved)
			if fx != null:
				# `createParticles(target.x, target.y, '#ffff66', 14)` runs INSIDE the
				# original's strike loop and `8` runs inside its chain loop, so EVERY foe
				# the bolt touches leaves a burst of its own -- the strike AND each hop --
				# and the player can see which foes were hit. The size travels with the
				# foe: one number for both would draw a hop as loudly as the bolt that
				# began it, which is a drawing that lies about what happened.
				for hit in hits:
					var hit_foe: Foe = hit["foe"]
					fx.emit_particles(hit_foe.x, hit_foe.y, Color("ffff66"), int(hit["sparks"]))
		"drain":
			#     const targetCount = this.isEvolved() ? 2 : 1;
			#
			# NOT the projectile count, which is what this passed: Soul Drain tethered a
			# second foe from weapon level 3 and a third from level 5, so the weapon had
			# two extra beams before it evolved and the evolution itself was invisible.
			# The original's one tether becomes two only at `evolveLevel`.
			var draining := EVOLVED_DRAIN_TARGETS if evolved else 1
			var drained := _strike_nearest(hero, foes, reach, dmg, draining)
			# Soul Drain heals on tick -- `lifestealPct` is on the data -- for
			# `totalDmg * steal`, summed over what it ACTUALLY drained. Two things were
			# wrong in the one line this replaces: it healed even when nothing was in
			# range (the original returns before the heal when `targets` is empty), and
			# it healed for ONE foe's damage while the evolved weapon drains two.
			var pct: float = float(weapon.get("lifestealPct", 0.0))
			if pct > 0.0 and not drained.is_empty():
				hero.hp = minf(hero.hp + dmg * float(drained.size()) * pct, hero.max_hp)
			if fx != null:
				for foe in drained:
					# The original's own tether visual, reproduced exactly: two sparks at
					# the MIDPOINT. `src/weapons.ts` calls it a "cheap 'tether' visual".
					fx.emit_particles(
						(hero.x + foe.x) / 2.0, (hero.y + foe.y) / 2.0, Color("ff88cc"), 2
					)
					fx.emit_beam(hero.x, hero.y, foe.x, foe.y, Color("ff88cc"))
		"mine":
			# A mine this slice treats as a delayed nova: the fuse is real in the data
			# and the arming behaviour is not ported, so it strikes immediately rather
			# than pretending to arm. Named here so it is not mistaken for finished.
			_strike_all_in_range(hero, foes, reach, dmg)
			if fx != null:
				# WHAT THE ORIGINAL DRAWS, and what it therefore cannot be reproduced as:
				# `renderMine` fills the blast radius and paints a 10px body that turns
				# bright red once `armed = fuse < maxFuse * 0.5`. That armed state needs a
				# mine that ARMS, and this port has none -- so the DETONATION is what is
				# reproduced (`Mine.update`: `createParticles(this.x, this.y, '#ff8833', 20)`
				# plus the blast radius the damage used). No fuse is invented for a mine
				# that is already gone.
				fx.emit_particles(hero.x, hero.y, Color("ff8833"), 20)
				fx.emit_blast(hero.x, hero.y, reach, Color("ff8833"))
			if evolved:
				# `_fireMine`'s evolved Cluster Mine, quoted:
				#
				#     const a = Math.random() * Math.PI * 2;
				#     game.mines.push(new Mine(player.x + Math.cos(a) * 60,
				#                              player.y + Math.sin(a) * 60,
				#                              radius * 0.8, dmg, fuse));
				#
				# A SECOND charge at full damage, 60px away, covering 80% of the radius --
				# and a second `Mine.update`, which is where the 20 sparks and the blast
				# disc come from. The angle has no data behind it in the original either,
				# so it is a global draw: what a player sees is two overlapping blasts,
				# not which way round they are.
				var cluster_angle := randf() * TAU
				var cluster_x := hero.x + cos(cluster_angle) * CLUSTER_OFFSET
				var cluster_y := hero.y + sin(cluster_angle) * CLUSTER_OFFSET
				var cluster_reach := reach * CLUSTER_RADIUS_MULT
				_strike_disc(cluster_x, cluster_y, foes, cluster_reach, dmg)
				if fx != null:
					fx.emit_particles(cluster_x, cluster_y, Color("ff8833"), 20)
					fx.emit_blast(cluster_x, cluster_y, cluster_reach, Color("ff8833"))
		_:
			push_warning("weapon archetype '%s' has no implementation" % kind)

	shots.append_array(created)
	return created

static func _fire_projectiles(
	weapon: Dictionary, hero: Hero, foes: Array, reach: float, dmg: float, count: int,
	evolved: bool
) -> Array:
	var target = nearest_to(hero.x, hero.y, foes, reach)
	if target == null:
		return []
	var speed: float = float(weapon.get("speed", DEFAULT_SPEED))
	# Boomerangs return to the THROWER, so they need to remember where from.
	var boomerang: bool = bool(weapon.get("boomerang", false))
	var out: Array = []
	for i in count:
		# A fan: several projectiles spread around the aim direction, so a three-knife
		# volley reads as a volley rather than one knife drawn three times.
		# A TIGHT fan, and tight is load-bearing rather than cosmetic.
		#
		# Two attempts got this wrong in the same direction. +/-0.25 rad put both
		# blaster shots either side of a bat; +/-0.12 still missed at 192px, because a
		# shot only connects within `radius + foe.size` (18px) and 0.12 rad spreads to
		# 23px there. A weapon that looks implemented and deals no damage is worse than
		# one that is obviously absent.
		#
		# 0.04 rad each side is ~2.3 degrees: 7px at 192px, comfortably inside the hit
		# radius, and still visibly a fan at range.
		#
		# AND THE EVOLVED FAN IS WIDER, by the original's own ratio:
		#
		#     const spreadDeg = count > 1 ? (this.isEvolved() ? 24 : 14) : 0;
		#
		# WHAT IS NOT FAITHFUL, stated rather than glossed: the original's width is
		# ABSOLUTE -- `(i - (count - 1) / 2) * spreadDeg` degrees apart per blade, so an
		# evolved Blade Fan spans +/-48 degrees -- and this port's is a fraction of that
		# (see the paragraph above: the original's own 14-degree fan already misses a
		# lone foe at 192px through THIS projectile geometry). The DIRECTION and the
		# RATIO are the original's; the absolute width is the port's, and a fan that
		# visibly widens is the part a player can see.
		var width := 0.08 * (FAN_EVOLVED_RATIO if evolved else 1.0)
		var spread := 0.0
		if count > 1:
			spread = (float(i) / float(count - 1) - 0.5) * width
		var dir: Vector2 = Vector2(target.x - hero.x, target.y - hero.y).normalized().rotated(spread)
		var s := Shot.new(hero.x, hero.y, dir, dmg, reach, speed, bool(weapon.get("piercing", false)))
		if boomerang:
			s.kind = Shot.Kind.BOOMERANG
			# Half the life outbound, half coming back.
			s.return_after = s.life * 0.5
		out.append(s)
	return out

static func _fire_orbit(hero: Hero, reach: float, dmg: float, count: int) -> Array:
	var out: Array = []
	for i in count:
		out.append(Shot.orbiting(hero.x, hero.y, TAU * float(i) / float(count), reach, dmg, ORBIT_SPIN))
	return out

## THE ORIGINAL'S MELEE SWEEP, AND IT IS NOT A DISC:
##
##     if (Math.abs(dx) > range) continue;
##     if (Math.abs(dy) > 40) continue;
##
## A horizontal band `2 * reach` wide and 80 tall, centred on the hero. This port damaged a
## 360-degree disc instead, and a behavioural audit measured what that costs: on a ring of
## eight foes the original hits the two on the horizontal axis and the disc hits all eight.
##
## The band is DRAWN by `Fx.emit_sweep` from these same two numbers, which is the point of
## the exercise -- a shape drawn one way and applied another is the same lie as a Garlic
## ring that stops short of its aura.
##
## At weapon level 5 the original EVOLVES this into a full circle:
##
##     if (evolved) {
##         if (Math.hypot(dx, dy) > range) continue;   // Full circular sweep
##     } else {
##         if (Math.abs(dx) > range) continue;
##         if (Math.abs(dy) > 40) continue;
##     }
##
## Both shapes live HERE, and the caller draws the one this function used, so the band a
## level-1 Whip applies and the circle a level-5 Whip applies are each drawn at the
## radius they actually reached. A 40px half-height on the evolved sweep would be the
## Garlic ring's lie again, one weapon along.
static func _strike_sweep(hero: Hero, foes: Array, reach: float, dmg: float, evolved: bool) -> void:
	for foe in foes:
		if foe.dead:
			continue
		var dx: float = foe.x - hero.x
		var dy: float = foe.y - hero.y
		if evolved:
			# `Math.hypot(dx, dy) > range`, STRICT: a foe at exactly `reach` is swept.
			if sqrt(dx * dx + dy * dy) > reach:
				continue
		else:
			if absf(dx) > reach:
				continue
			if absf(dy) > MELEE_HALF_HEIGHT:
				continue
		foe.take_damage(dmg)

## Everything within `reach`. Garlic, Frost Nova and Area Mine all land here -- what
## separates them is range and cadence, which is in the data.
static func _strike_all_in_range(hero: Hero, foes: Array, reach: float, dmg: float) -> void:
	_strike_disc(hero.x, hero.y, foes, reach, dmg)

## The same disc, around an arbitrary point rather than the hero. `_strike_all_in_range`
## is this centred on the hero; the evolved Cluster Mine's second charge is the SECOND
## mine's own position, which is the only caller that needs it.
static func _strike_disc(cx: float, cy: float, foes: Array, reach: float, dmg: float) -> void:
	for foe in foes:
		if foe.dead:
			continue
		var dx: float = foe.x - cx
		var dy: float = foe.y - cy
		if sqrt(dx * dx + dy * dy) <= reach:
			foe.take_damage(dmg)

## ONE LIGHTNING STRIKE: a RANDOM foe in range, and then the chain.
##
## WHICH FOE, AND WHY IT IS NOT THE NEAREST
##
##     const cand = targets[Math.floor(Math.random() * targets.length)];
##
## -- `_fireInstant` in `src/weapons.ts`, and `src/data.ts`'s own description of the
## weapon is "Smites a random foe". This port struck the NEAREST instead, and
## `verify_weapons.gd` ASSERTED that: a test pinning the behaviour the data contradicts,
## which is rule 12 upside down. Both are replaced in the same change.
##
## THE CHAIN, QUOTED RATHER THAN INVENTED
##
##     if (this.def.chain && this.level >= 3) {
##         const chainCount = evolved ? this.def.chainCount + 2 : this.def.chainCount;
##         for (let c = 0; c < chainCount; c++) {
##             ... if (d < 180 && d < minD) { minD = d; nearest = e; }
##             if (!nearest) break;
##             nearest.takeDamage(dmg * 0.7);
##             game.createParticles(nearest.x, nearest.y, '#ffff66', 8);
##
## -- the nearest UN-CHAINED foe within 180px of the last one hit, `dmg * 0.7` a hop, at
## most `chainCount` of them. Every one of those four numbers is read here: the flag, the
## level, the count and the radius. None of them is written into the code twice.
##
## WHAT EVOLUTION CHANGES HERE, quoted rather than described:
##
##     const strikes = evolved ? Math.min(3, targets.length) : 1;
##     const chainCount = evolved ? this.def.chainCount + 2 : this.def.chainCount;
##
## -- at `evolveLevel` one bolt smites up to THREE distinct foes and each of those
## strikes chains two hops further. Both are read from the def, so Thunder Call is a
## different weapon rather than a bigger number: `verify_weapons.gd` measures the
## population of foes a single fire damages at level 4 and at level 5.
##
## A DEAD FOE IS NOT A TARGET. The original's hop loop does not check, because its dead
## are swept later in the same frame; every other strike in this file skips the dead, so
## this one does too rather than chaining into a corpse.
##
## Returns `[{"foe": Foe, "sparks": int}]`. The burst SIZE travels with the foe because
## the original emits 14 at the strike and 8 at each hop, and the caller draws both.
static func _fire_instant(
	weapon: Dictionary,
	hero: Hero,
	foes: Array,
	reach: float,
	dmg: float,
	level: int,
	rng: RandomNumberGenerator,
	evolved: bool
) -> Array:
	var targets: Array = []
	for foe in foes:
		if foe.dead:
			continue
		var dx: float = foe.x - hero.x
		var dy: float = foe.y - hero.y
		# STRICT `<`: `if (Math.hypot(e.x - player.x, e.y - player.y) < range)`.
		if sqrt(dx * dx + dy * dy) < reach:
			targets.append(foe)
	if targets.is_empty():
		return []

	var hits: Array = []
	#     const strikes = evolved ? Math.min(3, targets.length) : 1;
	var strikes: int = mini(EVOLVED_STRIKES, targets.size()) if evolved else 1
	#     const picked = new Set();
	var picked: Array = []
	for _strike_index in strikes:
		#     let target: Enemy | null = null;
		#     while (picked.size < targets.length) {
		#         const cand = targets[Math.floor(Math.random() * targets.length)];
		#         if (!picked.has(cand)) { target = cand; picked.add(cand); break; }
		#     }
		#     if (!target) break;
		#
		# TRANSLITERATED, rejection sampling and all: a foe already struck by an earlier
		# strike of the same bolt is never struck twice, and when every candidate has
		# been picked the loop falls out and the remaining strikes do not happen. At
		# level 1 this runs exactly once and consumes exactly one draw -- which is what
		# `verify_weapons.gd` pins when it replays a seeded sequence.
		var struck: Foe = null
		while picked.size() < targets.size():
			var candidate: Foe = targets[_pick_index(rng, targets.size())]
			if not picked.has(candidate):
				struck = candidate
				picked.append(candidate)
				break
		if struck == null:
			break
		struck.take_damage(dmg)
		hits.append({"foe": struck, "sparks": 14})

		if not bool(weapon.get("chain", false)) or level < CHAIN_LEVEL:
			continue
		#     const chainCount = evolved ? this.def.chainCount + 2 : this.def.chainCount;
		#
		# EVERY strike of an evolved bolt chains, and each chain is two hops longer --
		# the `hits` list is what the caller draws, so a chain that is not in it is a
		# chain the player cannot see.
		var hops: int = int(weapon.get("chainCount", 0))
		if evolved:
			hops += EVOLVED_CHAIN_BONUS

		var chained: Array = [struck]
		var current: Foe = struck
		for _hop in hops:
			var nearest: Foe = null
			var min_d := CHAIN_RADIUS
			for foe in foes:
				if foe.dead or chained.has(foe):
					continue
				var hx: float = foe.x - current.x
				var hy: float = foe.y - current.y
				var d: float = sqrt(hx * hx + hy * hy)
				# `d < 180 && d < minD`, with `minD` started AT the radius rather than at
				# Infinity: the same candidate set, one comparison instead of two. STRICT,
				# so a foe at exactly 180px is NOT chained -- `verify_weapons.gd` pins it.
				if d < min_d:
					min_d = d
					nearest = foe
			if nearest == null:
				break
			nearest.take_damage(dmg * CHAIN_DAMAGE)
			hits.append({"foe": nearest, "sparks": 8})
			chained.append(nearest)
			current = nearest
	return hits

## A random index in `[0, n)`, from the generator the CALLER supplied when there is one.
##
## The same three lines as `Upgrades._next_index`, deliberately. One shape for "a random
## index a caller can seed" means a test pins a sequence the same way whichever part of
## the game it is driving, and there is one place to look when one of them is wrong.
##
## `rng == null` is the GLOBAL generator. Godot seeds it from the device at startup --
## measured rather than assumed: `randi()` and `RandomNumberGenerator.new().randi()`
## printed a different first value in each of three separate runs -- so the default is
## unpredictable play, and only a caller that passes a seeded generator gets a pinned
## sequence. `Game.step` passes nothing, which is the point of it.
static func _pick_index(rng: RandomNumberGenerator, n: int) -> int:
	if rng == null:
		return randi() % n
	return rng.randi() % n

## The `count` CLOSEST foes within `reach`. Soul Drain and nothing else -- Lightning used
## to be here and is not any more, because the original does not aim it at the nearest:
## `_fire_instant` above is the random smite plus the chain, and the two are different
## weapons. Hitting the furthest would be a third.
##
## Returns the foes it struck, because `_fireDrain` draws its hit AT the foe -- its two
## sparks are at the tether's midpoint -- and a caller cannot draw that from a count.
static func _strike_nearest(hero: Hero, foes: Array, reach: float, dmg: float, count: int) -> Array:
	var in_range: Array = []
	for foe in foes:
		if foe.dead:
			continue
		var dx: float = foe.x - hero.x
		var dy: float = foe.y - hero.y
		var d: float = sqrt(dx * dx + dy * dy)
		if d <= reach:
			in_range.append({"foe": foe, "d": d})
	in_range.sort_custom(func(a, b): return a["d"] < b["d"])
	var struck: Array = []
	for i in mini(count, in_range.size()):
		in_range[i]["foe"].take_damage(dmg)
		struck.append(in_range[i]["foe"])
	return struck

## A public helper because Lightning's `chain` and the tests both want it.
static func nearest_to(x: float, y: float, foes: Array, max_range: float):
	var best = null
	var best_d := max_range
	for foe in foes:
		if foe.dead:
			continue
		var dx: float = foe.x - x
		var dy: float = foe.y - y
		var d: float = sqrt(dx * dx + dy * dy)
		if d <= best_d:
			best_d = d
			best = foe
	return best
