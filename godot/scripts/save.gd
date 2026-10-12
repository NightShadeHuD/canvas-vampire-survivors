## The save file, ported from `src/storage.ts`.
##
## WHAT THIS IS FOR
##
## Until now `Game.save` was a `Variant` that was always null, which meant achievements
## could not survive a restart and `triple_build` -- which reads a LIFETIME total --
## could never fire at all. A save is what turns the achievement list from decoration
## into a record.
##
## WHY THE DEFAULTS ARE EXPLICIT
##
## `src/storage.ts` has a `DEFAULT_SAVE` and a `mergeDeep` that fills a partial save
## from it, because a save written by an older version is MISSING fields the current
## one reads. Godot's `Dictionary.get(key, default)` does the same job per read, and
## every read here goes through `_get` so adding a field to the source cannot produce a
## null in a running game.
##
## WHY `user://` AND NOT A PATH
##
## Godot maps `user://` to the platform's per-application data directory. A hardcoded
## path would write into the project folder on one platform and fail on another.
##
## @module godot/save
extends RefCounted
class_name SaveData

const PATH := 'user://save.json'

var data: Dictionary = {}

## The shape from `src/storage.ts`'s `DEFAULT_SAVE`.
##
## Written out rather than derived, because it is a FILE FORMAT: an older build reading
## a newer file must find every field it expects, and a newer build reading an older one
## must not see nulls. A format that is inferred from whatever happens to be in the
## source today cannot promise either.
static func defaults() -> Dictionary:
	return {
		"highScore": {"kills": 0, "timeSurvived": 0, "level": 1},
		"highScores": [],
		"totals":
		{
			"kills": 0,
			"timePlayed": 0,
			"runs": 0,
			"bossKills": 0,
			"seenBuilds": [],
			"uniqueBuilds": 0
		},
		"achievements": {},
		"stageHighScores": {},
		"settings":
		{
			"masterVolume": 0.6,
			"sfxVolume": 0.8,
			"musicVolume": 0.4,
			"difficulty": "normal",
			"showFps": false,
			"screenShake": true,
			"reducedMotion": false,
			"colorblind": false,
			"musicEnabled": true,
			"muted": false,
			"vibration": true
		}
	}

func _init() -> void:
	data = defaults()

## Load from disk, falling back to defaults.
##
## A CORRUPT file yields defaults rather than an exception. A save is the one thing a
## player cannot regenerate, so the rule is: never let reading it be fatal, and never
## let it stop the game starting.
static func load_from_disk() -> SaveData:
	var s := SaveData.new()
	if not FileAccess.file_exists(PATH):
		return s
	var f := FileAccess.open(PATH, FileAccess.READ)
	if f == null:
		push_warning('save: could not open %s; starting from defaults' % PATH)
		return s
	var text := f.get_as_text()
	f.close()
	var parsed = JSON.parse_string(text)
	if not (parsed is Dictionary):
		push_warning('save: %s is not a JSON object; starting from defaults' % PATH)
		return s
	# Merged OVER the defaults, so a file written by an older build gains every field
	# it is missing rather than handing the game a null. This is `mergeDeep`'s job in
	# `src/storage.ts` and it is the reason that function exists.
	s.data = _merge(defaults(), parsed)
	return s

func save_to_disk() -> bool:
	var f := FileAccess.open(PATH, FileAccess.WRITE)
	if f == null:
		push_error('save: could not write %s' % PATH)
		return false
	f.store_string(JSON.stringify(data, '  '))
	f.close()
	return true

## Recursive fill: every key in `base` survives unless `over` supplies one, and nested
## Dictionaries merge rather than replace. Replacing would drop the defaults for every
## sibling of a field the old file happened to have.
static func _merge(base: Dictionary, over: Dictionary) -> Dictionary:
	var out := base.duplicate(true)
	for key in over:
		var v = over[key]
		if out.has(key) and out[key] is Dictionary and v is Dictionary:
			out[key] = _merge(out[key], v)
		else:
			out[key] = v
	return out

## A read that cannot return null. Every field the game touches goes through this.
func get_value(path: String, fallback: Variant = null) -> Variant:
	var node: Variant = data
	for part in path.split('.'):
		if not (node is Dictionary) or not node.has(part):
			return fallback
		node = node[part]
	return node

func set_value(path: String, value: Variant) -> void:
	var parts := path.split('.')
	var node: Dictionary = data
	for i in parts.size() - 1:
		var part: String = parts[i]
		if not (node.get(part) is Dictionary):
			node[part] = {}
		node = node[part]
	node[parts[parts.size() - 1]] = value

## Mark an achievement earned, with when. Returns false if it already was, so a caller
## can tell a first unlock from a repeat without reading the map itself.
func earn(achievement_id: String) -> bool:
	var earned: Dictionary = get_value("achievements", {})
	if earned.has(achievement_id):
		return false
	earned[achievement_id] = int(Time.get_unix_time_from_system())
	set_value("achievements", earned)
	return true

func has_earned(achievement_id: String) -> bool:
	var earned: Dictionary = get_value("achievements", {})
	return earned.has(achievement_id)

## Record a finished run into the lifetime totals.
##
## `uniqueBuilds` is what `triple_build` reads, and it is a COUNT OF DISTINCT
## compositions -- so the build is fingerprinted and only a NEW one increments it.
## Counting every run would make the achievement "play three times", which is not what
## it says.
func record_run(kills: int, seconds: float, build_key: String) -> void:
	set_value("totals.runs", int(get_value("totals.runs", 0)) + 1)
	set_value("totals.kills", int(get_value("totals.kills", 0)) + kills)
	set_value("totals.timePlayed", float(get_value("totals.timePlayed", 0.0)) + seconds)

	var seen: Array = get_value("totals.seenBuilds", [])
	if build_key != "" and not seen.has(build_key):
		seen.append(build_key)
		set_value("totals.seenBuilds", seen)
		set_value("totals.uniqueBuilds", seen.size())
