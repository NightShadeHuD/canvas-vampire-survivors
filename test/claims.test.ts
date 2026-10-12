/**
 * @file test/claims.test.ts
 * @description Tests for the gate that compares a document's stated numbers against
 * what the gates measured.
 *
 * This exists because `strictNullChecks` in `src/` was reported as zero for SEVEN
 * consecutive rounds after it had gone back to seven. The tests below pin the two
 * properties that matter: a stale number fails, and prose describing PAST revisions is
 * left alone.
 *
 * @module test/claims
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { judgeClaims, parseClaims } from '../scripts/lib/claims.mjs';

const wrap = (rows: string[]) =>
    [
        '<!-- claims:begin -->',
        '| flag | src | test |',
        '| --- | --- | --- |',
        ...rows,
        '<!-- claims:end -->'
    ].join('\n');

test('claims: a row between the markers is read', () => {
    const claims = parseClaims(wrap(['| `noImplicitAny` | 168 | 360 |']));
    assert.equal(claims.length, 1);
    assert.equal(claims[0].gate, 'noImplicitAny');
    assert.equal(claims[0].src, 168);
    assert.equal(claims[0].test, 360);
});

test('claims: PROSE IS NOT READ, which is the whole design', () => {
    // "375 -> 0" and "was 227" are legitimate sentences about earlier revisions, and a
    // parser that scraped every sentence would flag them. A narrow parser that misses
    // something is a bug; a broad one that cries wolf is a gate nobody keeps.
    const prose = [
        '`strictNullChecks` went 375 -> 0 in `src/` and 227 in `test/`.',
        'It was 251 before that.',
        'See `noImplicitAny` (168 in `src/`, 360 in `test/`) for the rest.'
    ].join('\n');
    assert.deepEqual(parseClaims(prose), [], 'prose yields no claims');
});

test('claims: a number outside the markers is ignored even in table shape', () => {
    // The shape alone is not enough. A doc has other tables.
    const text = [
        '| flag | src | test |',
        '| --- | --- | --- |',
        '| `noImplicitAny` | 999 | 999 |'
    ].join('\n');
    assert.deepEqual(parseClaims(text), [], 'markers gate it, not the shape');
});

test('claims: a MISMATCH fails, and names the line and both numbers', () => {
    const claims = parseClaims(wrap(['| `strictNullChecks` | 7 | 225 |']));
    const v = judgeClaims(claims, { strictNullChecks: { src: 0, test: 225 } });
    assert.equal(v.ok, false);
    // The exact seven-round failure: the doc says 7, the gate measured 0.
    assert.match(v.reasons[0], /strictNullChecks.*is 7 in src\/.*measured 0/s);
    assert.match(v.reasons[0], /line \d+/);
});

test('claims: only the TEST column differing is still a failure', () => {
    const claims = parseClaims(wrap(['| `noImplicitAny` | 168 | 360 |']));
    const v = judgeClaims(claims, { noImplicitAny: { src: 168, test: 361 } });
    assert.equal(v.ok, false);
    assert.match(v.reasons[0], /360 in test\/.*measured 361/s);
});

test('claims: a match passes and reports how many it checked', () => {
    const claims = parseClaims(
        wrap(['| `noImplicitAny` | 168 | 360 |', '| `strictNullChecks` | 0 | 225 |'])
    );
    const v = judgeClaims(claims, {
        noImplicitAny: { src: 168, test: 360 },
        strictNullChecks: { src: 0, test: 225 }
    });
    assert.equal(v.ok, true);
    assert.equal(v.checked, 2, 'a gate must report how much it checked');
});

test('claims: a figure NOTHING measures is a failure, not a skip', () => {
    // A claim nothing measures cannot be checked, which is how a number becomes folklore.
    const claims = parseClaims(wrap(['| `someFutureFlag` | 1 | 2 |']));
    const v = judgeClaims(claims, { noImplicitAny: { src: 168, test: 360 } });
    assert.equal(v.ok, false);
    // The message changed when a MISSING name was separated from an UNMEASURED one:
    // `!want` conflated a registry with no such entry and an entry whose tool is absent,
    // so a runner without Godot read as "no gate measures this".
    assert.match(v.reasons[0], /no measurement in the registry produces it/);
});

test('claims: an UNMEASURED figure is reported, not compared', () => {
    // `undefined` -- the registry has no such name. `null` -- it has one and its tool is
    // absent. The first version treated both as "no gate measures it", which is wrong for
    // the second and was found by CI running without Godot.
    const claims = parseClaims(wrap(['| `godotAssertions` | 307 |']));
    // `null` is the registry's "a tool is absent" value, which the declared type did not
    // admit -- `check:strict` caught the widening as 226 in test/ against a ceiling of 225.
    const v = judgeClaims(claims, { godotAssertions: null } as unknown as Record<
        string,
        { src: number; test: number }
    >);
    assert.equal(v.ok, true, 'an absent tool is not a wrong number');
    assert.equal(v.unmeasured.length, 1, 'and it is reported rather than skipped silently');
    assert.match(v.unmeasured[0], /needs a tool that is not here/);
});
