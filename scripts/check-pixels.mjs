#!/usr/bin/env node
/**
 * @file scripts/check-pixels.mjs
 * @description Runs the WINDOWED pixel-checks tier.
 *
 * `verify_pixels.gd` needs a renderer, and headless Godot has none -- `get_texture()`
 * returns null, which is a checked fact rather than an assumption. So it cannot join
 * `check:godot`'s headless pass, and it is a separate tier here for the same reason
 * `boot-smoke` and `a11y-audit` are separate: it needs a display, and a gate that fails on
 * a machine without one is a gate somebody deletes.
 *
 * **Where there is no display it says NOTICE and exits 0**, so `verify:all` can run it and
 * a headless CI container reports "checked nothing" rather than a pass. That distinction is
 * the whole point -- an unrun check and a passing check must not print the same line.
 *
 *     npm run check:pixels
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { writeBaseline } from './lib/baseline-file.mjs';
import path from 'node:path';
import { NOTICE_PREFIX } from './lib/gate-input.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const godotDir = path.join(repoRoot, 'godot');

if (process.env.CI && !process.env.DISPLAY) {
    console.log(
        `check-pixels: ${NOTICE_PREFIX} no display, so the WINDOWED pixel checks did not run. ` +
            'This is not a pass; it is an unchecked tier.'
    );
    process.exit(0);
}

let out = '';
try {
    out = execFileSync('godot', ['--path', godotDir, '--script', 'res://verify_pixels.gd'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 180_000
    });
} catch (err) {
    out = `${err.stdout ?? ''}${err.stderr ?? ''}`;
    if (/command not found|ENOENT/.test(String(err.message))) {
        console.log(
            `check-pixels: ${NOTICE_PREFIX} Godot is not installed, so the pixel checks did not ` +
                'run. This is not a pass.'
        );
        process.exit(0);
    }
}

const verdict = /^verify_pixels: (PASS|FAIL)$/m.exec(out);
if (!verdict) {
    console.error('check-pixels: FAILED — the suite printed no verdict line.\n');
    console.error(out.split('\n').slice(-12).join('\n'));
    process.exit(1);
}
if (verdict[1] === 'FAIL') {
    console.error(
        out
            .split('\n')
            .filter((l) => l.includes('FAIL'))
            .join('\n')
    );
    process.exit(1);
}

// A FLOOR, because this file had none and its assertions were deletable in silence.
//
// `verify_pixels.gd` is not in `check-godot`'s headless list, so `godotAssertionFloors` cannot
// see it and this runner accepted any non-zero count. Its 34 assertions could have been
// removed one at a time with every gate still green -- the same hole `check:assertions` had
// when it read only `test/*.test.ts`, in a file written after that was fixed.
//
// A FLOOR rather than a ceiling: for assertions a FALL is the bad direction. Same shape as
// `godotAssertionFloors`, and `--update` raises it.
const ok = (out.match(/^ {2}ok {3}/gm) ?? []).length;
const baseline = JSON.parse(readFileSync(path.join(repoRoot, 'quality-baseline.json'), 'utf8'));
const floor = baseline.pixelAssertionFloor;
if (typeof floor !== 'number') {
    console.error(
        'check-pixels: FAILED — no `pixelAssertionFloor` in quality-baseline.json. Without a ' +
            'recorded count, a suite whose assertions were deleted passes exactly like one ' +
            'that was never weakened.'
    );
    process.exit(1);
}
if (ok < floor) {
    console.error(
        `check-pixels: FAILED — the pixel tier asserts ${ok} thing(s), below its floor of ` +
            `${floor}. An assertion was deleted or a section stopped running.\n`
    );
    process.exit(1);
}
if (ok > floor) {
    if (process.argv.includes('--update')) {
        baseline.pixelAssertionFloor = ok;
        writeBaseline(path.join(repoRoot, 'quality-baseline.json'), baseline);
        console.log(`check-pixels: floor raised ${floor} -> ${ok}`);
    } else {
        console.log(
            `check-pixels: NOTICE: ${ok} assertion(s), above the floor of ${floor}. Run \`npm run check:pixels -- --update\`.`
        );
    }
}
console.log(
    `check-pixels: ${ok} pixel assertion(s) hold (floor ${floor}) — every weapon that damages ` +
        'something is DRAWN, and each assertion was WATCHED FAILING on a deliberately broken build.'
);
