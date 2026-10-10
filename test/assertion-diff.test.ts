// Unit tests for scripts/lib/assertion-diff.mjs.
//
// This gate decides whether an assertion was weakened, so both of its failure
// directions matter: miss a weakening and a suite goes greener without getting
// stronger, report a phantom and the gate gets skimmed and then disabled.
//
// The scaffold's own comments record a phantom of exactly that kind, and the
// regression test for it is here.
//
// Runs in Node, no DOM.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
    assertions,
    literalsIn,
    compareFiles,
    assertionDigest,
    judgeDigests
} from '../scripts/lib/assertion-diff.mjs';

/** Wrap statements in a minimal test so fixtures read like real files. */
const file = (...statements) => `test('x', () => {\n${statements.join('\n')}\n});\n`;

// ---------------------------------------------------------------------------
// assertions()
// ---------------------------------------------------------------------------

test('assertion-diff: reads the assertion kind', () => {
    const found = assertions(file('assert.equal(a, b);', 'assert.ok(c);'));
    assert.deepEqual(
        found.map((a) => a.kind),
        ['equal', 'ok']
    );
});

test('assertion-diff: a trailing string is the message, not a value', () => {
    // In node:assert the last argument is always the diagnostic message. This
    // repository's messages quote things — 'not "1:7"' — so a length heuristic
    // would treat them as values and report phantoms.
    const [found] = assertions(
        file("assert.equal(ui.els.time.textContent, '01:07', 'not \"1:7\"');")
    );
    assert.equal(found.args.length, 2, 'the message must be dropped');
    assert.ok(!found.args.includes('\'not "1:7"\''));
});

test('assertion-diff: a lone string argument IS the value, not a message', () => {
    // assert.ok('x') has one argument and it is the subject of the assertion.
    const [found] = assertions(file("assert.ok('plain string');"));
    assert.deepEqual(found.args, ["'plain string'"]);
});

test('assertion-diff: a non-string last argument is not treated as a message', () => {
    const [found] = assertions(file('assert.equal(a, 12345);'));
    assert.deepEqual(found.args, ['a', '12345']);
});

test('assertion-diff: nested parentheses and calls do not truncate the head', () => {
    const [found] = assertions(file('assert.deepEqual(rows.map((r) => r.id), [1, 2]);'));
    assert.deepEqual(found.args, ['rows.map((r) => r.id)', '[1, 2]']);
});

test('assertion-diff: a comma inside a string does not split arguments', () => {
    const [found] = assertions(file("assert.equal(label, 'a, b, c');"));
    assert.deepEqual(found.args, ['label', "'a, b, c'"]);
});

test('assertion-diff: an assertion spanning several lines is one finding', () => {
    const found = assertions(file('assert.equal(\n    a,\n    b\n);'));
    assert.equal(found.length, 1);
    assert.deepEqual(found[0].args, ['a', 'b']);
});

// ---------------------------------------------------------------------------
// literalsIn()
// ---------------------------------------------------------------------------

test('assertion-diff: three-digit numbers are values worth comparing', () => {
    assert.deepEqual([...literalsIn(['7500'])], ['7500']);
});

test('assertion-diff: one- and two-digit numbers are ordinary code, not values', () => {
    // Reporting these would be noise, and a gate that reports noise is skimmed.
    assert.deepEqual([...literalsIn(['0', '12'])], []);
});

test('assertion-diff: a short quoted key is a value', () => {
    assert.deepEqual([...literalsIn(["'forest'"])], ['forest']);
});

// ---------------------------------------------------------------------------
// compareFiles()
// ---------------------------------------------------------------------------

test('assertion-diff: a value assertion replaced by a property assertion is reported', () => {
    const findings = compareFiles(
        file('assert.equal(cam.intensity, 0);'),
        file('assert.ok(cam.intensity >= 0);')
    );
    assert.ok(findings.length, 'the weakening must be reported');
    assert.match(findings.join('\n'), /value assertion\(s\).*property assertion/s);
});

test('assertion-diff: a lost literal is reported even when the count holds', () => {
    // The exact value stopped being asserted anywhere in the file.
    const findings = compareFiles(
        file('assert.equal(total, 7500);'),
        file('assert.equal(total, score());')
    );
    assert.match(findings.join('\n'), /"7500" are no longer asserted/);
});

test('assertion-diff: fewer assertions is reported', () => {
    const findings = compareFiles(
        file('assert.equal(a, 1);', 'assert.equal(b, 2);'),
        file('assert.equal(a, 1);')
    );
    assert.match(findings.join('\n'), /1 assertion\(s\), down from 2/);
});

test('assertion-diff: a property assertion ALREADY present cannot absorb a conversion', () => {
    // The scaffold's first version compared sums, so a file that already had
    // property assertions absorbed a converted one without the totals moving —
    // and that conversion is precisely the one worth catching.
    const findings = compareFiles(
        file('assert.ok(ready);', 'assert.equal(total, 7500);'),
        file('assert.ok(ready);', 'assert.ok(total > 0);')
    );
    assert.match(
        findings.join('\n'),
        /value assertion\(s\)/,
        'the conversion must be named even though property totals are unchanged'
    );
});

test('assertion-diff: an unchanged file reports nothing', () => {
    const text = file('assert.equal(a, 1);', 'assert.ok(b);');
    assert.deepEqual(compareFiles(text, text), []);
});

test('assertion-diff: a strengthened assertion reports nothing', () => {
    // The phantom this guards against: the scaffold's first version reported a
    // commit that had STRENGTHENED an assertion, because it read the text of a
    // diagnostic message as a lost value.
    const findings = compareFiles(
        file("assert.ok(total > 0, 'total should be positive');"),
        file("assert.equal(total, 7500, 'total should be 7500');")
    );
    assert.deepEqual(findings, [], 'strengthening must never be reported as weakening');
});

test('assertion-diff: a reworded message is not a lost value', () => {
    const findings = compareFiles(
        file("assert.equal(a, 'forest', 'the default stage');"),
        file("assert.equal(a, 'forest', 'the stage you start in');")
    );
    assert.deepEqual(findings, [], 'message wording is not a compared value');
});

test('assertion-diff: a renamed local is not a lost value', () => {
    const findings = compareFiles(
        file('assert.equal(hp, 100);'),
        file('assert.equal(health, 100);')
    );
    assert.deepEqual(findings, []);
});

test('assertion-diff: strength is not judged, only stated weakenings are', () => {
    // A different form of the same value passes: this cannot tell whether an
    // assertion is as strong, and it does not pretend to.
    const findings = compareFiles(
        file("assert.equal(ui.els.time.textContent, '01:07');"),
        file('assert.match(ui.els.time.textContent, /01:07/);')
    );
    assert.deepEqual(findings, [], 'equal -> match is not a weakening this can state');
});

// ---------------------------------------------------------------------------
// assertion digests — the hole the revision diff cannot see
// ---------------------------------------------------------------------------

const A = 'test("x", () => { assert.equal(a, 1); });';
const A_DIFFERENT_VALUE = 'test("x", () => { assert.equal(a, 2); });';
const A_WEAKENED = 'test("x", () => { assert.ok(a); });';

test('assertion-digest: a changed expected value does NOT change the digest', () => {
    // The digest answers "did the STRENGTH change". A new expected value is a
    // different question, the revision diff already answers it, and folding it in
    // here would make the digest fire on every legitimate test edit — which is how
    // a check becomes noise.
    assert.equal(assertionDigest(A), assertionDigest(A_DIFFERENT_VALUE));
});

test('assertion-digest: a weakened assertion DOES change the digest', () => {
    assert.notEqual(assertionDigest(A), assertionDigest(A_WEAKENED));
});

test('assertion-digest: reordering tests does not change the digest', () => {
    const two =
        'test("a", () => { assert.equal(x, 1); });\ntest("b", () => { assert.equal(y, 2); });';
    const swapped =
        'test("b", () => { assert.equal(y, 2); });\ntest("a", () => { assert.equal(x, 1); });';
    assert.equal(assertionDigest(two), assertionDigest(swapped), 'order is not strength');
});

test('assertion-digest: deleting an assertion changes the digest', () => {
    const two = 'test("a", () => { assert.equal(x, 1); assert.equal(y, 2); });';
    const one = 'test("a", () => { assert.equal(x, 1); });';
    assert.notEqual(assertionDigest(two), assertionDigest(one));
});

test('assertion-digest: an empty file has a stable digest', () => {
    assert.equal(assertionDigest(''), assertionDigest(''));
});

test('assertion-digest/judge: a stale digest fails EVEN when the base diff sees the file', () => {
    // The regression, and it cost a red main. The first version skipped a file the
    // revision diff already covered, on the reasoning that the diff was the
    // authority. On a pull request the file IS modified, so the skip applied, CI
    // passed, and `main` went red the instant it merged -- base then equalled the
    // tree and the stale digest fired.
    //
    // A check that cannot fail before the merge is not a check.
    const files = [{ path: 'test/a.test.ts', text: A_WEAKENED }];
    const recorded = { 'test/a.test.ts': assertionDigest(A) };
    const verdict = judgeDigests(files, recorded, new Set(['test/a.test.ts']));
    assert.equal(verdict.ok, false, 'the merge must not be the first place this fails');
    assert.match(verdict.reasons[0], /--update/);
});

test('assertion-digest/judge: a CURRENT digest passes however the file got here', () => {
    // The other arm: recorded and current agree, so nothing is reported.
    const files = [{ path: 'test/a.test.ts', text: A }];
    const recorded = { 'test/a.test.ts': assertionDigest(A) };
    const verdict = judgeDigests(files, recorded, new Set(['test/a.test.ts']));
    assert.equal(verdict.ok, true);
});

test('assertion-digest/judge: a changed digest the base diff CANNOT see is reported', () => {
    // The hole row 8 records: a weakening committed straight to base, where the
    // base then contains the weakened version and there is nothing to diff.
    const files = [{ path: 'test/a.test.ts', text: A_WEAKENED }];
    const recorded = { 'test/a.test.ts': assertionDigest(A) };
    const verdict = judgeDigests(files, recorded, new Set());
    assert.equal(verdict.ok, false);
    assert.match(verdict.reasons[0], /the base is not carrying the new value/);
    assert.match(verdict.reasons[0], /--update/, 'it must say how to resolve it');
});

test('assertion-digest/judge: an unrecorded file is not reported', () => {
    // A new file has no recorded strength to have lost.
    const verdict = judgeDigests([{ path: 'test/new.test.ts', text: A }], {}, new Set());
    assert.equal(verdict.ok, true);
});

test('assertion-digest/judge: it returns fresh digests for every file', () => {
    const files = [
        { path: 'test/a.test.ts', text: A },
        { path: 'test/b.test.ts', text: A_WEAKENED }
    ];
    const { fresh } = judgeDigests(files, {}, new Set());
    assert.deepEqual(Object.keys(fresh), ['test/a.test.ts', 'test/b.test.ts']);
    assert.equal(fresh['test/a.test.ts'], assertionDigest(A));
});
