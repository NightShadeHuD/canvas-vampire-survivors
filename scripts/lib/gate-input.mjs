/**
 * @file scripts/lib/gate-input.mjs
 * @description Guards for the two ways a gate can pass without checking anything.
 *
 * Adopted from the agent-scaffold method's rule that a gate whose configuration
 * is absent is "SKIPPED WITH A NOTICE, never silently passed", and from its
 * closing line, which counts them:
 *
 *   "ALL 12 GATES PASSED (3 skipped as unconfigured — each is a rule this
 *    project does not yet check)"
 *
 * That principle was applied here and it found two real holes. Measured, by
 * pointing each gate's scan at a glob that matches nothing:
 *
 *   check-docs     "0 document(s); tables well formed, 0 reference(s) resolve"  exit 0
 *   check-hygiene  "clean — 0 tracked files checked"                            exit 0
 *
 * Both reported success in exactly the shape a real pass takes. Neither had
 * looked at anything. This is principle P4's most expensive kind of wrong: a
 * degraded answer that looks correct, so nothing downstream can detect it and
 * nobody thinks to look.
 *
 * TWO DISTINCT STATES, AND THEY MUST NOT BE CONFLATED
 *
 *   - **Nothing to check** — the scan set is empty because the tooling is
 *     broken, a glob is wrong, or a directory moved. That is a FAILURE. A gate
 *     that verified nothing must not report that it verified everything.
 *   - **Nothing to check yet** — a project with no shortcut register has
 *     genuinely declared no shortcuts. That is a NOTICE: a legitimate state,
 *     reported and counted, so a run says how many gates checked nothing.
 */

/** Prefix a gate prints when it legitimately had nothing to check. */
export const NOTICE_PREFIX = 'NOTICE:';

/**
 * Refuse an empty scan set.
 *
 * @param {number} count how many things the gate was going to look at
 * @param {string} what a plural noun for them, e.g. "documents"
 * @param {string} because what an empty set would mean here
 * @returns {string|null} a failure message, or null when the set is non-empty
 */
export function refuseEmptyScan(count, what, because) {
    if (count > 0) return null;
    return (
        `nothing to check: 0 ${what} were found, so this gate verified nothing. ` +
        `${because} A gate that looks at nothing must not report that it looked ` +
        'at everything — that is a degraded answer wearing the shape of a pass.'
    );
}

/**
 * A legitimate "nothing to check yet" state, to be printed and counted.
 *
 * @param {string} message why there is nothing to check, and what that means
 */
export function notice(message) {
    return `${NOTICE_PREFIX} ${message}`;
}

/**
 * The NOTICE lines a gate printed, so a run can count what checked nothing.
 *
 * `undefined` is in the type because a caller may hand this whatever a spawn
 * produced, including nothing -- and `test/gate-input.test.ts` proves that case.
 * A test that proves robustness must not be rejected by the signature it proves.
 *
 * @param {string | undefined} output a step's combined stdout and stderr
 * @returns {string[]}
 */
export function noticesIn(output) {
    const found = [];
    for (const raw of String(output ?? '').split('\n')) {
        // Matched ANYWHERE in the line, not at its start: a gate prefixes its own
        // name for readability, so the line reads
        // `check-register: NOTICE: no register at ...`. Requiring the prefix
        // first meant the notice was printed and never collected — the counting
        // silently did nothing, which is the failure this module exists to stop.
        const at = raw.indexOf(NOTICE_PREFIX);
        if (at !== -1) found.push(raw.slice(at + NOTICE_PREFIX.length).trim());
    }
    return found;
}
