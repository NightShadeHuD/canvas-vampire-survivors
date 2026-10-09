// Unit tests for scripts/lib/gate-input.mjs.
//
// Two ways a gate passes without checking anything, and the two states must not
// be conflated: an empty scan set is a FAILURE, while "nothing declared yet" is
// a NOTICE that the run counts.
//
// Both guards exist because the holes were measured, not imagined — pointing a
// gate's glob at nothing produced "0 tracked files checked" and "0 document(s)"
// with exit 0.
//
// Runs in Node, no DOM.

import test from 'node:test';
import assert from 'node:assert/strict';
import { refuseEmptyScan, notice, noticesIn, NOTICE_PREFIX } from '../scripts/lib/gate-input.mjs';

// ---------------------------------------------------------------------------
// refuseEmptyScan
// ---------------------------------------------------------------------------

test('gate-input/scan: a non-empty set passes', () => {
    assert.equal(refuseEmptyScan(1, 'documents', 'Because.'), null);
});

test('gate-input/scan: an empty set is refused', () => {
    const message = refuseEmptyScan(0, 'documents', 'A wrong glob looks like this.');
    assert.ok(message, 'an empty scan must be refused');
    assert.match(message, /0 documents were found/);
    assert.match(message, /verified nothing/);
});

test('gate-input/scan: the refusal says what an empty set means here', () => {
    const message = refuseEmptyScan(0, 'tracked files', 'The tree moved.');
    assert.match(message, /The tree moved\./);
});

test('gate-input/scan: the refusal names the failure mode', () => {
    // P4: a degraded answer wearing the shape of a pass is the expensive kind.
    assert.match(
        refuseEmptyScan(0, 'sources', 'Because.'),
        /degraded answer wearing the shape of a pass/
    );
});

// ---------------------------------------------------------------------------
// notices
// ---------------------------------------------------------------------------

test('gate-input/notice: a notice carries the prefix', () => {
    assert.ok(notice('no register yet').startsWith(NOTICE_PREFIX));
});

test('gate-input/notices: a prefixed line is collected', () => {
    assert.deepEqual(noticesIn(`${NOTICE_PREFIX} no register yet`), ['no register yet']);
});

test('gate-input/notices: a gate that prefixes its own name still counts', () => {
    // The regression. Gates print `check-register: NOTICE: ...` for readability,
    // and requiring the prefix at the START of the line meant the notice was
    // printed and never collected — the counting silently did nothing, which is
    // the exact failure this module exists to prevent.
    assert.deepEqual(noticesIn('check-register: NOTICE: no register yet'), ['no register yet']);
});

test('gate-input/notices: ordinary output yields nothing', () => {
    assert.deepEqual(noticesIn('check-register: 8 row(s), all well formed'), []);
});

test('gate-input/notices: several notices are collected in order', () => {
    const output = [`${NOTICE_PREFIX} first`, 'some noise', `${NOTICE_PREFIX} second`].join('\n');
    assert.deepEqual(noticesIn(output), ['first', 'second']);
});

test('gate-input/notices: missing output is not a crash', () => {
    assert.deepEqual(noticesIn(undefined), []);
    assert.deepEqual(noticesIn(null), []);
    assert.deepEqual(noticesIn(''), []);
});

test('gate-input/notices: a notice is not matched mid-word', () => {
    // `NOTICE:` inside a sentence is still a notice only if it carries the colon.
    assert.deepEqual(noticesIn('this output has no notice marker'), []);
});
