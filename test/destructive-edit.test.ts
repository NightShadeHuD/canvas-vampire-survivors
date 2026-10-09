// Unit tests for scripts/lib/destructive-edit.mjs.
//
// Every pattern here is refused because it actually cost time in this
// repository: an in-place `sed` stripped the backticks out of a source file's
// template literals while "cleaning up" after a different mistake.
//
// The tests are written around the real commands rather than invented ones,
// because an invented example is easy to make pass.
//
// Runs in Node, no DOM.

import test from 'node:test';
import assert from 'node:assert/strict';
import { findDestructiveEdits, DESTRUCTIVE_PATTERNS } from '../scripts/lib/destructive-edit.mjs';

const scan = (text: string) => findDestructiveEdits('scripts/probe.sh', text);

// ---------------------------------------------------------------------------
// what is refused
// ---------------------------------------------------------------------------

test('destructive-edit: the command that caused the damage is refused', () => {
    // The actual invocation. It stripped every backtick from src/effects.ts,
    // including the template literals it builds its colours from:
    //     ctx.strokeStyle = `rgba(160,255,160,${...})`;
    assert.equal(scan("sed -i '' 's/`//g' src/effects.ts").length, 1);
});

test('destructive-edit: a plain in-place sed on a source file is refused', () => {
    assert.equal(scan("sed -i 's/foo/bar/' src/main.ts").length, 1);
});

test('destructive-edit: the GNU spelling is refused too', () => {
    assert.equal(scan("sed --in-place 's/foo/bar/' src/main.ts").length, 1);
});

test('destructive-edit: perl -pi is refused', () => {
    assert.equal(scan("perl -pi -e 's/foo/bar/' src/main.ts").length, 1);
});

test('destructive-edit: a python one-liner rewriting a source file is refused', () => {
    assert.equal(scan("python3 -c \"open('src/main.ts','w').write(s)\"").length, 1);
});

// ---------------------------------------------------------------------------
// what is allowed, because a gate that cries wolf gets skimmed
// ---------------------------------------------------------------------------

test('destructive-edit: reading a file with sed is fine', () => {
    assert.deepEqual(scan("sed -n '1,10p' src/main.ts"), []);
});

test('destructive-edit: editing a generated artefact is a different act', () => {
    // `dist/` is build output, and rewriting it is not rewriting the code.
    assert.deepEqual(scan("sed -i 's/a/b/' dist/bundle.js.map"), []);
});

test('destructive-edit: a non-source file is not measured', () => {
    assert.deepEqual(scan("sed -i 's/a/b/' CHANGELOG.md"), []);
});

test('destructive-edit: prose describing the hazard is not the hazard', () => {
    // This very repository documents the incident, and a check that flagged its
    // own documentation would be reporting a phantom.
    assert.deepEqual(scan("# never do: sed -i 's/a/b/' src/main.ts"), []);
    assert.deepEqual(scan("// never do: sed -i 's/a/b/' src/main.ts"), []);
});

test('destructive-edit: an ordinary build command is not flagged', () => {
    assert.deepEqual(scan('node scripts/build.mjs && npm test'), []);
});

// ---------------------------------------------------------------------------
// the rule table itself
// ---------------------------------------------------------------------------

test('destructive-edit: every pattern carries the reason it is refused', () => {
    // A rule with no stated reason is one somebody deletes when it is
    // inconvenient.
    for (const rule of DESTRUCTIVE_PATTERNS) {
        assert.ok(rule.pattern instanceof RegExp, 'a rule needs a pattern');
        assert.ok(rule.what && rule.what.length > 3, 'a rule needs to say what it refuses');
    }
});

test('destructive-edit: the finding names the file and line', () => {
    const findings = scan(['echo start', "sed -i 's/a/b/' src/main.ts"].join('\n'));
    assert.match(findings[0], /^scripts\/probe\.sh:2 /);
});

test('destructive-edit: the finding says what to do instead', () => {
    const findings = scan("sed -i 's/a/b/' src/main.ts");
    assert.match(findings[0], /anchored edit/);
    assert.match(findings[0], /refuses to write unless the anchor matched exactly once/);
});

test('destructive-edit: the rule-defining files are exempt, and only them', () => {
    // This module's own pattern table spells the forbidden commands out as regex
    // literals, and the first run of the gate flagged them. A rule definition is
    // a description, not an action — the same reason comments are skipped.
    assert.deepEqual(
        findDestructiveEdits('scripts/lib/destructive-edit.mjs', "sed -i 's/a/b/' src/main.ts"),
        []
    );
    assert.deepEqual(
        findDestructiveEdits('test/destructive-edit.test.ts', "sed -i 's/a/b/' src/main.ts"),
        []
    );
    // Anywhere else, the same line is still caught.
    assert.equal(
        findDestructiveEdits('scripts/other.mjs', "sed -i 's/a/b/' src/main.ts").length,
        1
    );
});
