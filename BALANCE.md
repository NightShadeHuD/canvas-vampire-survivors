# Balance Cheat Sheet

All tunables live in [`src/data.js`](./src/data.js) and
[`src/config.js`](./src/config.js). Numbers here mirror those files; when you
change a value, update both to keep reviewers happy.

## Global scaling

| Constant                    | Value                                                                         | Notes                                               |
| --------------------------- | ----------------------------------------------------------------------------- | --------------------------------------------------- |
| `PLAYER_SPEED`              | 240                                                                           | pixels / second                                     |
| `INVINCIBILITY_TIME`        | 0.5 s                                                                         | i-frames after taking damage                        |
| `WEAPON_MAX_LEVEL`          | 5                                                                             | level 5 triggers evolution for eligible weapons     |
| `PASSIVE_MAX_STACK`         | 5                                                                             | stacks per passive                                  |
| `MAGNET_BASE`               | 120                                                                           | base pickup radius                                  |
| `HIGHSCORE_SLOTS`           | 10                                                                            | leaderboard depth                                   |
| `MAX_ENEMIES`               | 300                                                                           | hard cap per frame                                  |
| Difficulty hp / dmg / spawn | Easy 0.75/0.75/0.8 · Normal 1.0 · Hard 1.3/1.25/1.25 · Nightmare 1.75/1.5/1.6 | hp / damage / spawn-rate multipliers, in that order |

Time-scaling: every 60 s in a run, enemy HP + damage both multiply by 1.3×
(`timeDiff = 1 + floor(gameTime/60) * 0.3`).

## Weapons

Level scaling applied uniformly unless a weapon opts out:

- `damage = base × (1 + (lvl − 1) × 0.2) × player.damageMult`
- `cooldown = base × 0.92^(lvl − 1) × player.cooldownMult`
- `range = base × (1 + (lvl − 1) × 0.1) × player.areaMult`

| Weapon     | Type       | Base Dmg | CD (s) | Range | Evolves at | Evolution                          |
| ---------- | ---------- | -------- | ------ | ----- | ---------- | ---------------------------------- |
| Whip       | melee      | 20       | 1.5    | 90    | 5          | Bloody Sweep (full circle)         |
| Magic Wand | projectile | 15       | 1.2    | 320   | 5          | Seeker Storm (+2 bolts)            |
| Knife      | projectile | 12       | 0.4    | 420   | 5          | Blade Fan (5 blades)               |
| Orbiter    | orbit      | 16       | 0.4    | 120   | 5          | Twin Halo (double ring)            |
| Lightning  | instant    | 35       | 3.0    | 420   | 5          | Thunder Call (3 strikes, +2 chain) |
| Area Mine  | mine       | 45       | 2.2    | 100   | 5          | Cluster Mine (twin drop)           |
| Garlic     | aura       | 5        | 0.2    | 110   | —          | —                                  |

Crit: multiplicative (×2) roll on projectile/melee/lightning contact; only
gated by the Luck passive (5% per stack).

## Passives (each stack is additive in its effect field)

| Passive   | Icon | Effect / stack     |
| --------- | ---- | ------------------ |
| Vitality  | ❤️   | +20% Max HP        |
| Recovery  | 💚   | +0.5 HP regen / s  |
| Armor     | 🛡️   | −1 damage taken    |
| Swiftness | 👟   | +10% move speed    |
| Might     | 💪   | +10% damage        |
| Area      | 📏   | +10% weapon range  |
| Cooldown  | ⏱️   | +8% attack speed   |
| Magnet    | 🧲   | +25% pickup radius |
| Growth    | 📈   | +10% XP gained     |
| Luck      | 🍀   | +5% crit chance    |

## Enemies (base values, pre-difficulty)

| ID        | Archetype | HP  | Speed | Dmg | XP  | Notes                                 |
| --------- | --------- | --- | ----- | --- | --- | ------------------------------------- |
| bat       | chaser    | 15  | 110   | 10  | 10  | Opening filler                        |
| zombie    | chaser    | 30  | 70    | 15  | 15  | Slow but tanky                        |
| skeleton  | chaser    | 25  | 95    | 12  | 12  | Baseline mid                          |
| wolf      | dasher    | 40  | 150   | 20  | 20  | Dashes every 3.5 s for 0.6 s          |
| golem     | shielded  | 120 | 45    | 30  | 50  | Shield absorbs 50% until 60 shield hp |
| ghost     | chaser    | 20  | 130   | 18  | 18  | Fast squishy                          |
| mage      | ranged    | 28  | 70    | 8   | 22  | Fires projectiles at 360 range        |
| slime     | splitter  | 55  | 65    | 14  | 24  | On death → 2 slimelings               |
| slimeling | chaser    | 18  | 105   | 8   | 6   | Splitter spawn                        |

## Bosses

| ID        | HP    | Dmg | Ability           | Spawns at |
| --------- | ----- | --- | ----------------- | --------- |
| reaper    | 2 500 | 40  | Summons 3 adds    | 5:00      |
| void_lord | 6 000 | 60  | 120 px telecharge | 10:00     |

Both bosses also multiply HP/damage by the time-scaling factor and difficulty
modifier, so a Nightmare Void Lord at 10:00 runs at ~6 000 × 1.75 × 1.3^10 hp.

## Wave director

Wave windows in `src/data.js` (`WAVES`). Each entry declares a pool of enemy
ids and a spawn-rate multiplier, blended with difficulty. After the last entry
(`from: 600`), the director loops with a 2.0× spawn multiplier and the full
enemy pool.

## Achievements + unlocks

Earning an achievement can unlock a weapon as a starter option. Chain:

| Achievement     | Starter unlock |
| --------------- | -------------- |
| `first_blood`   | Magic Wand     |
| `slayer_100`    | Knife          |
| `survive_5min`  | Orbiter        |
| `boss_slayer`   | Lightning      |
| `survive_10min` | Area Mine      |
