## Proves the XP loop: orbs drop, they are drawn in, they level the hero, and a
## level-up actually offers something and changes the hero.
##
## The curve is asserted against the ORIGINAL'S numbers, not against whatever this
## implementation happens to produce -- a test that reads its own output proves only
## that the code is self-consistent.
##
##   godot --headless --path godot --script res://verify_xp.gd
extends SceneTree

func _init() -> void:
	_the_curve_matches_the_original()
	_orbs_drop_where_foes_die()
	_orbs_are_magnetised_then_collected()
	_a_level_up_offers_three_distinct_things()
	_applying_a_pick_changes_the_hero()
	_a_multi_level_orb_owes_a_pick_each()

	var passed := Check.ok
	print("verify_xp: ", "PASS" if passed else "FAIL")
	quit(0 if passed else 1)

## `expToNext` starts at 50 and is multiplied by 1.2, floored, per level -- read from
## `src/entities.ts`, so if this drifts the port has drifted with it.
func _the_curve_matches_the_original() -> void:
	var h := Hero.new(0, 0)
	Check.approx(h.exp_to_next, 50.0, "the first level costs 50")
	h.gain_exp(50.0)
	Check.unchanged(h.level, 2, "50 xp is a level")
	Check.approx(h.exp_to_next, 60.0, "and the next costs floor(50 * 1.2) = 60")
	h.gain_exp(60.0)
	Check.approx(h.exp_to_next, 72.0, "then floor(60 * 1.2) = 72")

	# The heal on level-up, which is the difference between a reward and a lifeline.
	# `wounded` states the precondition: a heal on a full-health hero is clamped,
	# so the heal has to be measured on one that is actually hurt.
	var hurt := Check.wounded(Hero.new(0, 0), 40.0)
	var hurt_hp := hurt.hp
	hurt.gain_exp(50.0)
	Check.approx(hurt.hp, hurt_hp + 20.0, "a level heals 20")
	Check.wounded(hurt, 95.0)
	hurt.gain_exp(hurt.exp_to_next)
	Check.approx(hurt.hp, hurt.max_hp, "and never past max")

func _orbs_drop_where_foes_die() -> void:
	var g := Game.new(999.0)  # no natural spawning
	var f := Foe.new(Enemies.ENEMIES["BAT"], 500.0, 600.0)
	g.foes.append(f)
	# READ where the foe was, rather than writing down the values it was built with.
	var fell_at := Vector2(f.x, f.y)
	f.take_damage(9999.0)
	g.step(1.0 / 60.0, Vector2.ZERO)
	Check.unchanged(g.orbs.size(), 1, "a kill drops an orb")
	if g.orbs.size() == 1:
		Check.approx(g.orbs[0].x, fell_at.x, "where the foe fell (x)", 0.5)
		Check.approx(g.orbs[0].y, fell_at.y, "where the foe fell (y)", 0.5)
		# The orb is worth the FOE's exp, read from the foe rather than pinned here.
		Check.unchanged(g.orbs[0].value, f.exp_value, "worth the foe's exp")

func _orbs_are_magnetised_then_collected() -> void:
	var h := Hero.new(0, 0)
	# Just inside the magnet, well outside the pickup.
	var orb := Orb.new(float(Config.MAGNET_BASE) - 10.0, 0.0, 5)
	var orb_from := Vector2(orb.x, orb.y)
	orb.update(0.5, h)
	Check.closer(orb_from.x, orb_from.y, orb.x, orb.y, h.x, h.y, "an orb inside the magnet moves toward the hero")
	Check.unchanged(orb.collected, false, "but is not collected yet")

	# Outside the magnet it must not move at all, or the radius means nothing.
	var far := Orb.new(float(Config.MAGNET_BASE) + 50.0, 0.0, 5)
	var fx := far.x
	far.update(1.0, h)
	Check.unchanged(fx, far.x, "one outside the magnet stays put")

	# Inside the pickup it is taken, and the two radii are not the same one.
	var near := Orb.new(float(Config.PICKUP_DISTANCE) - 1.0, 0.0, 5)
	near.update(1.0 / 60.0, h)
	Check.unchanged(near.collected, true, "one inside the pickup is collected")

func _a_level_up_offers_three_distinct_things() -> void:
	var h := Hero.new(0, 0)
	var rng := RandomNumberGenerator.new()
	rng.seed = 7
	var picks := Upgrades.choose(h, 3, rng)
	Check.unchanged(picks.size(), 3, "three offers")
	var ids := []
	for p in picks:
		ids.append(p["def"]["id"])
	# "all distinct" as a POPULATION: three offers whose ids collapse to three.
	var unique_ids := {}
	for id in ids:
		unique_ids[id] = true
	Check.unchanged(unique_ids.size(), picks.size(), "all distinct: %s" % ", ".join(ids))
	# A fresh hero must be offered things it does not have, not a maxed list.
	var has_new := false
	for p in picks:
		if Upgrades.label(p) == " (New!)":
			has_new = true
	Check.unchanged(has_new, true, "and at least one is new to the hero")

func _applying_a_pick_changes_the_hero() -> void:
	var h := Hero.new(0, 0)
	# A fresh hero holds only Garlic, so a KNIFE offer must genuinely add one.
	var before := h.weapons.size()
	var knife := {"type": "weapon", "def": Weapons.WEAPONS["KNIFE"], "level": 0}
	Check.unchanged(Upgrades.apply(h, knife), "new", "a new weapon reports as new")
	Check.unchanged(h.weapons.size(), before + 1, "and the hero holds it")
	Check.unchanged(h.has_weapon("knife"), true, "found by its own id")

	# Taking it again must LEVEL it, not add a second copy -- the bug that turns a
	# three-weapon build into eleven of the same knife.
	var again := {"type": "weapon", "def": Weapons.WEAPONS["KNIFE"], "level": 1}
	Check.unchanged(Upgrades.apply(h, again), "levelled", "taking it again levels it")
	Check.unchanged(h.weapons.size(), before + 1, "without adding a duplicate")
	Check.unchanged(h.weapon_level("knife"), 2, "at level 2")

func _a_multi_level_orb_owes_a_pick_each() -> void:
	# One orb big enough for two levels must leave TWO picks owed, or the player is
	# silently robbed of a choice.
	var h := Hero.new(0, 0)
	var gained := h.gain_exp(50.0 + 60.0)
	Check.unchanged(gained, 2, "one orb can grant two levels")
	Check.unchanged(h.level, 3, "and the hero is level 3")
