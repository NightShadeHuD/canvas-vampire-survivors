#!/usr/bin/env node
/**
 * @file scripts/edit.mjs
 * @description The safe way to change a file from the shell.
 *
 * This exists so that `AGENTS.md` rule 6 has an alternative rather than only a
 * prohibition. A rule that forbids the quick thing and offers nothing else is a
 * rule that gets worked around.
 *
 *   node scripts/edit.mjs src/foo.ts --anchor 'old text' --replace 'new text'
 *   node scripts/edit.mjs src/foo.ts --anchor-file a.txt --replace-file b.txt
 *   node scripts/edit.mjs src/foo.ts --anchor 'x' --replace 'y' --count 3
 *   node scripts/edit.mjs src/foo.ts --anchor 'x' --replace 'y' --dry-run
 *
 * It refuses an anchor that matches zero times or the wrong number of times, and
 * after writing it reads the file back and checks the change is really there.
 *
 * Use `--anchor-file` for anything multi-line: embedding newlines in a shell
 * argument is its own source of surprise, and this tool exists to remove
 * surprises rather than add one.
 *
 * Exit codes: 0 changed (or a clean dry run), 1 refused, 2 usage.
 */

import { existsSync, readFileSync } from 'node:fs';
import { applyEdit, DEFAULT_EXPECTED } from './lib/source-edit.mjs';

/** The value after a flag, or null when the flag is absent. */
function option(name) {
    const at = process.argv.indexOf(name);
    return at === -1 ? null : (process.argv[at + 1] ?? '');
}

const target = process.argv[2];
if (!target || target.startsWith('--')) {
    console.error('usage: node scripts/edit.mjs <file> --anchor <text> --replace <text>');
    console.error('       [--count N] [--dry-run]   (or --anchor-file / --replace-file)');
    process.exit(2);
}
if (!existsSync(target)) {
    console.error(`edit: ${target} does not exist`);
    process.exit(2);
}

/** Prefer the file form when given, so multi-line text is never a shell problem. */
function text(inlineFlag, fileFlag, label) {
    const file = option(fileFlag);
    if (file !== null) {
        if (!existsSync(file)) {
            console.error(`edit: ${fileFlag} names ${file}, which does not exist`);
            process.exit(2);
        }
        return readFileSync(file, 'utf8');
    }
    const inline = option(inlineFlag);
    if (inline === null) {
        console.error(`edit: no ${label} given. Pass ${inlineFlag} or ${fileFlag}.`);
        process.exit(2);
    }
    return inline;
}

const anchor = text('--anchor', '--anchor-file', 'anchor');
const replacement = text('--replace', '--replace-file', 'replacement');

const rawCount = option('--count');
let expected = DEFAULT_EXPECTED;
if (rawCount !== null) {
    expected = Number(rawCount);
    if (!Number.isInteger(expected) || expected < 1) {
        console.error(`edit: --count must be a positive integer, got ${JSON.stringify(rawCount)}`);
        process.exit(2);
    }
}

const dryRun = process.argv.includes('--dry-run');

const result = applyEdit({ path: target, anchor, replacement, expected, dryRun });
if (!result.ok) {
    console.error(`edit: REFUSED — ${target}\n  ${result.reason}`);
    process.exit(1);
}

console.log(
    dryRun
        ? `edit: would replace ${result.matched} occurrence(s) in ${target} (dry run, nothing written)`
        : `edit: replaced ${result.matched} occurrence(s) in ${target}, and read it back to confirm`
);
