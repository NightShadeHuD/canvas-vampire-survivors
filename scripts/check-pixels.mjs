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
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const godotDir = path.join(repoRoot, 'godot');

if (process.env.CI && !process.env.DISPLAY) {
    console.log(
        'check-pixels: NOTICE — no display, so the WINDOWED pixel checks did not run. ' +
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
            'check-pixels: NOTICE — Godot is not installed, so the pixel checks did not ' +
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

const ok = (out.match(/^ {2}ok {3}/gm) ?? []).length;
const skipped = (out.match(/^ {2}SKIP/gm) ?? []).length;
console.log(`check-pixels: ${ok} pixel property(ies) hold, ${skipped} declared NOT IMPLEMENTED.`);
