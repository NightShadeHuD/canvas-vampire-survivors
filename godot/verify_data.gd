# A smoke check run BY GODOT, asserting the generated data matches the TypeScript.
# Syntax acceptance is not correctness: this reads real fields and compares them
# against values taken from `src/data.ts`.
extends SceneTree

func _init() -> void:
	var weapons = load("res://data/weapons.gd").WEAPONS
	var enemies = load("res://data/enemies.gd").ENEMIES
	var passives = load("res://data/passives.gd").PASSIVES
	Check.unchanged(weapons.size(), 11, "weapon count")
	Check.unchanged(enemies.size(), 11, "enemy count")
	Check.unchanged(passives.size(), 13, "passive count")
	Check.unchanged(weapons["WHIP"]["baseDamage"], 20, "WHIP baseDamage")
	Check.approx(weapons["WHIP"]["baseCooldown"], 1.5, "WHIP baseCooldown")
	Check.unchanged(weapons["GARLIC"]["type"], "aura", "GARLIC type")
	Check.unchanged(weapons["KNIFE"]["piercing"], true, "KNIFE piercing")
	Check.unchanged(weapons["WHIP"]["evolveName"], "Bloody Sweep", "WHIP evolveName")

	var passed := Check.ok
	print("verify_data: ", "PASS" if passed else "FAIL")
	quit(0 if passed else 1)
