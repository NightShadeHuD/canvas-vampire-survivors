# GENERATED FILE -- DO NOT EDIT BY HAND.
#
# Source of truth: src/data.ts
# Regenerate with:  npm run export:godot
#
# Editing this file directly creates a second source of truth, and the first time a
# weapon's damage is tuned in TypeScript the two will disagree with nothing to say so.
extends RefCounted
class_name Passives

const PASSIVES := {"MAX_HP": {"id": "max_hp", "name": "Vitality", "icon": "❤️", "description": "Max HP +20%", "effect": {"maxHpMult": 0.2}}, "RECOVERY": {"id": "recovery", "name": "Recovery", "icon": "💚", "description": "Regen +0.5 HP/s", "effect": {"hpRegen": 0.5}}, "ARMOR": {"id": "armor", "name": "Armor", "icon": "🛡️", "description": "Damage taken -1", "effect": {"armor": 1}}, "MOVESPEED": {"id": "movespeed", "name": "Swiftness", "icon": "👟", "description": "Move speed +10%", "effect": {"speedMult": 0.1}}, "MIGHT": {"id": "might", "name": "Might", "icon": "💪", "description": "Damage +10%", "effect": {"damageMult": 0.1}}, "AREA": {"id": "area", "name": "Area", "icon": "📏", "description": "Weapon range +10%", "effect": {"areaMult": 0.1}}, "COOLDOWN": {"id": "cooldown", "name": "Cooldown", "icon": "⏱️", "description": "Attack speed +8%", "effect": {"cooldownMult": -0.08}}, "MAGNET": {"id": "magnet", "name": "Magnet", "icon": "🧲", "description": "Pickup range +25%", "effect": {"magnetMult": 0.25}}, "GROWTH": {"id": "growth", "name": "Growth", "icon": "📈", "description": "XP gain +10%", "effect": {"expMult": 0.1}}, "LUCK": {"id": "luck", "name": "Luck", "icon": "🍀", "description": "Crit chance +5%", "effect": {"critChance": 0.05}}, "DODGE": {"id": "dodge", "name": "Evasion", "icon": "💨", "description": "Dodge chance +5%", "effect": {"dodgeChance": 0.05}}, "MAGNET_PLUS": {"id": "magnet_plus", "name": "Pickup Magnet+", "icon": "🧲", "description": "Pickup range +35%", "effect": {"magnetMult": 0.35}}, "DAMAGE_REDUCTION": {"id": "damage_reduction", "name": "Bulwark", "icon": "🛡️", "description": "Incoming damage -8%", "effect": {"damageReduction": 0.08}}}
