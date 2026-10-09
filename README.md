<!--
  Hero banner. The image is committed at docs/hero.svg so it loads on
  GitHub.com without external CDNs and works offline once cached.
-->

<p align="center">
  <img src="./docs/hero.svg" alt="Survivor — open-source HTML5 Canvas roguelite" width="720" />
</p>

```
   ____ _   _ ____  _   _ ___ __     __ ___  ____
  / ___| | | |  _ \| | | |_ _|\ \   / // _ \|  _ \
  \___ \| | | | |_) | | | || |  \ \ / /| | | | |_) |
   ___) | |_| |  _ <| |_| || |   \ V / | |_| |  _ <
  |____/ \___/|_| \_\\___/|___|   \_/   \___/|_| \_\
                  zero deps · typescript · MIT
```

<p align="center">
  <em>A zero-dependency HTML5 Canvas roguelite you can clone, play and ship in 30 seconds.</em>
</p>

<p align="center">
  <a href="./LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/License-MIT-yellow.svg"></a>
  <a href="https://github.com/NightShadeHuD/canvas-vampire-survivors/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/NightShadeHuD/canvas-vampire-survivors/actions/workflows/ci.yml/badge.svg"></a>
  <a href="https://github.com/NightShadeHuD/canvas-vampire-survivors"><img alt="Top language" src="https://img.shields.io/github/languages/top/NightShadeHuD/canvas-vampire-survivors.svg"></a>
  <a href="https://github.com/NightShadeHuD/canvas-vampire-survivors/commits"><img alt="Last commit" src="https://img.shields.io/github/last-commit/NightShadeHuD/canvas-vampire-survivors.svg"></a>
  <a href="./CONTRIBUTING.md"><img alt="Issues welcome" src="https://img.shields.io/badge/issues-welcome-brightgreen.svg"></a>
  <a href="./package.json"><img alt="Zero runtime deps" src="https://img.shields.io/badge/runtime%20deps-0-informational.svg"></a>
  <a href="https://developer.mozilla.org/en-US/docs/Web/JavaScript"><img alt="Made with TypeScript" src="https://img.shields.io/badge/made%20with-TypeScript-3178c6.svg"></a>
  <a href="./test"><img alt="Tests: 512" src="https://img.shields.io/badge/tests-512-success.svg"></a>
  <a href="./src/stages.ts"><img alt="Stages: 3" src="https://img.shields.io/badge/stages-3-blueviolet.svg"></a>
  <a href="./src/data.ts"><img alt="Weapons: 10" src="https://img.shields.io/badge/weapons-10-orange.svg"></a>
  <a href="./docs/JOURNEY.md"><img alt="Journey: 16 iterations" src="https://img.shields.io/badge/journey-16%20iters-lightgrey.svg"></a>
</p>

<p align="center">
  <a href="#-quickstart"><strong>▶ &nbsp;Run it locally</strong></a>
  &nbsp;·&nbsp;
  <a href="#-quickstart">Quickstart</a>
  &nbsp;·&nbsp;
  <a href="#-screenshots">Screenshots</a>
  &nbsp;·&nbsp;
  <a href="#why-another-vampire-survivors-clone">Why?</a>
  &nbsp;·&nbsp;
  <a href="#-contributing">Contribute</a>
</p>

---

## ✨ Feature grid

|                                                                  |                                                               |                                                                |
| ---------------------------------------------------------------- | ------------------------------------------------------------- | -------------------------------------------------------------- |
| 🧩 **Modular ES modules**<br/>Tiny readable files under `src/`.  | 🎨 **HTML5 Canvas**<br/>Fixed-step sim, smooth 60+ fps.       | 📦 **Zero runtime deps**<br/>No bundler, no build step.        |
| 🌐 **i18n built-in**<br/>EN + 简体中文 ship by default.          | 🎮 **Keyboard / touch / pad**<br/>All inputs first-class.     | 💾 **Local saves**<br/>`localStorage`, no backend.             |
| ⚙️ **Settings panel**<br/>Volume, language, motion.              | ♿ **Accessibility-aware**<br/>Reduced motion, high contrast. | 🧪 **Lint + format ready**<br/>ESLint, Prettier, CI on PR.     |
| 🕹️ **Roguelite loop**<br/>10 weapons w/ evolutions, 10 passives. | 👑 **Bosses & waves**<br/>Director with 10 named windows.     | 🏆 **Achievements & runs**<br/>12 unlocks, top-10 leaderboard. |

## 🎮 Controls

| Action          | Keyboard                                                     | Touch                 | Gamepad               |
| --------------- | ------------------------------------------------------------ | --------------------- | --------------------- |
| Move            | <kbd>W</kbd> <kbd>A</kbd> <kbd>S</kbd> <kbd>D</kbd> / arrows | Virtual joystick      | Left stick / D-pad    |
| Pause           | <kbd>Esc</kbd> / <kbd>P</kbd>                                | ⏸ button / edge tap×2 | <kbd>Start</kbd>      |
| Confirm choice  | <kbd>Enter</kbd> / <kbd>Space</kbd>                          | Tap option            | <kbd>A</kbd> / cross  |
| Cancel / back   | <kbd>Esc</kbd>                                               | Back button           | <kbd>B</kbd> / circle |
| Toggle settings | <kbd>,</kbd>                                                 | ⚙ icon                | <kbd>Select</kbd>     |
| Toggle language | <kbd>L</kbd>                                                 | Settings → Lang       | Settings → Lang       |
| Mute audio      | <kbd>M</kbd>                                                 | Settings → Music      | —                     |
| Help / hotkeys  | <kbd>H</kbd> / <kbd>?</kbd>                                  | "How to Play" button  | —                     |

## 🚀 Quickstart

```bash
git clone https://github.com/NightShadeHuD/canvas-vampire-survivors.git
cd canvas-vampire-survivors
npm install     # ESLint + Prettier only — zero runtime deps
npm start       # http://localhost:3000
```

Prefer no Node? Just open `index.html` directly in any modern browser, or
serve the folder with `python -m http.server`.

## 🌐 Play online

The browser loads the compiled output from `dist/`, which `npm run build`
produces. Serve the repository root over HTTP and open the page — GitHub Pages
is not enabled on this repository:

```bash
npm run build && npx serve .
```

The Pages build is also a [PWA](./manifest.json): on mobile, "Add to Home
Screen" gives you an offline-capable icon thanks to a tiny
[`service-worker.js`](./service-worker.js).

## 📸 Screenshots

Every tile below is a **real PNG capture** taken by
`node scripts/runtime-smoke.js` (headless Chromium + Playwright, dev-only).
The smoke harness fast-forwards game time via the `__SURV_DEBUG__` test hooks
to land on the boss / level-up / death scenes deterministically. SVG mockups
of the same scenes are archived under
[`docs/screenshots/svg/`](./docs/screenshots/svg/) for offline reference.

|                                                          |                                                         |                                                          |
| -------------------------------------------------------- | ------------------------------------------------------- | -------------------------------------------------------- |
| ![Main menu](./docs/screenshots/real-mainmenu.png)       | ![Early gameplay](./docs/screenshots/real-gameplay.png) | ![Boss fight](./docs/screenshots/real-boss-fight.png)    |
| ![Level-up choices](./docs/screenshots/real-levelup.png) | ![Game over](./docs/screenshots/real-gameover.png)      | ![Achievements](./docs/screenshots/svg/achievements.svg) |

## Why another Vampire Survivors clone?

Most JS clones ship with a 5 MB bundle and a build pipeline that takes longer
to spin up than the run itself. This repository takes the opposite stance:

1. **Zero dependencies at runtime.** No React, no bundler, no transpiler. Open
   `index.html` and the game is on screen in milliseconds. The `package.json`
   only lists ESLint + Prettier as dev tools.
2. **Open in a browser, period.** The loader handles `file://` AND
   `http(s)://` AND offline (via the optional service worker). Great for
   classrooms, kiosks, code-along livestreams.
3. **Fully auditable source.** Each module under `src/` is self-contained and
   under 1k lines, with a JSDoc header that names every export. No hidden
   build artefacts, no minified vendor blobs.
4. **i18n + accessibility from day one.** English / 简体中文 ship by default,
   `prefers-reduced-motion` is honoured, a high-contrast mode lives in
   settings, and every menu is keyboard-reachable.

## 🏗️ Architecture

The runtime is a single `main.js` orchestrator that wires together focused
modules. Every module has a clear job, and there are no runtime dependencies.

```mermaid
flowchart TD
    main[main.js<br/>game loop + orchestration]
    cfg[config.js<br/>constants + enums]
    data[data.js<br/>weapons / passives / enemies]
    ent[entities.js<br/>Player, Enemy, Projectile, Particle]
    wpn[weapons.js<br/>weapon behaviour]
    sh[spatial-hash.js<br/>broad-phase index]
    pool[pool.js<br/>object pools]
    sys[systems.js<br/>camera, FPS]
    ui[ui.js<br/>HUD, menus, overlays]
    audio[audio.js<br/>Web Audio synthesis]
    input[input.js<br/>keyboard, joystick, gamepad]
    store[storage.js<br/>localStorage save/load]
    i18n[i18n.js<br/>translations]

    main --> cfg
    main --> data
    main --> ent
    main --> wpn
    main --> sh
    main --> pool
    main --> sys
    main --> ui
    main --> audio
    main --> input
    main --> store
    main --> i18n
    ent --> sh
    wpn --> ent
    ui --> i18n
    ui --> store
```

## 🧱 Stack

| Layer       | Tooling                                                         |
| ----------- | --------------------------------------------------------------- |
| Runtime     | **Vanilla JS** (ES2022 modules) · **HTML5 Canvas** · Web Audio  |
| Persistence | `localStorage` (graceful in-memory fallback)                    |
| Mobile      | Virtual joystick · Touch edge double-tap · PWA manifest         |
| Tooling     | **ESLint 9** (flat config) · **Prettier 3** · GitHub Actions CI |
| Hosting     | **GitHub Pages** (auto-deploy from `main`) · Service Worker     |

## 🆕 What's new

- **v2.7** — Stage 3 + gamepad + deeper mobile polish. **Frozen Tundra**
  ships as the third map with three new modifiers (-10% move speed, +20%
  enemy HP, periodic 1 HP cold tick) and a frost-themed final boss
  **IceQueen**. The input layer now polls the Web Gamepad API every frame
  (left stick = move, right = aim, A = confirm, B = cancel, Start = pause,
  LB / RB = cycle menu options); see [`docs/CONTROLS.md`](./docs/CONTROLS.md).
  Mobile gets a special-skill button next to the joystick, a 0.8 / 1.0 / 1.2
  size knob in settings, and a one-shot PWA install prompt. Three new
  passives (Evasion, Pickup Magnet+, Bulwark) plus four evolution
  micro-tweaks. **195** unit tests, still zero runtime deps. See
  [CHANGELOG.md](./CHANGELOG.md#270---2026-04-25).
- **v2.6** — Content + finishing-touches release. Two stages now ship
  (Whisperwood + the new ranged-heavy Sunken Crypt), plus a daily
  challenge with deterministic per-UTC-day seed and Wordle-style share
  text. Iter-13 closes the loose ends: stage chip on the menu, 14-day
  daily-streak calendar (View Streak), one-time How-to-Play overlay,
  global `M` mute / `H` help hotkeys, and a multi-sample (3×3 patches)
  pixel sanity check in the live-deploy QA script. 167 unit tests, still
  zero runtime deps. See [CHANGELOG.md](./CHANGELOG.md#260---2026-04-25).
- **v2.5.1** — Camera follow + final-mile polish. The arena is now 2400×1600
  with a viewport-centred camera, every README screenshot is a real PNG
  captured by the Playwright smoke harness, the main menu passes axe-core
  with **0 violations** (WCAG AA contrast on primary buttons, mobile zoom
  re-enabled, ARIA roles on chip rows), and a 5-minute
  [`docs/CONTRIBUTING_QUICKSTART.md`](./docs/CONTRIBUTING_QUICKSTART.md)
  walks new contributors from clone to first PR.
- **v2.5** — Reflection + polish pass. Frost-Nova second pulse now uses the
  effects-layer dt scheduler (pauses correctly with the tab), leaderboard
  Import actually merges into storage, no-hit badge is now an authoritative
  per-run flag, `seenBuilds` capped at 1000 to keep saves small, README fps
  numbers explicitly tagged "(estimated)", `<html lang>` syncs on locale
  switch, generated SVG screenshot placeholders.
- **v2.4** — Content density: 3 new weapons (Frost Nova, Soul Drain,
  Boomerang), 2 enemies (Bomber, Illusionist), 2 bosses (Necromancer, Chrono
  Lich), 6 achievements, deterministic Speedrun mode + leaderboard.
- **v2.3** — Spatial-hash broad phase + object pools (stable 60 fps at 500
  enemies), full keyboard + screen-reader support, 73-test `node:test` suite,
  iOS Safari / reduced-motion / high-contrast polish.
- **v2.2** — Visual polish, GitHub Pages-friendly entry, achievements gallery,
  PWA manifest + offline service worker. See [CHANGELOG.md](./CHANGELOG.md).
- **v2.1** — Wave director, 5 enemy archetypes, 2 bosses, weapon evolutions,
  achievements + leaderboard, effects layer, procedural music upgrade.
- **v2.0** — Modular `src/` rewrite, i18n, fixed-step loop, full OSS scaffolding.

## ⚡ Performance

v2.3 moved the collision broad phase from an O(n²) pairwise scan into a
uniform 64 px spatial hash, pooled the churny entities (floating damage
numbers, particles), pre-rasterised enemy sprites into an offscreen
bitmap cache, and clamped the per-frame `dt` to 50 ms. The sim auto-pauses
on `document.visibilitychange` so a resumed tab cannot dump a 2 s step.

Measured on a 2021 14" MacBook Pro (M1 Pro, Chromium 123), 1200×800 canvas,
in-game enemy cap briefly raised to 500 for the test. Numbers are
**estimated**: a single dev machine, single Chromium build, single sitting,
no statistical sampling. Reproduce locally before quoting them anywhere.

| Scenario                                 | Before (v2.2) (est.) | After (v2.3) (est.) |
| ---------------------------------------- | -------------------- | ------------------- |
| 100 enemies, no boss                     | ~60 fps              | ~60 fps             |
| 250 enemies, projectile volley in flight | ~48 fps              | ~60 fps             |
| 500 enemies, Void-Lord phase 2           | **~30 fps**          | **~60 fps**         |
| Tab away 60 s → return, sim catch-up     | 500+ ms spike        | ≤50 ms step         |

Your mileage depends on GPU throughput for canvas composite — on older
integrated-graphics machines the curve flattens earlier. The
[spatial hash](./src/spatial-hash.js), [pool](./src/pool.js) and
[visibility-pause handler](./src/main.js) are isolated modules, so you can
grep `_onVisibilityChange` / `SpatialHash` to see exactly what changed.

## ♿ Accessibility

See [`docs/ACCESSIBILITY.md`](./docs/ACCESSIBILITY.md) for the full list.
Highlights:

- Every menu is keyboard-reachable; level-up cards support `Enter` / `Space`
  and arrow-key nav.
- Visible `:focus-visible` ring, `role="dialog"` + `aria-modal` on overlays,
  an ARIA live region that announces boss warnings, level-ups and unlocks.
- Honours `prefers-reduced-motion`, `prefers-contrast: more`,
  `forced-colors: active`, plus an in-game Colorblind toggle.
- Mobile: iOS Safari 100vh fixed via `svh` / `dvh`, no pull-to-refresh,
  no pinch-zoom inside the game.

## ⚠️ Known limitations

Honest list of small issues we have caught but not fixed yet. None block
gameplay; we keep them here so contributors know where the seams are and so
players don't think a wobble is something they did.

- **No service-worker on GitHub Pages cold loads.** `/service-worker.js`
  occasionally returns 404 when the Pages CDN is warming a new commit. The
  registration call demotes the failure to a console warning and the game
  still boots — offline-mode just doesn't kick in until the next hard
  refresh after deploy. The live-deploy smoke (`npm run smoke:live`) treats
  this as a benign warning, not a failure.
- **Replay diverges from non-deterministic runs.** Outside Speedrun and
  Daily, the spawn RNG falls back to `Math.random`, so a saved replay
  reproduces inputs faithfully but spawn positions can drift. Speedrun /
  Daily replays are bit-exact thanks to `SeededRng`. Documented inline in
  `src/main.js`'s `start()` near the recorder construction.
- **Speedrun timer paused/visibility shifts.** Pausing or hiding the tab
  during a Speedrun run is reconciled at resume time (iter-16), so wall-clock
  time excludes paused windows on the leaderboard. If you Alt+Tab for less
  than one frame the visibilitychange event may not fire and a few ms slip
  through; competitive runs should keep the tab focused throughout.
- **localStorage at quota.** Once the browser slot fills up (Safari private
  mode caps at ~5 MB, embedded iframes can be tighter), saves demote to an
  in-memory fallback that survives within the tab session but is lost on
  refresh. A single console warning fires the first time this happens; we
  don't surface a player-visible toast yet.
- **Mid-run locale flip refreshes static labels only.** Switching language
  while playing now retranslates every `data-i18n` element (iter-16), but
  ephemeral runtime strings already rendered as floating text or
  achievement toasts stay in the old locale until they age out — they're
  built once and not retained for re-rendering.
- **Sprite cache grows unbounded.** Pre-rasterised enemy bitmaps live in a
  module-level `Map` keyed by `${id}@${size}`. The set is finite (~100
  entries) so memory growth is capped, but we never evict on stage swap.
  Not a bug, just a thing to know if you instrument the heap.

If you reproduce something that is not on this list, please open an issue
with the steps and (ideally) a recording.

## 🗺️ Roadmap

- [x] Map variants (forest, crypt, tundra) with distinct enemy pools — _v2.7_
- [x] Gamepad support with menu navigation — _v2.7_
- [ ] Weapon evolution combinations (item × passive)
- [ ] Meta-progression: persistent unlocks between runs
- [ ] Additional languages (ES, JA, FR — PRs welcome)
- [ ] Optional WebGL renderer behind a feature flag
- [ ] Replay recording and share-to-clip

Vote on roadmap items by reacting to pinned issues. Want to own an item? Open
a discussion or drop a comment.

## 🤝 Contributing

Contributions are very welcome. New here? Start with the **5-minute
[contributing quickstart](./docs/CONTRIBUTING_QUICKSTART.md)** — clone, run,
open your first PR. The full rules live in
[CONTRIBUTING.md](./CONTRIBUTING.md), and by participating you agree to the
[Code of Conduct](./CODE_OF_CONDUCT.md).

Looking for low-hanging fruit? Try one of:

- Drop a screenshot into `docs/screenshots/` (see [the guide](./docs/screenshots/README.md)).
- Translate `src/i18n.js` into your language.
- Add a balance card to [BALANCE.md](./BALANCE.md).

Security issues? Please read [SECURITY.md](./SECURITY.md) first — do **not**
open a public issue.

## 🙏 Inspiration & credits

- Inspired by [Vampire Survivors](https://poncle.itch.io/vampire-survivors) by
  Poncle — an absolute masterclass in tight, compulsive gameplay loops. This
  project is an independent homage, not affiliated with or endorsed by Poncle.
- Mermaid for the architecture diagram, shields.io for the badges, MDN for
  the canvas reference, Mozilla's Web Audio team for the synthesis APIs.
- Every contributor who has filed an issue, sent a PR, or translated a
  string. You are why this repo exists.

## 🌌 Attribution

This is an independent project that began from
[ricardo-foundry/canvas-vampire-survivors](https://github.com/ricardo-foundry/canvas-vampire-survivors),
which is MIT-licensed. It has since been ported to TypeScript, restructured so
the simulation is independent of the DOM and canvas, and given its own
engineering standards and verification gates. See
[docs/ENGINEERING-STANDARDS.md](./docs/ENGINEERING-STANDARDS.md) and
[docs/TYPESCRIPT-MIGRATION.md](./docs/TYPESCRIPT-MIGRATION.md).

The original remains the upstream reference, kept as the `source` git remote
rather than `origin`.

## 📜 License

Released under the [MIT License](./LICENSE). Use it, fork it, ship it.

## ⭐ Stars over time

[![Star History Chart](https://api.star-history.com/svg?repos=NightShadeHuD/canvas-vampire-survivors&type=Date)](https://star-history.com/#NightShadeHuD/canvas-vampire-survivors&Date)

If you have read this far, please drop a ⭐ — it costs nothing and makes the
next person who finds the repo trust it more.

---

## 中文 · 简介

一个受《吸血鬼幸存者》启发的开源网页版幸存者游戏，纯原生 JavaScript + HTML5
Canvas 实现，**零运行时依赖**。项目采用模块化结构（`src/`），内置中英双语，
支持键盘、触屏虚拟摇杆与手柄操作，自动保存进度与设置，适配移动端与桌面端。
v2.2 版本添加了 PWA 离线支持、成就画廊、社交分享卡，以及更友好的 GitHub
Pages 静态入口。

- 🚀 一键启动：`npm install && npm start`，或直接用浏览器打开 `index.html`
- 🌐 本地运行：`npm run build && npx serve .`（本仓库未启用 GitHub Pages）
- 🤝 欢迎贡献：查看 [CONTRIBUTING.md](./CONTRIBUTING.md)，我们对新手非常友好
- 📜 协议：MIT，随意 fork 和二次创作

如果喜欢这个项目，请点一个 ⭐ Star 支持一下！
