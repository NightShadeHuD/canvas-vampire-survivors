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
import { existsSync } from 'node:fs';
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
    console.log(
        'check-godot: SKIPPED — `godot` is not on PATH, so the port was NOT verified.\n' +
            '  This is reported as a skip and not as a pass. Install Godot 4 to run it.'
    );
    process.exit(0);
}

// 1. Regenerate, so a stale `godot/data/` cannot pass on yesterday's values.
execFileSync('node', [path.join(here, 'export-godot.mjs')], { cwd: repoRoot, stdio: 'inherit' });

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
    ['res://verify_scene.gd', 'the hero is VISIBLE, the camera follows, the menu works']
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
    const pass = out.includes('PASS');
    if (!pass) failed = true;
    console.log(`check-godot: ${pass ? 'ok  ' : 'FAIL'} ${script} — ${what}`);
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
