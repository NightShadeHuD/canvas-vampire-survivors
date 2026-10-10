# GENERATED FILE -- DO NOT EDIT BY HAND.
#
# Source of truth: src/config.ts
# Regenerate with:  npm run export:godot
#
# Every key is its own `const` so the compiler can check a use site. A single
# Dictionary would make every typo a runtime null instead of a parse error.
extends RefCounted
class_name Difficulty

const EASY := {"id": "easy", "label": "Easy", "hpMult": 0.75, "dmgMult": 0.75, "spawnMult": 0.8}
const NORMAL := {"id": "normal", "label": "Normal", "hpMult": 1, "dmgMult": 1, "spawnMult": 1}
const HARD := {"id": "hard", "label": "Hard", "hpMult": 1.3, "dmgMult": 1.25, "spawnMult": 1.25}
const NIGHTMARE := {"id": "nightmare", "label": "Nightmare", "hpMult": 1.75, "dmgMult": 1.5, "spawnMult": 1.6}
