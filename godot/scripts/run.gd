## The tallies a single run accumulates, which the achievement conditions read.
##
## Ported from the `run` object in `src/main.ts`. Named fields rather than a Dictionary
## because every one is read by a CONDITION in `achievements.gd`, and a typo in a
## string key is a runtime null while a typo in a field is a compile error.
##
## These are separate from `Game` because they outlive it: `Game` is the simulation and
## this is the scorecard. A future leaderboard reads this and nothing else.
extends RefCounted
class_name Run

## Bosses beaten, keyed by id. `boss_slayer` and `void_breaker` read one each.
var bosses_defeated: Dictionary = {}
## The wall-clock seconds to the void lord, for `speed_demon`'s time window.
var real_seconds_to_void_lord := 0.0
var void_lord_defeated := false

## Set when any weapon reaches `WEAPON_MAX_LEVEL`.
var maxed_weapon := false
var maxed_weapon_count := 0
## Set when an evolution happens before seven minutes, for `early_evolve`.
var evolved_before_seven_min := false

## Longest stretch without being hit, in seconds.
var longest_unhit := 0.0
var orbs_collected := 0
## Passives taken. `zen_5min` needs this to be ZERO after five minutes.
var passives_picked := 0

var no_hit_boss := false
var konami_code := false
var fast_boss_clear := false
## Seconds spent having provoked a pacifist run -- see `pacifist_provoked`.
var pacifist_timer := 0.0
