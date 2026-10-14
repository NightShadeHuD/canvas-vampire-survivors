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

## The `-> Evolve Name` tag `src/ui.ts` puts under an option whose NEXT level IS the
## weapon's evolution, or `""` when this offer is not that one:
##
##     const willEvolve = up.type === 'weapon' && !isMaxed &&
##                        lvl + 1 === up.data.evolveLevel && up.data.evolveName;
##
## Every term of that condition is here, read off the DEF rather than written down:
## a weapon added to `src/data.ts` with an `evolveName` gets the tag with no edit to
## this file, and a weapon without one gets nothing. `evolveName` is the fifth
## evolution field, and this is the only thing in either game that reads it.
##
## `""` rather than null, so a caller can concatenate without asking.
##
## `->` AND NOT THE ORIGINAL'S `\u2192`, deliberately. The original renders
## `\u2192 ${evolveName}`; every name and description this picker draws today is
## ASCII (`node -e` over `godot/data/weapons.gd`: 0 of 22 non-ASCII), so a rightwards
## arrow would be the first glyph the Godot UI asks its default theme font for, and
## Godot renders an uncovered codepoint as a tofu box. That is a player-visible
## defect nothing in this repository can catch: `check:pixels` needs a DISPLAY and
## does not render the picker's text metrics. The ASCII arrow says the same thing.
static func evolve_tag(entry: Dictionary) -> String:
	if entry["type"] != "weapon":
		return ""
	var def: Dictionary = entry["def"]
	var name := str(def.get("evolveName", ""))
	if name == "":
		return ""
	# `!isMaxed`. Redundant while every `evolveLevel` is at or below the cap, and kept
	# because the original has it: a def that evolved past the cap shows no tag rather
	# than promising a level the game will not offer.
	if int(entry["level"]) >= int(Config.WEAPON_MAX_LEVEL):
		return ""
	if int(entry["level"]) + 1 != int(def.get("evolveLevel", 0)):
		return ""
	return "-> %s" % name

## Apply a pick to the hero. Returns what happened, so the caller can tell a new
## weapon from a levelled one.
static func apply(hero: Hero, entry: Dictionary) -> String:
	var def: Dictionary = entry["def"]
	if entry["type"] == "weapon":
		if hero.has_weapon(def["id"]):
			return "levelled" if hero.level_weapon(def["id"]) else "maxed"
		hero.add_weapon(def)
		return "new"
	# The DEF is passed, not an id: an effect lives on the def, so a count alone
	# cannot change anything.
	return "passive" if hero.add_passive(def) else "maxed"
