/**
 * @file scripts/lib/isolation-compare.mjs
 * @description Compare a test run under two process-isolation models.
 *
 * WHY THIS EXISTS — shortcut register row 5
 *
 * Coverage is measured with `--test-isolation=none`: every test in one process,
 * chosen because Node's per-file merge was not reproducible and moved the overall
 * branch figure by ~0.1 points at random. The cost is recorded honestly in
 * `docs/SHORTCUTS.md` — a test that depends on module state one process cannot
 * share may behave differently, and the two isolation models could disagree
 * without anyone knowing.
 *
 * The row's trigger is: *"a test that passes under `npm test` and fails under
 * `check:coverage-floor`, or the reverse."* That is a condition nobody was
 * watching for. This watches for it on every run.
 *
 * WHY THE COMPARISON IS BY NAME, NOT BY COUNT
 *
 * Totals agreeing is weak evidence: two runs can both report 792 passing while a
 * different test fails in each. The comparison is therefore per test — the set of
 * names and each one's outcome — so a divergence is named rather than counted.
 */

/**
 * Turn a parsed suite report into a name -> outcome map.
 *
 * @param {{ cases: Array<{ name: string, outcome: string }> }} report
 * @returns {Map<string, string>}
 */
export function outcomesByName(report) {
    const map = new Map();
    for (const testCase of report.cases) {
        // A duplicated name (two suites, one test name) keeps the WORST outcome,
        // so a single failure is never masked by a namesake passing.
        const previous = map.get(testCase.name);
        if (previous === 'fail') continue;
        if (previous === undefined || testCase.outcome === 'fail') {
            map.set(testCase.name, testCase.outcome);
        }
    }
    return map;
}

/**
 * Compare two isolation models.
 *
 * @param {{ total: number, cases: Array<{name: string, outcome: string}> }} isolated
 * @param {{ total: number, cases: Array<{name: string, outcome: string}> }} shared
 * @returns {{ ok: boolean, reasons: string[], notes: string[] }}
 */
export function compareIsolation(isolated, shared) {
    const reasons = [];
    const notes = [];
    const a = outcomesByName(isolated);
    const b = outcomesByName(shared);

    if (a.size === 0 || b.size === 0) {
        return {
            ok: false,
            reasons: [
                'one of the two runs reported no tests at all, so this comparison ' +
                    'proves nothing. A gate that looks at nothing must not report that ' +
                    'it looked at everything.'
            ],
            notes
        };
    }

    // A test present in one model and absent in the other. This is the failure the
    // row worries about, and it is invisible to a total.
    const onlyIsolated = [...a.keys()].filter((name) => !b.has(name));
    const onlyShared = [...b.keys()].filter((name) => !a.has(name));
    for (const name of onlyIsolated.slice(0, 10)) {
        reasons.push(
            `"${name}" ran under per-file isolation and NOT under a single process. ` +
                'A test that only exists in one model is a test whose result depends ' +
                'on how the suite was invoked.'
        );
    }
    for (const name of onlyShared.slice(0, 10)) {
        reasons.push(`"${name}" ran under a single process and NOT under per-file isolation.`);
    }

    // A test that changed outcome between models. This is the exact condition the
    // register row records as its trigger.
    for (const [name, isolatedOutcome] of a) {
        const sharedOutcome = b.get(name);
        if (sharedOutcome === undefined || sharedOutcome === isolatedOutcome) continue;
        reasons.push(
            `"${name}" is ${isolatedOutcome} under per-file isolation but ` +
                `${sharedOutcome} under a single process. The suite's result depends on ` +
                'how it was run, which means neither figure can be trusted on its own.'
        );
    }

    const hidden = Math.max(0, onlyIsolated.length + onlyShared.length - 20);
    if (hidden > 0) notes.push(`... and ${hidden} more name difference(s) not listed.`);

    if (reasons.length === 0) {
        notes.push(`${a.size} test(s) ran under both models with the same outcome in each.`);
    }
    return { ok: reasons.length === 0, reasons, notes };
}
