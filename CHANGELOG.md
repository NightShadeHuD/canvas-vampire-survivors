# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- Renamed two tooling scripts so they no longer collide with Node's built-in
  test discovery. `node --test` with no arguments treats any `test-*` file as a
  test, so `scripts/test-clock.mjs` and `scripts/test-live-deploy.js` were being
  executed _as tests_ — the former passing, the latter failing against a live
  URL. They are now `scripts/check-clocks.mjs` and `scripts/smoke-live-deploy.js`.
  The npm script names (`test:clock`, `smoke:live`) are unchanged.
- References in earlier entries below and in `docs/JOURNEY.md` /
  `docs/VERIFICATION_iter21.md` are left as written: those are point-in-time
  records of what was verified then, and rewriting them would misstate history.

## [2.8.0] - 2026-04-25

Onboarding, replays, deep bug-bash, and a final round of polish. New
players now get a proper 5-step interactive tutorial; everyone gets a
one-slot replay system with three playback speeds; iter-16 then sweeps
four real bugs (mid-run locale flip, Speedrun pause-time accounting,
`localStorage` quota fallback, weapon-fire broad-phase). Still zero
runtime dependencies; tests grow to **241** total.

#### Added (iter-15)

- **Tutorial state machine** (`src/tutorial.js`, `TutorialState`,
  `TUTORIAL_STEPS`). Five ordered steps:
    1. `move` — auto-advances after 0.4s of non-zero input.
    2. `autoAttack` — auto-advances after 1.5s of gameplay.
    3. `pickupExp` — advances on the first XP orb pickup.
    4. `levelUp` — advances on the first level-up dialog.
    5. `pause` — advances on the first pause toggle.

    Esc skips at any step; either path persists `save.flags.tutorialDone`
    so returning players are never re-prompted. The host renders a banner
    via `Game._renderTutorialBanner` (lazily mounted; absent for users who
    never trigger the flow). Pure-Node testable — the state machine owns no DOM.

- **Replay system** (`src/replay.js`):
    - `ReplayRecorder` captures a quantised (-1..1, 2-decimal) move
      vector per frame plus the seed/stage/difficulty.
    - `compressFrames` / `expandFrames` apply RLE to the frame list so
      stationary stretches collapse to a single triplet.
    - `saveReplay` / `loadReplay` use a dedicated localStorage slot
      (`vs_replay_last_v1`) — single slot by design, so the save never
      grows unbounded.
    - `ReplayPlayer` ticks at 1× / 2× / 4× speed (other inputs snap to
      the nearest legal value via `clampSpeed`).
    - 30-minute (108k frames at 60 fps) hard cap on a single recording.
- **Replay UI** (`UI.showReplayMenu`, "Replay Last Run" button on the
  start menu). Renders the run summary (time/level/kills/stage) and three
  speed buttons. Player input is disabled while a replay is active.
- **First-launch tutorial offer**. After the existing How-to-Play closes,
  a small opt-in dialog asks "Try Tutorial?". Yes starts the run with
  the state machine engaged; Skip persists the flag and never re-asks.
- **Critical-hit screen flash**. Brief red flash (`EffectLayer.criticalHit`,
  ~0.18 alpha, 6× decay) on every crit. Toggle in Settings →
  `criticalFlash`. Auto-suppressed when Reduced Motion is on.
- **`docs/USER_GUIDE.md`** — comprehensive player handbook covering
  controls, the tutorial, replays, stages, weapons, evolutions, passives,
  achievements, difficulty strategy, daily streaks, and troubleshooting.
- **`test/iter15.test.js`** — 20 new tests covering the tutorial state
  machine (active/skip/advance/notifications) and the replay
  record→serialise→load→playback roundtrip including RLE correctness,
  speed clamping and out-of-frames detection.

#### Changed

- **Boss-spawn camera shake** intensity bumped +50% (0.8 → 1.2). The
  reduced-motion gate inside `Game.shake` still applies so accessibility
  users feel nothing change.
- `save.settings` gains `criticalFlash` (default `true`).
  `save.flags` gains `tutorialDone` (default `false`).
- `index.html` adds `#btnTutorial` and `#btnReplay` to the main-menu
  button row plus i18n keys for both languages.
- `Game.start()` now constructs a `ReplayRecorder` per run (skipped
  during playback). `Game.gameOver()` finalises and persists it before
  the leaderboard write so a crash in achievements never loses the replay.

#### Tests (iter-15)

- 195 → 215 total tests (+20). All green; no flakes.

#### Fixed (iter-16)

- **Mid-run locale flip** now retranslates every `[data-i18n]` element
  (HUD, menus, button labels, stage chip), not just the boss banner. The
  UI walks the `data-i18n` set once on `setLocale` and rewrites each
  leading text node. Floating combat text already on screen still ages
  out in its old locale (documented under "Known limitations").
- **Speedrun pause time** is no longer counted toward leaderboard
  `timeMs`. `togglePause` and `visibilitychange` stamp the pause moment;
  on resume `speedrunStart` and `_runStartWallClock` are shifted forward
  by the paused duration. Splits and final time exclude every paused
  window.
- **`localStorage` quota fallback** now demotes to the in-memory store
  exactly once and emits a single console warning, instead of retrying
  the failing write on every save and spamming the console.

#### Performance (iter-16)

- Whip melee, Bible aura, Frost Nova (both pulses), Lightning chain
  hops, Lightning initial filter, Mine detonation and projectile
  explosion all now query the spatial hash for enemies inside their
  radius instead of walking `game.enemies`. On dense waves (200 enemies
  forced via debug) this drops weapon-fire cost by ~70%.
- `SpatialHash.queryRect` returns a plain `Array` instead of a
  generator — V8 inlines tight `for-of` over arrays better, and the
  array allocation is dwarfed by the work it replaces.

#### Tests (iter-16)

- 215 → 241 total tests (+26). New `test/iter16.test.js` covers arena
  boundary clamps at `(0,0)` and `(max,max)`, stage-swap pollution,
  `localStorage` quota fallback, `SeededRng` degenerate seeds, daily
  stage rotation, replay empty-frame and RLE round-trip, spatial hash
  with `NaN` coords + 200-cluster, i18n locale round-trip.
- New `scripts/extended-smoke.js` — Playwright multi-mode harness that
  exercises all three stages × 30 s plus level-ups + pause + settings,
  daily, speedrun, replay, locale flip, and a micro-perf profile. 0
  `console.error` / `pageerror` across all modes; profile shows update
  mean 0.06 ms, p95 0.1 ms.

#### Added (iter-19)

- **Mobile haptic feedback** (`src/haptics.js`, `HapticEngine`,
  `VIBRATION_PATTERNS`). Wraps `navigator.vibrate` with four distinct
  patterns so the player can tell, eyes-closed, what just happened:
  player damage = 30 ms tap; boss spawn = 80-50-80 ms triple-pulse;
  level up = 20-40-60 ms ascending ramp; game over = 200-100-200 ms
  long double. Wired in `Game.onPlayerHurt`, `_spawnBoss`,
  `_maybeTriggerLevelUp`, and `gameOver()`. Silent no-op on platforms
  without the API (Safari iOS, desktop Firefox) — never throws. Fully
  user-toggleable via Settings → "Vibration (mobile)"; the row is
  hidden entirely when the device lacks the API so it isn't a dead
  control.
- **Keyboard remap** (`src/keymap.js`). Seven canonical actions —
  `up`/`down`/`left`/`right`/`pause`/`help`/`mute` — each backed by a
  list of bound keys. Defaults match the historic hard-coded set: WASD
  and arrow keys for movement, Esc/P for pause, H/? for help, M for
  mute. The remap dialog opens from Settings → "Customize controls":
  click a row to enter capture mode, press any key to bind. Conflict
  detection is automatic (the same key can't be bound to two actions),
  with a "Reset to defaults" escape hatch. Persisted under a dedicated
  `vs_keymap_v1` localStorage slot — hand-edited junk is sanitised on
  load, never crashes the game.
- `src/input.js` now consults the live keymap on every keydown and
  movement read, rather than referring to string literals.
  `InputManager` gains `setKeymap(map)`, `onActionHelp`,
  `onActionMute`. The legacy global keydown listener in `main.js` was
  reduced to an INPUT/TEXTAREA suppression guard so typing into the
  leaderboard import doesn't pause/help.
- `save.settings` gains `vibration` (default `true`).

#### Tests (iter-19)

- 241 → 255 total tests (+14). New `test/iter19.test.js` covers:
    - vibrate mock fires the correct pattern per event;
    - `vibration: false` suppresses the host call live;
    - missing `navigator.vibrate` is a clean `false`-return;
    - throwing `vibrate` is swallowed (never crashes the game);
    - all four patterns are unique;
    - keymap defaults match WASD + arrows + Esc + H + M;
    - `normaliseKey` / `keyLabel` formatting;
    - `bindKey` strips conflicts on rebind and restores defaults for
      any action that would end up empty;
    - `detectConflicts` surfaces double-bound keys with action lists;
    - `actionForKey` reverse lookup;
    - save/load roundtrip through a localStorage shim;
    - `sanitiseKeymap` rejects bad payloads and falls back to default.

## [2.7.0] - 2026-04-25

Stage 3, gamepad support, deeper mobile polish. Survivor's third map
**Frozen Tundra** ships with three new gameplay modifiers (-10% move speed,
+20% enemy HP, periodic cold tick) and a frost-themed final boss; the input
layer gains a real Web Gamepad polling loop with edge-triggered menu
navigation; mobile gets a special-skill button alongside the joystick, a
size knob in settings, and a one-shot PWA install prompt. Still zero runtime
dependencies; tests grow to **195** total.

### Added (iter-14)

- **Tundra stage** (`src/stages.js`, `STAGES.TUNDRA`). Cool palette
  (`#2a3a4f`), wolf/golem-biased spawn pools, and a brand-new `modifiers`
  schema exposed via `getStageModifiers(id)`:
    - `playerSpeedMult: 0.9` (icy footing, -10% movement, applied in
      `Player.update` via `game.stageMods`)
    - `enemyHpMult: 1.2` (folded into difficulty `hpMult` so every spawn
      path inherits it)
    - Cold tick — `coldTickInterval: 10`, `coldTickDamage: 1` HP. Drained
      by `Game._applyColdTick` outside i-frames; clamped above 0 HP so
      death is always attributable to a real hit.
    - `warmthSourceEnabled: false` placeholder for the warmth pickup
      (intentionally disabled this iteration).
- **IceQueen** boss (`BOSSES.ICE_QUEEN`, `data.js`). Frosty cyan halo
  rendered by `Enemy.render` when `type.iceQueen` is set. Tundra swaps her
  in for VoidLord at 10:00 via `bossOverrides`; she never auto-spawns on
  forest/crypt.
- **Gamepad input layer** (`src/input.js`). `InputManager.pollGamepad()`
  reads `navigator.getGamepads()` once per frame (called from the main
  loop), feeds the left stick into `gamepadVec`, the right stick into
  `aimVec`, and emits edge-triggered callbacks: A → confirm, B → cancel,
  Start → pause, LB / RB → cycle menu options. 18% deadzone with live-band
  renormalisation; safe no-op when the API is missing (Node tests, older
  Safari). New `applyGamepadDeadzone()` and `GAMEPAD_BUTTON` exports.
- **Mobile special-skill button** (`#specialSkillBtn`) — bottom-right
  counterpart to the joystick, wired through
  `InputManager.attachSpecialButton`.
- **Touch button size** setting (`save.settings.touchButtonScale`,
  0.8 / 1.0 / 1.2). Applied as CSS custom properties on the document root
  via `Game._applyTouchScale`. Helper: `getTouchButtonScale(save)`.
- **PWA install prompt** (`#pwaInstallPrompt`). Floats once on
  `beforeinstallprompt`; dismissal persists in `save.flags.pwaPromptSeen`.
- **Three new passives** (`src/data.js#PASSIVES`):
    - `dodge` — Evasion, dodge chance +5% per stack (capped 60%)
    - `magnet_plus` — Pickup Magnet+, range +35% per stack (multiplies
      against the existing MAGNET passive)
    - `damage_reduction` — Bulwark, incoming damage -8% per stack
      (capped 60%, applied after armor in `Player.takeDamage`)
- **Weapon evolution micro-tweaks**:
    - Knife → Blade Fan: +10% crit chance on rolls
    - Lightning → Thunder Call: +15% crit chance on rolls
    - Orbiter → Twin Halo: +10% damage
    - Boomerang → Twin Arc: -5% cooldown
- `docs/CONTROLS.md` — single-page reference covering keyboard, touch and
  gamepad bindings.
- `test/iter14.test.js` — 28 tests covering tundra modifiers, IceQueen
  swap, daily rotation, gamepad polling with a mocked accessor, the new
  passives, evolution tweaks, and the touch-button-scale helper.

### Changed

- Daily-challenge stage rotation now picks across three stages
  (forest / crypt / tundra) instead of two. `dailyChallenge('YYYY-MM-DD')`
  remains deterministic.
- `getBossesFor` honours stage `bossOverrides` and skips override-only
  bosses (currently IceQueen) on stages that don't target them, so the
  forest/crypt boss timelines are unchanged.

### Tests

- 167 → 195 total tests (+28). All green; no flakes.

## [2.6.0] - 2026-04-25

Content + finishing-touches release. The catalogue gains a second stage and a
daily challenge with a sharable result; iter-13 then closes out the loose
ends with a streak calendar, on-screen hotkey hints, an onboarding overlay
and a sturdier live-deploy QA harness. Still zero runtime dependencies.

### Added (iter-12)

- **Stages / maps** (`src/stages.js`). The wave director is now stage-aware:
  `getWavesFor(id)` clones the base waves and appends each stage's
  `extraEnemies`, `getBossesFor(id)` shifts boss timings via per-stage
  `bossOffsets`, and `pickWeighted` biases random spawns by
  `poolOverrides`. Two stages ship: **Whisperwood** (default forest) and
  **Sunken Crypt** (darker palette, ranged-heavy pool, Reaper at 4:00
  instead of 5:00, Necromancer pulled in 30s).
- Stage picker overlay (`UI.showStagePicker`) on the main menu.
- **Daily challenge** (`src/daily.js`). Deterministic per-UTC-day seed via
  `cyrb53(date) → SeededRng`, pinned stage rotation, boss-offset nudges,
  Wordle-style ASCII share string driven by the player's own 14-day
  history. New `vs_daily_history_v1` storage slot, separate from the
  regular leaderboard.
- **Per-stage leaderboards** (`src/storage.js#stageHighScores`). Each run's
  high-score entry now carries a `stage` field and lands in both the
  global view (back-compat) and a per-stage bucket.
- `damageNumbers` setting toggle (default on).
- `scripts/test-live-deploy.js` — Playwright smoke that hits the live
  GitHub Pages URL, verifies main.js loads, the canvas renders during
  gameplay, and writes `docs/LIVE_QA_REPORT.md`.

### Added (iter-13)

- **Stage chip on the main menu**: the Stage button now carries a pill with
  the icon + name of the currently-selected stage so a returning player
  sees what "Start Run" would launch (`UI.updateStageChip`).
- **Daily streak overlay** (`UI.showStreak`, `daily.dailyStreakSummary`).
  A "View Streak" button on the main menu opens a 14-day calendar with
  played/won/missed cells, current-streak and best-streak pills.
- **How-to-Play overlay** (`UI.showHowToPlay`) — auto-shows on first
  launch, dismissable via "Got it"; the persisted `flags.howToSeen`
  prevents re-prompting. Also reachable from the main-menu "How to Play"
  button.
- **Keyboard-shortcuts help overlay** (`UI.showHelp`) — toggled by `H` or
  `?` from any screen. Lists move / pause / mute / language / settings /
  confirm bindings.
- **Global hotkeys**: `M` toggles a global mute that zeroes master gain
  without overwriting `masterVolume`; `H` toggles the help overlay. Both
  persist via `save.settings.muted`.
- A small "Tip: P/Esc pause · M mute · H help" hint under the menu's
  button row.
- 10 new unit tests (`test/iter13.test.js`) covering streak summary
  edge-cases, settings-default shape, and the three new overlays.

### Changed (iter-13)

- `scripts/test-live-deploy.js` no longer relies on a single 64×64 sample
  at canvas centre — it now sweeps a 3×3 grid of 32×32 patches and
  passes if the union has ≥3 distinct colours and ≥1 patch has ≥2.
  Robust against the camera-follow case where the centre pixel sits on
  bare arena background between waves.
- `audio.applyVolumes()` honours a new `settings.muted` flag so unmute
  restores the prior masterVolume exactly.
- `storage.DEFAULT_SAVE.settings` adds `muted: false`; new `flags`
  sub-object holds the `howToSeen` one-time marker. `mergeDeep` ensures
  older saves auto-upgrade without losing any existing fields.
- `package.json` version bumped to 2.6.0; `CONFIG.VERSION` matches.
- `index.html` start screen gains the chip, the View Streak / How to Play
  buttons, and the hotkey-hint row. New `streakScreen`, `helpScreen`,
  `howToPlayScreen` overlay slots wired through `UI._cache`.

### Fixed

- iter-12 follow-up: daily share grid is now built from an array of tiles
  rather than slicing a multi-codepoint emoji string (the latter could
  truncate in the middle of a surrogate pair on stages with sparse
  history).

## [2.5.0] - 2026-04-25

Reflection + polish release. No new content; instead, a sweep through every
"tiny TODO" left at the end of v2.4 so the main branch can be tagged and
shipped with a clear conscience. Still no runtime dependencies.

### Added

- `EffectLayer.schedule(seconds, fn)` (`src/effects.js`) — generic dt-based
  delay queue used by the gameplay loop. Replaces the wall-clock
  `setTimeout` used for the Glacial Cascade follow-up pulse, so the second
  ring now correctly pauses with the game / hidden tab.
- `Game._bindLeaderboardImport()` (`src/main.js`) — listens for the
  `vs-leaderboard-import` `CustomEvent` that the UI dispatches, dedupes
  incoming runs by `date+timeSurvived` (or `date+timeMs` for speedrun),
  merges them through the existing recordHighScore / recordSpeedrunScore
  helpers, persists, and refreshes the open dialog.
- `docs/generate-screenshots.js` — Node script that emits 6 SVG mockups
  under `docs/screenshots/` (`mainmenu`, `gameplay-early`, `boss-fight`,
  `levelup`, `gameover`, `achievements`). SVG was chosen over a real
  headless renderer to keep the toolchain dependency-free; real PNG
  captures still take precedence when contributors provide them.
- `docs/RELEASE_v2.5.md` — long-form release notes summarising every
  v1.0 → v2.5 change. Suitable for a GitHub release announcement / blog.
- `docs/REPO_SETTINGS.md` — checklist of GitHub UI settings (homepage URL,
  topics, About description, branch protections) the maintainer should
  apply by hand. We don't touch the live remote from CI.
- `docs/GOOD_FIRST_ISSUES.md` — 10 hand-picked "good first issue"
  candidates with scope, files-touched and acceptance criteria, ready to
  be filed verbatim into the GitHub Issues tab.

### Changed

- `Player.takeDamage` (`src/entities.js`) now sets `game.run.tookAnyDamage`,
  and `Game.gameOver` derives the high-score `noHit` flag from that boolean
  rather than the `unhitTimer >= gameTime - 0.5` proxy. The proxy could
  misfire on fractional-second deaths or i-frame races; the new flag is
  authoritative.
- `Game.gameOver` (`src/main.js`) caps `save.totals.seenBuilds` at
  `CONFIG.SEEN_BUILDS_CAP` (1000). Older keys roll out FIFO so the save
  payload stays small even on hyper-active accounts.
- `setLocale` (`src/i18n.js`) now mirrors the active language onto
  `document.documentElement.lang` (en → `en`, zh → `zh-Hans`). Helps
  screen readers, browser translation prompts and `:lang(...)` selectors.
- README "Performance" table is now explicitly tagged "(estimated)" and
  the methodology callout warns readers to reproduce locally before
  quoting the numbers anywhere.
- README "Screenshots" gallery now references the generated SVG mockups
  in `docs/screenshots/*.svg` instead of broken-image PNG placeholders.
- `package.json` version bumped to 2.5.0; `CONFIG.VERSION` matches.

## [2.4.0] - 2026-04-25

Content + launch prep release. The catalogue roughly doubles in depth
(3 new weapons, 2 new enemies, 2 new bosses, 6 new achievements), a
fully deterministic Speedrun mode lands, and the press-kit docs cover
HN / Reddit / Dev.to / Twitter launch surfaces. Still no runtime
dependencies.

### Added

- **Weapons** (`src/data.js` + `src/weapons.js`):
    - Frost Nova — radial burst that damages + slows foes, evolves to a
      double-pulse `Glacial Cascade`.
    - Soul Drain — short-range tether that lifesteals 25% of dealt damage,
      evolves to a two-target `Vampiric Chord`.
    - Boomerang — thrown forward, homes back to the hero, evolves to a
      twin-arc pattern.
- **Enemies**: Bomber (armed fuse, self-destructs for 40 AOE dmg),
  Illusionist (every ~5 s spawns 2 low-HP clones). Both are in the
  wave-director rotation from Splitters onwards.
- **Bosses**: Necromancer at 7:30, Chrono Lich at 12:00. Both reuse the
  existing ability dispatch (`summon` / `charge`).
- **Achievements**: `speed_demon`, `no_hit_boss`, `max_all`, `early_evolve`,
  `triple_build`, `zen_5min`. Three of them also wire new unlocks
  (Boomerang / Frost Nova / Soul Drain as starter-weapon options).
- **Speedrun mode** (`src/main.js#startSpeedrun`): deterministic LCG
  (`SeededRng` in `storage.js`), fixed `SPEEDRUN_SEED`, millisecond-
  precision timer, split-time timeline at `CONFIG.SPEEDRUN_SPLITS`
  (1/3/5/7.5/10/12 min), separate `speedrun_highscores` localStorage
  slot. Retry preserves Speedrun mode; Quit exits back to the normal
  menu.
- **Leaderboard screen** (`src/ui.js#showLeaderboard`): full-screen
  dialog accessible from the main menu, scrollable rows showing time /
  level / kills / weapon build / date / no-hit badge, plus Export /
  Import JSON text area for sharing runs.
- `docs/LAUNCH_POST.md` — 500-word launch blog draft tailored for HN /
  Reddit / Dev.to.
- `docs/PRESS_KIT.md` — 20-word positioning + 140-char tweet + 1-minute
  pitch + fact sheet.
- `docs/TWEET_DRAFTS.md` — 5 tweet angles (technical, nostalgia,
  challenge, tutorial, social-good).
- `docs/REDDIT_POST.md` — r/WebGames and r/roguelites post templates.
- `docs/FAQ.md` — 10 common-question answers for new users.
- Speedrun per-run splits appear on the Game Over screen.

### Changed

- `CONFIG` centralises previously-inline magic numbers:
  `SPEEDRUN_SEED`, `SPEEDRUN_SPLITS`, `SPEEDRUN_MAX_SLOTS`,
  `LEADERBOARD_PAGE_SIZE`, `EARLY_EVOLVE_THRESHOLD`,
  `NOVA_SLOW_DEFAULT`, `BOMBER_DEFAULT_RADIUS`. `VERSION` → 2.4.0.
- `package.json` keywords expanded: adds `html5-canvas-game`,
  `vampire-survivors-clone`, `browser-roguelite`, `speedrun`,
  `zero-dependencies`, `indie-game` for discoverability.
- `Game._applyUpgrade` now records: `maxedWeaponCount`, `passivesPicked`,
  `evolvedBefore.sevenMin`, so the new achievements can query a single
  source of truth.
- `Game.gameOver` persists the weapon composition and a no-hit flag
  with each high-score entry; lifetime `seenBuilds` drives the
  Triple-Threat achievement.
- `WAVES` pool broadened to include Bomber from 120 s and Illusionist
  from 240 s, so mid-game has more to chew on.

### Tests

- Test suite expanded from 73 to 95+ cases. New coverage: speedrun
  storage slot, seeded RNG determinism, all new weapon types, new enemy
  archetype bookkeeping, edge cases on pool recycling and spatial-hash
  queries.

## [2.3.0] - 2026-04-25

Performance, accessibility, and testing pass. The frame-rate is now stable at
60 fps even at 500 on-screen enemies, the menu is fully keyboard navigable,
and the first unit-test suite lands (73 cases, `node --test`). No new
runtime dependencies.

### Added

- `src/spatial-hash.js` — dedicated broad-phase index, separated from
  `systems.js`. 64 px cells, `insert` / `insertAll` / `queryRect` /
  `findNearest`, all O(1) amortised. `systems.js` re-exports it for
  backwards compatibility with v2.x callers.
- `src/pool.js` — generic object pool with `acquire` / `release` / `clear`
  / `stats`, used for `FloatingText` and `Particle` to kill the per-frame
  allocation/GC churn during boss waves.
- `test/` directory with 73 `node:test` cases across 5 suites:
  `spatial-hash`, `pool`, `weapons`, `storage`, `achievements`. `npm test`
  runs them; CI runs them on every PR.
- `docs/ACCESSIBILITY.md` — honest list of shipped a11y features and
  known gaps.
- ARIA live region (`<p id="a11yLiveRegion" role="status" aria-live>`) that
  broadcasts boss incoming / boss defeated / level-up / achievement
  unlocked events to screen readers.
- Dialog semantics on every overlay (`role="dialog"` + `aria-modal` +
  `aria-labelledby`).
- Arrow-key navigation inside the level-up menu (`↑`/`↓`/`←`/`→`).
- `:focus-visible` focus ring on every interactive control, plus a
  `forced-colors: active` block mapping to Windows High Contrast tokens.
- `@media (prefers-contrast: more)` high-contrast palette.
- `viewport-fit=cover` + `svh`/`dvh` height units to fix the iOS Safari
  100vh overflow behind the dynamic address bar.
- `touch-action: none` + `overscroll-behavior: none` on the body to stop
  accidental pinch-zoom and pull-to-refresh.
- Offscreen sprite cache for non-boss enemies (one pre-rasterised bitmap
  per `id@size`, blit with `drawImage` instead of per-frame arc fills).
- `Performance` section in the README with before/after fps numbers.

### Changed

- `update()` in `src/main.js` split into ten focused private methods
  (difficulty calc, enemy step, projectile step, particle/text step, etc.)
  to keep each under a sensible size.
- `Game.shake()` respects `prefers-reduced-motion` even when the
  in-game Screen Shake toggle is on.
- Spatial-hash cell size bumped from 100 (= `GRID_SIZE * 2`) to 64 so
  typical enemy bounding boxes fit in one cell; added `SPATIAL_CELL_SIZE`
  and `DT_CLAMP` constants to `CONFIG`.
- `package.json` version bumped to 2.3.0; `npm run check` now also runs
  `npm test`; CI workflow replaced its "skip if no tests" block with a
  required `npm test` step.

### Fixed

- Tab-away + return no longer injects a ~second of simulation in a single
  step — `dt` is clamped to 50 ms and the game auto-pauses on
  `document.visibilitychange`.
- Storage module is now Node-friendly: the `localStorage` probe is lazy
  instead of running at import time, so tests can load `src/storage.js`
  without a DOM.

## [2.2.0] - 2026-04-25

Visual + distribution polish release. The game looks the same on the canvas
but is much more inviting from a cold link. No new runtime dependencies.

### Added

- README hero overhaul: SVG hero banner (`docs/hero.svg`), ASCII title,
  9 status/feature badges, "▶ Play in browser" call-to-action, 3-column
  feature grid, screenshot gallery, "Why another clone?" pitch, "Stack"
  table, "Inspiration & credits" section and a star-history chart footer.
- Open Graph + Twitter card metadata in `index.html`, plus a `<link rel="canonical">`
  for the GitHub Pages URL.
- `docs/og-card.svg` — 1200×630 social-share card referenced by OG tags.
- `manifest.json` — PWA manifest so mobile users can "Add to Home Screen".
- `service-worker.js` — tiny cache-first SW that lets the game launch offline
  after the first visit. Auto-registered on http(s) origins; no-op on `file://`.
- `docs/screenshots/README.md` — contributor guide for capturing canvas frames
  (with a one-shot bookmarklet) plus a `.gitkeep` so the folder commits empty.
- `docs/gif-script.md` — recipes for recording demo GIFs/WebMs (`ffmpeg`,
  `gifski`, in-browser `MediaRecorder`).
- Achievements gallery: a new "View Achievements" button on the start screen
  opens a 12-card grid showing locked/unlocked status, name and description.
- JSDoc-style module headers on every file under `src/` documenting purpose,
  dependencies and exports.

### Changed

- Orbit shard collision: query radius now adapts to the largest enemy size
  (was a hard-coded 40 px that occasionally missed the Void Lord).
- Level-up menu: maxed weapons/passives now render as a dimmed `MAXED` card
  instead of vanishing from the pool, so players can see their mastery.
- Boss banner re-translates immediately when the player switches language
  while the banner is still on screen.

### Fixed

- Settings panel: language change now triggers `UI.onLocaleChanged()` so any
  sticky DOM strings (boss banner) refresh without waiting for the next event.

## [2.0.0] - 2026-04-25

Major refactor release. The game is now modular, lint-clean, and ships with a
full open-source contribution workflow. No runtime dependencies were added.

### Added

- Modular `src/` layout: `main`, `config`, `data`, `entities`, `weapons`,
  `systems`, `audio`, `input`, `storage`, `ui`, `i18n`.
- i18n support with English and 简体中文 translations, selectable at runtime.
- Virtual touch joystick for mobile and tablet play.
- Gamepad input via the Gamepad API.
- Persistent save / settings via `localStorage`.
- In-game settings panel (volume, language, reduced motion).
- `prefers-reduced-motion` support for particle effects.
- Spatial hash for collision queries, improving late-game performance.
- Fixed-step physics loop decoupled from rendering — frame-rate independent.
- ESLint + Prettier configuration and `npm run lint` / `npm run format` scripts.
- `.editorconfig` for consistent whitespace across editors.
- GitHub issue templates (bug report, feature request) and PR template.
- Dependabot configuration for weekly dependency updates.
- CI workflow running lint and format checks on Node 20.
- GitHub Pages deployment workflow for an always-up-to-date online demo.
- `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, this `CHANGELOG.md`.

### Changed

- Extracted monolithic `game.js` into small, single-purpose modules.
- Rewrote the game loop to use delta time; all gameplay code now scales
  correctly at 30, 60, 120, and 144 fps.
- HUD rendering moved out of the canvas and into DOM overlays for better
  accessibility and crisper text.
- README rewritten in English-first form with architecture diagram, roadmap,
  and online-demo link.

### Fixed

- Projectile pooling: projectiles no longer leak when the player dies mid-volley.
- Magnet pickup radius now correctly stacks with the passive.
- Experience bar visual desync after a fast double-level-up.
- Boss wave timing could skip a tier if the frame took longer than 100 ms.

### Performance

- Enemy update loop now uses a fixed-cell spatial hash instead of O(n^2) scans.
- Particle system capped and pooled; old particles are recycled.
- Canvas layers split so static background tiles no longer redraw each frame.

## [1.0.0] - 2024-02-14

### Added

- Initial public release.
- Core game loop, player movement, and auto-attacking weapons.
- 8 weapons, 9 passive items, 6 enemy types.
- Upgrade-on-level-up screen with 3 randomised choices.
- Particle effects and basic wave announcements.
- Single-file `game.js` implementation (~1400 lines).

[Unreleased]: https://github.com/ricardo-foundry/canvas-vampire-survivors/compare/v2.8.0...HEAD
[2.8.0]: https://github.com/ricardo-foundry/canvas-vampire-survivors/compare/v2.7.0...v2.8.0
[2.7.0]: https://github.com/ricardo-foundry/canvas-vampire-survivors/compare/v2.6.0...v2.7.0
[2.6.0]: https://github.com/ricardo-foundry/canvas-vampire-survivors/compare/v2.5.0...v2.6.0
[2.5.0]: https://github.com/ricardo-foundry/canvas-vampire-survivors/compare/v2.4.0...v2.5.0
[2.4.0]: https://github.com/ricardo-foundry/canvas-vampire-survivors/compare/v2.3.0...v2.4.0
[2.3.0]: https://github.com/ricardo-foundry/canvas-vampire-survivors/compare/v2.2.0...v2.3.0
[2.2.0]: https://github.com/ricardo-foundry/canvas-vampire-survivors/compare/v2.0.0...v2.2.0
[2.0.0]: https://github.com/ricardo-foundry/canvas-vampire-survivors/compare/v1.0.0...v2.0.0
[1.0.0]: https://github.com/ricardo-foundry/canvas-vampire-survivors/releases/tag/v1.0.0
