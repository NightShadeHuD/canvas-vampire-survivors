// Unit tests for scripts/lib/json-edit.mjs.
//
// The module exists because a bulk edit keyed on a field that is not unique
// destroyed seven entries of `gate-selftests.json` and left every gate green. So
// the tests are about the count: a selection that matches a declared number
// passes, and any other number is refused BEFORE anything is written.
//
// The first test is the incident itself, at the size it happened.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
    parseWhere,
    readManifest,
    serializeLike,
    planJsonEdit,
    applyJsonEdit
} from '../scripts/lib/json-edit.mjs';

/** Seven entries sharing a gate, as `gate-selftests.json` has. */
function sevenReachEntries() {
    return {
        items: [1, 2, 3, 4, 5, 6, 7].map((n) => ({
            gate: 'check:reach',
            break: `node scripts/edit.mjs godot/scripts/main.gd --anchor A${n} --replace B${n}`,
            why: `hole ${n}`
        }))
    };
}

// ---------------------------------------------------------------------------
// parseWhere — the selector grammar
// ---------------------------------------------------------------------------

test('json-edit/where: equality is read', () => {
    assert.deepEqual(parseWhere('gate=check:reach'), {
        ok: true,
        field: 'gate',
        value: 'check:reach',
        negated: false
    });
});

test('json-edit/where: inequality is read', () => {
    assert.equal(parseWhere('gate!=check:reach').negated, true);
});

test('json-edit/where: a spec with no operator is refused', () => {
    const parsed = parseWhere('check:reach');
    assert.equal(parsed.ok, false);
    assert.match(parsed.reason ?? '', /field=value/);
});

test('json-edit/where: a value containing = is kept whole', () => {
    assert.equal(parseWhere('break=node x --anchor a=b').value, 'node x --anchor a=b');
});

// ---------------------------------------------------------------------------
// readManifest / serializeLike
// ---------------------------------------------------------------------------

test('json-edit/manifest: a root array is read', () => {
    const parsed = readManifest('[{"a":1}]', null);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.items?.length, 1);
});

test('json-edit/manifest: --list names an array inside an object', () => {
    const parsed = readManifest('{"declaredGaps":[{"id":"x"}]}', 'declaredGaps');
    assert.equal(parsed.ok, true);
    assert.equal(parsed.items?.length, 1);
});

test('json-edit/manifest: a root object with no --list is refused', () => {
    const parsed = readManifest('{"a":1}', null);
    assert.equal(parsed.ok, false);
    assert.match(parsed.reason ?? '', /not a JSON array/);
});

test('json-edit/manifest: invalid JSON is refused with the parser reason', () => {
    const parsed = readManifest('{oops', null);
    assert.equal(parsed.ok, false);
    assert.match(parsed.reason ?? '', /not valid JSON/);
});

test('json-edit/serialize: the file own indentation is preserved', () => {
    // Reading the first indented line as the indent unit matters: a quote line
    // sits at its own nesting depth, and using that would re-serialize
    // gate-selftests.json at eight spaces and rewrite all 33 entries.
    const original = '[\n    {\n        "a": 1\n    }\n]\n';
    const text = serializeLike(original, [{ a: 2 }]);
    assert.equal(text, '[\n    {\n        "a": 2\n    }\n]\n');
});

test('json-edit/serialize: a missing trailing newline is not invented', () => {
    // The expectation in this test was wrong first time round — assert.equal on
    // '[1]', which is not what a re-serialization of a compact file can produce.
    // The behaviour that matters is that the file's OWN shape is kept.
    const compact = '[\n    {\n        "a": 1\n    }\n]';
    assert.equal(serializeLike(compact, [{ a: 2 }]), '[\n    {\n        "a": 2\n    }\n]');
});

// ---------------------------------------------------------------------------
// planJsonEdit — the refusal that is the whole point
// ---------------------------------------------------------------------------

test('json-edit/plan: THE INCIDENT — 7 matches against an expectation of 1 is refused', () => {
    const { items } = sevenReachEntries();
    const plan = planJsonEdit({
        manifest: items,
        items,
        list: null,
        edit: { field: 'break', value: 'ONE STRING FOR ALL SEVEN' },
        selector: { field: 'gate', value: 'check:reach' },
        expected: 1
    });
    assert.equal(plan.ok, false);
    assert.match(plan.reason ?? '', /matched 7 of 7 entries but 1 was expected/);
});

test('json-edit/plan: the declared number is accepted, and only it', () => {
    const { items } = sevenReachEntries();
    const plan = planJsonEdit({
        manifest: items,
        items,
        list: null,
        edit: { field: 'requires', value: 'godot' },
        selector: { field: 'gate', value: 'check:reach' },
        expected: 7
    });
    assert.equal(plan.ok, true);
    assert.equal(plan.matched, 7);
    assert.equal(plan.differed, 7);
});

test('json-edit/plan: an expectation of zero is refused', () => {
    // "I expect nothing" is not a declaration a bulk edit can make.
    const { items } = sevenReachEntries();
    const plan = planJsonEdit({
        manifest: items,
        items,
        list: null,
        edit: { field: 'x', value: 1 },
        selector: { all: true },
        expected: 0
    });
    assert.equal(plan.ok, false);
    assert.match(plan.reason ?? '', /positive integer/);
});

test('json-edit/plan: an edit that would change nothing is refused', () => {
    const { items } = sevenReachEntries();
    const plan = planJsonEdit({
        manifest: items,
        items,
        list: null,
        edit: { field: 'gate', value: 'check:reach' },
        selector: { all: true },
        expected: 7
    });
    assert.equal(plan.ok, false);
    assert.match(plan.reason ?? '', /would change nothing/);
});

test('json-edit/plan: --all still has to state the count', () => {
    const { items } = sevenReachEntries();
    const plan = planJsonEdit({
        manifest: items,
        items,
        list: null,
        edit: { field: 'tag', value: 'x' },
        selector: { all: true },
        expected: 3
    });
    assert.equal(plan.ok, false);
    assert.match(plan.reason ?? '', /matched 7 of 7/);
});

test('json-edit/plan: an edit inside --list leaves the rest of the file alone', () => {
    const manifest = { version: 1, declaredGaps: [{ id: 'a' }, { id: 'b' }] };
    const plan = planJsonEdit({
        manifest,
        items: manifest.declaredGaps,
        list: 'declaredGaps',
        edit: { field: 'why', value: 'because' },
        selector: { field: 'id', value: 'b' },
        expected: 1
    });
    assert.equal(plan.ok, true);
    assert.deepEqual(plan.result, {
        version: 1,
        declaredGaps: [{ id: 'a' }, { id: 'b', why: 'because' }]
    });
});

// ---------------------------------------------------------------------------
// applyJsonEdit — verifying its own work
// ---------------------------------------------------------------------------

/** A filesystem backed by a Map, so a write can be inspected and sabotaged. */
function fakeFs(initial: Record<string, string>) {
    const files = new Map(Object.entries(initial));
    return {
        files,
        read: (p: string) => {
            if (!files.has(p)) throw new Error(`ENOENT: ${p}`);
            return files.get(p) as string;
        },
        write: (p: string, s: string) => {
            files.set(p, s);
        }
    };
}

const FILE = 'gate-selftests.json';

test('json-edit/apply: a declared edit writes and verifies', () => {
    const { items } = sevenReachEntries();
    const fs = fakeFs({ [FILE]: JSON.stringify(items, null, 4) + '\n' });
    const result = applyJsonEdit({
        path: FILE,
        selector: { field: 'why', value: 'hole 3' },
        expected: 1,
        edit: { field: 'requires', value: 'godot' },
        ...fs
    });
    assert.equal(result.ok, true, result.reason ?? '');
    assert.equal(result.wrote, true);
    assert.equal(result.differed, 1);
    const written = JSON.parse(fs.files.get(FILE) as string);
    assert.equal(written[2].requires, 'godot');
    assert.equal(written.length, 7, 'the entry count must not move');
});

test('json-edit/apply: a refused plan writes NOTHING', () => {
    const { items } = sevenReachEntries();
    const original = JSON.stringify(items, null, 4) + '\n';
    const fs = fakeFs({ [FILE]: original });
    const result = applyJsonEdit({
        path: FILE,
        selector: { field: 'gate', value: 'check:reach' },
        expected: 1,
        edit: { field: 'break', value: 'ONE STRING FOR ALL SEVEN' },
        ...fs
    });
    assert.equal(result.ok, false);
    assert.equal(result.wrote, false);
    assert.equal(fs.files.get(FILE), original, 'the file must be untouched');
});

test('json-edit/apply: a dry run plans without writing', () => {
    const { items } = sevenReachEntries();
    const original = JSON.stringify(items, null, 4) + '\n';
    const fs = fakeFs({ [FILE]: original });
    const result = applyJsonEdit({
        path: FILE,
        selector: { field: 'why', value: 'hole 1' },
        expected: 1,
        edit: { field: 'requires', value: 'godot' },
        dryRun: true,
        ...fs
    });
    assert.equal(result.ok, true);
    assert.equal(result.wrote, false);
    assert.equal(fs.files.get(FILE), original);
});

test('json-edit/apply: a write that did not take is caught by reading back', () => {
    const { items } = sevenReachEntries();
    const fs = fakeFs({ [FILE]: JSON.stringify(items, null, 4) + '\n' });
    const result = applyJsonEdit({
        path: FILE,
        selector: { field: 'why', value: 'hole 1' },
        expected: 1,
        edit: { field: 'requires', value: 'godot' },
        read: fs.read,
        write: () => {}
    });
    assert.equal(result.ok, false);
    assert.equal(result.wrote, true);
    assert.match(result.reason ?? '', /reading it back produced different content/);
});

test('json-edit/apply: an edit that reaches an UNSELECTED entry is caught', () => {
    // The failure this module is named for, one level down: a write that touches
    // more entries than the plan declared. The verification compares the file on
    // disk against the plan, entry by entry.
    const { items } = sevenReachEntries();
    const fs = fakeFs({ [FILE]: JSON.stringify(items, null, 4) + '\n' });
    const result = applyJsonEdit({
        path: FILE,
        selector: { field: 'why', value: 'hole 1' },
        expected: 1,
        edit: { field: 'requires', value: 'godot' },
        read: fs.read,
        write: (p: string, s: string) => {
            const clobbered = JSON.parse(s);
            clobbered[6].break = 'CLOBBERED';
            fs.files.set(p, JSON.stringify(clobbered, null, 4) + '\n');
        }
    });
    assert.equal(result.ok, false);
    assert.equal(result.wrote, true);
    assert.match(result.reason ?? '', /different content/);
});

test('json-edit/apply: a missing file is refused, not thrown', () => {
    const fs = fakeFs({});
    const result = applyJsonEdit({
        path: 'gone.json',
        selector: { field: 'a', value: 'b' },
        expected: 1,
        edit: { field: 'c', value: 'd' },
        ...fs
    });
    assert.equal(result.ok, false);
    assert.match(result.reason ?? '', /could not read/);
});

test('json-edit/apply: a read-back that THROWS is refused, not propagated', () => {
    // The file can be gone by the time the verification runs; an exception there
    // would report nothing at all about the write.
    const { items } = sevenReachEntries();
    const original = JSON.stringify(items, null, 4) + '\n';
    const fs = fakeFs({ [FILE]: original });
    let reads = 0;
    const result = applyJsonEdit({
        path: FILE,
        selector: { field: 'why', value: 'hole 1' },
        expected: 1,
        edit: { field: 'requires', value: 'godot' },
        read: (p: string) => {
            reads += 1;
            if (reads > 1) throw new Error('EIO: the file went away');
            return fs.read(p);
        },
        write: fs.write
    });
    assert.equal(result.ok, false);
    assert.equal(result.wrote, true);
    assert.match(result.reason ?? '', /could not read it back/);
});
