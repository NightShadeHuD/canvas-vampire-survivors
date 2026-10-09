// Unit tests for scripts/lib/rule-docs.mjs.
//
// Both checks found a real defect in this tree the first time they ran, so these
// tests pin the behaviour that made that possible — and, just as importantly, the
// behaviour that keeps them from crying wolf. A document check that reports
// phantoms gets skimmed, and a gate people skim is worse than no gate because it
// looks like coverage.
//
// Runs in Node, no DOM, no filesystem: `exists` is injected.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
    checkTables,
    checkReferences,
    checkDocuments,
    checkAcceptanceCriteria
} from '../scripts/lib/rule-docs.mjs';

/** An `exists` probe backed by a plain list of paths. */
const probe =
    (...paths) =>
    (candidate) =>
        paths.includes(candidate);

// ---------------------------------------------------------------------------
// tables
// ---------------------------------------------------------------------------

test('rule-docs/tables: a well-formed table passes', () => {
    const text = ['| A | B |', '| --- | --- |', '| 1 | 2 |'].join('\n');
    assert.deepEqual(checkTables('doc.md', text), []);
});

test('rule-docs/tables: a row of the wrong width is refused', () => {
    // The real defect: BALANCE.md had a two-cell row under a three-cell header.
    const text = ['| A | B | C |', '| --- | --- | --- |', '| 1 | 2 |'].join('\n');
    const findings = checkTables('BALANCE.md', text);
    assert.equal(findings.length, 1);
    assert.match(
        findings[0],
        /^BALANCE\.md:3 has 2 cell\(s\) but the table header at line 1 declares 3/
    );
});

test('rule-docs/tables: a row wider than the header is refused too', () => {
    const text = ['| A | B |', '| --- | --- |', '| 1 | 2 | 3 |'].join('\n');
    assert.match(checkTables('doc.md', text)[0], /has 3 cell\(s\) but the table header/);
});

test('rule-docs/tables: the separator row is not measured as data', () => {
    // `| --- | :--: |` has the same cell count, but a ragged separator must not
    // be reported as a data row either.
    const text = ['| A | B |', '| --- | --- |', '| 1 | 2 |'].join('\n');
    assert.deepEqual(checkTables('doc.md', text), [], 'no finding for the separator');
});

test('rule-docs/tables: a second table gets its own header', () => {
    // Docs here hold several tables of different shapes in one file.
    const text = [
        '| A | B |',
        '| --- | --- |',
        '| 1 | 2 |',
        '',
        'Some prose.',
        '',
        '| X | Y | Z |',
        '| --- | --- | --- |',
        '| 1 | 2 | 3 |'
    ].join('\n');
    assert.deepEqual(checkTables('doc.md', text), []);
});

test('rule-docs/tables: prose between rows ends the table', () => {
    const text = ['| A | B |', '| --- | --- |', '| 1 | 2 |', '', 'Not a table row', '| 1 |'].join(
        '\n'
    );
    assert.deepEqual(checkTables('doc.md', text), [], 'the orphan row is a new table header');
});

test('rule-docs/tables: an indented table is still measured', () => {
    const text = ['  | A | B |', '  | --- | --- |', '  | 1 |'].join('\n');
    assert.equal(checkTables('doc.md', text).length, 1);
});

// ---------------------------------------------------------------------------
// document references
// ---------------------------------------------------------------------------

test('rule-docs/refs: a reference that resolves from the root passes', () => {
    const text = 'See `docs/CONTROLS.md` for the bindings.';
    assert.deepEqual(checkReferences('README.md', text, probe('docs/CONTROLS.md')), []);
});

test('rule-docs/refs: a reference that resolves from its own directory passes', () => {
    // A doc inside docs/ naming a sibling means the sibling. Resolving only from
    // the root reported five phantoms on this tree before this was handled.
    const text = 'See `CONTROLS.md` for the bindings.';
    assert.deepEqual(checkReferences('docs/USER_GUIDE.md', text, probe('docs/CONTROLS.md')), []);
});

test('rule-docs/refs: a missing document is refused', () => {
    const text = 'See `docs/audio-credits.md`.';
    const findings = checkReferences('docs/GOOD_FIRST_ISSUES.md', text, probe());
    assert.equal(findings.length, 1);
    assert.match(findings[0], /cites `docs\/audio-credits\.md`, which does not exist/);
});

test('rule-docs/refs: a declared owed document is not a broken citation', () => {
    const text = 'Credit line in `docs/audio-credits.md`.';
    const owed = new Set(['docs/audio-credits.md']);
    assert.deepEqual(checkReferences('docs/GOOD_FIRST_ISSUES.md', text, probe(), owed), []);
});

test('rule-docs/refs: the finding names the line', () => {
    const text = 'line one\nline two\nsee `docs/nope.md`';
    assert.match(checkReferences('doc.md', text, probe())[0], /^doc\.md:3 /);
});

test('rule-docs/refs: a non-document path is not measured', () => {
    // Code files are deliberately out of scope: they are legitimately renamed,
    // and a doc citing one is a weaker claim than a doc citing a missing
    // rulebook.
    const text = 'See `src/main.ts` and `styles.css`.';
    assert.deepEqual(checkReferences('doc.md', text, probe()), []);
});

// ---------------------------------------------------------------------------
// the whole check
// ---------------------------------------------------------------------------

test('rule-docs/check: aggregates findings across documents', () => {
    const documents = [
        { path: 'a.md', text: '| A | B |\n| --- | --- |\n| 1 |' },
        { path: 'b.md', text: 'See `docs/missing.md`.' }
    ];
    const { findings } = checkDocuments(documents, probe());
    assert.equal(findings.length, 2);
});

test('rule-docs/check: counts references across documents', () => {
    const documents = [
        { path: 'a.md', text: '`docs/one.md`' },
        { path: 'b.md', text: '`docs/one.md` and `docs/two.md`' }
    ];
    assert.equal(checkDocuments(documents, probe('docs/one.md', 'docs/two.md')).references, 3);
});

test('rule-docs/check: a clean document set reports nothing', () => {
    const documents = [{ path: 'a.md', text: '| A |\n| --- |\n| 1 |\n\nSee `docs/b.md`.' }];
    const { findings } = checkDocuments(documents, probe('docs/b.md'));
    assert.deepEqual(findings, []);
});

// ---------------------------------------------------------------------------
// acceptance criteria
// ---------------------------------------------------------------------------

/** A criteria table with the given rows. */
function criteriaDoc(...rows: string[]): string {
    return [
        '## Acceptance criteria',
        '',
        '| Id | The claim | The check | The evidence | Tier | Status |',
        '| --- | --- | --- | --- | --- | --- |',
        ...rows
    ].join('\n');
}

const criterion = (id: string, evidence = '`585 tests, 0 skipped`, floor 585') =>
    `| ${id} | A claim. | \`npm run check:suite\` | ${evidence} | Production | MET |`;

test('rule-docs/criteria: a sound table passes', () => {
    assert.deepEqual(checkAcceptanceCriteria('docs/A.md', criteriaDoc(criterion('AC-1'))), []);
});

test('rule-docs/criteria: evidence that restates the build is refused', () => {
    // ACCEPTANCE.md's own rule: "A criterion whose evidence column is 'tests
    // pass' is not a criterion. It restates the build."
    const findings = checkAcceptanceCriteria(
        'docs/A.md',
        criteriaDoc(criterion('AC-1', 'tests pass'))
    );
    assert.equal(findings.length, 1);
    assert.match(findings[0], /restates the build rather than settling the claim/);
});

test('rule-docs/criteria: an escaped pipe inside a cell is one cell', () => {
    // The regression. `\|` is legitimate Markdown, and a criteria row runs
    // `git ls-files 'src/*.js' \| wc -l` — reading it as a cell boundary
    // reported defects in a correct document.
    const row =
        "| AC-1 | No JavaScript. | `git ls-files 'src/*.js' \\| wc -l` | `0` | Functional | MET |";
    assert.deepEqual(checkAcceptanceCriteria('docs/A.md', criteriaDoc(row)), []);
});

test('rule-docs/criteria: a gap in the numbering is refused', () => {
    const findings = checkAcceptanceCriteria(
        'docs/A.md',
        criteriaDoc(criterion('AC-1'), criterion('AC-3'))
    );
    assert.match(findings.join('\n'), /has no AC-2/);
});

test('rule-docs/criteria: a duplicate id is refused', () => {
    const findings = checkAcceptanceCriteria(
        'docs/A.md',
        criteriaDoc(criterion('AC-1'), criterion('AC-1'))
    );
    assert.match(findings.join('\n'), /defines AC-1 more than once/);
});

test('rule-docs/criteria: a blank check is refused', () => {
    const row = '| AC-1 | A claim. |  | `0` | Functional | MET |';
    assert.match(
        checkAcceptanceCriteria('docs/A.md', criteriaDoc(row)).join('\n'),
        /AC-1 has no check/
    );
});

test('rule-docs/criteria: a blank status is refused', () => {
    const row = '| AC-1 | A claim. | `cmd` | `0` | Functional |  |';
    assert.match(
        checkAcceptanceCriteria('docs/A.md', criteriaDoc(row)).join('\n'),
        /AC-1 has no status/
    );
});

test('rule-docs/criteria: a struck-through criterion keeps its number', () => {
    const struck = '| ~~AC-2~~ | Was a claim. | `cmd` | `0` | Functional | RESOLVED at abc123 |';
    const findings = checkAcceptanceCriteria(
        'docs/A.md',
        criteriaDoc(criterion('AC-1'), struck, criterion('AC-3'))
    );
    assert.deepEqual(findings, [], 'a discharged criterion holds its number');
});

test('rule-docs/criteria: another document is not scanned for criteria', () => {
    // Only the section that declares them is measured, so a sentence elsewhere
    // saying "AC-1" is not read as a definition.
    const text = 'We cite AC-1 here.\n\n| Id | X |\n| --- | --- |\n| AC-9 | y |';
    assert.deepEqual(checkAcceptanceCriteria('docs/A.md', text), []);
});
