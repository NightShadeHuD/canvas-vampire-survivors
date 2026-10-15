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
 *   - **every path the deploy workflow puts in the artifact** — read from
 *     `.github/workflows/deploy-pages.yml`, not listed here, because a
 *     hand-written list IS this defect. `game.js` (HTTP 200, 371 bytes on the
 *     live site) and 53 of the 55 `docs/**` files were served and unhashed;
 *     `cp -r docs _site/docs` ships all of them;
 *   - every other asset the worker precaches, resolved against the tracked tree
 *     (`index.html`, `styles.css`, `manifest.json`, `docs/*.svg`);
 *   - the build itself — `tsconfig.json`, `tsconfig.build.json`,
 *     `package-lock.json`, **and `scripts/build.mjs`**, which sets the compiler's
 *     flags and writes `dist/package.json`. Leaving the builder out was the
 *     sharpest form of the defect: `--removeComments` changed every byte of
 *     `dist/main.js` and this gate stayed green;
 *   - the worker's own source, with its cache-name line REMOVED (so the name
 *     cannot hash itself), which is what makes an edit to `ASSETS` purge the old
 *     cache.
 *
 * THE GUARANTEE, and it is now enforced rather than asserted: **any change to the
 * bytes a player receives changes at least one input, so the name changes.** The
 * served set is parsed out of the workflow and every path in it is added to the
 * inputs, so a new `cp` step cannot re-open the hole silently — `check-sw-cache`
 * reports any served path that is not an input, and that assertion was WATCHED
 * failing by deleting the loop that adds them (it named all 53 `docs/**` files).
 *
 * It is a *strictly* wider set than the served bytes — it includes the sources
 * `dist/` is compiled from, and a doc edit purges a cache for a change no player
 * can see. That is a redundant cache purge, which is harmless, and it is the
 * direction that cannot miss a release, which is the bug.
 *
 * WHAT IT STILL CANNOT SEE, stated where it is owned:
 *
 *   - a `tsc` whose emitted bytes changed while every input stayed identical (a
 *     compiler that changed its output with no version change). See
 *     `check-sw-cache.mjs`;
 *   - a change to `.github/workflows/deploy-pages.yml` ITSELF, which decides WHICH
 *     bytes are served and where. It is deliberately not hashed — a workflow edit
 *     changes nothing a player receives, and hashing it would purge every cache
 *     for a YAML comment. What the gate enforces instead is that every path the
 *     workflow serves is an input, so a new served byte cannot appear unhashed.
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
 * `scripts/build.mjs` IS ONE OF THEM, and leaving it out was the sharpest form of
 * this file's own defect: it decides the compiler's flags, writes `dist/package.json`
 * and clears `dist/` before emitting, so an edit to it changes every byte a player
 * receives — and it was not hashed, so the name did not move and no returning
 * player received the new bundle. Proved by adding `--removeComments`, watching
 * `dist/main.js` change hash, and watching this gate stay GREEN.
 *
 * `package.json` is deliberately absent: `engines` and `type` do not reach the
 * emitted JavaScript, and including it would purge every player's cache for a
 * new npm script.
 */
const TOOLCHAIN = [
    'tsconfig.json',
    'tsconfig.build.json',
    'package-lock.json',
    'scripts/build.mjs'
];

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

// ---------------------------------------------------------------------------
// WHAT IS ACTUALLY SERVED, read from the workflow that assembles it.
//
// The input set is only worth deriving if it is a SUPERSET of the bytes a player
// receives, and for three of those bytes it was not:
//
//   `game.js`                     copied into `_site/` and never hashed
//   `docs/**` minus the two SVGs   `cp -r docs _site/docs` serves all 55 of them
//   `scripts/build.mjs`            decides every byte in `dist/`, and was not hashed
//
// The first two were found by MEASURING the live site (`game.js` answered 200,
// 371 bytes) rather than by reading this file, which is why the fix is not a
// longer hand-written list. **A hand-written list is the defect.** So the served
// set is PARSED out of `.github/workflows/deploy-pages.yml` and every path in it
// must be an input, which makes the guarantee below mechanical instead of a claim:
// adding `cp secret.txt _site/` to the workflow fails this gate until `secret.txt`
// is hashed too.
// ---------------------------------------------------------------------------

/** The directory the Pages workflow assembles the artifact in. */
export const SITE_DIR = '_site';

/** The workflow that decides which bytes are served, and from where. */
export const WORKFLOW_PATH = '.github/workflows/deploy-pages.yml';

/** The step whose shell lines assemble the artifact. */
const ASSEMBLY_STEP = 'Assemble static site';

/** A path segment inside the artifact. `.` and `..` are excluded by the caller. */
const SITE_SEGMENT = /^[A-Za-z0-9._-]+$/;

/**
 * The path inside `_site/` a copy destination names, or `null` when it names none.
 *
 * STRICT ON PURPOSE, and the strictness is the point: `_site//` and
 * `_site/../other/` both reached the gate this replaces, and a destination
 * normalised before it is checked is a destination that can be normalised
 * wrongly. `_site/../other/` in particular does not write into the artifact at
 * all, so "the worker is in the artifact" would have been checked against a path
 * that never receives it. A trailing `/` says the destination is a DIRECTORY;
 * without one, a single-file copy names the FILE.
 *
 * @param {string} arg
 * @returns {{ dest: string, namesDirectory: boolean } | null}
 */
function siteDestination(arg) {
    if (arg !== SITE_DIR && !arg.startsWith(`${SITE_DIR}/`)) return null;
    const rest = arg.slice(SITE_DIR.length);
    if (rest === '' || rest === '/') return { dest: '', namesDirectory: true };
    if (!rest.startsWith('/')) return null;
    const namesDirectory = rest.endsWith('/');
    const body = namesDirectory ? rest.slice(1, -1) : rest.slice(1);
    if (body === '') return null; // `_site//`
    for (const segment of body.split('/')) {
        if (!SITE_SEGMENT.test(segment) || segment === '.' || segment === '..') return null;
    }
    return { dest: body, namesDirectory };
}

/** A `dist` copy is covered by the sources it is compiled from, not by a path. */
const COMPILED_SOURCE = 'dist';

/** Shell operators, quoted words and bare words — enough of sh to read `cp`. */
const SHELL_WORD = /&&|\|\||[;|]|'[^']*'|"[^"]*"|[^\s;|&]+/g;

/** Words that end an argument list inside an `if`/`then` block. */
const SHELL_KEYWORDS = new Set(['then', 'else', 'fi', 'do', 'done']);

const isOperator = (word) => /^(?:&&|\|\||;|\|)$/.test(word);

/**
 * The shell lines of the workflow's assembly step, or null when it cannot be found.
 *
 * Read from the step rather than from the whole file so that a copy in some other
 * step — a future cache-priming job, say — does not silently count as serving the
 * artifact, and so that a `# cp …` COMMENT inside the step is still a comment.
 *
 * @param {string} workflow
 * @returns {string[] | null}
 */
function assemblyLines(workflow) {
    const lines = workflow.split('\n');
    const stepName = new RegExp(`^(?:-\\s*)?name:\\s*${ASSEMBLY_STEP}\\s*$`);
    const nameAt = lines.findIndex((l) => stepName.test(l.trim()));
    if (nameAt === -1) return null;
    for (let i = nameAt + 1; i < lines.length; i += 1) {
        const run = /^(\s*)run:\s*\|/.exec(lines[i]);
        if (!run) {
            // A new step begins before any `run:` — this step does not assemble anything.
            if (/^\s*-\s*name:/.test(lines[i])) return null;
            continue;
        }
        const indent = run[1].length;
        const body = [];
        for (let j = i + 1; j < lines.length; j += 1) {
            const line = lines[j];
            if (line.trim() === '') {
                body.push('');
                continue;
            }
            if (line.length - line.trimStart().length <= indent) break;
            body.push(line);
        }
        return body;
    }
    return null;
}

/**
 * Every `cp` in one shell line, as `{ sources, dest }`.
 *
 * `dest` is the RAW destination word; the caller checks it against `SITE_DEST`.
 * A `cp` whose operands cannot be read is returned with `dest: null` so the
 * caller refuses it — an unreadable copy is not a copy that serves nothing.
 *
 * @param {string} line
 * @returns {{ sources: string[], dest: string | null }[]}
 */
function copyCommands(line) {
    const words = line.match(SHELL_WORD) ?? [];
    const commands = [];
    for (let i = 0; i < words.length; i += 1) {
        // `#` at the START OF A WORD begins a comment, so everything after it is
        // prose. The check this replaces matched a commented-out
        // `# cp service-worker.js _site/` as a real copy step, which is how a
        // disabled deploy line read as an enabled one.
        if (words[i].startsWith('#')) break;
        if (words[i] !== 'cp') continue;
        const args = [];
        let j = i + 1;
        for (; j < words.length; j += 1) {
            if (words[j].startsWith('#')) break;
            if (isOperator(words[j]) || SHELL_KEYWORDS.has(words[j])) break;
            args.push(words[j]);
        }
        const operands = args.filter((a) => !a.startsWith('-'));
        commands.push(
            operands.length >= 2
                ? { sources: operands.slice(0, -1), dest: operands[operands.length - 1] }
                : { sources: operands, dest: null }
        );
        i = j;
    }
    return commands;
}

/**
 * One `cp` step in the workflow's assembly block.
 *
 * `destDir` is the directory inside the artifact the sources are placed in (the
 * empty string is its root), and `destFile` is set INSTEAD when the copy names
 * the file itself — `cp index.html _site/404.html`. Keeping the two apart is the
 * whole of F2: `cp service-worker.js _site/dist/` names a DIRECTORY, and to a
 * regex looking for `_site/` after the filename it is indistinguishable from the
 * copy that puts the worker where the page can actually fetch it.
 *
 * @typedef {{ sources: string[], destDir: string, destFile: string | null, line: string }} CopyStep
 */

/**
 * The set of bytes the deploy workflow puts in the artifact, and what could not
 * be read.
 *
 * @typedef {{ ok: boolean, files: string[], compiled: string[], copies: CopyStep[], problems: string[] }} ServedSet
 */

/**
 * Every tracked path the Pages artifact is assembled from.
 *
 * @param {string} repoRoot
 * @param {Set<string>} tracked
 * @returns {ServedSet}
 */
export function servedPaths(repoRoot, tracked) {
    const problems = [];
    const empty = { ok: false, files: [], compiled: [], copies: [], problems };

    let workflow;
    try {
        workflow = readFileSync(path.join(repoRoot, WORKFLOW_PATH), 'utf8');
    } catch {
        problems.push(`${WORKFLOW_PATH} cannot be read, so what is served cannot be derived`);
        return { ...empty, problems };
    }

    const lines = assemblyLines(workflow);
    if (lines === null) {
        problems.push(
            `no \`name: ${ASSEMBLY_STEP}\` step with a \`run: |\` block in ${WORKFLOW_PATH}. ` +
                'Without it the served set is unknown, and an unknown served set cannot be ' +
                'proved to be a subset of the hashed one.'
        );
        return { ...empty, problems };
    }

    const files = new Set();
    const compiled = new Set();
    const copies = [];

    for (const raw of lines) {
        const line = raw.trim();
        // A COMMENTED-OUT `# cp service-worker.js _site/` serves nothing, and the
        // first version of this check matched it anyway — the regex had no idea
        // what a shell comment was.
        if (line === '' || line.startsWith('#')) continue;
        for (const command of copyCommands(line)) {
            const target = command.dest === null ? null : siteDestination(command.dest);
            if (target === null) {
                problems.push(
                    `\`${line}\` — ${JSON.stringify(command.dest)} is not a canonical path ` +
                        `inside ${SITE_DIR}/, so what this copy serves cannot be named`
                );
                continue;
            }
            const rel = target.dest;
            // A copy of ONE tracked FILE to a destination with no trailing slash
            // NAMES THE FILE (`cp index.html _site/404.html`). Everything else
            // names a DIRECTORY the sources are placed inside, keeping their own
            // basenames. The two are different claims and the difference is the
            // whole of F2: `cp service-worker.js _site/dist/` satisfied a regex
            // that only asked whether `_site/` appeared after the filename.
            const namesTheFile =
                !target.namesDirectory &&
                command.sources.length === 1 &&
                command.sources[0] !== COMPILED_SOURCE &&
                tracked.has(command.sources[0]);
            const destDir = namesTheFile ? '' : rel;
            const destFile = namesTheFile ? rel : null;
            copies.push({ sources: command.sources, destDir, destFile, line });
            for (const source of command.sources) {
                if (source === COMPILED_SOURCE) {
                    compiled.add(destDir);
                    continue;
                }
                const under = [...tracked].filter(
                    (f) => f === source || f.startsWith(`${source}/`)
                );
                if (under.length === 0) {
                    problems.push(
                        `\`${line}\` — \`${source}\` matches nothing in the tracked tree, so ` +
                            'this copy either serves nothing or serves bytes no input covers'
                    );
                    continue;
                }
                for (const f of under) files.add(f);
            }
        }
    }

    // NOTE: "the worker is copied at all, and lands at the root" is NOT asserted
    // here. It is asserted by `check-sw-cache.mjs`, where the failure can name the
    // path it landed at instead of refusing the whole derivation with one line —
    // and where it is one of several layout facts read from the same parse.
    return {
        ok: problems.length === 0,
        files: [...files].sort(),
        compiled: [...compiled].sort(),
        copies,
        problems
    };
}

/**
 * The complete input set the cache name is a function of.
 *
 * @param {string} repoRoot
 * `served` is NOT optional, even on the failure paths: every return describes the
 * same parse, and a caller that had to check for `undefined` before reading it
 * would be one more place the Godot port has to rewrite.
 *
 * @returns {{ ok: boolean, entries: { path: string, bytes: Buffer }[], unresolved: string[], served: ServedSet, reason?: string }}
 */
export function precacheInputs(repoRoot) {
    const tracked = trackedFiles(repoRoot);

    // FIRST, so every return below can carry it. A failure here is fatal to the
    // derivation: an unknown served set cannot be shown to be a subset of the
    // hashed one, and that subset relation is the whole guarantee.
    const served = servedPaths(repoRoot, tracked);
    if (!served.ok) {
        return {
            ok: false,
            entries: [],
            unresolved: [],
            served,
            reason: served.problems.join('\n  ')
        };
    }

    const source = readFileSync(path.join(repoRoot, WORKER_PATH), 'utf8');

    const normalized = normalizeWorker(source);
    if (!normalized.ok) {
        return { ok: false, entries: [], unresolved: [], served, reason: normalized.reason };
    }

    const assets = precachedAssets(source);
    if (!assets.ok) {
        return { ok: false, entries: [], unresolved: [], served, reason: assets.reason };
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

    // EVERY PATH THE DEPLOY WORKFLOW PUTS IN THE ARTIFACT, and this is the line
    // that makes the guarantee below mechanical. `game.js` and 53 of the 55
    // `docs/**` files were served and unhashed; reading the served set out of the
    // workflow means the next addition to it cannot repeat that silently.
    for (const rel of served.files) add(rel);

    return { ok: true, entries, unresolved, served };
}

/**
 * What `service-worker.js` should contain, and under what name.
 *
 * @param {string} repoRoot
 * @returns {{ ok: boolean, name?: string, source?: string, rendered?: string, changed?: boolean,
 *            inputs?: { path: string, bytes: Buffer }[], unresolved?: string[], served: ServedSet,
 *            reason?: string }}
 */
export function expectedForRepo(repoRoot) {
    const inputs = precacheInputs(repoRoot);
    if (!inputs.ok) {
        return {
            ok: false,
            unresolved: inputs.unresolved,
            served: inputs.served,
            reason: inputs.reason
        };
    }
    const source = readFileSync(path.join(repoRoot, WORKER_PATH), 'utf8');
    const name = cacheNameFromDigest(digestOf(inputs.entries));
    const rendered = renderWorker(source, name);
    if (!rendered.ok) {
        return {
            ok: false,
            unresolved: inputs.unresolved,
            served: inputs.served,
            reason: rendered.reason
        };
    }
    return {
        ok: true,
        name,
        source,
        rendered: rendered.text,
        changed: rendered.changed,
        inputs: inputs.entries,
        unresolved: inputs.unresolved,
        served: inputs.served
    };
}
