// Unit tests for scripts/lib/isolation-compare.mjs.
//
// This gate exists because shortcut register row 5 records a condition nobody was
// watching: a test that passes under `npm test` and fails under
// `check:coverage-floor`, or the reverse. Every test here is about a divergence
// that a comparison of TOTALS would call agreement.
//
// Runs in Node, no DOM, no filesystem.

import test from 'node:test';
import assert from 'node:assert/strict';
import { outcomesByName, compareIsolation } from '../scripts/lib/isolation-compare.mjs';

/** A parsed-report-shaped object. */
const report = (...cases: Array<[string, string]>) => ({
    total: cases.length,
    cases: cases.map(([name, outcome]) => ({ name, outcome }))
});

// ---------------------------------------------------------------------------
// the divergence the row records
// ---------------------------------------------------------------------------

test('isolation: the same outcomes in both models agree', () => {
    const both = report(['a', 'pass'], ['b', 'pass']);
    const verdict = compareIsolation(both, both);
    assert.equal(verdict.ok, true);
    assert.match(verdict.notes[0], /same outcome in each/);
});

test('isolation: a test that FAILS in one model and passes in the other is caught', () => {
    // The row's exact trigger, and the reason a total is not enough: both runs
    // report two tests here.
    const perFile = report(['a', 'pass'], ['b', 'pass']);
    const oneProcess = report(['a', 'fail'], ['b', 'pass']);
    const verdict = compareIsolation(perFile, oneProcess);
    assert.equal(verdict.ok, false);
    assert.match(verdict.reasons[0], /"a" is pass under per-file isolation but fail/);
    assert.match(verdict.reasons[0], /neither figure can be trusted/);
});

test('isolation: the reverse direction is caught too', () => {
    const perFile = report(['a', 'fail']);
    const oneProcess = report(['a', 'pass']);
    const verdict = compareIsolation(perFile, oneProcess);
    assert.equal(verdict.ok, false);
    assert.match(verdict.reasons[0], /is fail under per-file isolation but pass/);
});

test('isolation: a test present in only ONE model is caught', () => {
    // A test that only exists in one model has a result that depends on how the
    // suite was invoked.
    const perFile = report(['a', 'pass'], ['only-per-file', 'pass']);
    const oneProcess = report(['a', 'pass']);
    const verdict = compareIsolation(perFile, oneProcess);
    assert.equal(verdict.ok, false);
    assert.match(verdict.reasons[0], /"only-per-file" ran under per-file isolation and NOT/);
});

test('isolation: a test present only in the shared model is caught', () => {
    const verdict = compareIsolation(
        report(['a', 'pass']),
        report(['a', 'pass'], ['extra', 'pass'])
    );
    assert.equal(verdict.ok, false);
    assert.match(verdict.reasons[0], /"extra" ran under a single process and NOT/);
});

test('isolation: equal TOTALS with a changed outcome is not agreement', () => {
    // The whole argument for comparing per test: these two runs both report two
    // tests and one failure, and a count would call them identical.
    const perFile = report(['a', 'fail'], ['b', 'pass']);
    const oneProcess = report(['a', 'pass'], ['b', 'fail']);
    assert.equal(perFile.total, oneProcess.total);
    assert.equal(compareIsolation(perFile, oneProcess).ok, false);
});

// ---------------------------------------------------------------------------
// what must not be reported
// ---------------------------------------------------------------------------

test('isolation: a skipped test in one model and not the other IS a divergence', () => {
    // Skipping is an outcome, so it counts.
    const verdict = compareIsolation(report(['a', 'skipped']), report(['a', 'pass']));
    assert.equal(verdict.ok, false);
    assert.match(verdict.reasons[0], /is skipped under per-file isolation but pass/);
});

test('isolation: an empty report on either side fails rather than passing', () => {
    // A gate that looked at nothing must not report that it looked at everything.
    const verdict = compareIsolation(report(), report(['a', 'pass']));
    assert.equal(verdict.ok, false);
    assert.match(verdict.reasons[0], /reported no tests at all/);
});

// ---------------------------------------------------------------------------
// name handling
// ---------------------------------------------------------------------------

test('isolation/outcomes: a duplicated name keeps the WORST outcome', () => {
    // Two suites can share a test name. Taking the last would let a failure be
    // masked by a namesake passing.
    const map = outcomesByName(report(['same', 'pass'], ['same', 'fail']));
    assert.equal(map.get('same'), 'fail');
    assert.equal(outcomesByName(report(['same', 'fail'], ['same', 'pass'])).get('same'), 'fail');
});

test('isolation/outcomes: distinct names are kept separately', () => {
    const map = outcomesByName(report(['a', 'pass'], ['b', 'fail']));
    assert.equal(map.size, 2);
    assert.equal(map.get('a'), 'pass');
    assert.equal(map.get('b'), 'fail');
});

test('isolation: many divergences are listed, and the rest are counted', () => {
    // A wall of output is not a report. The first ten are named and the remainder
    // is a count, so the size is visible without burying the reader.
    const many = Array.from({ length: 14 }, (_, i) => [`t${i}`, 'pass'] as [string, string]);
    const verdict = compareIsolation(report(...many), report());
    assert.equal(verdict.ok, false);
    assert.ok(verdict.reasons.length <= 11, 'it must not print an unbounded list');
});
