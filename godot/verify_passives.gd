## Every passive in the data must actually DO something.
##
## WHY THIS EXISTS
##
## The level-up screen offered thirteen passives and NOTHING read them. `add_passive`
## stored a bare count -- and an effect lives on the def, so a count with no def cannot
## compute anything. The bug was invisible because no test asked what a passive does.
##
## This drives the real table: take each passive, and require SOME observable value to
## move. A passive added to `src/data.ts` later fails until it is implemented.
##
##   godot --headless --path godot --script res://verify_passives.gd
extends SceneTree

var ok := true

func _init() -> void:
	_every_passive_changes_something()
	_stacking_compounds()
	_armor_cannot_make_you_immortal()
	_dodge_prevents_the_hit_entirely()
	_regen_heals_over_time()
	_magnet_extends_the_pull()
	_might_raises_weapon_damage()
	_area_extends_weapon_reach()
	_cooldown_shortens_the_timer()
	_growth_multiplies_xp()
	_vitality_raises_the_ceiling_and_heals()

	print("verify_passives: ", "PASS" if ok else "FAIL")
	quit(0 if ok else 1)

func _def(id: String) -> Dictionary:
	for p in Passives.PASSIVES.values():
		if p["id"] == id:
			return p
	push_error("no passive def for id '%s'" % id)
	return Passives.PASSIVES.values()[0]

## The headline check, over the DATA. Each passive is measured against a snapshot of
## everything it could plausibly move.
func _every_passive_changes_something() -> void:
	var silent: Array = []
	for def in Passives.PASSIVES.values():
		var h := Hero.new(0, 0)
		var before := _snapshot(h)
		h.add_passive(def)
		if _snapshot(h) == before:
			silent.append("%s (%s)" % [def["id"], JSON.stringify(def.get("effect", {}))])
	_check(
		silent.is_empty(),
		"EVERY passive changes something",
		"silent: %s" % (", ".join(silent) if not silent.is_empty() else "none")
	)

## Everything a passive can move, in one comparable value.
func _snapshot(h: Hero) -> Array:
	return [
		h.max_hp, h.speed_mult(), h.damage_mult(), h.area_mult(), h.cooldown_mult(),
		h.exp_mult(), h.magnet_mult(), h.armor(), h.dodge_chance(), h.crit_chance(),
		h.hp_regen(), h.damage_reduction(), h.magnet_range()
	]

func _stacking_compounds() -> void:
	# Two stacks of Might must be 1.1 * 1.1, not 1.2 -- the original compounds, and a
	# passive that adds instead of compounding stops scaling once you have several.
	var h := Hero.new(0, 0)
	var might := _def("might")
	h.add_passive(might)
	var one := h.damage_mult()
	h.add_passive(might)
	var two := h.damage_mult()
	_check(is_equal_approx(one, 1.1), "one Might is 1.1x", "%0.4f" % one)
	_check(is_equal_approx(two, 1.21), "two compound to 1.21x, not 1.2x", "%0.4f" % two)

func _armor_cannot_make_you_immortal() -> void:
	# A hit is floored at 1. Without the floor a tanky build becomes literally
	# unkillable, which is the difference between a good build and a broken one.
	var h := Hero.new(0, 0)
	for i in 20:
		h.add_passive(_def("armor"))  # far past the cap, deliberately
	var hp0 := h.hp
	h.take_damage(5.0)
	_check(h.hp <= hp0 - 1.0, "damage is floored at 1, never 0", "took %0.1f" % (hp0 - h.hp))
	_check(h.hp > 0.0, "and a tiny hit cannot kill outright", "hp %0.1f" % h.hp)

func _dodge_prevents_the_hit_entirely() -> void:
	# Dodge must return "dodged" rather than reducing the damage to zero -- a dodged
	# hit also must not burn an i-frame window, which is why it is checked before armor.
	#
	# Measured as a RATE over many trials, not as one hit. The first version stacked
	# Evasion twenty times and expected a 100% dodge; `add_passive` correctly caps at
	# PASSIVE_MAX_STACK, so it reached 25% and the test failed against working code.
	seed(4242)
	var h := Hero.new(0, 0)
	for i in 20:
		h.add_passive(_def("dodge"))
	_check(h.passive_count("dodge") == int(Config.PASSIVE_MAX_STACK), "Evasion caps at PASSIVE_MAX_STACK", "%d stacks" % h.passive_count("dodge"))
	_check(is_equal_approx(h.dodge_chance(), 0.25), "which is 5 x 5% = 25%", "%0.2f" % h.dodge_chance())

	var trials := 4000
	var dodged := 0
	var burned := 0
	for i in trials:
		var t := Hero.new(0, 0)
		for j in 20:
			t.add_passive(_def("dodge"))
		var hp0 := t.hp
		if t.take_damage(50.0) == "dodged":
			dodged += 1
			if t.hp != hp0 or t.invincible:
				burned += 1
	var rate := float(dodged) / float(trials)
	_check(absf(rate - 0.25) < 0.03, "about 25% of hits are dodged", "%0.3f over %d trials" % [rate, trials])
	_check(burned == 0, "and a dodged hit costs no health and no i-frames", "%d violation(s)" % burned)

func _regen_heals_over_time() -> void:
	var h := Hero.new(0, 0)
	h.add_passive(_def("recovery"))
	h.hp = 50.0
	# 0.5 HP/s for 2 seconds.
	for i in 120:
		h.tick(1.0 / 60.0)
	_check(h.hp > 50.5, "Recovery heals over time", "hp %0.2f after 2s" % h.hp)

func _magnet_extends_the_pull() -> void:
	var plain := Hero.new(0, 0)
	var boosted := Hero.new(0, 0)
	boosted.add_passive(_def("magnet"))
	_check(
		boosted.magnet_range() > plain.magnet_range(),
		"Magnet extends the pickup range",
		"%0.1f -> %0.1f" % [plain.magnet_range(), boosted.magnet_range()]
	)
	# And an orb must actually be pulled by the WIDER radius, which is the part that
	# a multiplier alone does not prove.
	var far := Orb.new(boosted.magnet_range() - 10.0, 0.0, 5)
	var x0 := far.x
	far.update(0.5, boosted)
	_check(far.x < x0, "an orb inside the wider range is pulled", "%0.1f -> %0.1f" % [x0, far.x])

func _might_raises_weapon_damage() -> void:
	var def: Dictionary = _weapon("knife")
	var plain := Hero.new(0, 0)
	var strong := Hero.new(0, 0)
	strong.add_passive(_def("might"))
	var foe_a := Foe.new(Enemies.ENEMIES["BAT"], plain.x + 100.0, plain.y)
	var foe_b := Foe.new(Enemies.ENEMIES["BAT"], strong.x + 100.0, strong.y)
	for f in [foe_a, foe_b]:
		f.max_hp = 10000.0
		f.hp = 10000.0
	var shots_a: Array = []
	var shots_b: Array = []
	WeaponFire.fire(def, plain, [foe_a], shots_a)
	WeaponFire.fire(def, strong, [foe_b], shots_b)
	_check(shots_b.size() == 1 and shots_a.size() == 1, "both heroes fire", "%d / %d" % [shots_a.size(), shots_b.size()])
	if shots_a.size() == 1 and shots_b.size() == 1:
		_check(
			shots_b[0].damage > shots_a[0].damage,
			"Might raises weapon damage",
			"%0.1f -> %0.1f" % [shots_a[0].damage, shots_b[0].damage]
		)

func _area_extends_weapon_reach() -> void:
	var def: Dictionary = _weapon("garlic")
	var plain := Hero.new(0, 0)
	var wide := Hero.new(0, 0)
	wide.add_passive(_def("area"))
	var near_plain := Foe.new(Enemies.ENEMIES["BAT"], plain.x + 115.0, plain.y)
	var near_wide := Foe.new(Enemies.ENEMIES["BAT"], wide.x + 115.0, wide.y)
	for f in [near_plain, near_wide]:
		f.max_hp = 10000.0
		f.hp = 10000.0
	# Garlic reaches 110. The foe at 115 is outside it -- and inside it once Area is
	# taken. That is the whole difference between a passive that works and one that is
	# merely stored.
	var shots: Array = []
	WeaponFire.fire(def, plain, [near_plain], shots)
	WeaponFire.fire(def, wide, [near_wide], shots)
	_check(near_plain.hp == 10000.0, "a foe past the base range is untouched", "hp %0.0f" % near_plain.hp)
	_check(near_wide.hp < 10000.0, "and IS hit once Area extends the reach", "hp %0.0f" % near_wide.hp)

func _cooldown_shortens_the_timer() -> void:
	# `cooldownMult` is NEGATIVE in the data, so `1 + effect` is 0.92 and a stack must
	# SHORTEN the timer. A sign error here would make the passive a penalty.
	var h := Hero.new(0, 0)
	h.add_passive(_def("cooldown"))
	_check(h.cooldown_mult() < 1.0, "Cooldown shortens the timer, not lengthens it", "%0.4f" % h.cooldown_mult())

func _growth_multiplies_xp() -> void:
	var plain := Hero.new(0, 0)
	var fast := Hero.new(0, 0)
	fast.add_passive(_def("growth"))
	plain.gain_exp(10.0)
	fast.gain_exp(10.0)
	_check(fast.exp > plain.exp, "Growth grants more XP for the same orb", "%0.1f vs %0.1f" % [plain.exp, fast.exp])

func _vitality_raises_the_ceiling_and_heals() -> void:
	var h := Hero.new(0, 0)
	var before := h.max_hp
	h.add_passive(_def("max_hp"))
	_check(h.max_hp > before, "Vitality raises max HP", "%0.0f -> %0.0f" % [before, h.max_hp])
	# Taking it must not leave you at the same health with a bigger bar.
	_check(h.hp == h.max_hp, "and heals by the same amount, so it is not a downgrade", "hp %0.0f" % h.hp)

func _weapon(id: String) -> Dictionary:
	for def in Weapons.WEAPONS.values():
		if def["id"] == id:
			return def
	return Weapons.WEAPONS.values()[0]

func _check(cond: bool, label: String, detail: String) -> void:
	if cond:
		print("  ok   %s  (%s)" % [label, detail])
	else:
		print("  FAIL %s  (%s)" % [label, detail])
		ok = false
