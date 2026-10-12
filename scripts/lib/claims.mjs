/**
 * @file scripts/lib/claims.mjs
 * @description Do the numbers a document states about the current revision match the
 * ones the gates measured?
 *
 * PORTED FROM `agent-scaffold/mechanisms/check_claims.py`, whose own docstring gives
 * the reason and is worth repeating because this project reproduced it exactly:
 *
 *     a count kept by hand
 *     "FIFTEEN packs" where the tree had 18 -- a number never measured
 *     the same, three times
 *
 * `check:register` validates a document's STRUCTURE -- tables, ids, citations. Nothing
 * validated its NUMBERS, so a row could be perfectly well formed and factually stale,
 * and the only thing that caught it was a human noticing.
 *
 * **This project's version of that failure: `strictNullChecks` in `src/` was reported
 * as zero for SEVEN consecutive rounds after it had gone back to seven.** A rule was
 * written about it (rule 8, "a number in prose must cite the command"). A rule is
 * something a person has to remember; this is a mechanism.
 *
 * WHAT IT CHECKED AGAINST, AND WHY
 *
 * The ceilings in `quality-baseline.json`. Those are only ever written by a gate that
 * MEASURED the value -- `check:strict --update` refuses to record anything above the
 * old ceiling -- so the ceiling is a measurement, not a second hand-written number.
 * Comparing one document against another hand-written number would prove nothing.
 *
 * WHAT IT DOES NOT CHECK, stated so the limit is known rather than assumed: numbers
 * describing PAST revisions. A document legitimately says "777 -> 168", and the 777
 * cannot be measured from here. This reads the claims about the CURRENT revision only.
 * That is the remaining ceiling, and it is the scaffold's too.
 *
 * @module scripts/lib/claims
 */

/** The markers the checkable numbers live between. */
export const CLAIM_BEGIN = '<!-- claims:begin -->';
export const CLAIM_END = '<!-- claims:end -->';

/**
 * A claim in a document: a gate name, and the figures stated for it.
 *
 * @typedef {{gate: string, src: number|null, test: number|null, line: number, text: string}} Claim
 */

/**
 * Find every `gate (N in \`src/\`, M in \`test/\`)` claim in a document.
 *
 * Anchored on the SHAPE the register actually uses rather than on prose. A parser that
 * tried to read any sentence containing a number would match the historical figures
 * this deliberately leaves alone, and a gate that cries wolf gets switched off.
 *
 * @param {string} text
 * @returns {Claim[]}
 */
export function parseClaims(text) {
    const claims = [];
    const lines = String(text ?? '').split('\n');

    // Only INSIDE the markers. Prose legitimately quotes historical figures -- "375 -> 0"
    // is a true sentence -- and a parser that scraped every sentence would flag them and be
    // switched off within a week. A narrow parser that misses something is a bug; a broad
    // one that cries wolf is a gate nobody keeps.
    let inside = false;
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes(CLAIM_BEGIN)) {
            inside = true;
            continue;
        }
        if (lines[i].includes(CLAIM_END)) {
            inside = false;
            continue;
        }
        if (!inside) continue;

        // `| \`noImplicitAny\` | 168 | 360 |`
        const m = /^\|\s*`([A-Za-z][A-Za-z0-9_]*)`\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*$/.exec(
            lines[i]
        );
        if (m) {
            claims.push({
                gate: m[1],
                src: Number(m[2]),
                test: Number(m[3]),
                line: i + 1,
                text: m[0].trim()
            });
        }
    }
    return claims;
}

/**
 * Compare claims against measured ceilings.
 *
 * A gate named in a document but absent from the ceilings is a FAILURE, not a skip: it
 * means the document is making a claim about something nothing measures, which is how a
 * number becomes folklore.
 *
 * @param {Claim[]} claims
 * @param {Record<string, {src: number, test: number}>} measured
 * @returns {{ok: boolean, reasons: string[], checked: number}}
 */
export function judgeClaims(claims, measured) {
    const reasons = [];

    for (const c of claims) {
        const want = measured?.[c.gate];
        if (!want) {
            reasons.push(
                `line ${c.line}: the document states a figure for \`${c.gate}\`, but no gate ` +
                    'measures it. A claim nothing measures cannot be checked, which is how a ' +
                    'number becomes folklore.'
            );
            continue;
        }
        if (c.src !== want.src) {
            reasons.push(
                `line ${c.line}: claims \`${c.gate}\` is ${c.src} in src/, but the gate ` +
                    `measured ${want.src}. Update the document, or the gate if it is wrong — ` +
                    'but do not leave the two disagreeing.'
            );
        }
        if (c.test !== want.test) {
            reasons.push(
                `line ${c.line}: claims \`${c.gate}\` is ${c.test} in test/, but the gate ` +
                    `measured ${want.test}.`
            );
        }
    }

    return { ok: reasons.length === 0, reasons, checked: claims.length };
}
