/**
 * @file scripts/lib/strict-flags.mjs
 * @description Measure the two TypeScript flags that are still off, so the numbers
 * in the register and the reports come from a gate instead of from an ad-hoc
 * command somebody remembered to run.
 *
 * WHY THIS EXISTS
 *
 * `strictNullChecks` was driven from 375 errors to zero in `src/` across many
 * rounds, and reported as zero for seven of them after it had silently gone back to
 * seven. Every one of those numbers came from a hand-run `tsc -p tsconfig.b.json`
 * in a shell. Nothing in the repository measured them, so nothing could notice.
 *
 * **The flags are not independent.** Declaring a parameter optional to satisfy
 * `noImplicitAny` moves an error into `strictNullChecks`; supplying a default to
 * satisfy `strictNullChecks` can move one back. Working one column without watching
 * the other is how a milestone quietly un-happens.
 *
 * WHY `src/` IS COUNTED SEPARATELY
 *
 * The same reason `check:ports` measures `src/` only: a GDScript port transforms
 * `src/` and replaces `test/` with GUT. A total that mixes them cannot say whether
 * the code that ships is getting stricter or the tests are getting noisier.
 *
 * @module scripts/lib/strict-flags
 */

/**
 * The flags this gate tracks.
 *
 * `strictNullChecks` first: GDScript has only `null`, so `undefined` versus `null`
 * is a real semantic difference at port time rather than hygiene. `noImplicitAny`
 * has no GDScript analogue at all — GDScript is dynamically typed — so it is
 * genuinely the lower-priority of the two, and the order here records that.
 */
export const STRICT_FLAGS = [
    {
        id: 'strictNullChecks',
        label: 'strictNullChecks',
        why: 'GDScript has only `null`, so undefined-vs-null is a real port difference.'
    },
    {
        id: 'noImplicitAny',
        label: 'noImplicitAny',
        why: 'Parameters written while these files were JavaScript. Mechanical, but large.'
    }
];

/** Every flag id this gate knows how to measure. */
export const STRICT_FLAG_IDS = STRICT_FLAGS.map((f) => f.id);

const ERROR_LINE = /^(src|test)\/([^\s(]+)\((\d+),\d+\): error TS\d+:/;

/**
 * Parse `tsc` output into totals split by tree.
 *
 * Split by `src/` and `test/` because those two numbers answer different questions,
 * and a single total lets a regression in shipped code hide behind an improvement
 * in tests.
 *
 * `undefined` is in the type because the caller passes whatever a spawn produced,
 * and `parseTscOutput(undefined)` returning zero is a case worth testing -- a test
 * that proves robustness must not be rejected by the signature it is proving.
 *
 * @param {string | undefined} output - Raw stdout+stderr from a `tsc` run.
 * @returns {{total: number, src: number, test: number, byFile: Record<string, number>, unparsed: number}}
 */
export function parseTscOutput(output) {
    const byFile = {};
    let src = 0;
    let test = 0;
    let unparsed = 0;

    for (const raw of String(output ?? '').split('\n')) {
        const line = raw.trim();
        if (!line.includes(': error TS')) continue;
        const m = ERROR_LINE.exec(line);
        if (!m) {
            // An error outside `src/` and `test/` is still an error. Counting it as
            // nothing would let one hide in a config file or a script.
            unparsed += 1;
            continue;
        }
        const tree = m[1];
        byFile[`${tree}/${m[2]}`] = (byFile[`${tree}/${m[2]}`] ?? 0) + 1;
        if (tree === 'src') src += 1;
        else test += 1;
    }

    return { total: src + test + unparsed, src, test, byFile, unparsed };
}

/**
 * Compare a measurement against the recorded ceilings.
 *
 * Both directions matter and only one is a failure. A count ABOVE its ceiling is a
 * regression and stops the build. A count BELOW is an improvement that `--update`
 * records — it is not an error, but it is reported, because a ceiling nobody lowers
 * stops being a measurement and becomes decoration.
 *
 * @param {Record<string, {src: number, test: number}>} measured
 * @param {Record<string, {src: number, test: number}>} ceilings
 * @returns {{ok: boolean, reasons: string[], improvements: string[]}}
 */
export function judgeStrict(measured, ceilings) {
    const reasons = [];
    const improvements = [];

    for (const flag of STRICT_FLAG_IDS) {
        const got = measured[flag];
        const want = ceilings?.[flag];
        if (!want) {
            reasons.push(
                `no recorded ceiling for \`${flag}\`. A metric with no ceiling cannot ` +
                    'detect a regression, and this gate exists because one went unnoticed.'
            );
            continue;
        }
        if (!got) {
            reasons.push(`\`${flag}\` was not measured, so this gate verified nothing about it.`);
            continue;
        }
        for (const tree of ['src', 'test']) {
            if (got[tree] > want[tree]) {
                reasons.push(
                    `\`${flag}\` in ${tree}/ rose to ${got[tree]}, above the recorded ceiling ` +
                        `of ${want[tree]}. Raising a ceiling is a deliberate edit to ` +
                        'quality-baseline.json with its reason; a rise is otherwise a regression.'
                );
            } else if (got[tree] < want[tree]) {
                improvements.push(`${flag} ${tree}/ ${want[tree]} -> ${got[tree]}`);
            }
        }
    }

    return { ok: reasons.length === 0, reasons, improvements };
}
