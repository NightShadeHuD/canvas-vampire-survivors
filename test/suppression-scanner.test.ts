// Unit tests for scripts/lib/suppression-scanner.mjs — the detection rules
// behind `npm run check:suppressions`.
//
// A gate is only trustworthy if its own logic is tested. This file exists
// because the first version of the scanner matched bare strings anywhere, so
// it counted its own rule table and its own documentation as violations and
// blocked an unrelated commit with 18 phantom suppressions. The "must NOT
// match" cases below are that bug, pinned.
//
// Runs in Node, no DOM.

import test from 'node:test';
import assert from 'node:assert/strict';
import { RULES, scanText, scanFiles, stripStrings } from '../scripts/lib/suppression-scanner.mjs';

/** Count one rule in a snippet. */
function count(ruleId, text) {
    return scanText(text).counts[ruleId];
}

// ---------------------------------------------------------------------------
// Real directives must be caught
// ---------------------------------------------------------------------------

test('scanner: line-comment directives are counted', () => {
    assert.equal(count('ts-nocheck', '// @ts-nocheck\nexport const a = 1;'), 1);
    assert.equal(count('ts-ignore', '// @ts-ignore'), 1);
    assert.equal(count('ts-expect-error', '// @ts-expect-error'), 1);
    assert.equal(count('eslint-disable', '// eslint-disable-next-line no-console'), 1);
});

test('scanner: block and JSDoc-comment directives are counted', () => {
    assert.equal(count('ts-ignore', '/* @ts-ignore */'), 1);
    assert.equal(count('ts-ignore', '/** @ts-ignore */'), 1);
    // A JSDoc continuation line carrying the directive (see the note in
    // suppression-scanner.mjs: this comment deliberately does not quote it,
    // because a directive-shaped token in a comment is itself counted).
    assert.equal(count('ts-ignore', '/**\n * @ts-ignore\n */'), 1);
    assert.equal(count('eslint-disable', '/* eslint-disable no-undef */'), 1);
});

test('scanner: TODO and FIXME are counted only inside comments', () => {
    assert.equal(count('todo', '// TODO: wire this up'), 1);
    assert.equal(count('todo', '/* TODO later */'), 1);
    assert.equal(count('todo', '/**\n * TODO: revisit\n */'), 1);
    assert.equal(count('fixme', '// FIXME broken on Safari'), 1);
});

test('scanner: a bare debugger statement is counted, a mention is not', () => {
    assert.equal(count('debugger', 'function f() {\n    debugger;\n}'), 1);
    assert.equal(count('debugger', 'debugger'), 1);
    assert.equal(count('debugger', 'const s = "debugger";'), 0);
    assert.equal(count('debugger', '// debugger removed'), 0);
});

test('scanner: skipped tests are counted', () => {
    assert.equal(count('test-skip', 'test.skip("later", () => {});'), 1);
    assert.equal(count('test-skip', 'describe.skip("group", () => {});'), 1);
    assert.equal(count('test-skip', 'xit("old", () => {});'), 1);
    assert.equal(count('test-skip', 'test("runs", () => {});'), 0);
});

// ---------------------------------------------------------------------------
// Prose and rule definitions must NOT be caught
// ---------------------------------------------------------------------------

test('scanner: a rule table that defines the patterns does not count itself', () => {
    // This is verbatim the shape that produced the false positives.
    const ruleTable = [
        "    { id: 'ts-nocheck', label: '@ts-nocheck', re: /@ts-nocheck/g },",
        "    { id: 'ts-ignore', label: '@ts-ignore', re: /@ts-ignore/g },",
        "    { id: 'eslint-disable', label: 'eslint-disable', re: /eslint-disable/g },",
        "    { id: 'todo', label: 'TODO', re: /\\bTODO\\b/g },"
    ].join('\n');

    const { counts } = scanText(ruleTable);
    assert.equal(counts['ts-nocheck'], 0, 'a pattern definition is not a suppression');
    assert.equal(counts['ts-ignore'], 0);
    assert.equal(counts['eslint-disable'], 0);
    assert.equal(counts['todo'], 0);
});

test('scanner: documentation prose does not count itself', () => {
    // Also verbatim from the file that tripped the gate.
    const prose = [
        ' * A suppression is any comment that tells a tool to stop looking:',
        ' * `@ts-nocheck`, `@ts-ignore`, `eslint-disable`, a skipped test, a `debugger`,',
        ' * a `TODO`. Each one is a place where the code is knowingly worse.',
        ' * Steps marked `TODO` are declared gaps recorded in quality-baseline.json.'
    ].join('\n');

    const { counts } = scanText(prose);
    assert.equal(counts['ts-nocheck'], 0);
    assert.equal(counts['ts-ignore'], 0);
    assert.equal(counts['eslint-disable'], 0);
    assert.equal(counts['debugger'], 0);
    assert.equal(counts.todo, 0);
    assert.equal(counts.fixme, 0);
});

test('scanner: a quoted suppression string is not a suppression', () => {
    assert.equal(count('ts-nocheck', "const label = '@ts-nocheck';"), 0);
    assert.equal(count('eslint-disable', 'const key = "eslint-disable";'), 0);
});

// ---------------------------------------------------------------------------
// Counting mechanics
// ---------------------------------------------------------------------------

test('scanner: two distinct directives on one line are both counted', () => {
    assert.equal(count('ts-ignore', '/* @ts-ignore */ const a = 1; // TODO: x'), 1);
    assert.equal(count('todo', '/* @ts-ignore */ const a = 1; // TODO: x'), 1);
    assert.equal(scanText('/* @ts-ignore */ /* eslint-disable */').counts['eslint-disable'], 1);
});

test('scanner: a repeated token inside one comment counts once', () => {
    // Only the leading token of a comment is a directive; the rest is text a
    // tool would never act on. Counting it twice would inflate the ceiling.
    assert.equal(count('ts-ignore', '// @ts-ignore @ts-ignore'), 1);
});

test('scanner: hits carry accurate 1-based line numbers', () => {
    const { hits } = scanText('const a = 1;\n\n// @ts-ignore\nconst b = 2;\n');
    const hit = hits.find((h) => h.rule === 'ts-ignore');
    assert.ok(hit, 'expected a ts-ignore hit');
    assert.equal(hit.line, 3);
});

test('scanner: an empty file yields zero for every rule', () => {
    const { counts, hits } = scanText('');
    assert.equal(hits.length, 0);
    for (const rule of RULES) assert.equal(counts[rule.id], 0, rule.id);
});

test('scanner: every rule reports a key, so ceilings cannot silently miss one', () => {
    const { counts } = scanText('');
    for (const rule of RULES) {
        assert.ok(
            Object.prototype.hasOwnProperty.call(counts, rule.id),
            `missing count for ${rule.id}`
        );
    }
});

test('scanner: scanFiles aggregates totals and attributes hits to files', () => {
    const files = { 'a.js': '// @ts-ignore', 'b.js': '// @ts-ignore\n// TODO: x' };
    const { totals, hitsByRule } = scanFiles(Object.keys(files), (p) => files[p]);

    assert.equal(totals['ts-ignore'], 2);
    assert.equal(totals.todo, 1);
    assert.deepEqual(hitsByRule['ts-ignore'], ['a.js:1', 'b.js:1']);
});

test('scanner: an unreadable file is skipped rather than throwing', () => {
    const { totals } = scanFiles(['missing.js'], () => {
        throw new Error('ENOENT');
    });
    assert.equal(totals['ts-ignore'], 0);
});

// ---------------------------------------------------------------------------
// String literals are data, not directives
//
// The second false positive the gate hit on itself: its own test fixtures, and
// the `.skip(` inside its own pattern source, were counted as suppressions and
// blocked the commit that added them.
// ---------------------------------------------------------------------------

test('scanner: directives inside string literals are not counted', () => {
    assert.equal(count('ts-nocheck', "const a = '// @ts-nocheck';"), 0);
    assert.equal(count('ts-ignore', 'const a = "// @ts-ignore";'), 0);
    assert.equal(count('eslint-disable', "const a = '// eslint-disable-next-line';"), 0);
    assert.equal(count('todo', "const a = '// TODO: not a real todo';"), 0);
    assert.equal(
        count('test-skip', "assert.equal(count('test-skip', 'test.skip(\"x\", () => {});'), 1);"),
        0
    );
    assert.equal(count('debugger', "const a = 'function f() { debugger; }';"), 0);
});

test('scanner: directives inside template literals and raw strings are not counted', () => {
    assert.equal(count('ts-ignore', 'const a = `// @ts-ignore`;'), 0);
    assert.equal(count('test-skip', 'const re = String.raw`it\\.skip\\(`;'), 0);
    assert.equal(
        count('ts-ignore', 'const a = `\n// @ts-ignore\n`;'),
        0,
        'a multi-line template is still data'
    );
});

test('scanner: escaped quotes do not end a string early', () => {
    // The escaped quote must not terminate the literal, or the rest of the
    // line would be scanned as code.
    assert.equal(count('ts-ignore', "const a = 'it\\'s // @ts-ignore';"), 0);
});

test('scanner: a real directive after a string on the same line is still counted', () => {
    assert.equal(count('ts-ignore', "const a = 'text'; // @ts-ignore"), 1);
});

test('scanner: a real directive after a string in a comment is still counted', () => {
    // Comments are kept verbatim, so directives inside them survive.
    assert.equal(count('todo', "const a = 'x'; /* TODO: real */"), 1);
});

test('stripStrings: preserves length and line count so hits stay accurate', () => {
    const src = "const a = '// @ts-ignore';\n// @ts-ignore\n";
    const stripped = stripStrings(src);
    assert.equal(stripped.length, src.length, 'length must be preserved');
    assert.equal(stripped.split('\n').length, src.split('\n').length, 'lines must be preserved');
    assert.match(stripped, /\/\/ @ts-ignore/, 'the real directive must survive');
    assert.ok(!stripped.includes("'// @ts-ignore'"), 'the literal must be blanked');
});

test('stripStrings: leaves comments untouched', () => {
    const src = '// @ts-ignore\n/* eslint-disable */\n';
    assert.equal(stripStrings(src), src);
});
