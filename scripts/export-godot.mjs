#!/usr/bin/env node
/**
 * @file scripts/export-godot.mjs
 * @description Generate the Godot data layer FROM the TypeScript source of truth.
 *
 * WHY A GENERATOR RATHER THAN A HAND PORT
 *
 * `docs/GODOT-PORT-RESEARCH.md` established that this port is a TRANSFORM, not a
 * rewrite. The data layer is the part of that transform which is purely mechanical:
 * eleven weapons, eleven enemies, thirteen passives, five bosses, twenty-one
 * achievements, and the tables that key them. Hand-copying 850 lines of literals
 * would produce a second source of truth that drifts the first time a weapon's
 * damage is tuned.
 *
 * This imports the ACTUAL `src/data.ts` -- Node runs it directly, no build step --
 * and writes GDScript. Tune a weapon in TypeScript and re-run this; the two cannot
 * disagree.
 *
 * WHAT IT REFUSES TO CONVERT, AND WHY THAT IS THE POINT
 *
 * An achievement carries `check: (c) => c.game.kills >= 100` -- behaviour, not a
 * literal -- and GDScript cannot hold a lambda in a Dictionary. The tempting move is
 * to skip those quietly. Instead every one is COUNTED and REPORTED with its path,
 * because that report is the port's actual worklist. A generator that silently
 * dropped them would look finished and be hollow.
 *
 * @module scripts/export-godot
 */

import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { gdFile } from './lib/godot-data.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
const OUT_DIR = path.join(repoRoot, 'godot', 'data');

/** The tables worth porting, in dependency order. */
const TABLES = ['WEAPONS', 'PASSIVES', 'ENEMIES', 'BOSSES', 'WAVES', 'ACHIEVEMENTS', 'UNLOCKS'];

/**
 * @param {string} [outDir] - Overridable so tests can write to a temp directory.
 */
export async function exportGodot(outDir = OUT_DIR) {
    const data = await import(path.join(repoRoot, 'src', 'data.ts'));
    const report = { skipped: [] };

    rmSync(outDir, { recursive: true, force: true });
    mkdirSync(outDir, { recursive: true });

    const files = [];
    for (const name of TABLES) {
        const value = data[name];
        if (value === undefined) {
            report.skipped.push({ at: name, why: 'not exported by src/data.ts' });
            continue;
        }
        writeFileSync(
            path.join(outDir, `${name.toLowerCase()}.gd`),
            gdFile(name, value, 'src/data.ts', report)
        );
        files.push(`${name.toLowerCase()}.gd`);
    }
    return { files, report };
}

// Only run when invoked directly -- importing this for tests must not write files.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const { files, report } = await exportGodot();
    console.log(`export-godot: wrote ${files.length} file(s) to godot/data/`);
    for (const f of files) console.log(`  ${f}`);

    if (report.skipped.length) {
        console.log(`\nexport-godot: ${report.skipped.length} value(s) could NOT be converted.`);
        console.log('  These are the port worklist -- each needs a hand-written `func` or a');
        console.log('  decision, and the generated file holds `null` where each one belongs.\n');
        const byWhy = {};
        for (const s of report.skipped) byWhy[s.why] = (byWhy[s.why] ?? 0) + 1;
        for (const [why, n] of Object.entries(byWhy).sort((a, b) => b[1] - a[1])) {
            console.log(`    ${String(n).padStart(3)}  ${why}`);
        }
    }
}
