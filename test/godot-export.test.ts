/**
 * @file test/godot-export.test.ts
 * @description Tests for the TypeScript-to-GDScript data exporter.
 *
 * The exporter is the only thing standing between `src/data.ts` and a `godot/data/`
 * that drifts from it. These pin the two properties that matter: values survive the
 * crossing, and what CANNOT cross is reported rather than dropped.
 *
 * @module test/godot-export
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { toGd } from '../scripts/lib/godot-data.mjs';

/** A fresh report, since `toGd` records what it could not convert. */
type Skip = { at: string; why: string };
const emptyReport = (): { skipped: Skip[] } => ({ skipped: [] });

const run = (v: unknown) => {
    const report = emptyReport();
    return { gd: toGd(v, 'x', report), skipped: report.skipped };
};

test('godot-export: scalars become GDScript literals', () => {
    assert.equal(run(20).gd, '20');
    assert.equal(run(1.5).gd, '1.5');
    assert.equal(run(true).gd, 'true');
    assert.equal(run('Whip').gd, '"Whip"');
    assert.equal(run(null).gd, 'null');
});

test('godot-export: undefined becomes null, because GDScript has no undefined', () => {
    // This is the ONE semantic difference the port turns on, and the reason
    // `strictNullChecks` in src/ was finished before any of this was attempted.
    assert.equal(run(undefined).gd, 'null');
});

test('godot-export: strings are escaped rather than emitted raw', () => {
    // A description with a quote in it would otherwise produce a syntax error in
    // the generated file, and Godot would refuse the whole script.
    const { gd } = run('says "hi"\nand a newline');
    assert.equal(gd, JSON.stringify('says "hi"\nand a newline'));
    assert.ok(gd.startsWith('"') && gd.endsWith('"'));
});

test('godot-export: arrays and dictionaries nest', () => {
    assert.equal(run([1, 2]).gd, '[1, 2]');
    assert.equal(run({ a: 1 }).gd, '{"a": 1}');
    assert.equal(run({ a: [1, { b: true }] }).gd, '{"a": [1, {"b": true}]}');
    assert.equal(run({}).gd, '{}');
    assert.equal(run([]).gd, '[]');
});

test('godot-export: a function is REPORTED, not silently dropped', () => {
    // Twenty-one achievements carry `check: (c) => ...`. GDScript cannot hold a
    // lambda in a Dictionary. A generator that skipped these would look finished
    // and be hollow -- the report IS the port worklist.
    const { gd, skipped } = run(() => true);
    assert.equal(gd, 'null');
    assert.equal(skipped.length, 1);
    assert.match(skipped[0].why, /hand-written/);
});

test('godot-export: a non-finite number is reported, not emitted', () => {
    // `Infinity` has no GDScript literal, and emitting the word would be a syntax
    // error rather than a wrong value.
    const { gd, skipped } = run(Infinity);
    assert.equal(gd, 'null');
    assert.equal(skipped.length, 1);
});

test('godot-export: the report names WHERE the unconvertible value was', () => {
    // A count is not a worklist. A path into the data is.
    const report = emptyReport();
    toGd({ WHIP: { check: () => true } }, 'WEAPONS', report);
    assert.equal(report.skipped.length, 1);
    assert.equal(report.skipped[0].at, 'WEAPONS.WHIP.check');
});
