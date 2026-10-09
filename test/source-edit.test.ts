// Unit tests for scripts/lib/source-edit.mjs.
//
// This module exists to remove the reason to reach for a blunt instrument, so
// its tests are about the refusals: an anchor that matches nothing, an anchor
// that matches too much, and a write that did not take. Those are the three ways
// a scripted edit lies about having worked.
//
// The verification tests use an injected filesystem, which is the only way to
// test "the write did not take" without actually breaking a write.
//
// Runs in Node, no DOM.

import test from 'node:test';
import assert from 'node:assert/strict';
import { planEdit, applyEdit, DEFAULT_EXPECTED } from '../scripts/lib/source-edit.mjs';

// ---------------------------------------------------------------------------
// planEdit — the refusals
// ---------------------------------------------------------------------------

test('source-edit/plan: a unique anchor is planned', () => {
    const plan = planEdit({ text: 'const a = 1;', anchor: '1', replacement: '2' });
    assert.equal(plan.ok, true);
    assert.equal(plan.result, 'const a = 2;');
    assert.equal(plan.matched, 1);
});

test('source-edit/plan: an anchor that matches nothing is refused', () => {
    // A typo here does nothing at all, and a script that does nothing still
    // reports that it ran.
    const plan = planEdit({ text: 'const a = 1;', anchor: 'const b', replacement: 'x' });
    assert.equal(plan.ok, false);
    assert.equal(plan.matched, 0);
    assert.match(plan.reason, /matched 0 times/);
});

test('source-edit/plan: an ambiguous anchor is refused', () => {
    // The `sed` failure in miniature: rewriting every match when one was meant.
    const plan = planEdit({ text: 'x x x', anchor: 'x', replacement: 'y' });
    assert.equal(plan.ok, false);
    assert.equal(plan.matched, 3);
    assert.match(plan.reason, /matched 3 time\(s\) but 1 was expected/);
    assert.match(plan.reason, /narrow the anchor until it is unique/);
});

test('source-edit/plan: a known-ambiguous anchor is allowed when stated', () => {
    // Sometimes every match IS the intent. It has to be declared, not assumed.
    const plan = planEdit({ text: 'x x x', anchor: 'x', replacement: 'y', expected: 3 });
    assert.equal(plan.ok, true);
    assert.equal(plan.result, 'y y y');
});

test('source-edit/plan: an empty anchor is refused', () => {
    const plan = planEdit({ text: 'abc', anchor: '', replacement: 'x' });
    assert.equal(plan.ok, false);
    assert.match(plan.reason, /would match everywhere/);
});

test('source-edit/plan: a no-op edit is refused', () => {
    const plan = planEdit({ text: 'abc', anchor: 'abc', replacement: 'abc' });
    assert.equal(plan.ok, false);
    assert.match(plan.reason, /identical/);
});

test('source-edit/plan: a regex metacharacter in the anchor is literal', () => {
    // The anchor is text, not a pattern, so `rgba(` and `$1` mean themselves.
    const text = 'ctx.strokeStyle = `rgba(160,255,160,0.25)`;';
    const plan = planEdit({
        text,
        anchor: 'rgba(160,255,160,0.25)',
        replacement: 'rgba(0,0,0,0.25)'
    });
    assert.equal(plan.ok, true);
    assert.equal(plan.result, 'ctx.strokeStyle = `rgba(0,0,0,0.25)`;');
});

test('source-edit/plan: a dollar in the replacement is not a backreference', () => {
    // String.replace would interpret `$&`; split/join must not.
    const plan = planEdit({ text: 'price', anchor: 'price', replacement: '$&100' });
    assert.equal(plan.ok, true);
    assert.equal(plan.result, '$&100');
});

test('source-edit/plan: multi-line anchors work', () => {
    const text = 'a\nb\nc\n';
    const plan = planEdit({ text, anchor: 'a\nb', replacement: 'a\nB' });
    assert.equal(plan.ok, true);
    assert.equal(plan.result, 'a\nB\nc\n');
});

test('source-edit/plan: the default expectation is one', () => {
    assert.equal(DEFAULT_EXPECTED, 1);
});

// ---------------------------------------------------------------------------
// applyEdit — verifying its own work
// ---------------------------------------------------------------------------

/** A filesystem backed by a Map, so writes can be inspected and sabotaged. */
function fakeFs(initial: Record<string, string>) {
    const files = new Map(Object.entries(initial));
    return {
        files,
        read: (p: string) => {
            if (!files.has(p)) throw new Error(`ENOENT: ${p}`);
            return files.get(p) as string;
        },
        write: (p: string, s: string) => void files.set(p, s)
    };
}

test('source-edit/apply: a good edit writes and verifies', () => {
    const fs = fakeFs({ 'src/a.ts': 'const a = 1;' });
    const result = applyEdit({ path: 'src/a.ts', anchor: '1', replacement: '2', ...fs });
    assert.equal(result.ok, true);
    assert.equal(result.wrote, true);
    assert.equal(fs.files.get('src/a.ts'), 'const a = 2;');
});

test('source-edit/apply: an ambiguous anchor writes nothing', () => {
    const fs = fakeFs({ 'src/a.ts': 'x x' });
    const result = applyEdit({ path: 'src/a.ts', anchor: 'x', replacement: 'y', ...fs });
    assert.equal(result.ok, false);
    assert.equal(result.wrote, false, 'nothing must be written when the plan is refused');
    assert.equal(fs.files.get('src/a.ts'), 'x x', 'the file must be untouched');
});

test('source-edit/apply: a missing file is refused, not thrown', () => {
    const fs = fakeFs({});
    const result = applyEdit({ path: 'src/gone.ts', anchor: 'a', replacement: 'b', ...fs });
    assert.equal(result.ok, false);
    assert.match(result.reason, /could not read/);
});

test('source-edit/apply: a dry run plans without writing', () => {
    const fs = fakeFs({ 'src/a.ts': 'const a = 1;' });
    const result = applyEdit({
        path: 'src/a.ts',
        anchor: '1',
        replacement: '2',
        dryRun: true,
        ...fs
    });
    assert.equal(result.ok, true);
    assert.equal(result.wrote, false);
    assert.equal(fs.files.get('src/a.ts'), 'const a = 1;', 'a dry run must not touch the file');
});

test('source-edit/apply: a write that did not take is caught by reading back', () => {
    // The whole reason this module exists: "I wrote it" is a claim, and a read
    // is a check.
    const fs = fakeFs({ 'src/a.ts': 'const a = 1;' });
    const result = applyEdit({
        path: 'src/a.ts',
        anchor: '1',
        replacement: '2',
        read: fs.read,
        write: () => {} // silently does nothing
    });
    assert.equal(result.ok, false);
    assert.equal(result.wrote, true);
    assert.match(result.reason, /reading it back produced different content/);
});

test('source-edit/apply: a file changed underneath the write is caught', () => {
    const fs = fakeFs({ 'src/a.ts': 'const a = 1;' });
    const result = applyEdit({
        path: 'src/a.ts',
        anchor: '1',
        replacement: '2',
        read: fs.read,
        write: (p: string) => fs.files.set(p, 'something else entirely')
    });
    assert.equal(result.ok, false);
    assert.match(result.reason, /different content/);
});

test('source-edit/apply: the result names how many matches were replaced', () => {
    const fs = fakeFs({ 'src/a.ts': 'x x x' });
    const result = applyEdit({
        path: 'src/a.ts',
        anchor: 'x',
        replacement: 'y',
        expected: 3,
        ...fs
    });
    assert.equal(result.matched, 3);
    assert.equal(fs.files.get('src/a.ts'), 'y y y');
});

test('source-edit/apply: a replacement CONTAINING the anchor is not refused', () => {
    // Regression. The first version asserted the anchor was gone from the result,
    // which refuses a good edit whose replacement embeds it — appending to the
    // line it matched. Measured: renaming `export class X {` to
    // `export class X { // note` was refused as "the anchor is still present".
    //
    // A tool that refuses correct work is a tool people stop using, which is the
    // exact failure this module exists to prevent.
    const fs = fakeFs({ 'src/a.ts': 'export class X {\n    y() {}\n}\n' });
    const result = applyEdit({
        path: 'src/a.ts',
        anchor: 'export class X {',
        replacement: 'export class X { // note',
        ...fs
    });
    assert.equal(result.ok, true, result.reason ?? '');
    assert.match(fs.files.get('src/a.ts') as string, /export class X \{ \/\/ note/);
});
