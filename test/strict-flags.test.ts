/**
 * @file test/strict-flags.test.ts
 * @description Tests for the `check:strict` gate's measurement and judgement.
 *
 * The gate exists because `strictNullChecks` in `src/` was reported as zero for
 * seven rounds after it had gone back to seven. Every one of those numbers came
 * from a hand-run `tsc` in a shell, so nothing could notice. These tests pin the
 * two properties that would have caught it: the totals are read per tree, and a
 * rise is a failure rather than a note.
 *
 * @module test/strict-flags
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
    judgeStrict,
    parseTscOutput,
    STRICT_FLAGS,
    STRICT_FLAG_IDS
} from '../scripts/lib/strict-flags.mjs';

/** One compiler line, in the shape `tsc` actually prints. */
const line = (tree: string, file: string, n = 1) =>
    `${tree}/${file}(${n},5): error TS7006: Parameter 'x' implicitly has an 'any' type.`;

test('strict-flags: a compiler line is attributed to the tree it came from', () => {
    const out = [line('src', 'main.ts'), line('src', 'ui.ts'), line('test', 'ui.test.ts')].join(
        '\n'
    );
    const m = parseTscOutput(out);
    assert.equal(m.src, 2, 'src/ is counted on its own');
    assert.equal(m.test, 1, 'test/ is counted on its own');
    assert.equal(m.total, 3);
    assert.equal(m.byFile['src/main.ts'], 1);
});

test('strict-flags: several errors in one file are counted, not deduplicated', () => {
    const out = [
        line('src', 'main.ts', 1),
        line('src', 'main.ts', 2),
        line('src', 'main.ts', 3)
    ].join('\n');
    const m = parseTscOutput(out);
    assert.equal(m.src, 3, 'three errors in one file is three errors');
    assert.equal(m.byFile['src/main.ts'], 3);
});

test('strict-flags: an error outside src/ and test/ is counted, not dropped', () => {
    // A count that silently ignores what it does not recognise is how a total
    // drifts from the truth. Anything shaped like a compiler error counts.
    const out = [
        'scripts/foo.mjs(1,1): error TS1005: expected something.',
        line('src', 'main.ts')
    ].join('\n');
    const m = parseTscOutput(out);
    assert.equal(m.unparsed, 1, 'the stray error is visible');
    assert.equal(m.total, 2, 'and it is in the total');
    assert.equal(m.src, 1);
});

test('strict-flags: non-error lines are ignored', () => {
    const out = ['src/main.ts(1,5): warning TS9999: not an error', 'Found 0 errors.', ''].join(
        '\n'
    );
    assert.equal(parseTscOutput(out).total, 0);
});

test('strict-flags: a clean run parses to zero without pretending otherwise', () => {
    assert.deepEqual(parseTscOutput(''), { total: 0, src: 0, test: 0, byFile: {}, unparsed: 0 });
    assert.equal(parseTscOutput(undefined).total, 0, 'a missing output is zero, not a crash');
});

test('strict-flags: a rise in EITHER tree fails, and names which', () => {
    // This is the property that would have caught the seven-round regression, and
    // the reason `src/` and `test/` are judged separately rather than summed.
    const ceilings = {
        strictNullChecks: { src: 0, test: 237 },
        noImplicitAny: { src: 267, test: 373 }
    };

    const ok = judgeStrict(
        { strictNullChecks: { src: 0, test: 237 }, noImplicitAny: { src: 267, test: 373 } },
        ceilings
    );
    assert.equal(ok.ok, true, 'exactly at the ceiling is not a regression');

    const srcRose = judgeStrict(
        { strictNullChecks: { src: 7, test: 237 }, noImplicitAny: { src: 267, test: 373 } },
        ceilings
    );
    assert.equal(srcRose.ok, false, 'src/ rising is a failure');
    assert.match(srcRose.reasons[0], /strictNullChecks.*src\/.*7/s);

    // A test-side rise must ALSO fail, otherwise a regression in shipped code could
    // hide behind a large and noisy test column.
    const testRose = judgeStrict(
        { strictNullChecks: { src: 0, test: 300 }, noImplicitAny: { src: 267, test: 373 } },
        ceilings
    );
    assert.equal(testRose.ok, false, 'test/ rising is also a failure');
});

test('strict-flags: an improvement is reported and does not fail', () => {
    const ceilings = {
        strictNullChecks: { src: 0, test: 237 },
        noImplicitAny: { src: 267, test: 373 }
    };
    const v = judgeStrict(
        { strictNullChecks: { src: 0, test: 237 }, noImplicitAny: { src: 200, test: 373 } },
        ceilings
    );
    assert.equal(v.ok, true);
    assert.equal(v.improvements.length, 1);
    assert.match(v.improvements[0], /noImplicitAny src\/ 267 -> 200/);
});

test('strict-flags: a missing ceiling is a failure, not a pass', () => {
    // A metric with no recorded ceiling cannot detect a regression, which is the
    // whole reason this gate was written.
    const partial = judgeStrict(
        { strictNullChecks: { src: 0, test: 0 }, noImplicitAny: { src: 0, test: 0 } },
        { strictNullChecks: { src: 0, test: 0 } }
    );
    assert.equal(partial.ok, false);
    assert.match(partial.reasons[0], /no recorded ceiling for `noImplicitAny`/);
});

test('strict-flags: an unmeasured flag is a failure, not a zero', () => {
    const v = judgeStrict(
        { strictNullChecks: { src: 0, test: 0 } },
        {
            strictNullChecks: { src: 0, test: 0 },
            noImplicitAny: { src: 1, test: 1 }
        }
    );
    assert.equal(v.ok, false);
    assert.match(v.reasons[0], /was not measured/);
});

test('strict-flags: the flag list is ordered by port relevance', () => {
    // `strictNullChecks` first on purpose: GDScript has only `null`, so
    // undefined-vs-null is a real port difference rather than hygiene. If the order
    // changes, the reasoning in docs/SHORTCUTS.md row 1 needs to change with it.
    assert.deepEqual(STRICT_FLAG_IDS, ['strictNullChecks', 'noImplicitAny']);
    for (const flag of STRICT_FLAGS)
        assert.ok(flag.why.length > 20, `${flag.id} must say why it matters`);
});
