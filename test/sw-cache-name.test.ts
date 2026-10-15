/**
 * @file test/sw-cache-name.test.ts
 * @description Tests for the derived service-worker cache name.
 *
 * The property under test is the one whose absence cost 146 releases their
 * delivery: **the name a cache-first worker stores under must be a function of
 * what it caches.** Every test here is a way of asking "would this name change
 * if that byte changed?", and the ones that read the real tree are the ones that
 * would have caught the input set being too narrow — which it was: deriving the
 * inputs from the worker's own `ASSETS` list left the defect alive for the twelve
 * modules that are imported but not precached, and `check:sw-cache` stayed green
 * through an edit to `src/pool.ts` until a test of this shape existed.
 *
 * Runs in Node, no DOM, no browser.
 *
 * @module test/sw-cache-name
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync, execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
    WORKFLOW_PATH,
    cacheNameFromDigest,
    cacheLines,
    digestOf,
    expectedForRepo,
    normalizeWorker,
    precachedAssets,
    precacheInputs,
    readCacheName,
    renderWorker,
    resolveAsset,
    servedPaths
} from '../scripts/lib/sw-cache-name.mjs';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const workerPath = new URL('../service-worker.js', import.meta.url);
const committed = readFileSync(workerPath, 'utf8');

/** A minimal worker source, so the pure functions can be driven without the filesystem. */
const workerWith = (name: string) => `const CACHE = '${name}';\nconst ASSETS = ['./index.html'];\n`;

const entry = (path: string, bytes: string) => ({ path, bytes });

// ---------------------------------------------------------------------------
// the digest
// ---------------------------------------------------------------------------

test('sw-cache-name: the digest does not depend on the order inputs are read in', () => {
    const a = [entry('a.js', 'one'), entry('b.js', 'two')];
    const b = [entry('b.js', 'two'), entry('a.js', 'one')];
    assert.equal(digestOf(a), digestOf(b));
});

test('sw-cache-name: changed content changes the digest', () => {
    const before = digestOf([entry('a.js', 'one')]);
    assert.notEqual(digestOf([entry('a.js', 'two')]), before);
});

test('sw-cache-name: a rename changes the digest even when the bytes do not', () => {
    // The path is part of the input, because `dist/a.js` and `dist/b.js` are
    // different requests even when they hold identical bytes.
    assert.notEqual(digestOf([entry('a.js', 'same')]), digestOf([entry('b.js', 'same')]));
});

test('sw-cache-name: adding or removing a file changes the digest', () => {
    const one = digestOf([entry('a.js', 'one')]);
    const two = digestOf([entry('a.js', 'one'), entry('b.js', 'two')]);
    assert.notEqual(two, one);
});

test('sw-cache-name: an empty input set is refused rather than hashed', () => {
    // A name derived from nothing would be the same name forever, which is the
    // original defect with extra steps.
    assert.throws(() => digestOf([]), /empty input set/);
});

// ---------------------------------------------------------------------------
// the name
// ---------------------------------------------------------------------------

test('sw-cache-name: the name is a prefixed slice of the digest', () => {
    const digest = 'a'.repeat(64);
    assert.equal(cacheNameFromDigest(digest), `survivor-${'a'.repeat(16)}`);
});

test('sw-cache-name: a name that is not a digest is refused', () => {
    // `survivor-v3.0.1` is the hand-maintained string this replaced. It is not a
    // digest, so it can never be produced by the generator.
    assert.throws(() => cacheNameFromDigest('survivor-v3.0.1'), /not a sha256 digest/);
});

// ---------------------------------------------------------------------------
// normalization and rendering
// ---------------------------------------------------------------------------

test('sw-cache-name: normalizing removes the name so it cannot hash itself', () => {
    const result = normalizeWorker(workerWith('survivor-0123456789abcdef'));
    assert.equal(result.ok, true);
    assert.equal(result.name, 'survivor-0123456789abcdef');
    assert.equal(result.text?.includes('survivor-0123456789abcdef'), false);
    assert.equal(result.text?.split('__SURVIVOR_CACHE_NAME__').length, 2);
});

test('sw-cache-name: normalizing refuses a worker with no cache-name line', () => {
    const result = normalizeWorker("const ASSETS = ['./index.html'];\n");
    assert.equal(result.ok, false);
    assert.match(String(result.reason), /no `const CACHE/);
});

test('sw-cache-name: normalizing refuses TWO cache-name lines', () => {
    // Rewriting every match when one was meant is the `sed` failure in miniature,
    // and it is what this refusal exists for.
    const result = normalizeWorker(`${workerWith('a')}const CACHE = 'b';\n`);
    assert.equal(result.ok, false);
    assert.match(String(result.reason), /2 `const CACHE/);
});

test('sw-cache-name: a placeholder mentioned in prose as well is refused', () => {
    // Otherwise the render would substitute into the comment too, and the worker
    // would ship with a name in a sentence that nothing reads.
    const source = `${workerWith('a')}// the __SURVIVOR_CACHE_NAME__ is substituted here\n`;
    const result = normalizeWorker(source);
    assert.equal(result.ok, false);
    assert.match(String(result.reason), /appears 2 time/);
});

test('sw-cache-name: rendering substitutes the name and reports whether it changed', () => {
    const rendered = renderWorker(workerWith('survivor-v3.0.1'), 'survivor-0123456789abcdef');
    assert.equal(rendered.ok, true);
    assert.equal(rendered.changed, true);
    assert.match(String(rendered.text), /^const CACHE = 'survivor-0123456789abcdef';$/m);
    assert.equal(readCacheName(String(rendered.text)), 'survivor-0123456789abcdef');
});

test('sw-cache-name: rendering is idempotent', () => {
    const once = renderWorker(workerWith('survivor-v3.0.1'), 'survivor-0123456789abcdef');
    const twice = renderWorker(String(once.text), 'survivor-0123456789abcdef');
    assert.equal(twice.changed, false);
    assert.equal(twice.text, once.text);
});

test('sw-cache-name: rendering refuses a hand-written name', () => {
    const rendered = renderWorker(workerWith('survivor-v3.0.1'), 'survivor-v3.0.2');
    assert.equal(rendered.ok, false);
    assert.match(String(rendered.reason), /not a generated cache name/);
});

// ---------------------------------------------------------------------------
// the real tree
// ---------------------------------------------------------------------------

test('sw-cache-name: the committed worker IS what its inputs generate', () => {
    // The drift check, at unit-test speed and against the real file. If this
    // fails, `npm run check:sw-cache` fails, and the fix is `npm run gen:sw-cache`.
    const expected = expectedForRepo(repoRoot);
    assert.equal(expected.ok, true, String(expected.reason));
    assert.equal(
        expected.changed,
        false,
        `service-worker.js carries ${readCacheName(committed)}, but its inputs derive ${expected.name}`
    );
});

test('sw-cache-name: the committed name is a digest, not a version string', () => {
    // The regression guard. `survivor-v3.0.1` was the shipped name for 146
    // commits while `src/` moved under it.
    assert.match(String(readCacheName(committed)), /^survivor-[0-9a-f]{16}$/);
});

test('sw-cache-name: every tracked source under src/ is in the input set', () => {
    // THIS IS THE ASSERTION THE NARROW INPUT SET FAILED. The worker's fetch
    // handler is cache-first for any same-origin GET it has already seen, so an
    // imported-but-not-precached module such as `dist/pool.js` is served stale
    // exactly like a precached one. Deriving the inputs from `ASSETS` left those
    // modules out and the name did not move when `src/pool.ts` changed.
    const tracked = execFileSync('git', ['ls-files'], { cwd: repoRoot, encoding: 'utf8' })
        .split('\n')
        .filter((f) => f.startsWith('src/'));
    const inputs = precacheInputs(repoRoot);
    assert.equal(inputs.ok, true);
    const covered = new Set(inputs.entries.map((e) => e.path));
    assert.deepEqual(
        tracked.filter((f) => !covered.has(f)),
        []
    );
});

test('sw-cache-name: the input set covers the worker and the toolchain as well', () => {
    const inputs = precacheInputs(repoRoot);
    const covered = new Set(inputs.entries.map((e) => e.path));
    for (const rel of [
        'service-worker.js',
        'tsconfig.json',
        'tsconfig.build.json',
        'package-lock.json'
    ]) {
        assert.equal(covered.has(rel), true, `${rel} is not an input`);
    }
});

test('sw-cache-name: every asset the worker precaches resolves in this tree', () => {
    // `cache.addAll` rejects as a whole if ANY request fails, so one entry that
    // 404s means the worker never installs and offline support silently does not
    // exist. The list is checked against the real tree, not against itself.
    const inputs = precacheInputs(repoRoot);
    assert.deepEqual(inputs.unresolved, []);
    const assets = precachedAssets(committed);
    assert.equal(assets.ok, true);
    assert.ok((assets.entries?.length ?? 0) >= 5);
});

test('sw-cache-name: changing one byte of one input changes the name', () => {
    const inputs = precacheInputs(repoRoot);
    const before = cacheNameFromDigest(digestOf(inputs.entries));
    const mutated = inputs.entries.map((e) =>
        e.path === 'src/main.ts'
            ? { path: e.path, bytes: Buffer.concat([e.bytes, Buffer.from('\n// one byte\n')]) }
            : e
    );
    assert.notEqual(cacheNameFromDigest(digestOf(mutated)), before);
});

test('sw-cache-name: deriving the name twice gives the same answer', () => {
    // Purity, stated because the whole gate rests on it: the same tree must
    // produce the same name on a machine that is not this one.
    const first = expectedForRepo(repoRoot);
    const second = expectedForRepo(repoRoot);
    assert.equal(first.name, second.name);
    assert.equal(first.rendered, second.rendered);
});

// ---------------------------------------------------------------------------
// asset resolution
// ---------------------------------------------------------------------------

test('sw-cache-name: ./ is the directory index', () => {
    const tracked = new Set(['index.html']);
    assert.deepEqual(resolveAsset('/nowhere', tracked, './'), { kind: 'file', path: 'index.html' });
});

test('sw-cache-name: a dist entry is covered by the source it is compiled from', () => {
    const tracked = new Set(['src/main.ts']);
    assert.deepEqual(resolveAsset('/nowhere', tracked, './dist/main.js'), {
        kind: 'module',
        path: './dist/main.js',
        source: 'src/main.ts'
    });
});

test('sw-cache-name: a precached module with no source is reported, not ignored', () => {
    const tracked = new Set(['src/main.ts']);
    const resolved = resolveAsset('/nowhere', tracked, './dist/ghost.js');
    assert.equal(resolved.kind, 'unresolved');
    assert.match(String(resolved.reason), /nothing under src\/ compiles/);
});

test('sw-cache-name: a precached file that is not tracked is reported, not ignored', () => {
    const resolved = resolveAsset('/nowhere', new Set(['index.html']), './docs/missing.svg');
    assert.equal(resolved.kind, 'unresolved');
    assert.match(String(resolved.reason), /not a tracked file/);
});

test('sw-cache-name: the cache-name anchor is read from the file, not assumed', () => {
    const lines = cacheLines("const CACHE = 'survivor-0000000000000000';\n");
    assert.equal(lines.length, 1);
    assert.equal(lines[0].name, 'survivor-0000000000000000');
});

// ---------------------------------------------------------------------------
// WHAT IS SERVED (F1/F2)
//
// The input set was a hand-written list, and the list was wrong three ways:
// `scripts/build.mjs` decides every byte in `dist/` and was not on it, and
// `game.js` and all but two of the `docs/**` files were copied into the artifact
// by `cp -r docs _site/docs` and were not on it either. So the served set is READ
// FROM THE WORKFLOW, and these are the tests that hold it there.
// ---------------------------------------------------------------------------

/** A repository root holding just a workflow, so the parser can be driven. */
function workflowRoot(assembly: string[]): string {
    const dir = mkdtempSync(path.join(tmpdir(), 'sw-served-'));
    mkdirSync(path.join(dir, '.github', 'workflows'), { recursive: true });
    writeFileSync(
        path.join(dir, WORKFLOW_PATH),
        [
            'name: Deploy to GitHub Pages',
            'jobs:',
            '    build:',
            '        steps:',
            '            - name: Assemble static site',
            '              run: |',
            ...assembly.map((l) => `                  ${l}`),
            '            - name: Upload Pages artifact',
            '              uses: actions/upload-pages-artifact@v5'
        ].join('\n')
    );
    return dir;
}

const TRACKED = new Set([
    'index.html',
    'styles.css',
    'game.js',
    'service-worker.js',
    'manifest.json',
    'docs/hero.svg',
    'docs/USER_GUIDE.md',
    'dist/main.js',
    'src/main.ts'
]);

test('sw-cache-name: the served set is read from the workflow, not listed by hand', () => {
    const dir = workflowRoot([
        'cp index.html styles.css game.js _site/',
        '[ -f service-worker.js ] && cp service-worker.js _site/ || true',
        '[ -f manifest.json ] && cp manifest.json _site/ || true',
        'cp -r dist _site/dist',
        'if [ -d docs ]; then cp -r docs _site/docs; fi',
        'cp index.html _site/404.html'
    ]);
    try {
        const served = servedPaths(dir, TRACKED);
        assert.deepEqual(served.problems, []);
        assert.deepEqual(served.files, [
            'docs/USER_GUIDE.md',
            'docs/hero.svg',
            'game.js',
            'index.html',
            'manifest.json',
            'service-worker.js',
            'styles.css'
        ]);
        assert.deepEqual(served.compiled, ['dist']);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('sw-cache-name: a copy destination that is not canonical inside _site is REFUSED', () => {
    // `_site//` and `_site/../other/` both satisfied the regex this replaced.
    // `_site/../other/` does not write into the artifact at all, so "the worker
    // is in the artifact" would have been checked against a path that never
    // receives it.
    for (const dest of ['_site//', '_site/../other/', '_site/./x', '_site/../']) {
        const dir = workflowRoot([`cp service-worker.js ${dest}`]);
        try {
            const served = servedPaths(dir, TRACKED);
            assert.equal(served.ok, false, `${dest} was accepted`);
            assert.match(served.problems.join(' '), /not a canonical path/);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    }
});

test('sw-cache-name: a commented-out copy serves nothing', () => {
    // The regex this replaced matched `# cp service-worker.js _site/` as a live
    // copy step, so a disabled deploy line read as an enabled one.
    const dir = workflowRoot(['# cp service-worker.js _site/']);
    try {
        const served = servedPaths(dir, TRACKED);
        assert.deepEqual(served.copies, []);
        assert.deepEqual(served.files, []);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('sw-cache-name: a copy that names the FILE is told apart from one that names a DIRECTORY', () => {
    // `cp service-worker.js _site/dist/` moves the worker to a path the page never
    // registers, and `/dist/service-worker.js` 404s — so NO worker installs. The
    // difference is the trailing slash, and the parse has to keep it.
    const dir = workflowRoot([
        'cp index.html _site/404.html',
        'cp service-worker.js _site/dist/',
        'cp -r docs _site/docs'
    ]);
    try {
        const served = servedPaths(dir, TRACKED);
        assert.deepEqual(
            served.copies.map((c) => [c.sources, c.destDir, c.destFile]),
            [
                [['index.html'], '', '404.html'],
                [['service-worker.js'], 'dist', null],
                [['docs'], 'docs', null]
            ]
        );
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('sw-cache-name: a copy of something the tree does not have is refused', () => {
    const dir = workflowRoot(['cp secret.txt _site/']);
    try {
        const served = servedPaths(dir, TRACKED);
        assert.equal(served.ok, false);
        assert.match(served.problems.join(' '), /matches nothing in the tracked tree/);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('sw-cache-name: every SERVED file is an input to the name', () => {
    // The guarantee, as an assertion rather than a sentence. Watched failing by
    // deleting the loop in `precacheInputs` that adds `served.files`: this names
    // all 53 `docs/**` files that were served and unhashed.
    const inputs = precacheInputs(repoRoot);
    assert.equal(inputs.ok, true, String(inputs.reason));
    const hashed = new Set(inputs.entries.map((e) => e.path));
    const unhashed = inputs.served.files.filter((f: string) => !hashed.has(f));
    assert.deepEqual(unhashed, []);
    assert.ok(
        inputs.served.files.length >= 55,
        `only ${inputs.served.files.length} served file(s) were derived`
    );
});

test('sw-cache-name: the three bytes that were served and unhashed are inputs now', () => {
    // One row per defect, so a future narrowing names what it broke.
    const covered = new Set(precacheInputs(repoRoot).entries.map((e) => e.path));
    for (const rel of [
        'scripts/build.mjs', // decides the compiler's flags and dist/package.json
        'game.js', // HTTP 200, 371 bytes, on the live site
        'docs/USER_GUIDE.md', // `cp -r docs _site/docs` serves all 55 of them
        'docs/screenshots/live-gameplay.png'
    ]) {
        assert.equal(covered.has(rel), true, `${rel} is served and is not an input`);
    }
});

test('sw-cache-name: perturbing anything SERVED moves the name', () => {
    // THE BEHAVIOURAL CONTROL for the assertion above. A list that contains a
    // path is not the same claim as a name that moves when the path changes, so
    // every served file is perturbed one at a time and the digest must move.
    const inputs = precacheInputs(repoRoot);
    const before = cacheNameFromDigest(digestOf(inputs.entries));
    for (const rel of inputs.served.files) {
        const mutated = inputs.entries.map((e) =>
            e.path === rel
                ? { path: e.path, bytes: Buffer.concat([e.bytes, Buffer.from('\n')]) }
                : e
        );
        assert.notEqual(
            cacheNameFromDigest(digestOf(mutated)),
            before,
            `${rel} is served and does not move the name`
        );
    }
});

// ---------------------------------------------------------------------------
// THE REFUSAL PATHS.
//
// A guard is only as good as what it does when it cannot read its input, and
// every one of these is a "say so and stop" rather than a "carry on with an
// empty set" — the second shape is how a gate that looked at nothing reports
// that it looked at everything.
// ---------------------------------------------------------------------------

/** A workflow file with hand-written steps, so the PARSER's refusals can be driven. */
function rawWorkflowRoot(stepLines: string[]): string {
    const dir = mkdtempSync(path.join(tmpdir(), 'sw-raw-'));
    mkdirSync(path.join(dir, '.github', 'workflows'), { recursive: true });
    writeFileSync(
        path.join(dir, WORKFLOW_PATH),
        ['name: Deploy to GitHub Pages', 'jobs:', '    build:', '        steps:']
            .concat(stepLines)
            .join('\n')
    );
    return dir;
}

/** A real git repository in a temp directory, so `trackedFiles` has something to list. */
function tempRepo(files: Record<string, string>): string {
    const dir = mkdtempSync(path.join(tmpdir(), 'sw-repo-'));
    for (const [rel, text] of Object.entries(files)) {
        const full = path.join(dir, rel);
        mkdirSync(path.dirname(full), { recursive: true });
        writeFileSync(full, text);
    }
    execSync('git init -q && git add -A', { cwd: dir, stdio: 'pipe' });
    return dir;
}

const ASSEMBLY_WORKFLOW = [
    'name: Deploy to GitHub Pages',
    'jobs:',
    '    build:',
    '        steps:',
    '            - name: Assemble static site',
    // A key BETWEEN the step name and its `run:` block — ordinary YAML, and the
    // shape that makes the parser SKIP a line rather than give up on the step.
    "              if: github.ref == 'refs/heads/main'",
    '              run: |',
    '                  cp index.html service-worker.js _site/',
    '            - name: Upload Pages artifact',
    '              uses: actions/upload-pages-artifact@v5'
].join('\n');

test('sw-cache-name: a workflow that cannot be READ is refused, not assumed empty', () => {
    const bare = mkdtempSync(path.join(tmpdir(), 'sw-bare-'));
    try {
        const served = servedPaths(bare, TRACKED);
        assert.equal(served.ok, false);
        assert.match(served.problems.join(' '), /cannot be read/);
        assert.deepEqual(served.files, []);
    } finally {
        rmSync(bare, { recursive: true, force: true });
    }
});

test('sw-cache-name: a workflow with no assembly step, or one with no run block, is refused', () => {
    // Three shapes, and each one is a way the served set could have been reported
    // as empty instead of unknown. An empty served set makes the subset assertion
    // trivially true — which is the vacuous check this file exists to avoid.
    const shapes: Array<[string[], RegExp]> = [
        [
            ['            - name: Checkout', '              uses: actions/checkout@v7'],
            /no `name: Assemble static site` step/
        ],
        [
            [
                '            - name: Assemble static site',
                '            - name: Upload Pages artifact'
            ],
            /no `name: Assemble static site` step/
        ],
        [['            - name: Assemble static site'], /no `name: Assemble static site` step/]
    ];
    for (const [lines, expected] of shapes) {
        const dir = rawWorkflowRoot(lines);
        try {
            const served = servedPaths(dir, TRACKED);
            assert.equal(served.ok, false, `accepted: ${JSON.stringify(lines)}`);
            assert.match(served.problems.join(' '), expected);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    }
});

test('sw-cache-name: a worker whose own source does not parse is refused WITH its reason', () => {
    const cases: Array<[string, RegExp]> = [
        ["const ASSETS = ['./index.html'];\n", /no `const CACHE/],
        [
            "const CACHE = 'a';\nconst CACHE = 'b';\nconst ASSETS = ['./index.html'];\n",
            /2 `const CACHE/
        ],
        ["const CACHE = 'survivor-0000000000000000';\n", /no `const ASSETS/],
        ["const CACHE = 'survivor-0000000000000000';\nconst ASSETS = [];\n", /precaches nothing/]
    ];
    for (const [worker, expected] of cases) {
        const dir = tempRepo({
            'index.html': '<html></html>\n',
            'service-worker.js': worker,
            [WORKFLOW_PATH]: ASSEMBLY_WORKFLOW
        });
        try {
            const inputs = precacheInputs(dir);
            assert.equal(inputs.ok, false, `accepted: ${JSON.stringify(worker)}`);
            assert.match(String(inputs.reason), expected);
            // The served set is still derived, so a caller that wants to report
            // the layout alongside the failure is not left with nothing.
            assert.equal(inputs.served.ok, true);
            assert.equal(
                expectedForRepo(dir).ok,
                false,
                'expectedForRepo disagreed with precacheInputs'
            );
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    }
});

test('sw-cache-name: a precached asset that does not resolve is COLLECTED, not dropped', () => {
    // `cache.addAll` rejects as a whole if any request 404s, so a silently
    // dropped entry is a worker that never installs with nothing to show for it.
    const dir = tempRepo({
        'index.html': '<html></html>\n',
        'service-worker.js':
            "const CACHE = 'survivor-0000000000000000';\n" +
            "const ASSETS = ['./index.html', './docs/missing.svg'];\n",
        [WORKFLOW_PATH]: ASSEMBLY_WORKFLOW
    });
    try {
        const inputs = precacheInputs(dir);
        assert.equal(inputs.ok, true, String(inputs.reason));
        assert.equal(inputs.unresolved.length, 1, JSON.stringify(inputs.unresolved));
        assert.match(inputs.unresolved[0], /not a tracked file/);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('sw-cache-name: the ASSETS list is read, and its absence or emptiness is refused', () => {
    const none = precachedAssets("const CACHE = 'survivor-0000000000000000';\n");
    assert.equal(none.ok, false);
    assert.match(String(none.reason), /no `const ASSETS/);
    const empty = precachedAssets("const CACHE = 'x';\nconst ASSETS = [];\n");
    assert.equal(empty.ok, false);
    assert.match(String(empty.reason), /precaches nothing/);
});

test('sw-cache-name: an asset that is not a ./-relative path is reported, not ignored', () => {
    const resolved = resolveAsset('/nowhere', new Set(['index.html']), 'index.html');
    assert.equal(resolved.kind, 'unresolved');
    assert.match(String(resolved.reason), /not a \.\/-relative path/);
});

test('sw-cache-name: a served set that cannot be derived fails the whole derivation', () => {
    // FAIL CLOSED. If the workflow cannot be parsed there is no served set, and an
    // unknown served set cannot be shown to be a subset of the hashed one — so the
    // name must not be produced at all. Returning one would mean a gate that
    // reports a name it cannot justify.
    const dir = tempRepo({
        'index.html': '<html></html>\n',
        'service-worker.js':
            "const CACHE = 'survivor-0000000000000000';\nconst ASSETS = ['./index.html'];\n"
    });
    try {
        const inputs = precacheInputs(dir);
        assert.equal(inputs.ok, false, 'a tree with no workflow produced a name');
        assert.match(String(inputs.reason), /cannot be read/);
        assert.equal(inputs.served.ok, false);
        assert.deepEqual(inputs.entries, []);
        assert.equal(expectedForRepo(dir).ok, false);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});
