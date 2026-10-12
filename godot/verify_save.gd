## The save file: it round-trips, it survives a missing or corrupt file, and it makes
## `triple_build` reachable.
##
## The last one is the point. `triple_build` reads a LIFETIME total, so before this
## file existed it could NEVER fire -- the achievement list was decorative. A test that
## only checked "saving works" would have missed that entirely.
##
##   godot --headless --path godot --script res://verify_save.gd
extends SceneTree

var ok := true
const TMP := 'user://save_verify_tmp.json'

func _init() -> void:
	_round_trips()
	_merges_an_older_file()
	_survives_a_missing_file()
	_survives_a_corrupt_file()
	_earned_achievements_persist()
	_unique_builds_counts_DISTINCT_builds()
	_triple_build_can_finally_fire()

	print("verify_save: ", "PASS" if ok and Check.ok else "FAIL")
	quit(0 if ok and Check.ok else 1)

func _write(text: String) -> void:
	var f := FileAccess.open(SaveData.PATH, FileAccess.WRITE)
	f.store_string(text)
	f.close()

func _round_trips() -> void:
	var s := SaveData.new()
	s.set_value("totals.kills", 42)
	s.set_value("settings.difficulty", "hard")
	Check.unchanged(s.save_to_disk(), true, "a save writes")

	var back := SaveData.load_from_disk()
	Check.unchanged(int(back.get_value("totals.kills", -1)), 42, "and its numbers come back")
	Check.unchanged(str(back.get_value("settings.difficulty", "")), "hard", "and its settings")

## The reason `mergeDeep` exists in `src/storage.ts`: a file written by an older build
## is MISSING fields the current one reads.
func _merges_an_older_file() -> void:
	_write('{"totals": {"kills": 7}}')
	var s := SaveData.load_from_disk()
	Check.unchanged(int(s.get_value("totals.kills", -1)), 7, "an older file's own values survive")
	Check.unchanged(int(s.get_value("totals.runs", -1)), 0, "and fields it LACKED get their default")
	# `Check.approx`, NOT `int(...)`: wrapping a float in `int()` truncates 0.6 to 0
	# and the check fails against a correct merge. Floats are never compared by equality
	# here, and never coerced to compare them.
	Check.approx(float(s.get_value("settings.masterVolume", -1)), 0.6, "including nested ones")

func _survives_a_missing_file() -> void:
	var err := DirAccess.remove_absolute(ProjectSettings.globalize_path(SaveData.PATH))
	var s := SaveData.load_from_disk()
	Check.unchanged(err == OK or err == ERR_FILE_NOT_FOUND, true, "the file was removed for the test")
	Check.unchanged(int(s.get_value("totals.runs", -1)), 0, "a missing save yields defaults, not a crash")

func _survives_a_corrupt_file() -> void:
	# A save is the one thing a player cannot regenerate. Reading it must never be fatal.
	_write('{ this is not json at all')
	var s := SaveData.load_from_disk()
	Check.unchanged(int(s.get_value("totals.runs", -1)), 0, "a CORRUPT save yields defaults, not a crash")
	_write('[1, 2, 3]')
	var s2 := SaveData.load_from_disk()
	Check.unchanged(int(s2.get_value("totals.runs", -1)), 0, "and so does valid JSON of the wrong shape")

func _earned_achievements_persist() -> void:
	var s := SaveData.new()
	Check.unchanged(s.earn("first_blood"), true, "an achievement is earned once")
	Check.unchanged(s.earn("first_blood"), false, "and not again")
	s.save_to_disk()

	var back := SaveData.load_from_disk()
	Check.unchanged(back.has_earned("first_blood"), true, "and it survives a restart")
	Check.unchanged(back.has_earned("slayer_100"), false, "while an unearned one stays unearned")
	# The timestamp, not just the flag: the UI needs to know WHEN.
	Check.at_least(float(back.get_value("achievements.first_blood", 0)), 1.0, "with the time it was earned")

## `uniqueBuilds` is DISTINCT compositions. Counting every run would make `triple_build`
## say "play three times", which is not what its description says.
func _unique_builds_counts_DISTINCT_builds() -> void:
	var s := SaveData.new()
	s.record_run(10, 60.0, "whip+armor")
	s.record_run(10, 60.0, "whip+armor")
	Check.unchanged(int(s.get_value("totals.uniqueBuilds", -1)), 1, "the same build twice is ONE unique build")
	Check.unchanged(int(s.get_value("totals.runs", -1)), 2, "but it is two runs")
	s.record_run(10, 60.0, "knife+might")
	s.record_run(10, 60.0, "orbit+area")
	Check.unchanged(int(s.get_value("totals.uniqueBuilds", -1)), 3, "and three distinct builds are three")

## The achievement that could never fire before this file existed.
func _triple_build_can_finally_fire() -> void:
	var s := SaveData.new()
	Check.unchanged(AchievementTracker.newly_earned(Game.without_spawns(), Run.new(), {}).has("triple_build"), false,
		"a fresh save cannot earn triple_build")
	s.record_run(1, 10.0, "a")
	s.record_run(1, 10.0, "b")
	s.record_run(1, 10.0, "c")

	var g := Game.without_spawns()
	# Overridden AFTER construction: `Game._init` loads the player's real save, and a
	# test that inherited it would pass or fail depending on what they had unlocked.
	g.save = s.data
	var earned := AchievementTracker.newly_earned(g, Run.new(), {})
	Check.unchanged(earned.has("triple_build"), true, "three distinct builds EARN it")

	# And already-earned ones are not reported twice.
	var again := AchievementTracker.newly_earned(g, Run.new(), {"triple_build": true})
	Check.unchanged(again.has("triple_build"), false, "and an earned one is not reported again")

	DirAccess.remove_absolute(ProjectSettings.globalize_path(SaveData.PATH))
