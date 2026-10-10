// Unit tests for scripts/lib/type-coverage.mjs.
//
// This is the port-readiness metric: `any` has no GDScript equivalent, so every
// use is a place a translator has to infer intent instead of reading it.
//
// Most of these tests are about what the scanner must NOT count. A metric people
// do not believe is a metric they ignore, and a grep for the word "any" would
// count `company`, prose in a docblock, and the word in a sentence explaining why
// something is deliberately loose.
//
// Runs in Node, no DOM, no filesystem.

import test from 'node:test';
import assert from 'node:assert/strict';
import { findAny, measureAny, judgeAny, ANY_FORMS } from '../scripts/lib/type-coverage.mjs';

const count = (text: string) => findAny(text).length;
const forms = (text: string) => findAny(text).map((h) => h.form);

// ---------------------------------------------------------------------------
// every form it must catch
// ---------------------------------------------------------------------------

test('type-coverage: an annotation is counted', () => {
    assert.deepEqual(forms('function f(x: any) {}'), ['annotation']);
});

test('type-coverage: a cast is counted', () => {
    // 57 of these exist, and they are the quietest kind: the type is real
    // everywhere around them and the cast removes the check at one point.
    assert.deepEqual(forms('const g = obj as any;'), ['cast']);
});

test('type-coverage: an untyped record is counted', () => {
    assert.deepEqual(forms('const save: Record<string, any> = {};'), ['record']);
    // It must be counted ONCE, not also as an annotation.
    assert.equal(count('const save: Record<string, any> = {};'), 1);
});

test('type-coverage: a type argument is counted', () => {
    assert.deepEqual(forms('const xs: Array<any> = [];'), ['generic']);
});

test('type-coverage: an array of anything is counted ONCE', () => {
    // Regression: `: any[]` matched both the annotation rule and the array rule,
    // so one `any` was counted twice. The forms that combine were exactly the
    // ones inflated, and nothing in the output said so.
    assert.deepEqual(forms('const xs: any[] = [];'), ['array']);
});

test('type-coverage: a record of arrays is not double counted', () => {
    assert.equal(count('const r: Record<string, any[]> = {};'), 1);
});

// ---------------------------------------------------------------------------
// what it must NOT count
// ---------------------------------------------------------------------------

test('type-coverage: the word inside a longer identifier is not counted', () => {
    // `company`, `anywhere`, `Many` — a grep counts all of these.
    assert.equal(count('const company = new Company(); const many = Many.any;'), 0);
});

test('type-coverage: a docblock mentioning any is not counted', () => {
    // A comment explaining WHY something is loose is evidence of care. Counting
    // it would punish the wrong thing and reward deleting the explanation.
    const text = [
        '/**',
        ' * This is any because the caller may pass anything.',
        ' * @param x the value, of any shape',
        ' */',
        'function f(x: number) {}'
    ].join('\n');
    assert.equal(count(text), 0);
});

test('type-coverage: a line comment mentioning any is not counted', () => {
    assert.equal(count('const x = 1; // any value works here'), 0);
});

test('type-coverage: an any in code followed by a comment counts once', () => {
    assert.equal(count('function f(x: any) {} // any'), 1);
});

test('type-coverage: a string containing the word is still counted in code position', () => {
    // Not ideal, but a string literal is rare in a type position and being
    // conservative here keeps the rule simple. Asserted so the behaviour is
    // known rather than discovered.
    assert.equal(count("const s = 'any';"), 0, 'a bare string is not a type position');
});

// ---------------------------------------------------------------------------
// measurement and the ceiling
// ---------------------------------------------------------------------------

test('type-coverage/measure: totals and per-file counts agree', () => {
    const result = measureAny([
        { path: 'a.ts', text: 'function f(x: any) {}\nconst g = y as any;' },
        { path: 'b.ts', text: 'const c = 1;' }
    ]);
    assert.equal(result.total, 2);
    assert.deepEqual(result.perFile, { 'a.ts': 2 });
    assert.equal(result.findings.length, 2);
    assert.equal(result.findings[0].path, 'a.ts');
});

test('type-coverage/measure: a file with no any is absent, not zero', () => {
    // Reporting every clean file as `0` would bury the ones that matter.
    const result = measureAny([{ path: 'clean.ts', text: 'const x: number = 1;' }]);
    assert.deepEqual(result.perFile, {});
    assert.equal(result.total, 0);
});

test('type-coverage/measure: findings carry the line number', () => {
    const result = measureAny([{ path: 'a.ts', text: 'const a = 1;\nconst b: any = 2;' }]);
    assert.equal(result.findings[0].line, 2);
});

test('type-coverage/judge: at the ceiling passes silently', () => {
    assert.deepEqual(judgeAny({ total: 5 }, 5), { ok: true });
});

test('type-coverage/judge: above the ceiling fails and says why', () => {
    const verdict = judgeAny({ total: 6 }, 5);
    assert.equal(verdict.ok, false);
    assert.match(verdict.reason ?? '', /no GDScript equivalent/);
    assert.match(verdict.reason ?? '', /raising the ceiling deliberately/);
});

test('type-coverage/judge: below the ceiling passes and asks for the floor to move', () => {
    const verdict = judgeAny({ total: 4 }, 5);
    assert.equal(verdict.ok, true);
    assert.match(verdict.reason ?? '', /Lower the ceiling/);
});

test('type-coverage: every form has a name, and specific shapes come first', () => {
    // The patterns are combined into one alternation, so they are no longer
    // individually global — the combined pattern is. What matters is the ORDER:
    // a shape containing a bare `: any` must precede the bare annotation, or it
    // never matches and its count is silently folded into the annotation's.
    for (const { name, pattern } of ANY_FORMS) {
        assert.equal(typeof name, 'string');
        assert.equal(pattern.global, false, `${name} is embedded in the combined pattern`);
    }
    const names = ANY_FORMS.map((f) => f.name);
    assert.equal(names.at(-1), 'annotation', 'the bare annotation must be last');
    for (const specific of ['array', 'record', 'generic']) {
        assert.equal(
            names.indexOf(specific) < names.indexOf('annotation'),
            true,
            `${specific} must come before annotation`
        );
    }
});

test('type-coverage: repeated uses on one line are all counted', () => {
    assert.equal(count('function f(a: any, b: any) {}'), 2);
});
