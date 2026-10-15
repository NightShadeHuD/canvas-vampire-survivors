## Anything a weapon puts into the world: a wand bolt, a knife, a boomerang, an
## orbiting shard.
##
## ONE class rather than five, because the differences are all fields: a knife is a
## fast piercing projectile, a boomerang is one that turns around, an orbit shard is
## one whose position is computed rather than integrated. Splitting them would
## duplicate the collision and lifetime logic five times.
##
## Ported from `Projectile` and `OrbitShard` in `src/entities.ts`.
extends RefCounted
class_name Shot

enum Kind { STRAIGHT, ORBIT, BOOMERANG }

var x: float
var y: float
var vx := 0.0
var vy := 0.0
var damage: float
var radius: float
var pierce: bool
var kind: int = Kind.STRAIGHT
var life: float
var dead := false
## Which foes this shot has already hit, so `pierce` means "hits several" rather
## than "hits the same one every frame".
var hit: Array = []
## Boomerangs fly out until `life` falls below this, then come back.
var return_after := 0.0
## Orbit shards are placed, not integrated.
var orbit_angle := 0.0
var orbit_radius := 0.0
var orbit_speed := 0.0

func _init(
	at_x: float, at_y: float, dir: Vector2, shot_damage: float,
	reach: float, speed: float, can_pierce: bool
) -> void:
	x = at_x
	y = at_y
	damage = shot_damage
	pierce = can_pierce
	vx = dir.x * speed
	vy = dir.y * speed
	radius = 6.0
	# `reach / speed` is how long it takes to cross its own range, which is a better
	# lifetime than a fixed number: a slow knife and a fast bolt both stop where the
	# data says they should.
	life = maxf(reach / maxf(speed, 1.0), 0.1)

## A shard that circles the hero. Its position is a function of the angle, so it
## cannot drift the way an integrated one would.
static func orbiting(hero_x: float, hero_y: float, angle: float, radius: float, shot_damage: float, speed: float) -> Shot:
	var s := Shot.new(hero_x + cos(angle) * radius, hero_y + sin(angle) * radius, Vector2.ZERO, shot_damage, 0.0, 0.0, true)
	s.kind = Kind.ORBIT
	s.orbit_angle = angle
	s.orbit_radius = radius
	s.orbit_speed = speed
	# Orbiting shards die with the weapon's cooldown, not on a range.
	s.life = 1.0
	return s

func update(delta: float, hero_x: float, hero_y: float, origin_x: float, origin_y: float) -> void:
	life -= delta
	if life <= 0.0:
		dead = true
		return

	match kind:
		Kind.ORBIT:
			orbit_angle += orbit_speed * delta
			x = hero_x + cos(orbit_angle) * orbit_radius
			y = hero_y + sin(orbit_angle) * orbit_radius
		Kind.BOOMERANG:
			# OUT first, then back. The first version reversed on frame one, so the
			# throw travelled zero distance and looked like a weapon that did nothing
			# -- which is exactly how it was found.
			#
			# The return leg aims at the THROWER'S SPOT, not at the hero. That is the
			# original's behaviour and it reads better: walk away and the shard returns
			# to where you were, not to where you are.
			if life > return_after:
				x += vx * delta
				y += vy * delta
				return
			var dx: float = origin_x - x
			var dy: float = origin_y - y
			var d: float = sqrt(dx * dx + dy * dy)
			if d < 24.0:
				dead = true
				return
			var speed: float = sqrt(vx * vx + vy * vy)
			x += (dx / d) * speed * delta
			y += (dy / d) * speed * delta
		_:
			x += vx * delta
			y += vy * delta

# ---------------------------------------------------------------------------
# THE PROJECTILE'S OWN PER-HIT CRIT, AND ITS OWN DAMAGE NUMBER
#
# A FIFTH roll site, and the four `_rollCrit` lines in `src/weapons.ts` do not contain it. It
# lives in `Game._updateProjectiles`, on IMPACT rather than on fire:
#
#     src/main.ts:1465-1483
#     for (const enemy of this.spatial.queryRect(p.x, p.y, range)) {
#         if (p.hitEnemies.has(enemy)) continue;
#         const d = Math.hypot(p.x - enemy.x, p.y - enemy.y);
#         if (d < enemy.size + p.size) {
#             let dmg = p.damage;
#             const chance = this.player.getCritChance();
#             const crit = chance > 0 && Math.random() < chance;
#             if (crit) dmg *= 2;
#             enemy.takeDamage(dmg);
#             p.hitEnemies.add(enemy);
#             if (enemy.hp > 0) {
#                 this.createFloatingText(
#                     Math.round(dmg), enemy.x, enemy.y - 20,
#                     crit ? '#ffee44' : '#fff', { crit }
#                 );
#             }
#
# FIVE THINGS ABOUT IT, each of which a reader would otherwise have to guess:
#
#   IT IS PER HIT, NOT PER VOLLEY. The roll is inside the per-enemy loop, so a five-blade fan
#   that touches five foes rolls five times and a piercing knife rolls once per foe it passes
#   through. `_updateProjectiles` is a different function from `_fireProjectile`, and the roll
#   is in the LATER one -- so nothing in `fire()` rolls for a projectile at all.
#
#   IT IS A DIFFERENT ROLL FROM `_rollCrit`. `this.player.getCritChance()` is the HERO's own
#   sum with NO `evolveBonusCrit`, and `dmg` is a LOCAL copy -- `p.damage` is never written
#   back, so a piercing shot's second victim is rolled against the BASE damage rather than
#   against whatever the first victim happened to take.
#
#   `if (enemy.hp > 0)` IS THE FEATURE, not an optimisation. A killing blow draws NO number:
#   the number reports what the foe has left to lose, and there is nothing left. `_rollCrit`'s
#   four sites have no such guard -- they draw before `takeDamage` -- which is a second,
#   independent reason this is not that function.
#
#   THE COLOURS ARE ITS OWN: `'#ffee44'` on a crit and `'#fff'` otherwise. `CRIT_NUMBER` in
#   `weapon-fire.gd` is the same literal on the `_rollCrit` side; `'#fff'` appears nowhere else
#   in the original, so it is named here.
#
#   `{ crit }` still changes the SIZE and the OUTLINE. It is `{crit:true}` on the crit branch
#   of `createFloatingText`, the same flag `_rollCrit` passes.
#
# AND IT DOES NOT COVER ORBIT SHARDS. `game.projectiles` has exactly ONE writer in `src/` --
# `src/weapons.ts:239`, inside `_fireProjectile` -- and `OrbitShard` is NOT one of its
# entries: a shard lives on the WEAPON (`weapon._shards`), is stepped by `weapon.update`, and
# does its damage in `OrbitShard.update`, which rolls NOTHING and draws its own `'#ffffcc'` at
# `e.y - 18` with no `hp > 0` guard. `rolls_on_hit` below is that boundary. Without it this
# port would give the ORBIT archetype a per-hit crit roll the original does not have -- the
# exact class of defect `da96c02` removed from the four archetypes -- and `ROLLING_ARCHETYPES`
# would not catch it, because the Orbiter declares no `evolveBonusCrit` for
# `_bonus_crit_is_read` to measure. See `_orbit_draws_no_number_and_rolls_nothing` in
# `verify_weapons.gd`, which is the assertion that pins it.
# ---------------------------------------------------------------------------

## The crit colour, `'#ffee44'`, on the PROJECTILE's roll. The same literal as
## `weapon-fire.gd`'s `CRIT_NUMBER` and a different roll: two faces of one colour in the
## original, named where each is used rather than shared across the two classes.
const HIT_CRIT_NUMBER := Color("ffee44")
## `'#fff'` -- the original's own short form for white, and the only place it is written.
const HIT_NUMBER := Color("ffffff")
## `enemy.y - 20`, the same 20 the four `_rollCrit` sites use and NOT the shard's 18.
const HIT_NUMBER_DY := -20.0

## TRUE when this shot is one of the original's `game.projectiles` entries, and therefore one
## the impact loop above rolls for. FALSE for an orbit shard, which is a `Shot` in this port
## because ONE class carries both -- `src/` keeps `OrbitShard` on the weapon and out of
## `game.projectiles`, and this predicate is that difference.
func rolls_on_hit() -> bool:
	return kind != Kind.ORBIT

## A float in `[0, 1)` from the generator the CALLER supplied when there is one, and from the
## global one otherwise -- `WeaponFire._randf`'s contract, and a deliberate second copy of it.
## Sharing the one in `weapon-fire.gd` would make this file reference `WeaponFire` while
## `weapon-fire.gd` already references `Shot`, and a cyclic `class_name` dependency is a worse
## cost than these three lines. The BEHAVIOUR is what `verify_weapons.gd` pins, on both paths.
static func _randf(rng: RandomNumberGenerator) -> float:
	if rng == null:
		return randf()
	return rng.randf()


## Apply this shot to any foe it is touching. Returns how many it hit.
##
## `hero` and `fx` ARE REQUIRED RATHER THAN DEFAULTED, for the reason `Foe.body_color`'s `now`
## is: a `hero` that defaulted to null would read as a crit chance of ZERO and silently delete
## the whole feature for a caller that forgot it, and an `fx` that defaulted to null would do
## the same to the number. A required argument is a caller that cannot forget -- and there is
## exactly ONE caller, `Game._update_shots`, which is where the original's loop lives.
func resolve(
	foes: Array, drop: Callable, hero: Hero, fx: Fx, rng: RandomNumberGenerator = null
) -> int:
	var hits := 0
	for foe in foes:
		if foe.dead or hit.has(foe):
			continue
		var dx: float = foe.x - x
		var dy: float = foe.y - y
		if sqrt(dx * dx + dy * dy) <= radius + foe.size:
			var dealt := damage
			if rolls_on_hit():
				# `const chance = this.player.getCritChance();` -- read PER TOUCHED PAIR,
				# which is where the original reads it. `crit_chance()` is a pure sum of the
				# hero's passives, so reading it here rather than once per shot cannot differ
				# in play; it is written here because that is where the original writes it.
				var chance := hero.crit_chance()
				# THE SHORT CIRCUIT IS THE ORIGINAL'S AND IT IS LOAD-BEARING: a hero with no
				# Luck takes NO draw at all, which is what makes a seeded sequence replay.
				var crit := chance > 0.0 and _randf(rng) < chance
				if crit:
					dealt *= 2.0
				foe.take_damage(dealt)
				hit.append(foe)
				# AFTER `hit.append`, and after the damage, which is the original's order --
				# and GUARDED, so a killing blow draws nothing.
				if foe.hp > 0.0:
					fx.emit_text(
						str(roundi(dealt)),
						foe.x,
						foe.y + HIT_NUMBER_DY,
						HIT_CRIT_NUMBER if crit else HIT_NUMBER,
						crit
					)
			else:
				# AN ORBIT SHARD: no roll, no doubling, NO NUMBER. `OrbitShard.update` does
				# `e.takeDamage(this.damage)` and this is that line. Its own
				# `createFloatingText(..., '#ffffcc')` is a separate call site this port does
				# not draw -- reported in `docs/GODOT-PORT.md`, not invented here.
				foe.take_damage(dealt)
				hit.append(foe)
			hits += 1
			if not pierce:
				dead = true
				return hits
	if hits > 0 and drop.is_valid():
		drop.call(self)
	return hits
