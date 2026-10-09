// ESLint v9+ flat config.
// See https://eslint.org/docs/latest/use/configure/configuration-files
//
// Coverage is enforced, not assumed: scripts/check-coverage.mjs fails the
// build if any tracked source file matches none of the `files:` blocks below.
// That check exists because ESLint reports *nothing* — no warning, exit 0 —
// for an uncovered file, which is how `scripts/`, `service-worker.js` and
// `game.js` went unlinted without anyone noticing.

'use strict';

const tseslint = require('typescript-eslint');

/**
 * Shared rule set. Defined once rather than repeated per block: with eight
 * blocks, copy-paste drift would be invisible and eslint.config.js is itself
 * linted, so an inconsistency would quietly weaken a rule for one directory.
 *
 * `caughtErrorsIgnorePattern` makes the deliberate "this error is ignored"
 * convention explicit — `catch (_) {}` and `catch (_e) {}` are intentional,
 * not oversights.
 */
const RULES = {
    'no-unused-vars': [
        'warn',
        {
            argsIgnorePattern: '^_',
            varsIgnorePattern: '^_',
            caughtErrorsIgnorePattern: '^_'
        }
    ],
    'no-undef': 'error',
    semi: ['warn', 'always'],
    'prefer-const': 'warn',
    eqeqeq: ['warn', 'smart'],
    'no-console': 'off'
};

/** Globals available to any modern JS runtime. */
const NODE_COMMON = {
    console: 'readonly',
    process: 'readonly',
    setTimeout: 'readonly',
    clearTimeout: 'readonly',
    setInterval: 'readonly',
    clearInterval: 'readonly',
    fetch: 'readonly',
    performance: 'readonly',
    URL: 'readonly',
    URLSearchParams: 'readonly',
    structuredClone: 'readonly',
    Buffer: 'readonly'
};

/** Adds the CommonJS surface on top of the common set. */
const NODE_CJS = {
    ...NODE_COMMON,
    require: 'readonly',
    module: 'writable',
    exports: 'writable',
    __dirname: 'readonly',
    __filename: 'readonly',
    global: 'readonly'
};

/** Browser globals the game runtime touches. */
const BROWSER_GAME = {
    window: 'readonly',
    document: 'readonly',
    navigator: 'readonly',
    location: 'readonly',
    console: 'readonly',
    requestAnimationFrame: 'readonly',
    cancelAnimationFrame: 'readonly',
    setTimeout: 'readonly',
    clearTimeout: 'readonly',
    setInterval: 'readonly',
    clearInterval: 'readonly',
    localStorage: 'readonly',
    sessionStorage: 'readonly',
    performance: 'readonly',
    AudioContext: 'readonly',
    webkitAudioContext: 'readonly',
    Image: 'readonly',
    HTMLElement: 'readonly',
    HTMLCanvasElement: 'readonly',
    CanvasRenderingContext2D: 'readonly',
    URL: 'readonly',
    URLSearchParams: 'readonly',
    fetch: 'readonly',
    FormData: 'readonly',
    Event: 'readonly',
    CustomEvent: 'readonly',
    KeyboardEvent: 'readonly',
    structuredClone: 'readonly',
    alert: 'readonly',
    confirm: 'readonly',
    prompt: 'readonly'
};

/**
 * Files that drive a real browser through Playwright. The outer script is Node;
 * code inside a `page.evaluate()` callback is serialised and executed in the
 * browser, so `window` and `document` are legitimately undefined from Node's
 * point of view. ESLint cannot scope globals by code position, so these are
 * declared only for the files that actually use them (measured, not guessed).
 */
const PLAYWRIGHT_DRIVERS = [
    'scripts/a11y-audit.mjs',
    'scripts/boot-smoke.mjs',
    'scripts/extended-smoke.js',
    'scripts/runtime-smoke.js',
    'scripts/smoke-live-deploy.js'
];

const PLAYWRIGHT_BROWSER = {
    window: 'readonly',
    document: 'readonly',
    localStorage: 'readonly',
    // Used inside page.evaluate() to assert an overlay actually became visible.
    // This only surfaced once scripts/ was linted at all.
    getComputedStyle: 'readonly'
};

/** A service worker runs in the WorkerGlobalScope: not Node, not a module. */
const SERVICE_WORKER = {
    self: 'readonly',
    caches: 'readonly',
    clients: 'readonly',
    fetch: 'readonly',
    URL: 'readonly',
    Request: 'readonly',
    Response: 'readonly',
    Headers: 'readonly',
    console: 'readonly'
};

module.exports = [
    {
        // `dist/` is future TypeScript build output; `.wip/` is local scratch.
        // Neither is tracked, and neither should ever be linted.
        ignores: ['node_modules/**', '_site/**', 'coverage/**', 'dist/**', '.wip/**']
    },

    // --- game runtime ------------------------------------------------------
    {
        // `src/` is mid-migration, so one block covers both extensions. The
        // TypeScript parser handles plain JavaScript as well, which means a
        // directory can be part-converted without a second rule set drifting
        // out of step with this one.
        files: ['src/**/*.js', 'src/**/*.ts'],
        languageOptions: {
            parser: tseslint.parser,
            ecmaVersion: 2022,
            sourceType: 'module',
            globals: BROWSER_GAME
        },
        rules: RULES
    },

    // --- Node entry points and configs ------------------------------------
    {
        files: ['server.js', 'game.js', '*.config.js', '*.cjs'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'commonjs',
            globals: NODE_CJS
        },
        rules: RULES
    },

    // --- tests -------------------------------------------------------------
    {
        // Tests run under the Node `node:test` runner as ESM modules.
        files: ['test/**/*.js', 'test/**/*.ts'],
        languageOptions: {
            parser: tseslint.parser,
            ecmaVersion: 2022,
            sourceType: 'module',
            globals: {
                ...NODE_COMMON,
                global: 'readonly',
                globalThis: 'readonly',
                // Node timer/microtask globals the tests use to let a rejected
                // promise settle without racing a real delay.
                setImmediate: 'readonly',
                clearImmediate: 'readonly',
                queueMicrotask: 'readonly'
            }
        },
        rules: RULES
    },

    // --- tooling -----------------------------------------------------------
    {
        files: ['scripts/**/*.mjs'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'module',
            globals: NODE_COMMON
        },
        rules: RULES
    },
    {
        // scripts/*.js are CommonJS: the package root declares "type": "commonjs".
        files: ['scripts/**/*.js'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'commonjs',
            globals: NODE_CJS
        },
        rules: RULES
    },
    {
        // Browser globals for the drivers only, merged onto their Node globals
        // by flat config. A browser-global typo elsewhere is still caught.
        files: PLAYWRIGHT_DRIVERS,
        languageOptions: { globals: PLAYWRIGHT_BROWSER }
    },
    {
        // The docs-screenshot generator is a Node CJS CLI.
        files: ['docs/**/*.js'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'commonjs',
            globals: NODE_CJS
        },
        rules: RULES
    },

    // --- service worker ----------------------------------------------------
    {
        // Shipped to production and handles the offline cache, yet it had never
        // been linted. It carried `/* eslint-env serviceworker */` and
        // `/* global self, caches, fetch */` — eslint-8 syntax that flat config
        // ignores entirely — so the intent was there and the wiring was lost in
        // the flat-config migration. Note its own list was also incomplete: it
        // uses `clients` without declaring it.
        files: ['service-worker.js'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'script',
            globals: SERVICE_WORKER
        },
        rules: RULES
    }
];
