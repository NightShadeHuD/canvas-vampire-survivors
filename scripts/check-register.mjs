#!/usr/bin/env node
/**
 * @file scripts/check-register.mjs
 * @description Refuses a shortcut register that has rotted.
 *
 * Adopted from the agent-scaffold method (`mechanisms/check_register.py`).
 *
 * The mandate says a shortcut is legitimate only when it is declared, bounded
 * and tracked. `docs/SHORTCUTS.md` is where that happens; this is what stops the
 * table rotting, and without it the register is a document nobody re-reads.
 *
 * It refuses three things, all of which have happened in the project the
 * scaffold was extracted from:
 *
 *   1. a row missing a column — the table still renders and a blank ceiling
 *      reads exactly like an unreviewed row;
 *   2. a gap in the numbering — a row deleted to tidy up cannot be told from one
 *      that moved, and every citation to it becomes a dead end;
 *   3. a citation to a row that does not exist — worse than a malformed row,
 *      because it promises a ceiling and a trigger that are not there.
 *
 * A project with no register passes: nothing is declared, so nothing is claimed.
 */

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { checkRegister } from './lib/shortcut-register.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');

const REGISTER = 'docs/SHORTCUTS.md';

/** Documents whose "row N" citations must resolve. */
const CITING = [
    'AGENTS.md',
    'README.md',
    'docs/ENGINEERING-STANDARDS.md',
    'docs/GODOT-DECOUPLING.md',
    'docs/TYPESCRIPT-MIGRATION.md'
];

const registerPath = path.join(repoRoot, REGISTER);
if (!existsSync(registerPath)) {
    console.log(
        `check-register: no register at ${REGISTER}, so nothing is declared and ` +
            'nothing is checked. This is a notice: add one when the first ' +
            'shortcut is taken.'
    );
    process.exit(0);
}

const citing = CITING.filter((rel) => existsSync(path.join(repoRoot, rel))).map((rel) => ({
    path: rel,
    text: readFileSync(path.join(repoRoot, rel), 'utf8')
}));

const { findings, rowCount } = checkRegister({
    registerPath: REGISTER,
    registerText: readFileSync(registerPath, 'utf8'),
    citing
});

if (findings.length) {
    console.error('check-register: FAILED\n');
    for (const finding of findings) console.error(`  ${finding}`);
    console.error('');
    process.exit(1);
}

console.log(
    `check-register: ${REGISTER}: ${rowCount} row(s), all well formed, numbering ` +
        `contiguous, citations across ${citing.length} document(s) resolve.`
);
