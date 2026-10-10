// Unit tests for scripts/lib/baseline-file.mjs.
//
// One writer for quality-baseline.json, because five tools rewrote it and two of
// them disagreed about encoding.
//
// The bug was real and it blocked a `git switch` after a merge: the committed
// file escapes `§` and `—`, JSON.stringify emits them raw, so
// `check:coverage-floor --update` produced a diff that changed nothing but one
// comment's escaping. A diff nobody can read is a diff nobody reviews.
//
// Runs in Node, no DOM.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serialiseBaseline, readBaseline, writeBaseline } from '../scripts/lib/baseline-file.mjs';

test('baseline-file: a section sign is escaped, as the committed file has it', () => {
    const text = serialiseBaseline({ _comment: 'see docs/ENGINEERING-STANDARDS.md §1.1' });
    assert.match(text, /\\u00a7/, 'it must be escaped, not raw');
    assert.equal(text.includes('§'), false, 'no raw section sign may survive');
});

test('baseline-file: an em dash is escaped', () => {
    const text = serialiseBaseline({ _comment: 'a — b' });
    assert.match(text, /\\u2014/);
    assert.equal(text.includes('—'), false);
});

test('baseline-file: escaping survives a JSON round trip unchanged', () => {
    // The point of the convention: the value must be the same either way, so the
    // only difference between the two writers was the bytes.
    const value = { _comment: '§ and — together' };
    assert.deepEqual(JSON.parse(serialiseBaseline(value)), value);
});

test('baseline-file: ordinary text is untouched', () => {
    const text = serialiseBaseline({ a: 1, b: 'plain' });
    assert.deepEqual(JSON.parse(text), { a: 1, b: 'plain' });
    assert.match(text, /\n$/, 'it ends with a newline, as the file does');
});

test('baseline-file: a backslash in a value cannot be mistaken for an escape', () => {
    // JSON.stringify writes a literal backslash as `\\`, so the escape pass sees
    // `\\u00a7` for a value that CONTAINS that text, and must not double-escape.
    const value = { note: 'literal \\u00a7 text' };
    assert.deepEqual(JSON.parse(serialiseBaseline(value)), value);
});

test('baseline-file: four-space indentation matches the committed file', () => {
    assert.match(serialiseBaseline({ a: { b: 1 } }), /\n {4}"a": \{/);
});

test('baseline-file/write: writes in the convention and reads back the same value', () => {
    // `readBaseline` and `writeBaseline` are the pair every tool uses; testing only
    // the serialiser left them uncovered, which `check:coverage-floor` caught as a
    // drop in the functions metric and refused.
    const path = join(tmpdir(), `baseline-test-${process.pid}.json`);
    const value = { _comment: 'a § and an — together', n: 1 };
    try {
        writeBaseline(path, value);
        assert.deepEqual(readBaseline(path), value, 'the value round-trips');
        const raw = readFileSync(path, 'utf8');
        assert.equal(raw.includes('§'), false, 'and it is stored escaped');
        assert.match(raw, /\\u00a7/);
    } finally {
        rmSync(path, { force: true });
    }
});

test('baseline-file/write: a read of something that is not JSON throws', () => {
    // The tools rely on this being loud rather than returning a default: a
    // baseline that silently reads as `{}` would disable every ceiling it holds.
    const path = join(tmpdir(), `baseline-bad-${process.pid}.json`);
    try {
        writeFileSync(path, 'not json');
        assert.throws(() => readBaseline(path));
    } finally {
        rmSync(path, { force: true });
    }
});
