# GENERATED FILE -- DO NOT EDIT BY HAND.
#
# Source of truth: src/data.ts
# Regenerate with:  npm run export:godot
#
# Editing this file directly creates a second source of truth, and the first time a
# weapon's damage is tuned in TypeScript the two will disagree with nothing to say so.
extends RefCounted
class_name Waves

const WAVES := [{"from": 0, "to": 30, "pool": ["bat", "zombie"], "spawnMult": 1, "label": "Opening"}, {"from": 30, "to": 60, "pool": ["bat", "zombie", "skeleton"], "spawnMult": 1.1, "label": "Wave 2"}, {"from": 60, "to": 90, "pool": ["zombie", "skeleton", "mage"], "spawnMult": 1.15, "label": "Cultists"}, {"from": 90, "to": 120, "pool": ["skeleton", "wolf", "ghost", "mage"], "spawnMult": 1.2, "label": "Pack"}, {"from": 120, "to": 180, "pool": ["wolf", "ghost", "slime", "mage", "bomber"], "spawnMult": 1.3, "label": "Splitters"}, {"from": 180, "to": 240, "pool": ["wolf", "golem", "ghost", "slime", "bomber"], "spawnMult": 1.4, "label": "Vanguard"}, {"from": 240, "to": 300, "pool": ["golem", "ghost", "slime", "mage", "illusionist"], "spawnMult": 1.5, "label": "Pressure"}, {"from": 300, "to": 420, "pool": ["wolf", "golem", "ghost", "slime", "mage", "bomber", "illusionist"], "spawnMult": 1.6, "label": "Post-Reaper"}, {"from": 420, "to": 600, "pool": ["golem", "slime", "mage", "ghost", "wolf", "illusionist"], "spawnMult": 1.75, "label": "Escalation"}, {"from": 600, "to": null, "pool": ["golem", "slime", "mage", "ghost", "wolf", "skeleton", "bomber", "illusionist"], "spawnMult": 2, "label": "Endgame"}]
