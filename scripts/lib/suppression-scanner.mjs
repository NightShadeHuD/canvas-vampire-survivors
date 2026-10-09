/**
 * @file scripts/lib/suppression-scanner.mjs
 * @description The detection rules behind scripts/check-suppressions.mjs, split
 * out so they can be unit-tested. A gate whose own logic is untested is just a
 * different kind of unverified claim.
 *
 * The central idea: a suppression only counts when a tool would actually **act
 * on it** — a comment directive, a statement, or a call. Prose that merely
 * mentions a suppression does not count.
 *
 * That distinction is not academic. The first version of this scanner matched
 * the bare strings anywhere, so it counted:
 *   - its own rule table (`re: /@ts-nocheck/g`),
 *   - its own doc comment (` * `@ts-nocheck`, `@ts-ignore`, ...`),
 *   - `scripts/verify.mjs` explaining what a TODO means,
 * and blocked an unrelated commit with 18 phantom violations. Anchoring every
 * pattern to comment syntax fixed all of them with no file exclusions, so a
 * real suppression can never hide behind a carve-out.
 *
 * See docs/ENGINEERING-STANDARDS.md §1.2.
 */

/**
 * Prefix that a suppression must carry to be in effect: a line comment, a
 * block comment (including `/**`), or a JSDoc continuation line.
 */
const COMMENT = String.raw`(?:\/\/|\/\*+|\*)[ \t]*`;

/** Build a comment-directive pattern for a token. */
const directive = (token) => `${COMMENT}${token}\\b`;

/**
 * Tracked suppressions. `id` is the key in quality-baseline.json; `source` is a
 * regex source string evaluated per line, so counts and line numbers always
 * agree.
 */
export const RULES = [
    { id: 'ts-nocheck', label: '@ts-nocheck', source: directive('@ts-nocheck') },
    { id: 'ts-ignore', label: '@ts-ignore', source: directive('@ts-ignore') },
    {
        id: 'ts-expect-error',
        label: '@ts-expect-error',
        source: directive('@ts-expect-error')
    },
    { id: 'eslint-disable', label: 'eslint-disable', source: directive('eslint-disable') },
    { id: 'debugger', label: 'debugger statement', source: String.raw`^\s*debugger\s*;?\s*$` },
    {
        id: 'test-skip',
        label: '.skip( / xit( / xtest(',
        source: String.raw`\b(?:it|test|describe)\.skip\(|\bxit\(|\bxtest\(`
    },
    { id: 'todo', label: 'TODO', source: `${COMMENT}TODO\\b` },
    { id: 'fixme', label: 'FIXME', source: `${COMMENT}FIXME\\b` }
];

/** Fresh, non-stateful regexes per rule (avoids `lastIndex` bugs). */
const compiled = RULES.map((rule) => ({ ...rule, re: new RegExp(rule.source, 'g') }));

/**
 * Blank out the contents of string and template literals, preserving length and
 * newlines so line numbers stay accurate. Comments are left untouched.
 *
 * Why this exists: a string literal is *data*. A suppression token wrapped in
 * quotes is not a directive — no tool acts on it — so counting it is wrong.
 * Without this step the scanner counted its own test fixtures, and the
 * skip-pattern text inside its own rule table, and blocked two commits with
 * phantom suppressions. Scanning code-and-comments rather than raw bytes
 * removes that whole class of error with no file carve-outs, so a real
 * suppression can never hide behind an exclusion.
 *
 * Corollary, and it is deliberate: a comment that *itself* contains a
 * directive-shaped token is counted. That is why the examples above are
 * described rather than quoted. A scanner that guessed at intent would be
 * unpredictable, and an unpredictable gate is worse than a strict one.
 *
 * Known limit: regex literals are not detected. Telling `/` division from a
 * regex literal needs a full parser, and the failure mode here is a false
 * *positive* on a pathological regex, never a missed directive.
 *
 * @param {string} text
 * @returns {string} same length, strings blanked to spaces
 */
export function stripStrings(text) {
    const out = text.split('');
    const n = text.length;
    let i = 0;

    while (i < n) {
        const c = text[i];

        // Line comment — keep the whole thing, directives live here.
        if (c === '/' && text[i + 1] === '/') {
            while (i < n && text[i] !== '\n') i++;
            continue;
        }

        // Block comment — also kept.
        if (c === '/' && text[i + 1] === '*') {
            i += 2;
            while (i < n && !(text[i] === '*' && text[i + 1] === '/')) i++;
            i += 2;
            continue;
        }

        // String or template literal — blank the contents.
        if (c === "'" || c === '"' || c === '`') {
            const quote = c;
            out[i] = ' ';
            i++;
            while (i < n) {
                if (text[i] === '\\') {
                    out[i] = ' ';
                    if (i + 1 < n) out[i + 1] = ' ';
                    i += 2;
                    continue;
                }
                if (text[i] === quote) {
                    out[i] = ' ';
                    i++;
                    break;
                }
                // Template literals may span lines; keep newlines so line
                // numbers in hits still line up with the original file.
                if (text[i] !== '\n') out[i] = ' ';
                i++;
            }
            continue;
        }

        i++;
    }

    return out.join('');
}

/**
 * Count every rule across one file's text.
 *
 * @param {string} text
 * @returns {{ counts: Record<string, number>, hits: Array<{rule: string, line: number, text: string}> }}
 */
export function scanText(text) {
    const counts = Object.fromEntries(RULES.map((r) => [r.id, 0]));
    const hits = [];

    // Scan code-and-comments, not raw bytes: string contents are data.
    const scannable = stripStrings(text);

    const lines = scannable.split('\n');
    const originalLines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        for (const rule of compiled) {
            rule.re.lastIndex = 0;
            const matches = line.match(rule.re);
            if (!matches) continue;
            counts[rule.id] += matches.length;
            // Report the original text so the message is readable.
            hits.push({ rule: rule.id, line: i + 1, text: (originalLines[i] ?? '').trim() });
        }
    }

    return { counts, hits };
}

/**
 * Scan many files. `read` is injected so this stays testable without a
 * filesystem.
 *
 * @param {string[]} paths
 * @param {(p: string) => string} read
 */
export function scanFiles(paths, read) {
    const totals = Object.fromEntries(RULES.map((r) => [r.id, 0]));
    const hitsByRule = Object.fromEntries(RULES.map((r) => [r.id, []]));

    for (const p of paths) {
        let text;
        try {
            text = read(p);
        } catch {
            continue; // Unreadable/binary — not this scanner's concern.
        }
        const { counts, hits } = scanText(text);
        for (const rule of RULES) totals[rule.id] += counts[rule.id];
        for (const h of hits) hitsByRule[h.rule].push(`${p}:${h.line}`);
    }

    return { totals, hitsByRule };
}
