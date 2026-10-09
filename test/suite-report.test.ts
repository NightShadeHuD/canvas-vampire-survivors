// Unit tests for scripts/lib/suite-report.mjs.
//
// This gate decides whether a suite is allowed to call itself green, so its
// parser is the part that must not be wrong: a parser that miscounts turns a
// skipped test into a passing one, and nothing downstream can tell.
//
// The fixtures are Node's own `--test-reporter=junit` output, captured, rather
// than XML written by hand — several of these tests exist precisely because the
// reporter emits something a hand-written fixture would not have thought of.
//
// Runs in Node, no DOM.

import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSuiteReport, judgeSuite } from '../scripts/lib/suite-report.mjs';

/** Wrap cases in the testsuites element Node emits. */
function report(...cases) {
    return `<?xml version="1.0" encoding="utf-8"?>\n<testsuites>\n${cases.join('\n')}\n</testsuites>\n`;
}

const PASSED = '\t<testcase name="passes" time="0.0002" classname="test" file="/p/a.test.js"/>';
const SKIPPED =
    '\t<testcase name="is skipped" time="0.0001" classname="test" file="/p/a.test.js">\n' +
    '\t\t<skipped type="skipped" message="true"/>\n\t</testcase>';
const TODO =
    '\t<testcase name="is todo" time="0.0001" classname="test" file="/p/a.test.js">\n' +
    '\t\t<skipped type="todo" message="true"/>\n\t</testcase>';
const FAILED =
    '\t<testcase name="fails" time="0.0001" classname="test" file="/p/a.test.js">\n' +
    '\t\t<failure message="boom" type="AssertionError">stack</failure>\n\t</testcase>';

// ---------------------------------------------------------------------------
// parsing
// ---------------------------------------------------------------------------

test('suite-report/parse: a self-closing testcase is a pass', () => {
    const { total, cases } = parseSuiteReport(report(PASSED));
    assert.equal(total, 1);
    assert.deepEqual(cases, [{ name: 'passes', outcome: 'Passed' }]);
});

test('suite-report/parse: a skipped child is a skip, not a pass', () => {
    const { cases } = parseSuiteReport(report(SKIPPED));
    assert.equal(cases[0].outcome, 'Skipped', 'a skip must never read as a pass');
});

test('suite-report/parse: a todo child is distinguished from a skip', () => {
    // Node marks both with <skipped>, so the `type` attribute is the only thing
    // that separates "not run" from "declared and asserting nothing".
    const { cases } = parseSuiteReport(report(TODO));
    assert.equal(cases[0].outcome, 'Todo');
});

test('suite-report/parse: a failure child is a failure', () => {
    const { cases } = parseSuiteReport(report(FAILED));
    assert.equal(cases[0].outcome, 'Failed');
});

test('suite-report/parse: an attribute value may contain a raw > — the regression', () => {
    // Measured against Node's reporter: `>` is legal unescaped inside an XML
    // attribute value, and one of this repository's test names contains one:
    //   name="daily: saveDailyResult persists and prunes old days (>14d)"
    // A naive `[^>]*` scanner stopped there, truncated the case, lost its name,
    // and searched the WRONG body — reporting a second skipped test that did
    // not exist. The fixture is the real name, not an invented one.
    const xml = report(
        '\t<testcase name="daily: saveDailyResult persists and prunes old days (>14d)" ' +
            'time="0.0002" classname="test" file="/p/a.test.js"/>'
    );
    const { total, cases } = parseSuiteReport(xml);
    assert.equal(total, 1, 'one testcase is one case, not two');
    assert.equal(cases[0].name, 'daily: saveDailyResult persists and prunes old days (>14d)');
    assert.equal(cases[0].outcome, 'Passed');
});

test('suite-report/parse: a truncated case cannot borrow the next case’s skip', () => {
    // The bug's actual damage: the naively-matched case ran its body search on
    // into the following element and found a <skipped> that belonged to
    // somebody else. One skip must be reported as exactly one.
    const xml = report(
        '\t<testcase name="has a > in it" time="0.1" classname="test" file="/p/a.test.js"/>',
        SKIPPED
    );
    const skipped = parseSuiteReport(xml).cases.filter((c) => c.outcome === 'Skipped');
    assert.equal(skipped.length, 1, 'the skip belongs to one case, not two');
    assert.equal(skipped[0].name, 'is skipped');
});

test('suite-report/parse: single-quoted attributes are accepted', () => {
    const { cases } = parseSuiteReport(report("<testcase name='single' time='0.1'/>"));
    assert.equal(cases[0].name, 'single');
});

test('suite-report/parse: XML entities in a name are decoded', () => {
    const { cases } = parseSuiteReport(
        report('\t<testcase name="a &lt;b&gt; &amp; c" time="0.1"/>')
    );
    assert.equal(cases[0].name, 'a <b> & c');
});

test('suite-report/parse: a report with no cases yields zero, not an error', () => {
    const { total, cases } = parseSuiteReport('<testsuites></testsuites>');
    assert.equal(total, 0);
    assert.deepEqual(cases, []);
});

// ---------------------------------------------------------------------------
// judging
// ---------------------------------------------------------------------------

test('suite-report/judge: a clean suite at the floor passes', () => {
    const { problems, notes } = judgeSuite(parseSuiteReport(report(PASSED)), 1);
    assert.deepEqual(problems, []);
    assert.match(notes.join(' '), /floor 1, ran 1/);
});

test('suite-report/judge: a skip is refused, and named', () => {
    const { problems } = judgeSuite(parseSuiteReport(report(PASSED, SKIPPED)), null);
    assert.ok(problems.length, 'a skip must be refused');
    assert.match(problems.join('\n'), /SKIPPED/);
    assert.match(problems.join('\n'), /is skipped/, 'the offending test must be named');
});

test('suite-report/judge: a todo is refused, and named', () => {
    const { problems } = judgeSuite(parseSuiteReport(report(TODO)), null);
    assert.match(problems.join('\n'), /TODO/);
    assert.match(problems.join('\n'), /is todo/);
});

test('suite-report/judge: a failure is refused, and named', () => {
    const { problems } = judgeSuite(parseSuiteReport(report(FAILED)), null);
    assert.match(problems.join('\n'), /did not pass/);
    assert.match(problems.join('\n'), /fails/);
});

test('suite-report/judge: a count below the floor is refused', () => {
    const { problems } = judgeSuite(parseSuiteReport(report(PASSED)), 2);
    assert.match(problems.join('\n'), /ran 1 test\(s\) but the recorded floor is 2/);
});

test('suite-report/judge: the floor is a floor, not an equality', () => {
    // Asserting an exact count would make every unrelated test addition a
    // failure, which trains people to edit the number without reading it.
    const { problems } = judgeSuite(parseSuiteReport(report(PASSED, PASSED, PASSED)), 1);
    assert.deepEqual(problems, [], 'more tests than the floor is fine');
});

test('suite-report/judge: no recorded floor is a notice, not a pass', () => {
    // Silence here would be a gate that looks configured and is not.
    const { problems, notes } = judgeSuite(parseSuiteReport(report(PASSED)), null);
    assert.deepEqual(problems, []);
    assert.match(notes.join(' '), /no test-count floor is recorded/);
});

test('suite-report/judge: an empty report is a problem, never a clean run', () => {
    // Zero tests is what a broken glob or a runner that never started looks
    // like from the outside. It must not read as success.
    const { problems } = judgeSuite(parseSuiteReport('<testsuites></testsuites>'), 0);
    assert.match(problems.join('\n'), /records no test results at all/);
});

test('suite-report/judge: skips and todos are reported together', () => {
    const { problems } = judgeSuite(parseSuiteReport(report(SKIPPED, TODO)), null);
    const text = problems.join('\n');
    assert.match(text, /SKIPPED/);
    assert.match(text, /TODO/);
});
