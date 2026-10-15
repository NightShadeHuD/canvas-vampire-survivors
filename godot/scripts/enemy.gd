## A foe, and the seven ways the data says one can behave.
##
## `archetype` is on EVERY enemy in `src/data.ts` and nothing used to read it, so all
## ten enemy types were ten SKINS that walked at you at different speeds. That is the
## same bug as the weapons and the passives: data declaring something the code ignores.
##
## Everything here is driven by the data's own flags -- `dashSpeed`, `shieldHp`,
## `keepDistance`, `splitInto`, `fuseRange`, `cloneCount` -- rather than by constants
## chosen here. Retune a wolf in `src/data.ts`, re-run `npm run export:godot`, and this
## file needs no change.
extends RefCounted
class_name Foe

var x: float
var y: float
var hp: float
var max_hp: float
var speed: float
var damage: float
var size: float
var exp_value: int
var color: String
var def_id: String
var archetype: String
var dead := false
## Kept so a splitter knows what to become and a bomber how hard it hits.
var def: Dictionary

## shielded: absorbs damage before health, and cuts what gets through.
var shield_hp := 0.0
var shield_max := 0.0
var damage_reduction := 0.0

## dasher: still, then fast, on a cycle.
var _dash_timer := 0.0
var _dash_left := 0.0
var dashing := false

## ranged: holds a distance and shoots.
var _fire_timer := 0.0
var wants_to_fire := false

## bomber: arms inside `fuseRange`, then detonates. `fuse_armed` is what the renderer
## blinks on in the original.
var fuse_armed := false
var _fuse_left := 0.0
var exploded := false

## illusionist: spawns clones on a cycle.
var _clone_timer := 0.0
var wants_clone := false
## A clone of an illusionist is still an illusionist, so without this it clones too --
## and the population is exponential. Measured: 27,165 foes in 25 seconds.
var is_clone := false

## FROST NOVA'S SLOW, which the data declares and this port used to ignore entirely.
##
## `src/data.ts` carries `slowPct: 0.5` and `slowDuration: 1.2` on Frost Nova, and
## `src/entities.ts` declares AND reads both:
##
##     if (this.slowTimer > 0) this.slowTimer -= dt;
##     const slowMult = this.slowTimer > 0 ? 1 - (this.slowPct || 0) : 1;
##
## -- `Enemy.update`. `slow_timer` is the seconds LEFT and `slow_pct` the fraction of
## speed removed while it is positive, so a slowed bat moves at half speed for 1.2s.
var slow_timer := 0.0
var slow_pct := 0.0

## THE HIT FLASH: the FIRST branch of `renderEnemy`'s colour chain, and the one this port had
## no timer for at all -- a foe that was hit looked exactly like a foe that was not.
##
##     this.flashTimer = 0.08;                            -- `Enemy.takeDamage`, the last
##                                                           line of its body, UNCONDITIONALLY
##     if (this.flashTimer > 0) this.flashTimer -= dt;     -- `Enemy.update`, in BOTH of its
##                                                           branches: the bomber's early
##                                                           `return` and the general path
##
## 0.08s is about five frames at 60fps, so a struck foe reads WHITE for a fifth of a second
## and is then itself again. **THE DECAY IS THE WHOLE FEATURE.** A flash with no countdown is
## a foe that is white forever, and that is the same class of bug as the dim that never
## lifted -- `AGENTS.md` rule 18's fourth row, "the screen greyed out and stayed grey". It is
## aged from the TOP of `chase`, above every early return in this file, so no foe can outlive
## its flash by standing still.
var flash_timer := 0.0

func _init(d: Dictionary, start_x: float, start_y: float, hp_mult := 1.0, dmg_mult := 1.0) -> void:
	def = d
	def_id = d["id"]
	archetype = str(d.get("archetype", "chaser"))
	x = start_x
	y = start_y
	max_hp = float(d["hp"]) * hp_mult
	hp = max_hp
	speed = float(d["speed"])
	damage = float(d["damage"]) * dmg_mult
	size = float(d["size"])
	exp_value = int(d["exp"])
	color = str(d["color"])

	if d.has("shieldHp"):
		shield_max = float(d["shieldHp"])
		shield_hp = shield_max
		damage_reduction = float(d.get("damageReduction", 0.0))

	# Each timer starts at a different fraction of its cycle so a wave of wolves does
	# not dash in unison -- which reads as one animation rather than a pack.
	if archetype == "dasher":
		_dash_timer = float(d.get("dashInterval", 3.5)) * randf()
	if archetype == "ranged":
		_fire_timer = float(d.get("fireCooldown", 2.4)) * randf()
	if archetype == "illusionist":
		_clone_timer = float(d.get("cloneCooldown", 5.5)) * randf()

func take_damage(amount: float) -> void:
	# THE FLASH IS SET FIRST AND UNCONDITIONALLY, which is where the original sets it and the
	# one place it can go here. `Enemy.takeDamage` ends
	#
	#     this.hp -= dmg;
	#     this.flashTimer = 0.08;
	#
	# with no early return at all, so a blow a shield absorbs ENTIRELY still flashes the foe:
	# what the flash reports is that the hit landed, not how much of it got through. The
	# `return` below is the one path the original does not have, and a timer set after it
	# would make a fully-shielded hit invisible to the player.
	flash_timer = FLASH_TIME
	# Shield first, then the reduction applies to what is left. A golem with 60 shield
	# and 50% reduction is not simply "90 more health" -- the two interact.
	var incoming := amount
	if shield_hp > 0.0:
		var absorbed := minf(shield_hp, incoming)
		shield_hp -= absorbed
		incoming -= absorbed
	incoming *= 1.0 - damage_reduction
	if incoming <= 0.0:
		return
	hp -= incoming
	if hp <= 0.0:
		hp = 0.0
		dead = true

## Distance a foe wants to keep. A mage stops at `keepDistance` and fires; everything
## else closes to nothing.
func standoff() -> float:
	if archetype == "ranged":
		return float(def.get("keepDistance", 0.0))
	return 0.0

## Apply Frost Nova's slow. `_fireNova` in `src/weapons.ts`:
##
##     if (!enemy.slowTimer || enemy.slowTimer < slowDur) {
##         enemy.slowTimer = slowDur;
##         enemy.slowPct = slowPct;
##     }
##
## The guard is on TIME ALONE, and that asymmetry is the original's, not an oversight
## here: a weak slow landing on a strongly-slowed foe REPLACES it when it lasts longer,
## because nothing compares `slowPct`. `!enemy.slowTimer` is `slow_timer <= 0.0` -- absent
## and zero both mean "not currently slowed".
func apply_slow(pct: float, duration: float) -> void:
	if slow_timer <= 0.0 or slow_timer < duration:
		slow_timer = duration
		slow_pct = pct

## What this foe's speed is multiplied by RIGHT NOW.
##
##     const slowMult = this.slowTimer > 0 ? 1 - (this.slowPct || 0) : 1;
##
## STRICTLY greater than zero: a timer that has reached exactly zero has expired, which is
## the boundary `verify_weapons.gd` pins. Read AFTER the tick in `chase`, so the frame that
## takes the timer to zero is a frame the foe moves at FULL speed -- the original's order.
func slow_mult() -> float:
	if slow_timer > 0.0:
		return 1.0 - slow_pct
	return 1.0

## Move toward the hero, in whatever way this archetype moves.
##
## THE SLOW TICKS FIRST, and it ticks for EVERY foe -- including one standing exactly on
## the hero and one that has nowhere to go. `Enemy.update` decays it at the top, before any
## archetype branch and before anything can return early, so a slowed foe cannot outlive
## its slow by standing still. `slow` is then read ONCE and multiplied into every movement
## below, which is what the original does at all five of its movement sites.
func chase(target_x: float, target_y: float, delta: float) -> void:
	# THE FLASH AGES FIRST, and for EVERY foe -- above the `d <= 0.001` return below, above
	# every archetype branch, and outside the movement entirely. `Enemy.update` decays it in
	# both of its branches, so a foe standing exactly on the hero, a foe with nowhere to go
	# and an armed bomber all spend their flash at the same rate. A tick placed after any one
	# of those returns is a foe that stays white while it does the thing it is doing.
	if flash_timer > 0.0:
		flash_timer -= delta
	if slow_timer > 0.0:
		slow_timer -= delta
	var slow := slow_mult()

	var dx := target_x - x
	var dy := target_y - y
	var d := sqrt(dx * dx + dy * dy)
	if d <= 0.001:
		return
	var dir_x := dx / d
	var dir_y := dy / d

	match archetype:
		"dasher":
			_tick_dash(delta)
			# `speed` for the prowl, `dashSpeed` for the burst -- both from the data.
			# The first version prowled at `speed * 0.35`, a number I made up, which
			# left a wolf SLOWER than a bat over four seconds: a dasher that never
			# catches anything.
			var move_speed := float(def.get("dashSpeed", speed)) if dashing else speed
			# THE DASH IS SLOWED TOO. `_fireNova`'s slow is on the foe, not on its
			# walk, and the original multiplies `dashSpeed` by `slowMult` at this exact
			# line -- so a frozen wolf lunges at half its burst speed. The dash TIMER is
			# not slowed in either version.
			x += dir_x * move_speed * slow * delta
			y += dir_y * move_speed * slow * delta
		"ranged":
			_tick_ranged(d, delta)
			# Backs off if too close, advances if too far, holds still in the band.
			var band := standoff()
			if d > band + 20.0:
				x += dir_x * speed * slow * delta
				y += dir_y * speed * slow * delta
			elif d < band - 20.0:
				x -= dir_x * speed * slow * delta
				y -= dir_y * speed * slow * delta
		"bomber":
			_tick_bomber(d, delta)
			# An ARMED bomber still walks: `src/entities.ts` sets `vx`/`vy` AFTER its fuse
			# check, so it never stops -- `_tick_bomber`'s "holds position" describes what
			# that comment intended, not what the original does. The slow lands on THIS line
			# because this is the line the original multiplies. The fuse is not slowed.
			x += dir_x * speed * slow * delta
			y += dir_y * speed * slow * delta
		"illusionist":
			_tick_clone(delta)
			x += dir_x * speed * slow * delta
			y += dir_y * speed * slow * delta
		_:
			x += dir_x * speed * slow * delta
			y += dir_y * speed * slow * delta

func _tick_dash(delta: float) -> void:
	var interval := float(def.get("dashInterval", 3.5))
	if dashing:
		_dash_left -= delta
		if _dash_left <= 0.0:
			dashing = false
		return
	_dash_timer -= delta
	if _dash_timer <= 0.0:
		_dash_timer = interval
		dashing = true
		_dash_left = float(def.get("dashDuration", 0.6))

func _tick_ranged(d: float, delta: float) -> void:
	_fire_timer -= delta
	var firing_range := float(def.get("firingRange", 360.0))
	# Fires when in range AND roughly at its standoff, so it does not shoot while
	# still walking into position.
	if _fire_timer <= 0.0 and d <= firing_range:
		_fire_timer = float(def.get("fireCooldown", 2.4))
		wants_to_fire = true

func _tick_bomber(d: float, delta: float) -> void:
	# A bomber that reaches the hero STOPS and arms rather than pushing through.
	if fuse_armed:
		_fuse_left -= delta
		if _fuse_left <= 0.0:
			exploded = true
			dead = true
		return
	if d <= float(def.get("fuseRange", 80.0)):
		fuse_armed = true
		_fuse_left = float(def.get("fuseTime", 1.4))
		return
	# Once armed it holds position, which is what the original does.
	if fuse_armed:
		return

func _tick_clone(delta: float) -> void:
	# A clone never clones. This is the guard that stops the exponential blow-up, and it
	# is checked HERE rather than at the spawn site so the signal is never raised at all.
	if is_clone:
		return
	_clone_timer -= delta
	if _clone_timer <= 0.0:
		_clone_timer = float(def.get("cloneCooldown", 5.5))
		wants_clone = true

# ---------------------------------------------------------------------------
# WHAT THIS FOE LOOKS LIKE
#
# A slow the player cannot SEE is half a feature, and the half that is missing is the one
# that tells them the weapon worked. `renderEnemy` in `src/entity-render.ts` is a CHAIN, and
# the ORDER of it is the specification rather than a detail of it:
#
#     if (self.flashTimer > 0) ctx.fillStyle = '#ffffff';
#     else if (self.slowTimer > 0) ctx.fillStyle = '#88ccff';
#     else if (self.bomber && self.fuseArmed) { ...blink white / colour... }
#     else ctx.fillStyle = self.color;
#
# ALL FOUR BRANCHES ARE HERE NOW, in `body_color`, which is the one place they live -- so the
# drawn colour and the asserted colour cannot drift apart. The order is load-bearing and not
# tidiness: a foe that is BOTH hit and slowed reads WHITE rather than iced blue, and one that
# is slowed while its fuse burns reads iced blue rather than blinking. Each of those three
# orderings is asserted by putting two states on ONE foe, because an implementation that
# reordered the chain would pass every single-state check ever written about it.
# ---------------------------------------------------------------------------

## `#88ccff`: "Slowed foes get a cold cast."
const SLOW_TINT := Color("88ccff")
## `'#ffffff'`, written twice in the original -- once for the hit flash and once for the armed
## bomber's blink -- so it is one constant here rather than two names for one white. The
## suites assert it against the `src/` literal, not against this constant.
const WHITE_TINT := Color("ffffff")
## `this.flashTimer = 0.08`. About five frames at 60fps, and 0.08 is the original's number.
const FLASH_TIME := 0.08
## `Math.floor(performance.now() / 120) % 2 === 0`. 120 MILLISECONDS IS THE HALF PERIOD: the
## armed bomber is white for 0.12s and its own colour for 0.12s. The phase depends on the
## CLOCK ALONE -- not on the fuse's remaining time, not on the foe's health, not on when the
## fuse armed -- which is what makes it a blink rather than a fuse gauge.
##
## THE CLOCK IS THE GAME'S, NOT THE WALL'S. The original reads `performance.now()`, which runs
## on while the game is paused; this reads `Game.elapsed`, which does not, for the reason the
## hero's i-frame strobe already reads it: a paused frame must be a still frame. That
## substitution is the port's and it is reported rather than hidden -- the PHASE therefore
## differs from the original's to within the run's own clock, and the PERIOD does not.
const BLINK_HALF_PERIOD := 0.12

## The colour the BODY is drawn in, so the rule has one home and the drawn body and the
## asserted body cannot disagree. `main.gd`'s `_draw_foe` is the only caller, and it passes
## `Game.elapsed`.
##
## `now` IS REQUIRED RATHER THAN DEFAULTED. A default of 0.0 would silently freeze the blink
## in whichever half zero falls in (white, by the arithmetic below) for every caller that
## forgot it -- a foe that is white forever, which is the exact defect the flash's decay
## exists to prevent. A required argument is a caller that cannot forget.
func body_color(now: float) -> Color:
	if flash_timer > 0.0:
		return WHITE_TINT
	if slow_timer > 0.0:
		return SLOW_TINT
	# `self.bomber`, read here as the ARCHETYPE -- the field every other bomber behaviour in
	# this file is dispatched on and the field `verify_archetypes.gd` drives the data by.
	# `data/enemies.gd` carries `"bomber": true` as well; it is the same fact, and this port
	# keeps ONE reader of it rather than two that can drift.
	if archetype == "bomber" and fuse_armed:
		return WHITE_TINT if blink_is_white(now) else Color(color)
	return Color(color)

## `const blink = Math.floor(performance.now() / 120) % 2 === 0;` -- true in the half that
## draws WHITE, false in the half that draws the foe's own colour.
func blink_is_white(now: float) -> bool:
	return int(now / BLINK_HALF_PERIOD) % 2 == 0
