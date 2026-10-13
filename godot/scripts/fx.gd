## Transient weapon visuals: the sparks a weapon throws, and the SHAPE its damage covered.
##
## WHY THIS EXISTS
##
## `_draw` iterated `game.shots`, `game.foes`, `game.orbs` and `game.enemy_shots`. Six of
## the eight archetypes create no `Shot` at all -- melee, aura, nova, instant, drain and
## mine apply damage directly -- so firing one of those weapons put NOTHING on screen for
## `_draw` to find. A behavioural audit measured it: the Whip's frame moved 232 pixels and
## every one of them was a foe's HP bar, against 224 for a single Orbiter shard that has
## always been drawn.
##
## WHAT THE ORIGINAL DRAWS, WHICH IS WHAT THIS REPRODUCES
##
##   `Weapon._fireMelee`    `createParticles(player.x - range / 2, player.y, '#ffaa00', 5)`
##                          and the same at `+ range / 2` -- one burst per end of the sweep
##   `Weapon._fireAura`     one `#88ff88` particle at a random point inside the radius,
##                          40% of the time
##   `Weapon._fireNova`     `createParticles(player.x, player.y, '#aaeeff', 24)`
##   `Weapon._fireInstant`  `createParticles(target.x, target.y, '#ffff66', 14)`
##   `Weapon._fireDrain`    `createParticles(midpoint, '#ff88cc', 2)`; the comment in
##                          `src/weapons.ts` calls it the "cheap 'tether' visual"
##   `Mine.update`          `createParticles(this.x, this.y, '#ff8833', 20)` on detonation
##
## Every one of those is a PARTICLE, so `Spark` is ported field for field from `Particle`
## in `src/entities.ts` -- the same random size, speed, decay and friction.
##
## A particle says THAT something happened. It does not say WHAT WAS HIT, and the original
## never needed it to: it draws a damage number on every hit (`_rollCrit` ->
## `createFloatingText`) and this port does not. So a `Strike` also records the shape the
## damage covered, and `main.gd` draws it. Each emit site names whether the original draws
## that shape or whether it is the port's judgement call.
##
## DATA, NOT NODES. `Game` owns this and `main.gd` is still the only file that draws, so a
## headless suite can assert what a weapon EMITTED -- which is the half of this the windowed
## pixel tier cannot run in CI.
##
## @module godot/fx
extends RefCounted
class_name Fx

## A safety valve, not a behaviour. The original's `Pool` caps only its FREE list
## (`src/pool.ts`, `maxSize: 512`), so its live particle count is unbounded; the emitters
## here are the same ones, and with the same decay they peak in the tens. 512 is where the
## oldest is dropped rather than letting an adversarial run grow the array forever.
const MAX_SPARKS := 512

## How long a shape lives, in seconds. Long enough to be seen: 0.22 is thirteen frames.
## The Whip's sweep is the shortest because the original fires it every 1.5s and a band
## that lingers reads as a persistent aura rather than a lash.
const SWEEP_LIFE := 0.22
const RING_LIFE := 0.45
const BEAM_LIFE := 0.18
const BLAST_LIFE := 0.35

## Every spark alive. `main.gd` iterates this BY NAME and `verify_scene.gd` asserts that it
## does -- a list that is simulated and never drawn is the exact bug this file exists for.
var sparks: Array = []

## Every strike shape alive. Iterated by `main.gd` in the same way.
var strikes: Array = []


## One particle, ported field for field from `Particle` in `src/entities.ts`.
##
## The friction is a POWER rather than a per-frame multiply (`vx *= Math.pow(friction, dt)`)
## which makes the drag independent of the frame rate -- so a spark thrown at 30fps and one
## at 60fps travel the same distance, and a test can step it at any dt.
class Spark:
	var x: float
	var y: float
	var vx: float
	var vy: float
	var color: Color
	var size: float
	var life := 1.0
	var decay: float
	var friction := 0.2

	func _init(at_x: float, at_y: float, tint: Color) -> void:
		x = at_x
		y = at_y
		color = tint
		size = randf() * 4.0 + 2.0
		decay = randf() * 1.5 + 1.0
		var angle := randf() * TAU
		var speed := randf() * 180.0 + 60.0
		vx = cos(angle) * speed
		vy = sin(angle) * speed

	func update(delta: float) -> void:
		x += vx * delta
		y += vy * delta
		vx *= pow(friction, delta)
		vy *= pow(friction, delta)
		life -= decay * delta
		size *= pow(0.3, delta)


## The area one weapon's fire covered, so the hit has a SHAPE on screen and not just a
## flash. Only the fields its `kind` uses are meaningful.
class Strike:
	enum Kind {
		## The Whip's band: `abs(dx) <= reach and abs(dy) <= half_height`.
		SWEEP,
		## Frost Nova's burst: a ring that grows from the hero out to `reach`.
		RING,
		## Soul Drain's tether: a line from the hero to the foe it is draining.
		BEAM,
		## Area Mine's detonation: the blast disc, filled, out to `reach`.
		BLAST,
	}

	var kind: int
	var x: float
	var y: float
	## BEAM only: the far end.
	var x2 := 0.0
	var y2 := 0.0
	## The radius the damage reached. Every shape is drawn AT this and never short of it.
	var reach: float
	## SWEEP only. The original's `Math.abs(dy) > 40`.
	var half_height := 0.0
	var color: Color
	var life: float
	var max_life: float

	func _init(
		shape: Kind, at_x: float, at_y: float, radius: float, tint: Color, lifespan: float
	) -> void:
		kind = shape
		x = at_x
		y = at_y
		reach = radius
		color = tint
		life = lifespan
		max_life = lifespan

	## 1.0 at birth, 0.0 at death. The one thing every drawing branch reads.
	func fade() -> float:
		return clampf(life / max_life, 0.0, 1.0)


# ---------------------------------------------------------------------------
# Emitting. Each of these mirrors one `createParticles` call in `src/weapons.ts`.
# ---------------------------------------------------------------------------

## `Game.createParticles(x, y, color, n)`. The oldest spark is dropped at the cap.
func emit_particles(x: float, y: float, color: Color, n: int) -> void:
	for i in n:
		if sparks.size() >= MAX_SPARKS:
			sparks.pop_front()
		sparks.append(Spark.new(x, y, color))


## The Whip's band. The ORIGINAL draws two particle bursts at the ends of this band and
## no band at all -- see `_fireMelee`, quoted in the file header -- so the outline is the
## port's judgement call. It is drawn because the shape is a claim the player can be
## wronged by: a foe at `abs(dy) == 41` takes nothing, and the original's own sweep,
## `weapon-fire.gd`'s damage and this outline are now all the same 40.
func emit_sweep(x: float, y: float, reach: float, half_height: float, color: Color) -> void:
	var s := Strike.new(Strike.Kind.SWEEP, x, y, reach, color, SWEEP_LIFE)
	s.half_height = half_height
	strikes.append(s)


## An expanding ring centred on the hero. The ORIGINAL draws
## `createParticles(player.x, player.y, '#aaeeff', 24)` -- a burst at the hero and no ring
## -- so the ring is the port's judgement call. A nova's whole identity is its radius, and
## a burst at the origin does not show one.
func emit_ring(x: float, y: float, reach: float, color: Color) -> void:
	strikes.append(Strike.new(Strike.Kind.RING, x, y, reach, color, RING_LIFE))


## A tether from the hero to the foe being drained. The ORIGINAL's comment on this one is
## "Cheap 'tether' visual = particle streak", and the two sparks at the midpoint are
## reproduced at the emit site; the line is the port's judgement call.
func emit_beam(x1: float, y1: float, x2: float, y2: float, color: Color) -> void:
	var s := Strike.new(Strike.Kind.BEAM, x1, y1, 0.0, color, BEAM_LIFE)
	s.x2 = x2
	s.y2 = y2
	strikes.append(s)


## The Area Mine's blast, at the radius the port actually hits. The ORIGINAL fills exactly
## this circle while the mine is ARMED (`renderMine`: `ctx.arc(self.x, self.y, self.radius)`)
## -- the port has no fuse, so there is no armed state to fill, and the radius is drawn at
## the moment the damage lands instead. Reported rather than invented.
func emit_blast(x: float, y: float, reach: float, color: Color) -> void:
	strikes.append(Strike.new(Strike.Kind.BLAST, x, y, reach, color, BLAST_LIFE))


# ---------------------------------------------------------------------------
# Lifetime
# ---------------------------------------------------------------------------

## Advance every spark and shape, dropping what has expired.
##
## Called from `Game.step`, so the effects pause with the game for the same reason the
## original's do: `effects.update(dt)` only runs from the gameplay loop.
func update(delta: float) -> void:
	var live_sparks: Array = []
	for spark in sparks:
		spark.update(delta)
		if spark.life > 0.0 and spark.size > 0.15:
			live_sparks.append(spark)
	sparks = live_sparks

	var live_strikes: Array = []
	for strike in strikes:
		strike.life -= delta
		if strike.life > 0.0:
			live_strikes.append(strike)
	strikes = live_strikes

## Throw away everything alive. For a restart, and for a test that needs a still frame.
func clear() -> void:
	sparks.clear()
	strikes.clear()

## True when there is nothing left to draw. A test can assert a still frame is still.
func is_empty() -> bool:
	return sparks.is_empty() and strikes.is_empty()
