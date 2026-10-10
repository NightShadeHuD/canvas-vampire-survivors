# A smoke check run BY GODOT, asserting the generated data matches the TypeScript.
# Syntax acceptance is not correctness: this reads real fields and compares them
# against values taken from `src/data.ts`.
extends SceneTree

func _init() -> void:
	var weapons = load("res://data/weapons.gd").WEAPONS
	var enemies = load("res://data/enemies.gd").ENEMIES
	var passives = load("res://data/passives.gd").PASSIVES
	var ok := true

	ok = _check(weapons.size(), 11, "weapon count") and ok
	ok = _check(enemies.size(), 11, "enemy count") and ok
	ok = _check(passives.size(), 13, "passive count") and ok
	ok = _check(weapons["WHIP"]["baseDamage"], 20, "WHIP baseDamage") and ok
	ok = _check(weapons["WHIP"]["baseCooldown"], 1.5, "WHIP baseCooldown") and ok
	ok = _check(weapons["GARLIC"]["type"], "aura", "GARLIC type") and ok
	ok = _check(weapons["KNIFE"]["piercing"], true, "KNIFE piercing") and ok
	ok = _check(weapons["WHIP"]["evolveName"], "Bloody Sweep", "WHIP evolveName") and ok

	print("verify_data: ", "PASS" if ok else "FAIL")
	quit(0 if ok else 1)

func _check(got, want, label: String) -> bool:
	if got == want:
		print("  ok   %s = %s" % [label, str(got)])
		return true
	print("  FAIL %s: got %s, want %s" % [label, str(got), str(want)])
	return false
