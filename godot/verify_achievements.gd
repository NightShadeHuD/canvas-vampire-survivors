## Every achievement in the data must be reachable, and fire at the right threshold.
##
## WHY THIS EXISTS
##
## `scripts/export-godot.mjs` has reported `21  a function -- needs a hand-written func`
## on every run since it was written. Those 21 were the port worklist, and this file is
## what closes them.
##
## It drives the GENERATED table, so an achievement added to `src/data.ts` later fails
## here until a condition is written for it -- rather than sitting in the game looking
## earnable and being impossible.
##
##   godot --headless --path godot --script res://verify_achievements.gd
extends SceneTree

var ok := true

func _init() -> void:
	_every_definition_has_a_condition()
	_no_orphan_conditions()
	_thresholds_fire_on_the_boundary()
	_earned_achievements_do_not_refire()
	_conditions_read_the_run_as_well_as_the_game()
	_a_missing_save_is_not_a_crash()

	print("verify_achievements: ", "PASS" if ok else "FAIL")
	quit(0 if ok and Check.ok else 1)

## The headline. A definition with no condition is unreachable in play.
func _every_definition_has_a_condition() -> void:
	var missing: Array = []
	var conds := AchievementTracker.conditions()
	for def in Achievements.ACHIEVEMENTS:
		if not conds.has(def["id"]):
			missing.append(def["id"])
	Check.unchanged(
		missing.size(), 0,
		"EVERY achievement definition has a condition%s" % ("" if missing.is_empty() else " -- missing: " + ", ".join(missing))
	)
	# And the count is the one the exporter reports, so the two cannot drift apart.
	Check.approx(
		float(Achievements.ACHIEVEMENTS.size()), 21.0,
		"and the generated table holds all 21", 0.5
	)

## A condition with no definition can never fire. Dead code that looks like coverage.
func _no_orphan_conditions() -> void:
	var defined := {}
	for def in Achievements.ACHIEVEMENTS:
		defined[def["id"]] = true
	var orphans: Array = []
	for id in AchievementTracker.conditions():
		if not defined.has(id):
			orphans.append(id)
	Check.unchanged(
		orphans.size(), 0,
		"no condition is orphaned%s" % ("" if orphans.is_empty() else " -- orphans: " + ", ".join(orphans))
	)

## Boundary and one past it, which is how this project pins an edge. A `>=` written as
## `>` passes a "fires when true" test and fails a player who reaches exactly 100 kills.
func _thresholds_fire_on_the_boundary() -> void:
	var g := Game.without_spawns()
	var r := Run.new()
	var conds := AchievementTracker.conditions()

	var cases := [
		# id, how to set the state, the value ON the boundary
		["first_blood", func(): g.kills = 0, func(): g.kills = 1, "kills"],
		["slayer_100", func(): g.kills = 99, func(): g.kills = 100, "kills"],
		["slayer_1000", func(): g.kills = 999, func(): g.kills = 1000, "kills"],
		["survive_5min", func(): g.elapsed = 299.0, func(): g.elapsed = 300.0, "seconds"],
		["survive_10min", func(): g.elapsed = 599.0, func(): g.elapsed = 600.0, "seconds"],
		["survive_15min", func(): g.elapsed = 899.0, func(): g.elapsed = 900.0, "seconds"],
		["level_20", func(): g.hero.level = 19, func(): g.hero.level = 20, "level"],
		["xp_hoarder", func(): r.orbs_collected = 99, func(): r.orbs_collected = 100, "orbs"],
		["untouchable", func(): r.longest_unhit = 59.0, func(): r.longest_unhit = 60.0, "seconds"],
		["max_all", func(): r.maxed_weapon_count = 5, func(): r.maxed_weapon_count = 6, "weapons"],
	]
	for case in cases:
		var id: String = case[0]
		var below: Callable = case[1]
		var at: Callable = case[2]
		var unit: String = case[3]
		_reset(g, r)
		below.call()
		var quiet: bool = not conds[id].call(g, r)
		at.call()
		var fires: bool = conds[id].call(g, r)
		Check.unchanged(quiet, true, "%s stays quiet one %s below" % [id, unit])
		Check.unchanged(fires, true, "%s fires ON the boundary" % id)

## An achievement already in the save must not be reported again, or the toast fires
## every frame it stays true.
func _earned_achievements_do_not_refire() -> void:
	var g := Game.without_spawns()
	var r := Run.new()
	g.kills = 100
	var fresh := AchievementTracker.newly_earned(g, r, {})
	Check.at_least(float(fresh.size()), 1.0, "100 kills earns something", )
	Check.unchanged(fresh.has("slayer_100"), true, "and it is slayer_100")

	var already := {"slayer_100": true}
	var again := AchievementTracker.newly_earned(g, r, already)
	Check.unchanged(again.has("slayer_100"), false, "and an EARNED one is not reported again")

## Three conditions read `run` rather than `game`. A tracker that only ever looked at
## the game would report those as permanently unearned.
func _conditions_read_the_run_as_well_as_the_game() -> void:
	var g := Game.without_spawns()
	var r := Run.new()
	var conds := AchievementTracker.conditions()

	Check.unchanged(conds["boss_slayer"].call(g, r), false, "no boss defeated -> no boss_slayer")
	r.bosses_defeated["reaper"] = true
	Check.unchanged(conds["boss_slayer"].call(g, r), true, "and defeating the reaper earns it")

	Check.unchanged(conds["zen_5min"].call(g, r), false, "zen_5min needs five minutes first")
	g.elapsed = 300.0
	Check.unchanged(conds["zen_5min"].call(g, r), true, "then it fires with no passives taken")
	r.passives_picked = 1
	Check.unchanged(conds["zen_5min"].call(g, r), false, "and one passive is enough to lose it")

	# `speed_demon` needs BOTH halves. Defeating the boss slowly is `void_breaker`.
	r.void_lord_defeated = true
	r.real_seconds_to_void_lord = 0.0
	Check.unchanged(conds["speed_demon"].call(g, r), false, "a missing time is not a fast time")
	r.real_seconds_to_void_lord = 299.0
	Check.unchanged(conds["speed_demon"].call(g, r), true, "under five minutes earns speed_demon")
	r.real_seconds_to_void_lord = 301.0
	Check.unchanged(conds["speed_demon"].call(g, r), false, "and over it does not")

## `triple_build` reads a lifetime SAVE total, which a bare Game does not have.
func _a_missing_save_is_not_a_crash() -> void:
	var g := Game.without_spawns()
	var r := Run.new()
	var earned := AchievementTracker.newly_earned(g, r, {})
	Check.unchanged(earned.has("triple_build"), false, "no save means no lifetime total, not a crash")

func _reset(g: Game, r: Run) -> void:
	g.kills = 0
	g.elapsed = 0.0
	g.hero.level = 1
	r.orbs_collected = 0
	r.longest_unhit = 0.0
	r.maxed_weapon_count = 0
