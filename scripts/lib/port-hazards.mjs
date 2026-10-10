/**
 * @file scripts/lib/port-hazards.mjs
 * @description Measure the syntax this codebase uses that will not survive a
 * Godot port unchanged.
 *
 * WHY THIS EXISTS
 *
 * `docs/GODOT-PORT-RESEARCH.md` established that a TypeScript-to-GDScript
 * converter exists, so the port is a TRANSFORM of this codebase rather than a
 * rewrite of it. That makes the size of the transform a number worth tracking —
 * and it was measured by hand, in a document, where it would silently drift the
 * moment anyone wrote another `?.`.
 *
 * A hand-measured inventory in prose is a snapshot. This makes it a ceiling.
 *
 * THE TWO KINDS OF HAZARD, WHICH MUST NOT BE CONFLATED
 *
 *   `error`     The converter REFUSES it. `??`, `?.`, spread, destructuring,
 *               top-level declarations, extra classes per file. These are
 *               mechanical work with a known shape.
 *
 *   `silent`    It CONVERTS and behaves differently. `x in y` checks an index in
 *               TypeScript and an element in GDScript. These are the dangerous
 *               ones, because nothing fails — so they are counted separately and
 *               a change in one is worth more attention than a change in fifty
 *               `?.`.
 *
 * Every count falls when the code is made more portable and rises when it is not.
 * The ceiling may only fall; raising it is a deliberate edit to
 * `quality-baseline.json` that shows up in review.
 */

/**
 * Every hazard, with the reason it is one.
 *
 * `scope` is `src` for code that ships and `both` for code where a loose test is
 * still a contract left unstated.
 */
export const PORT_HAZARDS = [
    {
        id: 'optional-chaining',
        label: '`?.` optional chaining',
        kind: 'error',
        pattern: /\?\./g,
        why: 'GDScript has no short-circuiting member access; check for null first'
    },
    {
        id: 'nullish-coalescing',
        label: '`??` / `??=` nullish coalescing',
        kind: 'error',
        pattern: /\?\?=?/g,
        why: 'GDScript has no such operator; use a ternary'
    },
    {
        id: 'top-level-declaration',
        label: 'top-level `const` / `let`',
        kind: 'error',
        pattern: /^(?:export\s+)?(?:const|let)\s/gm,
        why: 'GDScript has no variables outside a class; move constants into the class'
    },
    {
        id: 'typeof-guard',
        label: "`typeof x === 'undefined'` platform guard",
        kind: 'error',
        // A STRING comparison, not a use of the undefined value. `typeof window`
        // is how this codebase asks "am I in a browser", and in GDScript there is
        // no window to ask about — the module guarding itself is replaced
        // wholesale. Counted separately from the value below because the two need
        // opposite treatment, and lumping them together made the port look like it
        // had 68 null-migrations when most of it was browser detection.
        pattern: /typeof\s+[\w.]+\s*[!=]==\s*['"]undefined['"]/g,
        why: 'typeof does not exist in GDScript; these guards vanish with the browser module they protect'
    },
    {
        id: 'undefined',
        label: '`undefined` as a VALUE',
        kind: 'error',
        // The lookbehind excludes `typeof x === 'undefined'`, which is a string
        // and belongs above.
        pattern: /(?<!['"])\bundefined\b(?!['"])/g,
        why: 'GDScript has only null; write null, and type optional parameters as `T | null = null`'
    },
    {
        id: 'extra-class-per-file',
        label: 'classes beyond the first in a file',
        kind: 'error',
        // Applied per file, not per line: one `.gd` file is one class.
        perFile: true,
        pattern: /^(?:export\s+)?(?:abstract\s+)?class\s/gm,
        why: 'a .gd file is one class; the others become inner classes or their own files'
    },
    {
        id: 'spread',
        label: 'spread `...`',
        kind: 'error',
        // A REST PARAMETER IS FINE — `(...args: T[])` converts cleanly, and the
        // caveats say so. Only a spread at a USE site is a hazard. The lookahead
        // is what separates them: a rest parameter is typed, so it is followed by
        // `name:`, and a call-site spread is not.
        pattern: /\.\.\.(?!\s*\w+\s*:)/g,
        why: 'a call cannot take a variable number of arguments; join arrays with gd.ops.add'
    },
    {
        id: 'in-operator',
        label: '`x in y` (index vs element)',
        kind: 'silent',
        pattern: /(?<![.\w])in\s+(?!\[)/g,
        why: 'checks an INDEX in TypeScript and an ELEMENT in GDScript — use array.has(x)'
    },
    {
        id: 'destructuring',
        label: 'destructuring',
        kind: 'error',
        // `[^}\]\n]` and NOT `[^}\]]`. Without the newline exclusion this
        // matched ACROSS lines, spanning whole functions until it happened to find
        // a `}` followed by `=`, and reported 76 destructuring sites where the
        // corrected pattern finds none. A metric that over-reports by a factor of
        // seventy is not a metric, it is noise with a number attached.
        pattern: /(?:const|let|var)\s*[{[][^}\]\n]*[}\]]\s*=/g,
        why: 'GDScript has none; assign each value on its own line'
    }
];

/** A line that is only a comment, where a hazard is described rather than used. */
const COMMENT_ONLY = /^\s*(?:\/\/|\*|\/\*)/;

/**
 * Words that make an `in` grammar rather than a membership test.
 *
 * Tested against the text BEFORE the match, not against the whole line. The first
 * version tested the line, so `for (const k in obj) {}` was reported as a hazard
 * because the pattern `for\s*\([^)]*$` cannot reach the end of a line that
 * contains a closing paren — the filter silently never fired on the commonest
 * form of the very thing it was written to exclude.
 */
const GRAMMAR_BEFORE = /(?:\bfor\s*\([^)]*|\b(?:import|export|typeof)\b[^;]*)$/;

/**
 * Measure the hazards in one file.
 *
 * @param {string} text the file's contents
 * @returns {Record<string, number>} hazard id -> count
 */
export function measureFile(text) {
    const lines = text.split('\n');
    const counts = {};

    for (const hazard of PORT_HAZARDS) {
        if (hazard.perFile) {
            const found = text.match(hazard.pattern)?.length ?? 0;
            const extra = Math.max(0, found - 1);
            if (extra > 0) counts[hazard.id] = extra;
            continue;
        }
        let n = 0;
        for (const line of lines) {
            if (COMMENT_ONLY.test(line)) continue;
            const code = line.replace(/\/\/.*$/, '');
            if (hazard.id === 'undefined') {
                // Count each bare `undefined` whose prefix is not a typeof
                // comparison, which the guard hazard above already owns.
                for (const match of code.matchAll(/\bundefined\b/g)) {
                    const before = code.slice(0, match.index);
                    if (/typeof\s+[\w.]+\s*[!=]==\s*['"]?$/.test(before)) continue;
                    if (/['"]$/.test(before)) continue;
                    n += 1;
                }
                continue;
            }
            if (hazard.id !== 'in-operator') {
                n += (code.match(hazard.pattern) ?? []).length;
                continue;
            }
            // Count each `in` whose PREFIX is not a for/import/typeof.
            const word = /(?<![.\w])in(?![.\w])/g;
            for (const match of code.matchAll(word)) {
                if (!GRAMMAR_BEFORE.test(code.slice(0, match.index))) n += 1;
            }
        }
        if (n > 0) counts[hazard.id] = n;
    }
    return counts;
}

/**
 * Measure a set of files.
 *
 * @param {Array<{ path: string, text: string }>} files
 * @returns {{ total: number, byHazard: Record<string, number>, byKind: Record<string, number>, byFile: Record<string, Record<string, number>>, findings: Array<{path: string, line: number, id: string, text: string}> }}
 */
export function measurePorts(files) {
    const byHazard = {};
    const byKind = {};
    const byFile = {};
    const findings = [];
    let total = 0;

    const kindOf = Object.fromEntries(PORT_HAZARDS.map((h) => [h.id, h.kind]));

    for (const file of files) {
        const counts = measureFile(file.text);
        const sum = Object.values(counts).reduce((a, b) => a + b, 0);
        if (sum === 0) continue;
        byFile[file.path] = counts;
        total += sum;
        for (const [id, n] of Object.entries(counts)) {
            byHazard[id] = (byHazard[id] ?? 0) + n;
            const kind = kindOf[id] ?? 'error';
            byKind[kind] = (byKind[kind] ?? 0) + n;
        }
        // One finding per hazard per file is enough to locate the work; the count
        // carries the size.
        for (const [id, n] of Object.entries(counts)) {
            findings.push({ path: file.path, id, count: n, line: 0, text: '' });
        }
    }
    return { total, byHazard, byKind, byFile, findings };
}

/**
 * Compare a measurement against recorded ceilings.
 *
 * Two totals, because the two kinds mean different things. The `error` total is
 * mechanical work; the `silent` total is behaviour that will change without
 * anything failing, so it is held to its own, tighter number.
 *
 * @param {{ byKind: Record<string, number> }} measured
 * @param {{ error?: number, silent?: number }} ceilings
 * @returns {{ ok: boolean, reasons: string[] }}
 */
export function judgePorts(measured, ceilings) {
    const reasons = [];
    const silent = measured.byKind.silent ?? 0;
    const errors = measured.byKind.error ?? 0;

    if (errors > (ceilings.error ?? 0)) {
        reasons.push(
            `the mechanical port hazards rose to ${errors}, above the ceiling of ${ceilings.error}. ` +
                'Each is a site the TypeScript-to-GDScript converter refuses, so each is work ' +
                'the port has to do. Raising the ceiling is a deliberate edit.'
        );
    }
    if (silent > (ceilings.silent ?? 0)) {
        reasons.push(
            `the SILENT port hazards rose to ${silent}, above the ceiling of ${ceilings.silent}. ` +
                'These convert without complaint and then behave differently — an `in` that ' +
                'checked an index now checks an element. They are counted separately because a ' +
                'failure here cannot be seen at runtime.'
        );
    }
    return { ok: reasons.length === 0, reasons };
}
