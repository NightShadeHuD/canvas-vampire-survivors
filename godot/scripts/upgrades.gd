## Building the level-up choices.
##
## Pure: no nodes, no rendering, no randomness the caller cannot seed. `verify_xp.gd`
## drives it directly, which is the same reason `game.gd` holds no `_draw`.
##
## Ported from `buildUpgradePool` and the pick block in `src/ui.ts`.
extends RefCounted
class_name Upgrades

## Every upgrade the hero could be offered: all weapons, then all passives.
##
## The original returns `[...live, ...maxed]` -- live options first, with maxed ones
## appended as a fallback -- and the caller takes a prefix. Reproduced as two lists
## rather than one, because the split is the part that matters.
static func pool(hero: Hero) -> Array:
	var live: Array = []
	var maxed: Array = []

	for id in Weapons.WEAPONS:
		var def: Dictionary = Weapons.WEAPONS[id]
		var lvl := hero.weapon_level(def["id"])
		var entry := {"type": "weapon", "def": def, "level": lvl}
		if lvl >= int(Config.WEAPON_MAX_LEVEL):
			maxed.append(entry)
		else:
			live.append(entry)

	for id in Passives.PASSIVES:
		var def: Dictionary = Passives.PASSIVES[id]
		var stack := hero.passive_count(def["id"])
		var entry := {"type": "passive", "def": def, "level": stack}
		if stack >= int(Config.PASSIVE_MAX_STACK):
			maxed.append(entry)
		else:
			live.append(entry)

	return [live, maxed]

## Choose `count` distinct upgrades, live ones first.
##
## `maxed` is only reached into when `live` cannot fill the offer -- which happens
## once a hero has nearly everything, and is the original's behaviour.
static func choose(hero: Hero, count: int = 3, rng: RandomNumberGenerator = null) -> Array:
	var parts := pool(hero)
	var live: Array = parts[0].duplicate()
	var maxed: Array = parts[1].duplicate()
	var picks: Array = []

	while picks.size() < count and live.size() > 0:
		var i := _next_index(rng, live.size())
		picks.append(live[i])
		live.remove_at(i)
	while picks.size() < count and maxed.size() > 0:
		var i := _next_index(rng, maxed.size())
		picks.append(maxed[i])
		maxed.remove_at(i)

	return picks

static func _next_index(rng: RandomNumberGenerator, n: int) -> int:
	if rng == null:
		return randi() % n
	return rng.randi() % n

## The label the original puts beside an option: " (New!)", " (Lv.2)", " (MAXED)".
static func label(entry: Dictionary) -> String:
	var lvl: int = int(entry["level"])
	var capped := (
		lvl >= int(Config.WEAPON_MAX_LEVEL)
		if entry["type"] == "weapon"
		else lvl >= int(Config.PASSIVE_MAX_STACK)
	)
	if capped:
		return " (MAXED)"
	if lvl > 0:
		return " (Lv.%d)" % (lvl + 1) if entry["type"] == "weapon" else " (x%d)" % (lvl + 1)
	return " (New!)"

## Apply a pick to the hero. Returns what happened, so the caller can tell a new
## weapon from a levelled one.
static func apply(hero: Hero, entry: Dictionary) -> String:
	var def: Dictionary = entry["def"]
	if entry["type"] == "weapon":
		if hero.has_weapon(def["id"]):
			return "levelled" if hero.level_weapon(def["id"]) else "maxed"
		hero.add_weapon(def)
		return "new"
	# Passives are counts, not objects; the hero tracks them by id.
	return "passive"
