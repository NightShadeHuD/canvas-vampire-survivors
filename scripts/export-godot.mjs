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

import { mkdirSync, readdirSync, writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { configFile, gdFile } from './lib/godot-data.mjs';

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

    // REMOVE ONLY WHAT THIS GENERATES, not the whole directory.
    //
    // `rmSync(outDir, { recursive: true })` wiped Godot's `.gd.uid` sidecar files,
    // which are TRACKED -- so every export deleted four files and the next `--import`
    // recreated them, churning the working tree for nothing. Godot 4.4+ writes those
    // uids and owns them; this tool owns only the `.gd` files it emits.
    mkdirSync(outDir, { recursive: true });
    for (const existing of readdirSync(outDir)) {
        if (existing.endsWith('.gd')) rmSync(path.join(outDir, existing), { force: true });
    }

    const files = [];

    // CONFIG first: every other generated file, and every hand-written script, reads
    // its tuning from here rather than repeating a number.
    // `HERO_MAX_HP` is the hero's `baseMaxHp`, which lives on the entity rather than
    // in CONFIG. Passed in as an extra so the slice reads it from one generated place.
    const config = await import(path.join(repoRoot, 'src', 'config.ts'));
    writeFileSync(path.join(outDir, 'config.gd'), configFile(config.CONFIG, { HERO_MAX_HP: 100 }));
    files.push('config.gd');

    // `Difficulty` and the spawn pacing are real constants, not slice tuning. The
    // whole reason the original gets hard is `timeDiff`, which lives in main.ts
    // rather than config, so the formula is written down in `game.gd` with the
    // constants it needs exported here.
    const cfg = await import(path.join(repoRoot, 'src', 'config.ts'));
    writeFileSync(
        path.join(outDir, 'difficulty.gd'),
        configFile(cfg.Difficulty, {}).replace('class_name Config', 'class_name Difficulty')
    );
    files.push('difficulty.gd');

    // EVERY top-level export is considered, not just the ones on the list.
    //
    // `TABLES` used to be the whole story, so a new export in `src/data.ts` was never
    // looked at, never ported, and never reported -- the "data declares what the code
    // ignores" bug, inside the tool built to prevent it. Proved by adding
    // `export const UNPORTABLE = { probe: () => 1 }` and watching the worklist stay at
    // 22 while the table went unported.
    //
    // The list still decides ORDER, because later tables reference earlier ones. It no
    // longer decides SCOPE.
    const unlisted = Object.keys(data).filter((k) => !TABLES.includes(k));
    const ordered = [...TABLES.filter((t) => data[t] !== undefined), ...unlisted];

    for (const name of ordered) {
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
