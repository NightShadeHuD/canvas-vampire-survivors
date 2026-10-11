#!/usr/bin/env node
/**
 * @file scripts/check-godot.mjs
 * @description Regenerate the Godot data and prove the project still loads and plays.
 *
 * Three things, in order, because each depends on the last:
 *
 *   1. `npm run export:godot`  -- the generated files must match `src/data.ts`
 *   2. `res://verify_data.gd`  -- Godot must LOAD them and the values must be right
 *   3. `res://verify_slice.gd` -- the slice must MOVE, SPAWN, KILL and take damage
 *   4. `res://verify_scene.gd` -- the hero must be VISIBLE, the camera must FOLLOW,
 *      and the menu must exist and work
 *
 * Step 1 is what stops the two sources of truth drifting. Step 2 is what stops a
 * generated file being valid-looking nonsense. Step 3 is what stops a project that
 * opens being mistaken for a game that runs.
 *
 * **Step 4 exists because step 3 was not enough.** The first version shipped with an
 * invisible hero: no Camera2D, and the hero starts at the centre of a 2400x1600
 * arena while the viewport is 1152x648. Every check passed, because every check
 * asserted the SIMULATION and the simulation was right. Nothing asked whether a
 * human could see it. A test at the wrong level passes while the game is unplayable.
 *
 * If Godot is not installed this SKIPS loudly rather than passing quietly. A check
 * that reports success by not running is worse than no check.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { exportGodot } from './export-godot.mjs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
const godotDir = path.join(repoRoot, 'godot');

function have(cmd) {
    try {
        execFileSync(cmd, ['--version'], { stdio: 'ignore' });
        return true;
    } catch {
        return false;
    }
}

if (!have('godot')) {
    // The `NOTICE:` prefix is how `verify.mjs` knows a gate had nothing to check. It
    // PASSES -- "Godot is not installed here" is a real state -- but the run reports
    // how many gates did, so "passed" is never mistaken for "verified everything".
    console.log(
        'check-godot: NOTICE: `godot` is not on PATH, so the port was NOT verified.\n' +
            '  Install Godot 4 to run this gate; until then it checks nothing.'
    );
    process.exit(0);
}

// 1. Generate to a TEMP DIRECTORY and compare against what is committed.
//
// This used to regenerate into `godot/data/` and then verify -- which meant it
// SILENTLY REPAIRED drift and always passed. Proved by corrupting a committed value:
// `check:godot` rewrote it and reported ok. Edit `src/data.ts`, forget to re-export,
// and CI passes while the game runs on yesterday's numbers -- the exact two-sources-of-
// truth problem the generator exists to prevent, reintroduced by the check that was
// supposed to catch it.
//
// Generating elsewhere and DIFFING is the only form that can fail.
const scratch = mkdtempSync(path.join(tmpdir(), 'godot-drift-'));
const drifted = [];
try {
    const { files } = await exportGodot(scratch);
    for (const name of files) {
        const fresh = readFileSync(path.join(scratch, name), 'utf8');
        const committedPath = path.join(godotDir, 'data', name);
        const committed = existsSync(committedPath) ? readFileSync(committedPath, 'utf8') : null;
        if (committed === null) drifted.push(`${name} (missing)`);
        else if (committed !== fresh) drifted.push(name);
    }
} finally {
    rmSync(scratch, { recursive: true, force: true });
}

if (drifted.length > 0) {
    console.error(
        `check-godot: FAILED — ${drifted.length} generated file(s) do NOT match src/:\n` +
            drifted.map((f) => `    ${f}`).join('\n') +
            '\n\n  These are GENERATED from the TypeScript. Run `npm run export:godot` and\n' +
            '  commit the result. A stale file here means the game runs on old numbers\n' +
            '  while `src/data.ts` says otherwise, and nothing else in this repository\n' +
            '  would notice.'
    );
    process.exit(1);
}
console.log(
    `check-godot: ok   ${'generated data matches src/'} — ${drifted.length === 0 ? 'no drift' : ''}`
);

if (!existsSync(path.join(godotDir, 'project.godot'))) {
    console.error('check-godot: FAILED — godot/project.godot is missing.');
    process.exit(1);
}

// 2. Import, which is what registers the `class_name` globals. Without it every
//    script fails to resolve `Config`, `Hero` and the rest.
try {
    execFileSync('godot', ['--headless', '--path', godotDir, '--import'], { stdio: 'ignore' });
} catch {
    // `--import` exits non-zero on some builds even when it worked. The scripts
    // below are the real test; this is only here to make them resolvable.
}

const checks = [
    ['res://verify_data.gd', 'the generated data loads and the values are right'],
    ['res://verify_slice.gd', 'the slice moves, spawns, kills and takes damage'],
    ['res://verify_scene.gd', 'the hero is VISIBLE, the camera follows, the menu works'],
    ['res://verify_play.gd', '90s of real play: foes scale, and the hero CAN die'],
    ['res://verify_xp.gd', 'orbs drop, the curve matches the original, picks apply'],
    ['res://verify_weapons.gd', 'EVERY weapon in the data actually damages something'],
    ['res://verify_passives.gd', 'EVERY passive in the data actually changes something'],
    ['res://verify_invariants.gd', '10 minutes of adversarial play stays coherent'],
    ['res://verify_archetypes.gd', 'EVERY enemy archetype in the data behaves differently'],
    ['res://verify_assertions.gd', 'the assertion helpers fail when they should'],
    ['res://verify_achievements.gd', 'EVERY achievement is reachable and fires on its boundary']
];

let failed = false;
for (const [script, what] of checks) {
    let out = '';
    try {
        out = execFileSync('godot', ['--headless', '--path', godotDir, '--script', script], {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe']
        });
    } catch (err) {
        out = `${err.stdout ?? ''}${err.stderr ?? ''}`;
    }
    // A runtime ERROR is a failure even when the script prints PASS and Godot exits 0.
    // GDScript does not fail a suite on an uncaught error: it prints a stack trace and
    // carries on, so `verify_achievements.gd` passed while `g.save` threw on a Game
    // that had no such member. That is a false green, and it is the class of failure
    // this project keeps having to remove.
    const errored =
        /SCRIPT ERROR|Parse Error|Invalid access|Invalid call|nonexistent function/i.test(out);
    const pass = out.includes('PASS') && !errored;
    if (!pass) failed = true;
    console.log(
        `check-godot: ${pass ? 'ok  ' : 'FAIL'} ${script} — ${what}` +
            (errored ? '  [runtime error]' : '')
    );
    if (!pass) {
        console.error(
            out
                .split('\n')
                .filter((l) => l.includes('FAIL') || l.includes('ERROR'))
                .slice(0, 6)
                .join('\n')
        );
    }
}

if (failed) {
    console.error('\ncheck-godot: FAILED — the Godot project does not behave as documented.');
    process.exit(1);
}
console.log('check-godot: the Godot project loads, and the slice plays.');
