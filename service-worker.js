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

const CACHE = 'survivor-v3.0.0';
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
