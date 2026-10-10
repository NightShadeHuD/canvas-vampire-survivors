## Proves the XP loop: orbs drop, they are drawn in, they level the hero, and a
## level-up actually offers something and changes the hero.
##
## The curve is asserted against the ORIGINAL'S numbers, not against whatever this
## implementation happens to produce -- a test that reads its own output proves only
## that the code is self-consistent.
##
##   godot --headless --path godot --script res://verify_xp.gd
extends SceneTree

var ok := true

func _init() -> void:
	_the_curve_matches_the_original()
	_orbs_drop_where_foes_die()
	_orbs_are_magnetised_then_collected()
	_a_level_up_offers_three_distinct_things()
	_applying_a_pick_changes_the_hero()
	_a_multi_level_orb_owes_a_pick_each()

	print("verify_xp: ", "PASS" if ok else "FAIL")
	quit(0 if ok else 1)

## `expToNext` starts at 50 and is multiplied by 1.2, floored, per level -- read from
## `src/entities.ts`, so if this drifts the port has drifted with it.
func _the_curve_matches_the_original() -> void:
	var h := Hero.new(0, 0)
	_check(h.exp_to_next == 50.0, "the first level costs 50", "%0.0f" % h.exp_to_next)
	h.gain_exp(50.0)
	_check(h.level == 2, "50 xp is a level", "level %d" % h.level)
	_check(h.exp_to_next == 60.0, "and the next costs floor(50 * 1.2) = 60", "%0.0f" % h.exp_to_next)
	h.gain_exp(60.0)
	_check(h.exp_to_next == 72.0, "then floor(60 * 1.2) = 72", "%0.0f" % h.exp_to_next)

	# The heal on level-up, which is the difference between a reward and a lifeline.
	var hurt := Hero.new(0, 0)
	hurt.hp = 40.0
	hurt.gain_exp(50.0)
	_check(hurt.hp == 60.0, "a level heals 20", "hp %0.0f" % hurt.hp)
	hurt.hp = 95.0
	hurt.gain_exp(hurt.exp_to_next)
	_check(hurt.hp == hurt.max_hp, "and never past max", "hp %0.0f / %0.0f" % [hurt.hp, hurt.max_hp])

func _orbs_drop_where_foes_die() -> void:
	var g := Game.new(999.0)  # no natural spawning
	var f := Foe.new(Enemies.ENEMIES["BAT"], 500.0, 600.0)
	g.foes.append(f)
	f.take_damage(9999.0)
	g.step(1.0 / 60.0, Vector2.ZERO)
	_check(g.orbs.size() == 1, "a kill drops an orb", "%d orb(s)" % g.orbs.size())
	if g.orbs.size() == 1:
		_check(
			is_equal_approx(g.orbs[0].x, 500.0) and is_equal_approx(g.orbs[0].y, 600.0),
			"where the foe fell",
			"(%0.0f, %0.0f)" % [g.orbs[0].x, g.orbs[0].y]
		)
		_check(g.orbs[0].value == 10, "worth the foe's exp", "%d" % g.orbs[0].value)

func _orbs_are_magnetised_then_collected() -> void:
	var h := Hero.new(0, 0)
	# Just inside the magnet, well outside the pickup.
	var orb := Orb.new(float(Config.MAGNET_BASE) - 10.0, 0.0, 5)
	var d0 := orb.x
	orb.update(0.5, h)
	_check(orb.x < d0, "an orb inside the magnet moves toward the hero", "%0.1f -> %0.1f" % [d0, orb.x])
	_check(not orb.collected, "but is not collected yet", "still flying")

	# Outside the magnet it must not move at all, or the radius means nothing.
	var far := Orb.new(float(Config.MAGNET_BASE) + 50.0, 0.0, 5)
	var fx := far.x
	far.update(1.0, h)
	_check(is_equal_approx(far.x, fx), "one outside the magnet stays put", "%0.1f" % far.x)

	# Inside the pickup it is taken, and the two radii are not the same one.
	var near := Orb.new(float(Config.PICKUP_DISTANCE) - 1.0, 0.0, 5)
	near.update(1.0 / 60.0, h)
	_check(near.collected, "one inside the pickup is collected", "collected")

func _a_level_up_offers_three_distinct_things() -> void:
	var h := Hero.new(0, 0)
	var rng := RandomNumberGenerator.new()
	rng.seed = 7
	var picks := Upgrades.choose(h, 3, rng)
	_check(picks.size() == 3, "three offers", "%d" % picks.size())
	var ids := []
	for p in picks:
		ids.append(p["def"]["id"])
	_check(ids.size() == 3 and ids[0] != ids[1] and ids[1] != ids[2] and ids[0] != ids[2],
		"all distinct", ", ".join(ids))
	# A fresh hero must be offered things it does not have, not a maxed list.
	var has_new := false
	for p in picks:
		if Upgrades.label(p) == " (New!)":
			has_new = true
	_check(has_new, "and at least one is new to the hero", "labels offered")

func _applying_a_pick_changes_the_hero() -> void:
	var h := Hero.new(0, 0)
	# A fresh hero holds only Garlic, so a KNIFE offer must genuinely add one.
	var before := h.weapons.size()
	var knife := {"type": "weapon", "def": Weapons.WEAPONS["KNIFE"], "level": 0}
	_check(Upgrades.apply(h, knife) == "new", "a new weapon reports as new", "applied")
	_check(h.weapons.size() == before + 1, "and the hero holds it", "%d weapon(s)" % h.weapons.size())
	_check(h.has_weapon("knife"), "found by its own id", "has_weapon('knife')")

	# Taking it again must LEVEL it, not add a second copy -- the bug that turns a
	# three-weapon build into eleven of the same knife.
	var again := {"type": "weapon", "def": Weapons.WEAPONS["KNIFE"], "level": 1}
	_check(Upgrades.apply(h, again) == "levelled", "taking it again levels it", "applied")
	_check(h.weapons.size() == before + 1, "without adding a duplicate", "%d weapon(s)" % h.weapons.size())
	_check(h.weapon_level("knife") == 2, "at level 2", "Lv.%d" % h.weapon_level("knife"))

func _a_multi_level_orb_owes_a_pick_each() -> void:
	# One orb big enough for two levels must leave TWO picks owed, or the player is
	# silently robbed of a choice.
	var h := Hero.new(0, 0)
	var gained := h.gain_exp(50.0 + 60.0)
	_check(gained == 2, "one orb can grant two levels", "%d" % gained)
	_check(h.level == 3, "and the hero is level 3", "level %d" % h.level)

func _check(cond: bool, label: String, detail: String) -> void:
	if cond:
		print("  ok   %s  (%s)" % [label, detail])
	else:
		print("  FAIL %s  (%s)" % [label, detail])
		ok = false
