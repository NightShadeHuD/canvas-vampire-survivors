/**
 * @file scripts/lib/assertion-diff.mjs
 * @description Detects an assertion that became WEAKER between two revisions.
 *
 * Adopted from the agent-scaffold method (`mechanisms/check_assertions.py`),
 * whose reasoning this repository had already earned the hard way.
 *
 * `check:suite` refuses a test that was DELETED or DISABLED. What it cannot see
 * is the same test, still present and still passing, asserting less. Measured
 * here before this file existed — weakening one real assertion:
 *
 *     assert.equal(cam.intensity, 0)   ->   assert.ok(cam.intensity >= 0)
 *
 * left 530/530 tests passing with lint, check:hygiene, check:baseline and
 * check:suite all exiting 0. The suite got greener without getting stronger.
 *
 * WHAT THIS DETECTS, AND WHAT IT DELIBERATELY DOES NOT
 *
 * A tool that judged whether an assertion is "as strong" would be guessing, and
 * a guessing gate gets disabled. So this compares two revisions and reports only
 * weakenings that can be stated with evidence:
 *
 *   1. WEAKENED-KIND  a value assertion (`equal`, `deepEqual`, `match`, …)
 *                     replaced by a property assertion (`ok`, `fail`).
 *                     Asserting that something is true is strictly weaker than
 *                     asserting what it is, and this is the transform that hides
 *                     a wrong value.
 *   2. LOST-VALUE     an exact literal an assertion compared is gone from the
 *                     file — a recorded value that stopped being asserted.
 *   3. FEWER-ASSERTS  the file has fewer assertion calls than its parent.
 *
 * Everything else is left alone. Reworded comments, renamed locals, extracted
 * helpers and a value asserted through a different form all pass, because none
 * of them is a weakening this can state with evidence.
 *
 * WHY THE MESSAGE ARGUMENT IS EXCLUDED
 *
 * The scaffold's version accepts any short quoted run as a "value", and its own
 * comments record the bug that caused: it reported the contents of a diagnostic
 * message as a lost value on a commit that had STRENGTHENED an assertion, and
 * "reporting it teaches the reader to ignore the check".
 *
 * This repository's assertion messages are short and often quote things —
 * `'not "1:7"'`, `'a living player must not display 0 health'` — so a length
 * heuristic would not separate them. Instead the arguments are split properly
 * and a trailing string literal is dropped, because in `node:assert` the last
 * argument is always the message and never a compared value.
 */

/** Assertion kinds that state a VALUE. Replacing one of these is the weakening. */
export const VALUE_KINDS = [
    'equal',
    'strictEqual',
    'deepEqual',
    'deepStrictEqual',
    'notEqual',
    'notStrictEqual',
    'notDeepEqual',
    'match',
    'doesNotMatch',
    'throws',
    'rejects',
    'doesNotThrow',
    'doesNotReject',
    'ifError'
];

/** Assertion kinds that state a PROPERTY, and so pin down less. */
export const PROPERTY_KINDS = ['ok', 'fail'];

/**
 * How many arguments each kind needs before a trailing string can be a message.
 *
 * `assert.equal(actual, expected)` takes two, so a second string is the EXPECTED
 * VALUE; only a third is the message. `assert.ok(value)` takes one, so a second
 * is the message. Getting this wrong silently deletes a compared value —
 * measured: `assert.equal(label, 'a, b, c')` lost `'a, b, c'` and looked like a
 * weakened assertion.
 */
const MIN_ARGS = {
    equal: 2,
    strictEqual: 2,
    deepEqual: 2,
    deepStrictEqual: 2,
    notEqual: 2,
    notStrictEqual: 2,
    notDeepEqual: 2,
    match: 2,
    doesNotMatch: 2,
    throws: 1,
    rejects: 1,
    doesNotThrow: 1,
    doesNotReject: 1,
    ifError: 1,
    ok: 1,
    fail: 0
};

/** `assert.<kind>(` — the subject of this whole module. */
const ASSERTION = /\bassert\.(?<kind>[A-Za-z]+)\s*\(/g;

/**
 * Split an argument list at its top level, respecting nesting and quoting.
 * @param {string} text everything between the call's parentheses
 * @returns {string[]}
 */
function splitArguments(text) {
    const parts = [];
    let depth = 0;
    let quote = null;
    let escaped = false;
    let current = '';
    for (const character of text) {
        if (quote) {
            current += character;
            if (escaped) escaped = false;
            else if (character === '\\') escaped = true;
            else if (character === quote) quote = null;
            continue;
        }
        if (character === '"' || character === "'" || character === '`') {
            quote = character;
            current += character;
            continue;
        }
        if ('([{'.includes(character)) depth += 1;
        if (')]}'.includes(character)) depth -= 1;
        if (character === ',' && depth === 0) {
            parts.push(current.trim());
            current = '';
            continue;
        }
        current += character;
    }
    if (current.trim()) parts.push(current.trim());
    return parts;
}

/** True when the text is a single string literal and nothing else. */
function isPlainStringLiteral(text) {
    return /^'(?:[^'\\]|\\.)*'$/.test(text) || /^"(?:[^"\\]|\\.)*"$/.test(text);
}

/**
 * Every assertion in a file, with the arguments that carry compared values.
 *
 * @param {string} text file contents
 * @returns {Array<{ kind: string, head: string, args: string[] }>}
 */
export function assertions(text) {
    const found = [];
    ASSERTION.lastIndex = 0;
    let match;
    while ((match = ASSERTION.exec(text)) !== null) {
        // Walk to the balanced close paren, with a generous bound for the
        // pathological case. Only the head is needed: the kind and the values.
        const start = ASSERTION.lastIndex;
        let depth = 1;
        let index = start;
        const limit = Math.min(text.length, start + 600);
        while (index < limit && depth > 0) {
            const character = text[index];
            if (character === '(') depth += 1;
            else if (character === ')') depth -= 1;
            index += 1;
        }
        const inside = text.slice(start, depth === 0 ? index - 1 : index);
        const head = `${match[0]}${inside})`.replace(/\s+/g, ' ');

        const args = splitArguments(inside);
        // In node:assert the trailing argument is the message, and only when
        // the call has more arguments than the kind requires. Dropping it by
        // position rather than by "is a string" is what keeps a legitimate
        // expected value — `assert.equal(label, 'a, b, c')` — in the list.
        const minimum = MIN_ARGS[match.groups.kind] ?? 1;
        if (args.length > minimum && isPlainStringLiteral(args[args.length - 1])) args.pop();

        found.push({ kind: match.groups.kind, head, args });
    }
    return found;
}

/**
 * The literals an assertion compares.
 *
 * Numbers must be three digits or more: one- and two-digit numbers appear in
 * ordinary code often enough that reporting them would be noise, and a gate
 * that reports noise is a gate that gets skimmed.
 *
 * @param {string[]} args the value-carrying arguments
 * @returns {Set<string>}
 */
export function literalsIn(args) {
    const values = new Set();
    for (const arg of args) {
        for (const number of arg.matchAll(/(?<![\w.'])(\d{3,})(?![\w.])/g)) values.add(number[1]);
        // A quoted key or short label used as the EXPECTED value.
        for (const quoted of arg.matchAll(/'([A-Za-z0-9_./ -]{2,40})'/g)) values.add(quoted[1]);
    }
    return values;
}

/**
 * Compare two revisions of one test file.
 *
 * @param {string} parentText the file at the base revision
 * @param {string} currentText the file now
 * @returns {string[]} findings, empty when nothing was weakened
 */
export function compareFiles(parentText, currentText) {
    const parent = assertions(parentText);
    const current = assertions(currentText);
    const findings = [];

    // 1. WEAKENED-KIND.
    //
    // Pair a loss against a gain rather than letting a total excuse it. The
    // scaffold's first version compared sums and reported nothing when the gains
    // matched — but a file that ALREADY had property assertions can absorb a
    // converted one without the totals moving, and that conversion is exactly
    // the one worth catching.
    let lostValues = 0;
    for (const kind of VALUE_KINDS) {
        const before = parent.filter((a) => a.kind === kind).length;
        const after = current.filter((a) => a.kind === kind).length;
        lostValues += Math.max(0, before - after);
    }
    let gainedProperties = 0;
    for (const kind of PROPERTY_KINDS) {
        const before = parent.filter((a) => a.kind === kind).length;
        const after = current.filter((a) => a.kind === kind).length;
        gainedProperties += Math.max(0, after - before);
    }
    if (lostValues > 0 && gainedProperties > 0) {
        findings.push(
            `${lostValues} value assertion(s) and ${gainedProperties} property ` +
                'assertion(s) appeared or vanished together. Asserting that something ' +
                'IS TRUE is weaker than asserting WHAT IT IS, and this is the ' +
                'transform that hides a wrong value.'
        );
    }

    // 2. LOST-VALUE: a literal that stopped being asserted anywhere in the file.
    const before = new Set();
    for (const a of parent) for (const v of literalsIn(a.args)) before.add(v);
    const after = new Set();
    for (const a of current) for (const v of literalsIn(a.args)) after.add(v);
    const lost = [...before].filter((v) => !after.has(v));
    if (lost.length) {
        findings.push(
            `the value(s) ${lost.map((v) => JSON.stringify(v)).join(', ')} ` +
                'are no longer asserted anywhere in this file. A value that stopped ' +
                'being compared is a defect the suite stopped being able to see.'
        );
    }

    // 3. FEWER-ASSERTS.
    if (current.length < parent.length) {
        findings.push(`the file has ${current.length} assertion(s), down from ${parent.length}.`);
    }

    return findings;
}
