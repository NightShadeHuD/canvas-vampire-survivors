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

test('destructive-edit: a direct write to a source file is refused', () => {
    // scripts/edit.mjs and scripts/lib/source-edit.mjs exist so a scripted edit
    // anchors, counts and verifies. A direct write does none of those.
    assert.equal(scan("writeFileSync('src/main.ts', text)").length, 1);
});

test('destructive-edit: a shell redirection into a source file is refused', () => {
    assert.equal(scan('echo "x" > src/main.ts').length, 1);
    assert.equal(scan('cat a.txt >> test/main.test.ts').length, 1);
});

test('destructive-edit: writing build output directly is still fine', () => {
    assert.deepEqual(scan("writeFileSync('dist/main.js', text)"), []);
});

test('destructive-edit: the PORT is source too', async () => {
    // The extension list was written before the Godot port existed, so a committed
    // `sed -i` against `godot/` was invisible -- rule 6's MECHANICAL half did not cover
    // the half of the codebase the port is transforming. Found by an audit that put a
    // `sed -i` on `godot/scripts/hero.gd` into a committed script and watched it pass,
    // then changed the target to `src/data.ts` and watched it fail.
    const { findDestructiveEdits } = await import('../scripts/lib/destructive-edit.mjs');

    for (const target of [
        'godot/scripts/hero.gd',
        'godot/scenes/main.tscn',
        'godot/data/config.gd'
    ]) {
        const findings = findDestructiveEdits(
            'probe.mjs',
            `execSync(\`sed -i "s/x/y/" ${target}\`);`
        );
        assert.ok(findings.length > 0, `${target} must be treated as source`);
    }

    // `.ts` still caught, so the widening did not replace the old behaviour.
    assert.ok(
        findDestructiveEdits('probe.mjs', 'execSync(`sed -i "s/x/y/" src/data.ts`);').length > 0
    );
});

test('destructive-edit: GDScript suppressions are a tracked family', async () => {
    // `@warning_ignore` is GDScript's analogue of `eslint-disable` -- a warning silenced
    // rather than fixed -- and it was entirely unread, because the source extension list
    // was written before the port existed. A whole family could grow without limit while
    // the gate reported every ceiling matched exactly.
    //
    // The first attempt used the `directive(...)` helper, which expects the directive in a
    // COMMENT. GDScript's is an ANNOTATION on the line above, so the helper found zero
    // hits on a file that plainly contained one.
    const { scanText } = await import('../scripts/lib/suppression-scanner.mjs');

    const gd = '@warning_ignore("unused_parameter")\nfunc f(x):\n\treturn x\n';
    assert.equal(scanText(gd).counts['warning-ignore'], 1, 'a GDScript suppression is seen');

    // And a `.gd` file with none is not falsely flagged.
    assert.equal(scanText('func f(x):\n\treturn x\n').counts['warning-ignore'], 0);
});
