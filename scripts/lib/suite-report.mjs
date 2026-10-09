/**
 * @file scripts/lib/suite-report.mjs
 * @description Reads the test suite's own machine-readable report.
 *
 * Adopted from the agent-scaffold method (`mechanisms/check_suite.py`), whose
 * reasoning transfers exactly:
 *
 *   "A skipped test is the quietest way to a green suite: the console prints it
 *    in the same shape as a clean run, so reading the summary is not enough."
 *
 * That was measured in this repository before this file existed. Adding one
 * skipped test to `test/systems.test.ts` produced:
 *
 *     tests 513   pass 512   fail 0   skipped 1
 *
 * and lint, check:hygiene and check:baseline all exited 0. The suite reported
 * 512 passing tests and nobody would have looked further.
 *
 * WHY A REPORT AND NOT THE CONSOLE
 *
 * The console summary counts passes. It does not say WHICH test stopped running,
 * and a count that silently grows by one while a skip appears is exactly the
 * shape that reads as success. The report names every test and its outcome.
 *
 * Node emits this XML itself via `--test-reporter=junit`, so nothing here
 * depends on a third-party parser or on the console format.
 *
 * A NOTE ON THE PARSER
 *
 * This is a focused reader for Node's JUnit output, not a general XML parser,
 * and it does not pretend otherwise. It handles the constructs that reporter
 * emits: self-closing and paired `<testcase>` elements, attribute values in
 * single or double quotes, and XML entity escapes. It is covered by unit tests
 * against captured reporter output rather than against XML in general.
 */

/** Decode the five predefined XML entities. */
function decodeEntities(text) {
    return text
        .replaceAll('&lt;', '<')
        .replaceAll('&gt;', '>')
        .replaceAll('&quot;', '"')
        .replaceAll('&apos;', "'")
        .replaceAll('&amp;', '&');
}

/**
 * Pull the attributes out of a start tag's body.
 * @param {string} body the text between `<tag` and `>` or `/>`
 */
function parseAttributes(body) {
    const attributes = {};
    // `name="value"` or `name='value'`; values may contain `>` when escaped.
    const pattern = /([A-Za-z_:][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
    let match;
    while ((match = pattern.exec(body)) !== null) {
        attributes[match[1]] = decodeEntities(match[2] ?? match[3] ?? '');
    }
    return attributes;
}

/**
 * Parse a JUnit report into a suite summary.
 *
 * @param {string} xml contents of a `--test-reporter=junit` report
 * @returns {{ total: number, cases: Array<{ name: string, outcome: string }> }}
 */
export function parseSuiteReport(xml) {
    const cases = [];
    // Every `<testcase ...>`, whether self-closing or wrapping a `<skipped>`.
    //
    // The attribute section is `(?:[^>"']|"[^"]*"|'[^']*')*` rather than the
    // obvious `[^>]*`, because `>` is LEGAL unescaped inside an XML attribute
    // value and Node's reporter emits it. This test name broke the naive
    // version:
    //
    //     name="daily: saveDailyResult persists and prunes old days (>14d)"
    //
    // `[^>]*` stopped at that `>`, so the case was truncated, lost its name,
    // and its body search ran on into the NEXT case — which reported a second
    // skipped test that did not exist. Measured: the naive parser said
    // "2 test(s) were SKIPPED" while Node's own report said `skipped 1`.
    const pattern = /<testcase\b((?:[^>"']|"[^"]*"|'[^']*')*?)(\/>|>)/g;
    let match;
    while ((match = pattern.exec(xml)) !== null) {
        const attributes = parseAttributes(match[1]);
        const name = attributes.name || '(unnamed test)';
        let outcome = 'Passed';

        if (match[2] === '>') {
            // Take everything up to this case's closing tag.
            const close = xml.indexOf('</testcase>', pattern.lastIndex);
            const body = close === -1 ? '' : xml.slice(pattern.lastIndex, close);
            if (body.includes('<failure') || body.includes('<error')) outcome = 'Failed';
            else {
                const skip = /<skipped\b([^>]*)\/?>/.exec(body);
                if (skip) {
                    // Node distinguishes `type="skipped"` from `type="todo"`.
                    // Both are a test that does not run; keep them apart so the
                    // failure message can say which.
                    const kind = parseAttributes(skip[1]).type;
                    outcome = kind === 'todo' ? 'Todo' : 'Skipped';
                }
            }
        }
        cases.push({ name, outcome });
    }
    return { total: cases.length, cases };
}

/**
 * Decide whether a parsed suite is acceptable.
 *
 * @param {{ total: number, cases: Array<{ name: string, outcome: string }> }} report
 * @param {number|null} floor minimum acceptable test count, or null if unrecorded
 * @returns {{ problems: string[], notes: string[] }}
 */
export function judgeSuite(report, floor) {
    const problems = [];
    const notes = [];

    if (report.total === 0) {
        // Total silence must never read as success: zero tests is what a broken
        // glob or a crashed runner looks like from the outside.
        problems.push(
            'the report records no test results at all. That is what a broken ' +
                'test glob or a runner that never started looks like, and it must ' +
                'not read as a clean suite.'
        );
        return { problems, notes };
    }

    const failed = report.cases.filter((c) => c.outcome === 'Failed');
    if (failed.length) {
        problems.push(`${failed.length} test(s) did not pass:`);
        problems.push(...failed.slice(0, 20).map((c) => `    ${c.name}`));
    }

    const skipped = report.cases.filter((c) => c.outcome === 'Skipped');
    const todo = report.cases.filter((c) => c.outcome === 'Todo');

    if (skipped.length) {
        problems.push(
            `${skipped.length} test(s) were SKIPPED. A skip is the quietest way to a ` +
                'green suite — the count still rises and the summary still reads ' +
                'clean. Delete the test and record why, or fix it:'
        );
        problems.push(...skipped.slice(0, 20).map((c) => `    ${c.name}`));
    }
    if (todo.length) {
        problems.push(
            `${todo.length} test(s) are TODO — declared but asserting nothing. ` +
                'A test that cannot fail is worse than no test, because it ' +
                'manufactures confidence:'
        );
        problems.push(...todo.slice(0, 20).map((c) => `    ${c.name}`));
    }

    if (floor === null) {
        notes.push(
            'no test-count floor is recorded, so the count is unconstrained this ' +
                'run. Set `testCountFloor` in quality-baseline.json to make ' +
                'deleting a test a build failure.'
        );
    } else if (report.total < floor) {
        problems.push(
            `the suite ran ${report.total} test(s) but the recorded floor is ${floor}. ` +
                'Tests were removed, and the floor may only be raised.'
        );
    } else {
        notes.push(`floor ${floor}, ran ${report.total} (+${report.total - floor})`);
    }

    return { problems, notes };
}
