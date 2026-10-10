# GENERATED FILE -- DO NOT EDIT BY HAND.
#
# Source of truth: src/data.ts
# Regenerate with:  npm run export:godot
#
# Editing this file directly creates a second source of truth, and the first time a
# weapon's damage is tuned in TypeScript the two will disagree with nothing to say so.
extends RefCounted
class_name Bosses

const BOSSES := {"REAPER": {"id": "reaper", "name": "The Reaper", "hp": 2500, "speed": 80, "damage": 40, "exp": 500, "color": "#220033", "size": 48, "boss": true, "ability": "summon", "spawnAt": 300}, "VOID_LORD": {"id": "void_lord", "name": "Void Lord", "hp": 6000, "speed": 60, "damage": 60, "exp": 1200, "color": "#550077", "size": 64, "boss": true, "ability": "charge", "spawnAt": 600}, "NECROMANCER": {"id": "necromancer", "name": "Necromancer", "hp": 4200, "speed": 70, "damage": 50, "exp": 850, "color": "#3a1a4a", "size": 54, "boss": true, "ability": "summon", "spawnAt": 450}, "CHRONO_LICH": {"id": "chrono_lich", "name": "Chrono Lich", "hp": 10000, "speed": 55, "damage": 75, "exp": 2000, "color": "#0b2a4a", "size": 72, "boss": true, "ability": "charge", "spawnAt": 720}, "ICE_QUEEN": {"id": "ice_queen", "name": "The Ice Queen", "hp": 6200, "speed": 55, "damage": 60, "exp": 1300, "color": "#88ccff", "size": 66, "boss": true, "ability": "charge", "spawnAt": 660, "iceQueen": true}}
