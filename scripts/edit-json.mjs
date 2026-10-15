#!/usr/bin/env node
/**
 * @file scripts/edit-json.mjs
 * @description The safe way to bulk-edit a JSON manifest from the shell.
 *
 * `scripts/edit.mjs` refuses an anchor that matches more than once. That covers
 * a single text edit and **not** the case that actually did damage here: a loop
 * selecting `gate-selftests.json` entries by `gate == 'check:reach'` matched
 * SEVEN of them and overwrote all seven breaks with one string.
 *
 *   entries matched by gate == "check:reach": 7
 *   distinct break strings before: 6      after: 1
 *   total entries: 33 -> 33
 *
 * Nothing errored. The file still parsed, the entry count was unchanged, and the
 * whole gate chain stayed green — because each surviving entry still had a break
 * that worked. **No downstream check can see this**, so the refusal has to happen
 * at the point of the edit, which is here.
 *
 * So `--expect N` is MANDATORY: a bulk edit names how many matches it expects,
 * and any other number is refused before anything is written.
 *
 *   node scripts/edit-json.mjs gate-selftests.json --where 'gate=check:reach' \
 *       --expect 7 --set 'requires=godot'
 *   node scripts/edit-json.mjs quality-baseline.json --list declaredGaps \
 *       --where 'id=godot-x' --expect 1 --set-file 'removal=removal.txt'
 *   node scripts/edit-json.mjs gate-selftests.json --all --expect 33 --set 'x=1' --dry-run
 *
 * Exit codes: 0 changed (or a clean dry run), 1 refused, 2 usage.
 */

import { existsSync, readFileSync } from 'node:fs';
import { applyJsonEdit, parseWhere } from './lib/json-edit.mjs';

/** The value after a flag, or null when the flag is absent. */
function option(name) {
    const at = process.argv.indexOf(name);
    return at === -1 ? null : (process.argv[at + 1] ?? '');
}

const target = process.argv[2];
if (!target || target.startsWith('--')) {
    console.error(
        "usage: node scripts/edit-json.mjs <file> (--where 'field=value' | --all) --expect N\n" +
            "       (--set 'field=value' | --set-file 'field=path') [--list <field>] [--dry-run]"
    );
    process.exit(2);
}
if (!existsSync(target)) {
    console.error(`edit-json: ${target} does not exist`);
    process.exit(2);
}

const where = option('--where');
const all = process.argv.includes('--all');
if ((where === null) === !all) {
    console.error(
        'edit-json: pass EXACTLY ONE of --where or --all. A selection that nobody stated is ' +
            'how a bulk edit reaches entries it was never meant to touch.'
    );
    process.exit(2);
}

const rawExpect = option('--expect');
if (rawExpect === null) {
    console.error(
        'edit-json: --expect is MANDATORY. A bulk edit must name how many matches it expects, ' +
            'and refuse any other number — that count is the only thing that notices the ' +
            'selection changing under you.'
    );
    process.exit(2);
}
const expected = Number(rawExpect);
if (!Number.isInteger(expected) || expected < 1) {
    console.error(
        `edit-json: --expect must be a positive integer, got ${JSON.stringify(rawExpect)}`
    );
    process.exit(2);
}

const set = option('--set');
const setFile = option('--set-file');
if ((set === null) === (setFile === null)) {
    console.error('edit-json: pass exactly one of --set or --set-file.');
    process.exit(2);
}

/** A `field=value` assignment, with the value read from a file when asked. */
function assignment(inline, file, label) {
    const spec = inline ?? file;
    const at = spec.indexOf('=');
    if (at <= 0) {
        console.error(`edit-json: ${label} must be 'field=value', got ${JSON.stringify(spec)}`);
        process.exit(2);
    }
    const field = spec.slice(0, at).trim();
    let value = spec.slice(at + 1);
    if (file !== null) {
        if (!existsSync(value)) {
            console.error(`edit-json: ${label} names ${value}, which does not exist`);
            process.exit(2);
        }
        value = readFileSync(value, 'utf8');
    } else {
        // A JSON literal where one parses, so numbers, booleans and arrays work;
        // otherwise the raw string, which is what a shell argument usually is.
        try {
            value = JSON.parse(value);
        } catch {
            /* the string is the value */
        }
    }
    return { field, value };
}

const selector = where === null ? { all: true } : parseWhere(where);
if (selector.ok === false) {
    console.error(`edit-json: REFUSED — ${selector.reason}`);
    process.exit(2);
}

const list = option('--list');
const edit = assignment(set, setFile, set === null ? '--set-file' : '--set');

const result = applyJsonEdit({
    path: target,
    selector,
    expected,
    edit,
    list,
    dryRun: process.argv.includes('--dry-run')
});

if (!result.ok) {
    console.error(`edit-json: REFUSED — ${target}\n  ${result.reason}`);
    process.exit(1);
}

console.log(
    process.argv.includes('--dry-run')
        ? `edit-json: would set \`${edit.field}\` on ${result.matched} of ${result.total} ` +
              `entr(ies) selected by ${selector.all ? '--all' : `--where '${where}'`} ` +
              '(dry run, nothing written)'
        : `edit-json: set \`${edit.field}\` on ${result.matched} of ${result.total} entr(ies), ` +
              `${result.differed} of which actually changed, and read the file back to confirm`
);
