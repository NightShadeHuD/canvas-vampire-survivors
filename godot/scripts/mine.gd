## The Area Mine: dropped where the hero stood, armed for `fuse` seconds, then a blast.
##
## Ported from `Mine` in `src/entities.ts:743`, which is the whole of the original's mine:
##
##     export class Mine {
##         constructor(x, y, radius, damage, fuse) {
##             ...; this.fuse = fuse; this.maxFuse = fuse; this.shouldRemove = false;
##         }
##         update(dt, game) {
##             this.fuse -= dt;
##             if (this.fuse <= 0) {
##                 const cands = game?.spatial ? ... : game.enemies;
##                 for (const enemy of cands) {
##                     const d = Math.hypot(enemy.x - this.x, enemy.y - this.y);
##                     if (d < this.radius) { enemy.takeDamage(this.damage); ... }
##                 }
##                 game.createParticles(this.x, this.y, '#ff8833', 20);
##                 game.shake(0.25);
##                 game.audio?.explosion?.();
##                 this.shouldRemove = true;
##             }
##         }
##     }
##
## WHY THIS FILE EXISTS. `src/data.ts:154` declares `"fuse": 1.2` on the Area Mine, so
## `quality-baseline.json` declared `godot-mine-fuse-unread`: the port dealt the blast on the
## FIRE frame and had no mine entity at all, which made the field a number nothing read. This
## is the reader.
##
## THE FUSE STARTS ON PLACEMENT, AND THAT IS THE WHOLE MECHANIC. `Mine.update`'s first line
## is `this.fuse -= dt` and NOTHING guards it: there is no proximity test anywhere in the
## class, so a mine dropped in an empty field detonates on exactly the frame one dropped in a
## crowd does. A foe walking over it changes nothing. The proximity-armed countdown is the
## BOMBER's (`fuseRange`/`fuseTime` on an enemy def, `src/entities.ts:375`) -- a different
## entity, a different table and a different timer, and the two share only the word "fuse".
##
## THE TWO THINGS THAT ARE NOT PORTED, and neither is specific to the mine: `game.shake` and
## `game.audio` have no counterpart anywhere in `godot/`, and `createFloatingText` is the
## damage-number system this port renders nowhere. The 20 sparks are `Fx.emit_particles` at
## the detonation site in `Game._update_mines`.
##
## THE REMOVAL CONTRACT IS THE ORIGINAL'S. `shouldRemove` is set on the detonating frame and
## the CALLER splices -- `main.ts:1513` `_updateMines` does exactly that, and so does
## `Game._update_mines`. There is no re-entrancy guard here because the original has none:
## calling `update` twice on a detonated mine blasts twice in `src/entities.ts` too.
##
## @module godot/mine
extends RefCounted
class_name Mine

## `src/weapons.ts:356`: `const fuse = this.def.fuse || 1.2;`. The fallback is the
## ORIGINAL's, for a mine def with no `fuse` field -- `WEAPONS.MINE` declares one, so this
## number is unreachable through the real table and is here because the original writes it.
const DEFAULT_FUSE := 1.2

var x: float
var y: float
## The blast radius. `_fireMine` passes `getRange(player)`, so a level or an Area passive
## widens the blast and the drawn warning disc with it.
var radius: float
var damage: float
var fuse: float
## Where the fuse started, so the armed state has something to be a fraction OF.
var max_fuse: float
## Set on the frame the blast lands; the caller removes the mine.
var removed := false

func _init(at_x: float, at_y: float, blast_radius: float, blast_damage: float, fuse_seconds: float) -> void:
	x = at_x
	y = at_y
	radius = blast_radius
	damage = blast_damage
	fuse = fuse_seconds
	max_fuse = fuse_seconds

## IS THIS MINE ABOUT TO BLOW?
##
##     const armed = self.fuse < self.maxFuse * 0.5;      -- renderMine, entity-render.ts:112
##
## STRICTLY less than, which `test/entity-render.test.ts:278` pins from the other side:
## "exactly half is unarmed" and "one step below the boundary IS armed". The rule lives here
## rather than in `main.gd` for the reason `Foe.body_color` does -- one home, so the state a
## suite asserts and the state a player sees cannot drift apart.
func armed() -> bool:
	return fuse < max_fuse * 0.5

## One frame of the countdown, and the blast when it reaches zero.
##
## `foes` rather than a `Game`: this port hands an entity the world it may touch, and a mine
## touches the foes and nothing else. `fx` is the visual sink, optional so a headless suite
## can step a mine without one.
func update(delta: float, foes: Array, fx: Fx = null) -> void:
	fuse -= delta
	if fuse > 0.0:
		return
	# `if (d < this.radius)` -- STRICTLY, `src/entities.ts:769`. Measured against the
	# original's own `Mine.update`: a foe at d = 100 with radius 100 recorded 0 hits and one
	# at 99.9 recorded 1. This is why the blast is not routed through `WeaponFire._strike_disc`,
	# which uses `<=` for the aura and the nova.
	for foe in foes:
		if foe.dead:
			continue
		var dx: float = foe.x - x
		var dy: float = foe.y - y
		if sqrt(dx * dx + dy * dy) < radius:
			foe.take_damage(damage)
	if fx != null:
		fx.emit_particles(x, y, Color("ff8833"), 20)
		# The ORIGINAL's only detonation visual is those 20 sparks. The disc is the port's
		# judgement call, kept here because a blast whose radius is invisible cannot be
		# learned -- and `verify_pixels.gd` measures that it reaches the frame.
		fx.emit_blast(x, y, radius, Color("ff8833"))
	removed = true
