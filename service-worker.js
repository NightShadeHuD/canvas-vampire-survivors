/**
 * service-worker.js
 *
 * Tiny cache-first service worker so the game can be re-launched offline once
 * the player has loaded it at least once. We intentionally keep the cache list
 * short and explicit — it covers the static assets the browser needs to render
 * a frame. localStorage (used by `src/storage.js`) already handles save data.
 *
 * No build step, no Workbox, no dependencies.
 *
 * Globals (self, caches, clients, ...) are declared in eslint.config.js.
 * This file used to declare them with an eslint-env comment plus a global
 * comment list — eslint-8 syntax that flat config ignores entirely. The
 * consequence was that the file was never linted at all, and its own list was
 * missing `clients`. Both comments are gone: the config is the single source
 * of truth, and ESLint v10 rejects eslint-env comments outright.
 */

/**
 * The cache name is the ONLY thing that makes a release reach a returning
 * player, and that is F3.
 *
 * This worker is cache-first for every same-origin GET, so once it controls a
 * page the browser answers from `CACHE` and never revalidates. A new release
 * therefore does not change what a returning player runs — unless the BYTES OF
 * THIS FILE change, because only then does the browser install a new worker,
 * and only `activate` deletes the old cache. `dist/*.js` can change all it
 * likes; this line is the release.
 *
 * It used to be hand-maintained, and it had not changed since `0d67e16` — 146
 * commits, 46 of them touching `src/`. Every one of those releases was
 * invisible to anyone who had already played.
 *
 * GENERATED. The name is a digest of everything this worker caches, so it
 * cannot be forgotten. `npm run gen:sw-cache` writes it and
 * `npm run check:sw-cache` refuses a name that does not match its inputs. Do
 * not edit the line below by hand.
 */
const CACHE = 'survivor-2357cd0b968a966f';
const ASSETS = [
    './',
    './index.html',
    './styles.css',
    './manifest.json',
    './dist/main.js',
    './dist/config.js',
    './dist/data.js',
    './dist/entities.js',
    './dist/weapons.js',
    './dist/systems.js',
    './dist/effects.js',
    './dist/audio.js',
    './dist/input.js',
    './dist/ui.js',
    './dist/i18n.js',
    './dist/storage.js',
    './dist/achievements.js',
    './docs/hero.svg',
    './docs/og-card.svg'
];

/**
 * HOW THE NAME IS KEPT HONEST
 *
 * `scripts/lib/sw-cache-name.mjs` derives it from everything a player can
 * receive: this file's own source with the line above removed, every precached
 * asset, the `src/` each `./dist/*.js` is compiled from, the build that compiles
 * them (`scripts/build.mjs` included — it decides the compiler's flags), and
 * every path the deploy workflow copies into the artifact. That last one is
 * READ FROM THE WORKFLOW rather than listed by hand, so `game.js` and the 53
 * `docs/**` files that were served and unhashed cannot come back silently. So
 * this line moves whenever any byte a player receives moves.
 *
 * The plan this comment used to carry was re-derived and three parts of it did
 * not survive:
 *
 *   - `dist/` is gitignored, so a drift gate reading the emitted tree would have
 *     nothing to read in a fresh checkout, and a gate whose verdict depends on
 *     an untracked artefact enforces nothing.
 *   - `npm run build` writing this line would leave the drift gate unable to
 *     fail, because `build` is the last step of `npm run verify` (rule 13). It
 *     does not touch this file; `npm run gen:sw-cache` does.
 *   - moving the worker into `dist/` would give it a scope of `/dist/`. A
 *     worker's default scope is its own directory and GitHub Pages cannot send
 *     `Service-Worker-Allowed`, so it would stop controlling `index.html`,
 *     `styles.css` and `/`. It stays at the root, and `check:sw-cache` asserts
 *     the registration path and the deploy copy so a move cannot go unnoticed.
 *
 * The residual risk is stated where it is owned, in `scripts/check-sw-cache.mjs`.
 */
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches
            .open(CACHE)
            .then((cache) => cache.addAll(ASSETS))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches
            .keys()
            .then((keys) =>
                Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
            )
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    const req = event.request;
    if (req.method !== 'GET') return;
    // Cache-first for same-origin GETs; bypass everything else.
    const url = new URL(req.url);
    if (url.origin !== self.location.origin) return;
    event.respondWith(
        caches.match(req).then(
            (hit) =>
                hit ||
                fetch(req)
                    .then((res) => {
                        // Opportunistically populate the cache for new same-origin assets.
                        if (res && res.status === 200) {
                            const copy = res.clone();
                            caches.open(CACHE).then((c) => c.put(req, copy));
                        }
                        return res;
                    })
                    .catch(() => caches.match('./index.html'))
        )
    );
});
