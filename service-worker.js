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
 * likes; this string is the release.
 *
 * It had not changed since `0d67e16` — 146 commits, 46 of them touching `src/`.
 * Every one of those releases was invisible to anyone who had already played.
 *
 * So: BUMP IT IN ANY COMMIT THAT CHANGES `dist/`. The durable fix is a
 * build-time hash — see the note at the bottom of this file — and it is not
 * implemented because it needs a build step the repository does not have.
 */
const CACHE = 'survivor-v3.0.1';
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
 * WHAT A DURABLE FIX WOULD TAKE
 *
 * A name derived from the bytes it caches, so forgetting is not possible:
 *
 *   1. `scripts/build.mjs` already owns `dist/`. After `tsc` emits, hash every
 *      file in `dist/` (plus `index.html` and `styles.css`, which the asset list
 *      also covers) with `node:crypto`, and write the digest into a generated
 *      `dist/sw-cache-name.js` — or substitute a `__CACHE_NAME__` placeholder
 *      into a copy of this file as it lands in `dist/`.
 *   2. Serve the worker from `dist/` and register `./dist/service-worker.js`,
 *      because a root-scoped worker cannot be generated into `dist/` without
 *      changing its scope.
 *   3. Make `npm run verify` refuse a committed `dist/` whose name does not
 *      match its contents, so the drift is a gate rather than a habit.
 *
 * That is three changes and one of them moves a file the deploy workflow
 * assembles, which is a cascade for a commit whose job is a security fix. It is
 * described here, not done, and it is the FIRST thing to do next.
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
