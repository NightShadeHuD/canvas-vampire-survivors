// Unit tests for scripts/lib/port-hazards.mjs.
//
// This measures the size of the Godot transform, so its own accuracy is the
// product. Two of these tests exist because the scanner was WRONG in ways that
// took the number from plausible to meaningless:
//
//   - the destructuring pattern matched ACROSS newlines, spanning whole
//     functions, and would have reported sites that do not exist
//   - a rest parameter is FINE in GDScript, and counting it as spread would have
//     inflated the work by every variadic helper in the codebase
//
// Runs in Node, no DOM, no filesystem.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
    measureFile,
    measurePorts,
    judgePorts,
    PORT_HAZARDS
} from '../scripts/lib/port-hazards.mjs';

const count = (id: string, text: string) => measureFile(text)[id] ?? 0;

// ---------------------------------------------------------------------------
// each hazard is found
// ---------------------------------------------------------------------------

test('port-hazards: optional chaining is counted', () => {
    assert.equal(count('optional-chaining', 'const a = b?.c;'), 1);
});

test('port-hazards: both nullish forms are counted', () => {
    assert.equal(count('nullish-coalescing', 'const a = b ?? c;'), 1);
    assert.equal(count('nullish-coalescing', 'b ??= c;'), 1);
});

test('port-hazards: undefined is counted', () => {
    assert.equal(count('undefined', 'if (x === undefined) {}'), 1);
});

test('port-hazards: destructuring is counted on ONE line', () => {
    assert.equal(count('destructuring', 'const { a, b } = obj;'), 1);
    assert.equal(count('destructuring', 'const [x, y] = pair;'), 1);
});

test('port-hazards: destructuring does not match across newlines', () => {
    // The regression. `[^}\]]` matches a newline, so the pattern ran from a
    // `const` to the first `}` that happened to be followed by `=`, spanning
    // whole functions. A metric that over-reports is noise with a number on it.
    const text = ['const a = compute({', '    x: 1', '});', 'const b = { y: 2 };'].join('\n');
    assert.equal(count('destructuring', text), 0);
});

test('port-hazards: a class beyond the first is counted, the first is not', () => {
    // GDScript is one class per file, so the FIRST is free and the rest are work.
    assert.equal(count('extra-class-per-file', 'export class A {}'), 0);
    assert.equal(count('extra-class-per-file', 'export class A {}\nexport class B {}'), 1);
    assert.equal(count('extra-class-per-file', 'class A {}\nclass B {}\nclass C {}'), 2);
});

test('port-hazards: a call-site spread is counted', () => {
    assert.equal(count('spread', 'f(...args);'), 1);
    assert.equal(count('spread', 'const o = { ...base };'), 1);
});

test('port-hazards: a REST PARAMETER is not counted as spread', () => {
    // The caveats are explicit: "A rest parameter in a declaration
    // (`f(...args: int[])`) is fine." Counting it would inflate the work by every
    // variadic helper in the codebase — `src/pool.ts` alone has one.
    assert.equal(count('spread', 'function f(...args: number[]) {}'), 0);
    // `number[]`, not `any[]`: the fixture does not need a loose type to make its
    // point, and `check:types` counts an `any` inside a string literal — a
    // deliberate conservatism, and this is it working.
    assert.equal(count('spread', 'constructor(...args: number[]) {}'), 0);
});

test('port-hazards: the in operator is counted, and classified silent', () => {
    // The one that BEHAVES DIFFERENTLY: an index in TypeScript, an element in
    // GDScript. Nothing fails, which is why it is held to its own ceiling.
    assert.equal(count('in-operator', 'if (i in arr) {}'), 1);
    assert.equal(PORT_HAZARDS.find((h) => h.id === 'in-operator')?.kind, 'silent');
});

test('port-hazards: a for loop is grammar, not the in operator', () => {
    assert.equal(count('in-operator', 'for (const x of arr) {}'), 0);
    assert.equal(count('in-operator', 'for (const k in obj) {}'), 0);
});

test('port-hazards: an import is grammar, not the in operator', () => {
    assert.equal(count('in-operator', "import { a } from './b.ts';"), 0);
});

// ---------------------------------------------------------------------------
// prose is not a hazard
// ---------------------------------------------------------------------------

test('port-hazards: a comment describing a hazard is not the hazard', () => {
    const text = [
        '// This uses ?? which GDScript does not have.',
        ' * and x?.y is optional chaining',
        '/* const { a } = b; */'
    ].join('\n');
    assert.equal(measureFile(text)['optional-chaining'] ?? 0, 0);
    assert.equal(measureFile(text).destructuring ?? 0, 0);
});

test('port-hazards: a trailing comment does not hide the code before it', () => {
    assert.equal(count('optional-chaining', 'const a = b?.c; // safe? no'), 1);
});

// ---------------------------------------------------------------------------
// measurement
// ---------------------------------------------------------------------------

test('port-hazards/measure: totals, kinds and files agree', () => {
    // Both lines are INSIDE a function, because a top-level `const` is itself a
    // hazard — the first version of this fixture forgot that and the test was
    // measuring its own scaffolding.
    const result = measurePorts([
        { path: 'a.ts', text: 'function f(b, i, arr) {\n  const a = b?.c;\n  if (i in arr) {}\n}' },
        { path: 'b.ts', text: 'function g() {\n  return 1;\n}' }
    ]);
    assert.equal(result.total, 2);
    assert.deepEqual(result.byKind, { error: 1, silent: 1 });
    assert.deepEqual(Object.keys(result.byFile), ['a.ts']);
});

test('port-hazards/measure: a clean file is absent, not zero', () => {
    assert.deepEqual(
        measurePorts([{ path: 'a.ts', text: 'function f(): number {\n  return 1;\n}' }]).byFile,
        {}
    );
});

// ---------------------------------------------------------------------------
// the ceiling
// ---------------------------------------------------------------------------

test('port-hazards/judge: both ceilings hold', () => {
    assert.deepEqual(judgePorts({ byKind: { error: 5, silent: 1 } }, { error: 5, silent: 1 }), {
        ok: true,
        reasons: []
    });
});

test('port-hazards/judge: a rising SILENT count fails and says why it is worse', () => {
    const verdict = judgePorts({ byKind: { error: 0, silent: 2 } }, { error: 0, silent: 1 });
    assert.equal(verdict.ok, false);
    assert.match(verdict.reasons.join(' '), /SILENT/);
    assert.match(verdict.reasons.join(' '), /behave differently/);
});

test('port-hazards/judge: a rising error count fails separately', () => {
    const verdict = judgePorts({ byKind: { error: 6, silent: 0 } }, { error: 5, silent: 0 });
    assert.equal(verdict.ok, false);
    assert.equal(verdict.reasons.length, 1);
});

test('port-hazards: every hazard states why it is one', () => {
    // A rule with no stated reason is one somebody deletes when it is
    // inconvenient — and these will be inconvenient the day the port starts.
    for (const hazard of PORT_HAZARDS) {
        assert.match(hazard.id, /^[a-z-]+$/, `${hazard.id} is not a stable id`);
        assert.equal(hazard.kind === 'error' || hazard.kind === 'silent', true, hazard.id);
        assert.equal(hazard.why.length > 20, true, `${hazard.id} needs a real reason`);
        assert.equal(typeof hazard.label, 'string');
    }
});
