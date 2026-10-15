/**
 * @file scripts/lib/sw-cache-name.mjs
 * @description The cache name `service-worker.js` serves under, derived from the
 * content it caches, so a release cannot reach a returning player under the old
 * bundle.
 *
 * THE DEFECT THIS EXISTS FOR (F3)
 *
 * The worker is cache-first for every same-origin GET. Once it controls a page,
 * the browser answers from `CACHE` and never revalidates. **A new release
 * therefore does not reach a returning player at all** — the browser installs a
 * new worker only when the BYTES OF `service-worker.js` change, and only
 * `activate` deletes the old cache. `dist/*.js` can change all it likes.
 *
 * So the cache name *is* the release. It was hand-maintained, and it had not
 * changed in 146 commits, 46 of which touched `src/`. Every one of those
 * releases was invisible to anyone who had already played.
 *
 * WHAT REPLACES THE HAND-MAINTAINED STRING
 *
 * A name that is a function of the content it caches:
 *
 *     CACHE = 'survivor-' + sha256(inputs).slice(0, 16)
 *
 * `npm run gen:sw-cache` writes it; `npm run check:sw-cache` regenerates to a
 * temporary path and DIFFS, so a name that does not match its inputs is a gate
 * failure rather than a habit (rule 13).
 *
 * WHY THE INPUTS ARE SOURCES AND NOT `dist/`
 *
 * The previous author's plan was to hash `dist/` as it is emitted. It cannot be
 * the drift gate's input: `dist/` is gitignored, so it does not exist in a fresh
 * checkout, and a gate whose verdict depends on an untracked build artefact is a
 * gate that NOTICEs on a clean tree and enforces nothing. It is also the
 * self-fulfilling shape rule 13 forbids — if `npm run build` wrote the name, then
 * `build` (the last gate in `verify`) would repair the drift the drift gate was
 * checking for.
 *
 * So the inputs are **what `dist/` is built from**, which is committed, so the
 * gate is deterministic on any machine and cannot be repaired by anything it
 * checks:
 *
 *   - **every tracked file under `src/`** — all of it, not only the modules the
 *     precache list names. The fetch handler opportunistically caches ANY same-origin
 *     GET it sees, so `dist/pool.js` is served cache-first on the second load
 *     whether or not it appears in `ASSETS`. Deriving the inputs from `ASSETS`
 *     alone left the original defect alive for those modules: proved by editing
 *     `src/pool.ts` and watching this gate stay green;
 *   - every other asset the worker precaches, resolved against the tracked tree
 *     (`index.html`, `styles.css`, `manifest.json`, `docs/*.svg`);
 *   - the toolchain that turns the sources into `dist/` — `tsconfig.json`,
 *     `tsconfig.build.json`, `package-lock.json`;
 *   - the worker's own source, with its cache-name line REMOVED (so the name
 *     cannot hash itself), which is what makes an edit to `ASSETS` purge the old
 *     cache.
 *
 * This is a superset in the direction that matters: any change to the bytes a
 * player receives changes at least one input, so the name changes. It is a
 * *strictly* wider set than the served bytes, so it can regenerate the name for a
 * change that did not alter the bundle — a redundant cache purge, which is
 * harmless — and it cannot miss one, which is the bug.
 *
 * WHAT IT CANNOT SEE is stated in `check-sw-cache.mjs`: a `tsc` whose emitted
 * bytes changed without any of these inputs changing.
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

/** Stands in for the cache name while the worker is hashed, so it cannot hash itself. */
export const PLACEHOLDER = '__SURVIVOR_CACHE_NAME__';

/** Kept for legibility in DevTools > Application > Cache Storage. */
export const NAME_PREFIX = 'survivor-';

/** 64 bits of the digest. A collision here needs 2^32 releases to be likely. */
export const DIGEST_CHARS = 16;

/** The served worker. Root, so its scope is the whole site — see `check-sw-cache.mjs`. */
export const WORKER_PATH = 'service-worker.js';

/**
 * The one line the generator owns.
 *
 * Anchored to a whole line and required to match EXACTLY once: an anchor that
 * matches zero times does nothing while reporting that it ran, and one that
 * matches twice rewrites something nobody meant to touch. Both are rule 6.
 */
const CACHE_LINE = /^const CACHE = '([^']*)';$/m;

/** The precache list, read rather than restated, so the two cannot drift. */
const ASSETS_BLOCK = /const ASSETS = \[([\s\S]*?)\];/;

/** `./dist/ui.js` is compiled from `src/ui.ts`. */
const DIST_ENTRY = /^\.\/dist\/(.+)\.js$/;

/**
 * Committed files that change the bytes `tsc` emits, and are therefore part of
 * what the cache name must be a function of.
 *
 * `package.json` is deliberately absent: `engines` and `type` do not reach the
 * emitted JavaScript, and including it would purge every player's cache for a
 * new npm script.
 */
const TOOLCHAIN = ['tsconfig.json', 'tsconfig.build.json', 'package-lock.json'];

const sha256 = (data) => createHash('sha256').update(data).digest('hex');

/**
 * The cache name for a digest.
 *
 * @param {string} hex a 64-character sha256 digest
 * @returns {string}
 */
export function cacheNameFromDigest(hex) {
    if (!/^[0-9a-f]{64}$/.test(hex)) {
        throw new Error(`sw-cache-name: "${hex}" is not a sha256 digest`);
    }
    return `${NAME_PREFIX}${hex.slice(0, DIGEST_CHARS)}`;
}

/**
 * A digest over `path + content` pairs, independent of read order.
 *
 * Each file is hashed on its own and the digest of the digests is taken, so the
 * result depends on the (path, content) SET rather than on concatenation order or
 * file sizes. A file added, removed, renamed or edited all move it.
 *
 * @param {{ path: string, bytes: string | Buffer }[]} entries
 * @returns {string} 64-character sha256 digest
 */
export function digestOf(entries) {
    if (!Array.isArray(entries) || entries.length === 0) {
        throw new Error('sw-cache-name: refusing to hash an empty input set');
    }
    const lines = [...entries]
        .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
        .map(({ path: p, bytes }) => `${p}\t${sha256(bytes)}\n`);
    return sha256(lines.join(''));
}

/**
 * Every match of the cache-name line, with the name it currently holds.
 *
 * @param {string} source the worker's text
 * @returns {{ line: string, name: string }[]}
 */
export function cacheLines(source) {
    return [...source.matchAll(new RegExp(CACHE_LINE.source, 'gm'))].map((m) => ({
        line: m[0],
        name: m[1]
    }));
}

/** The name the worker currently serves under, or null if the anchor is not exactly one line. */
export function readCacheName(source) {
    const found = cacheLines(source);
    return found.length === 1 ? found[0].name : null;
}

/**
 * The worker with its cache name replaced by `PLACEHOLDER`.
 *
 * This is the form that gets hashed. Without it the name would have to contain
 * its own digest, which has no solution; with it, the name is a pure function of
 * everything except itself.
 *
 * @param {string} source
 * @returns {{ ok: boolean, text?: string, name?: string, reason?: string }}
 */
export function normalizeWorker(source) {
    const found = cacheLines(source);
    if (found.length === 0) {
        return {
            ok: false,
            reason:
                "no `const CACHE = '...';` line. The generator owns that line and needs it " +
                'to exist exactly once.'
        };
    }
    if (found.length > 1) {
        return {
            ok: false,
            reason:
                `${found.length} \`const CACHE = '...';\` lines. Rewriting both when one was ` +
                'meant is how a bulk substitution damages a file — narrow it to one.'
        };
    }
    const text = source.split(found[0].line).join(`const CACHE = '${PLACEHOLDER}';`);
    const occurrences = text.split(PLACEHOLDER).length - 1;
    if (occurrences !== 1) {
        return {
            ok: false,
            reason:
                `the placeholder appears ${occurrences} time(s) after normalization. It must ` +
                'appear exactly once, in the cache-name line, or the render would substitute ' +
                'into a comment as well.'
        };
    }
    return { ok: true, text, name: found[0].name };
}

/**
 * The worker as it should be served: the placeholder replaced by `name`.
 *
 * @param {string} source the worker's current text
 * @param {string} name the derived cache name
 * @returns {{ ok: boolean, text?: string, changed?: boolean, reason?: string }}
 */
export function renderWorker(source, name) {
    if (!new RegExp(`^${NAME_PREFIX}[0-9a-f]{${DIGEST_CHARS}}$`).test(name)) {
        return {
            ok: false,
            reason: `"${name}" is not a generated cache name (expected ${NAME_PREFIX}<${DIGEST_CHARS} hex>)`
        };
    }
    const normalized = normalizeWorker(source);
    if (!normalized.ok) return normalized;
    const text = normalized.text.split(PLACEHOLDER).join(name);
    return { ok: true, text, changed: text !== source };
}

/** The asset list the worker precaches, as written in its source. */
export function precachedAssets(source) {
    const block = ASSETS_BLOCK.exec(source);
    if (!block) {
        return { ok: false, reason: 'no `const ASSETS = [...];` list to read' };
    }
    const entries = [...block[1].matchAll(/'([^']*)'/g)].map((m) => m[1]);
    if (entries.length === 0) {
        return { ok: false, reason: 'the `ASSETS` list is empty, so the worker precaches nothing' };
    }
    return { ok: true, entries };
}

/** Every tracked path, as a Set. */
export function trackedFiles(repoRoot) {
    return new Set(
        execFileSync('git', ['ls-files', '-z'], { cwd: repoRoot, encoding: 'utf8' })
            .split('\0')
            .filter(Boolean)
    );
}

/**
 * Where one `ASSETS` entry actually lives in the committed tree.
 *
 * `./` is the directory index, which is `index.html`. A `./dist/x.js` entry is
 * covered by its source, because `dist/` is not committed and the source is what
 * determines it. Anything else must be a tracked file, or the entry would 404 and
 * `cache.addAll` — which rejects as a whole if ANY request fails — would leave the
 * worker permanently uninstalled.
 *
 * @returns {{ kind: 'file' | 'module' | 'unresolved', path: string, source?: string, reason?: string }}
 */
export function resolveAsset(repoRoot, tracked, entry) {
    if (entry === './' || entry === './index.html') {
        return { kind: 'file', path: 'index.html' };
    }
    const dist = DIST_ENTRY.exec(entry);
    if (dist) {
        const source = [`src/${dist[1]}.ts`, `src/${dist[1]}.js`].find((p) => tracked.has(p));
        if (!source) {
            return {
                kind: 'unresolved',
                path: entry,
                reason: `nothing under src/ compiles to dist/${dist[1]}.js`
            };
        }
        return { kind: 'module', path: entry, source };
    }
    if (entry.startsWith('./')) {
        const rel = entry.slice(2);
        if (tracked.has(rel)) return { kind: 'file', path: rel };
        return { kind: 'unresolved', path: entry, reason: `${rel} is not a tracked file` };
    }
    return { kind: 'unresolved', path: entry, reason: 'not a ./-relative path' };
}

/**
 * The complete input set the cache name is a function of.
 *
 * @param {string} repoRoot
 * @returns {{ ok: boolean, entries: { path: string, bytes: Buffer }[], unresolved: string[], reason?: string }}
 */
export function precacheInputs(repoRoot) {
    const tracked = trackedFiles(repoRoot);
    const source = readFileSync(path.join(repoRoot, WORKER_PATH), 'utf8');

    const normalized = normalizeWorker(source);
    if (!normalized.ok) {
        return { ok: false, entries: [], unresolved: [], reason: normalized.reason };
    }

    const assets = precachedAssets(source);
    if (!assets.ok) {
        return { ok: false, entries: [], unresolved: [], reason: assets.reason };
    }

    const entries = [{ path: WORKER_PATH, bytes: Buffer.from(normalized.text, 'utf8') }];
    const unresolved = [];
    const seen = new Set([WORKER_PATH]);

    const add = (rel) => {
        if (seen.has(rel)) return;
        seen.add(rel);
        entries.push({ path: rel, bytes: readFileSync(path.join(repoRoot, rel)) });
    };

    // ALL of src/, not just the precached modules. The fetch handler serves any
    // same-origin GET from this cache once it has seen it once, so an imported
    // module is just as stale as a precached one. Restricting the inputs to
    // `ASSETS` reproduced the original defect for the twelve modules that are
    // imported but not listed, and this gate stayed GREEN through an edit to
    // src/pool.ts until this line changed.
    for (const rel of [...tracked].filter((f) => f.startsWith('src/')).sort()) add(rel);

    // Every precached asset must also RESOLVE to something real.
    // `cache.addAll` rejects as a WHOLE if any request fails, so one entry that
    // 404s leaves the worker permanently uninstalled and there is no offline
    // support at all -- an invisible failure with no player-visible error.
    for (const asset of assets.entries) {
        const resolved = resolveAsset(repoRoot, tracked, asset);
        if (resolved.kind === 'unresolved') {
            unresolved.push(`${asset} — ${resolved.reason}`);
            continue;
        }
        if (resolved.kind === 'file') add(resolved.path);
    }

    for (const rel of TOOLCHAIN) {
        if (!tracked.has(rel) || seen.has(rel)) continue;
        seen.add(rel);
        entries.push({ path: rel, bytes: readFileSync(path.join(repoRoot, rel)) });
    }

    return { ok: true, entries, unresolved };
}

/**
 * What `service-worker.js` should contain, and under what name.
 *
 * @param {string} repoRoot
 * @returns {{ ok: boolean, name?: string, source?: string, rendered?: string, changed?: boolean,
 *            inputs?: { path: string, bytes: Buffer }[], unresolved?: string[], reason?: string }}
 */
export function expectedForRepo(repoRoot) {
    const inputs = precacheInputs(repoRoot);
    if (!inputs.ok) {
        return { ok: false, unresolved: inputs.unresolved, reason: inputs.reason };
    }
    const source = readFileSync(path.join(repoRoot, WORKER_PATH), 'utf8');
    const name = cacheNameFromDigest(digestOf(inputs.entries));
    const rendered = renderWorker(source, name);
    if (!rendered.ok) {
        return { ok: false, unresolved: inputs.unresolved, reason: rendered.reason };
    }
    return {
        ok: true,
        name,
        source,
        rendered: rendered.text,
        changed: rendered.changed,
        inputs: inputs.entries,
        unresolved: inputs.unresolved
    };
}
