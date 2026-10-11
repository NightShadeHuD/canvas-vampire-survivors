## The achievement tracker, and the twenty-one conditions.
##
## WHY THE CONDITIONS ARE HERE AND NOT IN THE DATA
##
## `scripts/export-godot.mjs` reported exactly this, every run since it was written:
##
##     21  a function -- needs a hand-written `func`
##
## An achievement in `src/data.ts` carries `check: (c) => c.game.kills >= 100`.
## GDScript cannot hold a lambda in a Dictionary, so the DEFINITIONS are generated into
## `godot/data/achievements.gd` and the CONDITIONS live here. The generated file holds
## `null` where each belongs, so nothing looks finished that is not.
##
## Each condition is written out rather than table-driven, because they genuinely
## differ: some read the game, some the run, and three need both. A single expression
## string in the data would have to be either parsed or re-implemented anyway.
##
## The tracker is named `AchievementTracker` because the generated definitions already
## claim `class_name Achievements`, and two classes cannot share a name. The generated
## one wins: everything else in the project already refers to it.
##
## @module godot/achievements
extends RefCounted
class_name AchievementTracker

## id -> Callable(game, run) -> bool
##
## Built once and shared: the conditions are pure and capture nothing.
static var _conditions: Dictionary = {}

## Every condition, keyed by the id it belongs to. A condition whose id is not in the
## generated table is a typo, and `verify_achievements.gd` asserts the two agree.
static func conditions() -> Dictionary:
	if _conditions.is_empty():
		_conditions = {
			# --- kills -----------------------------------------------------------
			"first_blood": func(g: Game, _r: Run) -> bool: return g.kills >= 1,
			"slayer_100": func(g: Game, _r: Run) -> bool: return g.kills >= 100,
			"slayer_1000": func(g: Game, _r: Run) -> bool: return g.kills >= 1000,
			# --- bosses ----------------------------------------------------------
			"boss_slayer": func(_g: Game, r: Run) -> bool: return r.bosses_defeated.has("reaper"),
			"void_breaker": func(_g: Game, r: Run) -> bool: return r.bosses_defeated.has("void_lord"),
			# --- survival --------------------------------------------------------
			"survive_5min": func(g: Game, _r: Run) -> bool: return g.elapsed >= 300.0,
			"survive_10min": func(g: Game, _r: Run) -> bool: return g.elapsed >= 600.0,
			"survive_15min": func(g: Game, _r: Run) -> bool: return g.elapsed >= 900.0,
			# --- building --------------------------------------------------------
			"weapon_max": func(_g: Game, r: Run) -> bool: return r.maxed_weapon,
			"max_all": func(_g: Game, r: Run) -> bool: return r.maxed_weapon_count >= 6,
			"early_evolve": func(_g: Game, r: Run) -> bool: return r.evolved_before_seven_min,
			"level_20": func(g: Game, _r: Run) -> bool: return g.hero.level >= 20,
			# --- not being hit ---------------------------------------------------
			"untouchable": func(_g: Game, r: Run) -> bool: return r.longest_unhit >= 60.0,
			"no_hit_boss": func(_g: Game, r: Run) -> bool: return r.no_hit_boss,
			# --- collecting ------------------------------------------------------
			"xp_hoarder": func(_g: Game, r: Run) -> bool: return r.orbs_collected >= 100,
			# --- speed -----------------------------------------------------------
			# Both halves are required. `void_lord` alone is `void_breaker`, and the time
			# window is the whole point of this one.
			"speed_demon": func(_g: Game, r: Run) -> bool:
				return r.void_lord_defeated and r.real_seconds_to_void_lord > 0.0 and r.real_seconds_to_void_lord <= 300.0,
			"speedrun_plus": func(_g: Game, r: Run) -> bool: return r.fast_boss_clear,
			# --- restraint -------------------------------------------------------
			# Five minutes survived while having picked NO passives.
			"zen_5min": func(g: Game, r: Run) -> bool: return g.elapsed >= 300.0 and r.passives_picked == 0,
			# A minute of provocation without a single kill.
			"pacifist_provoked": func(g: Game, r: Run) -> bool: return r.pacifist_timer >= 60.0 and g.kills == 0,
			# --- secrets ---------------------------------------------------------
			"konami_code": func(_g: Game, r: Run) -> bool: return r.konami_code,
			# --- lifetime, not this run ------------------------------------------
			# `uniqueBuilds` is a SAVE total. Read through the game because the run does
			# not carry it -- and this is the one condition that can unlock on a run
			# where nothing happened.
			"triple_build": func(g: Game, _r: Run) -> bool: return _unique_builds(g) >= 3,
		}
	return _conditions

## Lifetime distinct builds, from the save. Zero when there is no save, which is the
## correct answer rather than a crash.
static func _unique_builds(g: Game) -> int:
	# Every step guarded, because each is a shape the caller might not have: no game,
	# no save, no totals. The first version checked only the first two and threw on a
	# `Game` that had no `save` member at all -- a runtime ERROR, which does not fail a
	# Godot suite, so it passed while printing a stack trace.
	if g == null:
		return 0
	var save = g.save
	if save == null or not (save is Dictionary):
		return 0
	var totals = save.get("totals")
	if totals == null or not (totals is Dictionary):
		return 0
	return int(totals.get("uniqueBuilds", 0))

## Every achievement that is now satisfied AND not already earned.
##
## Returns the newly-earned ids in the order the generated table lists them, so two runs
## over the same state produce the same order -- which a test can assert and a player
## never notices.
static func newly_earned(g: Game, r: Run, already: Dictionary) -> Array:
	var out: Array = []
	for def in Achievements.ACHIEVEMENTS:
		var id: String = def["id"]
		if already.has(id):
			continue
		var cond: Callable = conditions().get(id, Callable())
		if not cond.is_valid():
			# A definition with no condition is the generator's worklist, not a bug --
			# reported on every export. Skipped here so a missing one cannot crash a run.
			continue
		if cond.call(g, r):
			out.append(id)
	return out
