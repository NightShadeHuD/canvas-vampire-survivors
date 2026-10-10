/**
 * @file scripts/lib/baseline-file.mjs
 * @description One writer for `quality-baseline.json`, so every tool agrees.
 *
 * WHY THIS EXISTS
 *
 * Five tools rewrite this file. Three of them escape non-ASCII before writing;
 * two did not. `JSON.stringify` emits `§` and `—` as raw UTF-8 while Python's
 * `json.dump` escapes them, and the committed file is the ESCAPED form — so
 * running `check:coverage-floor --update` produced a diff that changed nothing
 * but the encoding of one comment:
 *
 *   -  "... docs/ENGINEERING-STANDARDS.md \u00a7\u00a71.1 ..."
 *   +  "... docs/ENGINEERING-STANDARDS.md §1.1 ..."
 *
 * Observed for real: it blocked a `git switch` after a merge, because the file
 * was modified when nothing meaningful had changed. A diff nobody can read is a
 * diff nobody reviews, and this one had been sitting in the notes as a known
 * inconsistency for long enough to be forgotten.
 *
 * The fix is not "remember to escape" in five places. It is one function that
 * five tools call.
 */

import { readFileSync, writeFileSync } from 'node:fs';

/** The characters this repository's baseline escapes, and why. */
const ESCAPES = [
    [/\u00a7/g, '\\u00a7'], // section sign, in doc references
    [/\u2014/g, '\\u2014'] // em dash, in prose
];

/**
 * Serialise a baseline the way the committed file is serialised.
 *
 * @param {unknown} data
 * @returns {string}
 */
export function serialiseBaseline(data) {
    let text = JSON.stringify(data, null, 4);
    for (const [pattern, replacement] of ESCAPES) {
        // Applied to the serialised text, which is safe here because the escapes
        // are exactly the characters JSON.stringify leaves raw and the file's
        // convention is to escape. A backslash in a value would already be `\\`
        // and cannot be mistaken for one of these.
        text = text.replace(pattern, replacement);
    }
    return `${text}\n`;
}

/**
 * Read a baseline.
 *
 * @param {string} path
 * @returns {any}
 */
export function readBaseline(path) {
    return JSON.parse(readFileSync(path, 'utf8'));
}

/**
 * Write a baseline in the repository's convention.
 *
 * @param {string} path
 * @param {unknown} data
 */
export function writeBaseline(path, data) {
    writeFileSync(path, serialiseBaseline(data));
}
