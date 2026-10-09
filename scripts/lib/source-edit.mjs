import { readFileSync, writeFileSync } from 'node:fs';

/**
 * @file scripts/lib/source-edit.mjs
 * @description The safe way to change source text from a script.
 *
 * `AGENTS.md` rule 6 forbids blunt edits, and `check:destructive` refuses them in
 * committed tooling. Both of those only describe the hazard. This is the thing
 * that removes the reason to reach for `sed` in the first place: an edit that
 * will not proceed unless it is unambiguous, and that checks its own work.
 *
 * WHAT IT REFUSES, AND WHY EACH REFUSAL IS EARNED
 *
 *   - **An anchor that matches nothing.** A typo in the anchor silently does
 *     nothing, and "the script ran" reads as success.
 *   - **An anchor that matches more than once.** This is the `sed` failure in
 *     miniature: rewriting every match when one was meant. The backtick-stripping
 *     submission that damaged `src/effects.ts` was exactly this, applied to the
 *     whole file.
 *   - **A write whose result does not contain the replacement.** A write can
 *     fail, a path can be wrong, a later step can undo it. Reading the file back
 *     is the difference between "I wrote it" and "it is there".
 *   - **A replacement that leaves the anchor count unchanged**, which means the
 *     edit did not take.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 *
 * It does not parse the language, judge whether the change is correct, or infer
 * intent. It anchors, replaces a counted number of times, and verifies that what
 * it wrote is what is on disk. Everything else belongs to `typecheck`, `lint`
 * and the suite, which is where it belongs.
 */

/** How many times an anchor is expected to match when the caller does not say. */
export const DEFAULT_EXPECTED = 1;

/** Count non-overlapping occurrences of `needle` in `text`. */
function countOccurrences(text, needle) {
    if (needle === '') return 0;
    let count = 0;
    let from = 0;
    for (;;) {
        const at = text.indexOf(needle, from);
        if (at === -1) return count;
        count += 1;
        from = at + needle.length;
    }
}

/**
 * Work out what an edit would do, without touching anything.
 *
 * Pure: it reads text and returns a plan, so every refusal is testable without a
 * filesystem and the caller can dry-run before committing to a write.
 *
 * @param {object} input
 * @param {string} input.text the file's current contents
 * @param {string} input.anchor the exact text to replace
 * @param {string} input.replacement what to put in its place
 * @param {number} [input.expected] how many matches are acceptable
 * @returns {{ ok: boolean, reason?: string, result?: string, matched: number }}
 */
export function planEdit({ text, anchor, replacement, expected = DEFAULT_EXPECTED }) {
    if (typeof anchor !== 'string' || anchor === '') {
        return { ok: false, matched: 0, reason: 'the anchor is empty; it would match everywhere' };
    }
    if (typeof replacement !== 'string') {
        return { ok: false, matched: 0, reason: 'the replacement must be a string' };
    }
    if (anchor === replacement) {
        return { ok: false, matched: 0, reason: 'the anchor and the replacement are identical' };
    }

    const matched = countOccurrences(text, anchor);

    if (matched === 0) {
        return {
            ok: false,
            matched,
            reason:
                'the anchor matched 0 times. A typo here does nothing at all, and a ' +
                'script that does nothing still reports that it ran.'
        };
    }
    if (matched !== expected) {
        return {
            ok: false,
            matched,
            reason:
                `the anchor matched ${matched} time(s) but ${expected} was expected. ` +
                'Rewriting every match when one was meant is how a global ' +
                'substitution damages a file — narrow the anchor until it is unique.'
        };
    }

    // Split and join rather than replace(), so no `$1` in the replacement is
    // interpreted and no regex metacharacter in the anchor is special.
    const result = text.split(anchor).join(replacement);
    if (result === text) {
        return { ok: false, matched, reason: 'the edit produced no change' };
    }
    return { ok: true, matched, result };
}

/**
 * Apply an edit to a file, verifying its own work.
 *
 * @param {object} input
 * @param {string} input.path the file to edit
 * @param {string} input.anchor the exact text to replace
 * @param {string} input.replacement what to put in its place
 * @param {number} [input.expected] how many matches are acceptable
 * @param {boolean} [input.dryRun] plan the edit but do not write
 * @param {(p: string, s: string) => void} [input.write]
 * @param {(p: string) => string} [input.read]
 * @returns {{ ok: boolean, reason?: string, matched: number, wrote: boolean }}
 */
export function applyEdit({ path, anchor, replacement, expected, dryRun = false, write, read }) {
    // Injected so the verification path can be tested without a real failure,
    // and so a caller can point it at something other than the filesystem.
    const readFile = read ?? ((p) => readFileSyncDefault(p));
    const writeFile = write ?? ((p, s) => writeFileSyncDefault(p, s));

    let before;
    try {
        before = readFile(path);
    } catch (err) {
        return {
            ok: false,
            matched: 0,
            wrote: false,
            reason: `could not read ${path}: ${err.message}`
        };
    }

    const plan = planEdit({ text: before, anchor, replacement, expected });
    if (!plan.ok) return { ok: false, matched: plan.matched, wrote: false, reason: plan.reason };

    if (dryRun) return { ok: true, matched: plan.matched, wrote: false };

    writeFile(path, plan.result);

    // The whole point: a write that "succeeded" is a claim, and a read is a check.
    let after;
    try {
        after = readFile(path);
    } catch (err) {
        return {
            ok: false,
            matched: plan.matched,
            wrote: true,
            reason: `wrote ${path} but could not read it back: ${err.message}`
        };
    }

    // Comparing against the plan IS the verification, and it is the only check
    // that is correct in every case. An earlier version also asserted the anchor
    // was gone from the result — which refuses a perfectly good edit whose
    // REPLACEMENT CONTAINS THE ANCHOR, such as appending to the line it matched.
    // Measured: renaming `export class X {` to `export class X { // note` was
    // refused as "the anchor is still present". A tool that refuses correct work
    // is a tool people stop using, which is the failure this module exists to
    // prevent.
    if (after !== plan.result) {
        return {
            ok: false,
            matched: plan.matched,
            wrote: true,
            reason:
                `wrote ${path} but reading it back produced different content. ` +
                'The write did not take, or something else changed the file.'
        };
    }
    if (!after.includes(replacement)) {
        return {
            ok: false,
            matched: plan.matched,
            wrote: true,
            reason: `wrote ${path} but the replacement is not present in the result`
        };
    }
    return { ok: true, matched: plan.matched, wrote: true };
}

function readFileSyncDefault(p) {
    return readFileSync(p, 'utf8');
}
function writeFileSyncDefault(p, s) {
    writeFileSync(p, s);
}
