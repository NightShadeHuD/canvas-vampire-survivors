/**
 * @file scripts/lib/type-coverage.mjs
 * @description Measure how much of this codebase is typed as `any`.
 *
 * WHY THIS IS THE METRIC THAT MATTERS FOR THE PORT
 *
 * Every other number this project tracks measures the JavaScript game: coverage
 * of lines, branches and functions, a test count, a gate count. None of them
 * measures the thing that decides whether a GDScript port is a translation or a
 * guess.
 *
 * `any` has no GDScript equivalent. `float`, `String`, `Array[Enemy]` and a class
 * type all translate; `any` leaves the translator to infer intent from the body,
 * and an inference is exactly what a port cannot afford to get wrong. So a
 * falling `any` count is the port getting closer, and a rising one is the port
 * getting further away while every other gate stays green.
 *
 * WHY IT IS NOT SIMPLY "COUNT THE WORD ANY"
 *
 * `any` appears in prose, in comments explaining why a parameter is loose, and in
 * identifiers like `company`. A grep would count all of them and the number would
 * be noise — and a metric people do not believe is a metric they ignore.
 *
 * So each form is matched where it is a TYPE and nowhere else:
 *
 *   `: any`            an annotation
 *   `as any`           a cast that silences a check
 *   `Record<string, any>`   an untyped bag, which is the same problem in a shape
 *   `<any>`            a type argument, including `Array<any>`
 *   `any[]`            an array of anything
 *
 * Comment-only lines are skipped. A docblock explaining a deliberate `any` is
 * evidence of care, not a defect, and counting it would punish the wrong thing.
 */

/** The forms an `any` can take where it is a type, and what each is called. */
export const ANY_FORMS = [
    // ORDER IS LOAD-BEARING. The alternation is tried left to right at each
    // position, so the shapes that CONTAIN a bare `: any` must come before it,
    // or `: any[]` is counted as an annotation and the array form never matches.
    { name: 'array', pattern: /\bany\s*\[\s*\]/ },
    { name: 'record', pattern: /\bRecord<\s*string\s*,\s*any\s*>/ },
    { name: 'generic', pattern: /<\s*any\s*[,>]/ },
    { name: 'cast', pattern: /\bas\s+any\b/ },
    // The lookahead is what makes `: any[]` count as an array and not as an
    // annotation. Ordering alone cannot do it: the two patterns match at
    // different starting positions — `annotation` begins at the colon and
    // `array` begins at `any` — so whichever the scanner reaches first wins, and
    // from the colon only `annotation` can match.
    { name: 'annotation', pattern: /:\s*any\b(?!\s*\[)/ }
];

/**
 * One pass that finds an `any` wherever it is a type.
 *
 * A SINGLE combined pattern, matched once per position. The first version tested
 * each form separately, so `: any[]` matched both the annotation rule and the
 * array rule and one `any` was counted twice — the count was inflated by exactly
 * the forms that combine, and nothing about the output said so.
 *
 * Order matters: the alternatives are tried left to right at each position, so
 * the more specific shapes come first and the bare annotation last.
 */
const ANY_AT = new RegExp(ANY_FORMS.map((f) => `(${f.pattern.source})`).join('|'), 'g');

/** A line that is only a comment, where an `any` is prose rather than a type. */
const COMMENT_ONLY = /^\s*(?:\/\/|\*|\/\*)/;

/**
 * Every `any` in one file's text.
 *
 * @param {string} text the file's contents
 * @returns {Array<{ line: number, form: string, text: string }>}
 */
export function findAny(text) {
    const found = [];
    for (const [index, line] of text.split('\n').entries()) {
        if (COMMENT_ONLY.test(line)) continue;
        // Strip a trailing line comment so `f(x: any); // any` counts once.
        const code = line.replace(/\/\/.*$/, '');
        ANY_AT.lastIndex = 0;
        for (const match of code.matchAll(ANY_AT)) {
            // Group 1 is the whole alternation; the first non-undefined capture
            // after it says which form matched.
            const which = match.slice(1).findIndex((g) => g !== undefined);
            found.push({
                line: index + 1,
                form: ANY_FORMS[which]?.name ?? 'unknown',
                text: line.trim()
            });
        }
    }
    return found;
}

/**
 * Count the `any` in a set of files.
 *
 * @param {Array<{ path: string, text: string }>} files
 * @returns {{ total: number, perFile: Record<string, number>, byForm: Record<string, number>, findings: Array<{path: string, line: number, form: string, text: string}> }}
 */
export function measureAny(files) {
    const perFile = {};
    const byForm = {};
    const findings = [];
    let total = 0;

    for (const file of files) {
        const hits = findAny(file.text);
        if (hits.length === 0) continue;
        perFile[file.path] = hits.length;
        total += hits.length;
        for (const hit of hits) {
            byForm[hit.form] = (byForm[hit.form] ?? 0) + 1;
            findings.push({ path: file.path, ...hit });
        }
    }
    return { total, perFile, byForm, findings };
}

/**
 * Compare a measurement against recorded ceilings.
 *
 * Only the TOTAL has a ceiling, not each file. A per-file ceiling would fail the
 * moment a file was renamed or split — which `check:coverage-floor` already
 * demonstrated costs a confusing red gate for a change that made nothing worse —
 * while the total is what the port actually cares about. A file that improves and
 * a file that regresses cancel out, and that is the correct behaviour for a
 * number whose meaning is "how much of this codebase would a translator have to
 * guess at".
 *
 * @param {{ total: number }} measured
 * @param {number} ceiling
 * @returns {{ ok: boolean, reason?: string }}
 */
export function judgeAny(measured, ceiling) {
    if (measured.total > ceiling) {
        return {
            ok: false,
            reason:
                `the codebase now contains ${measured.total} use(s) of \`any\`, above the ` +
                `recorded ceiling of ${ceiling}. \`any\` has no GDScript equivalent, so each ` +
                'one is a place a port has to infer intent instead of reading it. Either give ' +
                'it a real type, or declare the increase by raising the ceiling deliberately.'
        };
    }
    if (measured.total < ceiling) {
        return {
            ok: true,
            reason:
                `\`any\` use fell from ${ceiling} to ${measured.total}. Lower the ceiling with ` +
                '`npm run check:types -- --update` so the improvement cannot be given back.'
        };
    }
    return { ok: true };
}
