/**
 * @file scripts/lib/destructive-edit.mjs
 * @description Detects unverified bulk edits in this repository's own tooling.
 *
 * WHY THIS EXISTS
 *
 * Two failures in one session, both from editing source text in bulk:
 *
 *   1. An annotator that inserted a type at a parameter's identifier produced
 *      `update(dt: number, height: number?)` — invalid syntax — because it
 *      assumed the identifier was never already followed by `?`.
 *   2. A `sed 's/`//g'` run across `src/effects.ts` to clean up after the first
 *      mistake stripped EVERY backtick in the file, including the template
 *      literals it builds its colours from:
 *
 *          ctx.strokeStyle = `rgba(160,255,160,${...})`;
 *
 * Both were caught by `typecheck` within seconds, and both were self-inflicted
 * by choosing a blunt instrument for a precise job. This module is the part of
 * that lesson a machine can hold: it refuses the patterns in committed tooling,
 * so the house style cannot quietly become "sed the file and see what breaks".
 *
 * WHAT IT CANNOT SEE, STATED PLAINLY
 *
 * Failure 2 happened in an agent's shell invocation, not in a file this
 * repository tracks. **No gate can inspect a command that was never committed.**
 * That half of the lesson is a mandate in AGENTS.md and a review rule, and it is
 * recorded as such rather than implied by this check. A gate that claims to stop
 * something it cannot see is worse than no gate.
 */

/**
 * Patterns that edit files in place without verifying what they matched.
 *
 * Each is refused because it rewrites every match in a file with no anchor
 * check, no uniqueness requirement, and no verification that the result still
 * parses — which is exactly how a template literal loses its backticks.
 */
/** The rules, as data, so the exclusion above can be stated and tested. */
export const DESTRUCTIVE_PATTERNS = [
    {
        // `sed -i`, `sed -i ''`, `sed --in-place`
        pattern: /\bsed\b[^\n]*\s-(?:-in-place\b|i(?:\s|$|'|"))/,
        what: 'sed -i (in-place substitution)'
    },
    {
        // `perl -pi`, `perl -pi -e`, `perl -i -pe`
        pattern: /\bperl\b[^\n]*\s-[a-zA-Z]*i[a-zA-Z]*\b/,
        what: 'perl -i (in-place substitution)'
    },
    {
        // A python one-liner rewriting a source file.
        pattern: /\bpython3?\b[^\n]*\bopen\([^)]*['"]w['"]/,
        what: 'in-line python rewriting a file'
    },
    {
        // A script writing a source file itself, rather than through the
        // anchored helper. `scripts/edit.mjs` and `scripts/lib/source-edit.mjs`
        // exist so that a scripted edit anchors, counts and verifies; a direct
        // write does none of those things.
        pattern: /\bwriteFileSync\([^)]*\b(?:src|test)\//,
        what: 'a direct write to a source file'
    },
    {
        // The shell spelling of the same act.
        pattern: />>?\s*(?:src|test)\/[\w./-]+/,
        what: 'a shell redirection into a source file'
    }
];

/**
 * Extensions whose contents are source text, where a blunt edit is costly.
 *
 * Matched ANYWHERE in the line, not only at its end. The first version anchored
 * to `$`, so `sed -i ... src/main.ts` was caught while
 * `python3 -c "open('src/main.ts','w')..."` was not — the file is named in the
 * middle there. A filter that only sees one spelling of the same act is a
 * filter that reports nothing on the other.
 */
const SOURCE_EXTENSION = /\.(?:ts|js|mjs|cjs|jsx|tsx)\b/;

/**
 * Paths whose contents are generated, so rewriting them is a different act.
 *
 * `dist/` is build output that `npm run build` recreates; blanket-substituting
 * it cannot lose hand-written code. Excluded rather than left to make the rule
 * look broader than it is.
 */
const GENERATED_PATH = /(?:^|[\s'"=(])(?:dist|node_modules|artifacts|coverage)\//;

/**
 * Scan a script's text for unverified bulk edits.
 *
 * A match is only reported when the same line also names a source file, because
 * `sed -i` on a generated artefact or a temporary file is a different act from
 * rewriting the code itself.
 *
 * @param {string} scriptPath path used in findings
 * @param {string} text the script's contents
 * @returns {string[]}
 */
/**
 * Files that DEFINE these rules rather than follow them.
 *
 * This module's own pattern table spells the forbidden commands out as regex
 * literals, and the first run of the gate flagged them — a rule definition is a
 * description, not an action, which is the same reason comments are skipped
 * above. Declared here rather than left to a heuristic, because inferring
 * "is this line a definition?" from surrounding prose is how a check becomes
 * noise. The test file is included for the same reason: it writes the real
 * command as a fixture.
 */
const DEFINES_THE_RULES = new Set([
    'scripts/lib/destructive-edit.mjs',
    'test/destructive-edit.test.ts'
]);

export function findDestructiveEdits(scriptPath, text) {
    const findings = [];
    if (DEFINES_THE_RULES.has(scriptPath)) return findings;
    for (const [index, line] of text.split('\n').entries()) {
        // Skip prose: a comment describing the hazard is not the hazard.
        const code = line.replace(/(^|\s)(#|\/\/).*$/, '');
        if (!code.trim()) continue;
        if (!SOURCE_EXTENSION.test(code)) continue;
        if (GENERATED_PATH.test(code)) continue;

        for (const { pattern, what } of DESTRUCTIVE_PATTERNS) {
            if (pattern.test(code)) {
                findings.push(
                    `${scriptPath}:${index + 1} uses ${what} on a source file. ` +
                        'An in-place bulk substitution rewrites every match with no anchor ' +
                        'check and no verification that the result still parses — which is ' +
                        'how a template literal loses its backticks. Use an anchored edit ' +
                        'that refuses to write unless the anchor matched exactly once.'
                );
            }
        }
    }
    return findings;
}
