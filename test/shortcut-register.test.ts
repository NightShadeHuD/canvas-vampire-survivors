// Unit tests for scripts/lib/shortcut-register.mjs.
//
// A register is only worth what its weakest row is worth, so these tests are
// mostly about the three ways one rots: a lost column, a numbering gap, and a
// citation to a row that is not there. The scoping test matters as much as any
// of them — the review table below the register is a different shape whose first
// cell is also a number, and reading it as register rows reports defects that do
// not exist.
//
// Runs in Node, no DOM.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
    registerRows,
    checkRegister,
    REGISTER_COLUMNS
} from '../scripts/lib/shortcut-register.mjs';

/** Build a register document from row bodies. */
function doc(...rows) {
    return [
        '# Declared shortcuts',
        '',
        '## Register',
        '',
        '| # | Area | Location | Ceiling accepted | Revisit trigger | Status |',
        '| --- | --- | --- | --- | --- | --- |',
        ...rows,
        '',
        '## Review',
        '',
        '| Gate | Reviewed | Open shortcuts | Any trigger met? |',
        '| --- | --- | --- | --- |',
        '| v1.0.0 | 2026-01-01 | 1 | No |'
    ].join('\n');
}

/** One well-formed row. */
function row(n, overrides: Record<string, string> = {}) {
    const cells = [
        String(n),
        overrides.area ?? 'Area',
        overrides.location ?? '`src/a.ts`',
        overrides.ceiling ?? '**Bounded at 10.** Why.',
        overrides.trigger ?? 'The first time it exceeds 10.',
        overrides.status ?? 'OPEN'
    ];
    return `| ${cells.join(' | ')} |`;
}

const check = (text, citing = []) =>
    checkRegister({ registerPath: 'docs/SHORTCUTS.md', registerText: text, citing });

// ---------------------------------------------------------------------------
// registerRows()
// ---------------------------------------------------------------------------

test('register/rows: reads numbered rows in the Register section', () => {
    const rows = registerRows(doc(row(1), row(2)));
    assert.deepEqual(
        rows.map((r) => r.cells[0]),
        ['1', '2']
    );
});

test('register/rows: the Review table below is NOT read as register rows', () => {
    // Its first cell is a version, and a file-wide scan misreads the whole table.
    const rows = registerRows(doc(row(1)));
    assert.equal(rows.length, 1, 'only the register section counts');
    assert.ok(!rows.some((r) => r.cells.some((c) => c.includes('v1.0.0'))));
});

test('register/rows: a struck-through row is still a definition', () => {
    const rows = registerRows(
        doc('| ~~3~~ | Area | `src/a.ts` | Bounded. | Trigger. | RESOLVED |')
    );
    assert.deepEqual(
        rows.map((r) => r.cells[0]),
        ['3']
    );
});

test('register/rows: the header and separator are not rows', () => {
    const rows = registerRows(doc(row(1)));
    assert.equal(rows.length, 1);
});

// ---------------------------------------------------------------------------
// well-formedness
// ---------------------------------------------------------------------------

test('register/check: a sound register passes', () => {
    const { findings, rowCount } = check(doc(row(1), row(2)));
    assert.deepEqual(findings, []);
    assert.equal(rowCount, 2);
});

test('register/check: a row with the wrong cell count is refused', () => {
    // The failure the scaffold records: one register lost its Status column for
    // twenty-eight rows and nothing noticed for several phases, because a
    // missing cell renders blank and a blank ceiling reads as unreviewed.
    const { findings } = check(doc('| 1 | Area | `src/a.ts` | Ceiling. | Trigger. |'));
    assert.equal(findings.length, 1);
    assert.match(findings[0], /has 5 cell\(s\) but the header declares 6/);
});

test('register/check: a blank ceiling is refused', () => {
    const { findings } = check(doc(row(1, { ceiling: '' })));
    assert.match(findings.join('\n'), /row 1 has no ceiling accepted/);
});

test('register/check: a blank revisit trigger is refused', () => {
    const { findings } = check(doc(row(1, { trigger: '' })));
    assert.match(findings.join('\n'), /row 1 has no revisit trigger/);
});

test('register/check: a blank status is refused', () => {
    const { findings } = check(doc(row(1, { status: '' })));
    assert.match(findings.join('\n'), /row 1 has no status/);
});

test('register/check: an empty Register section is refused', () => {
    // An empty register reads as "no shortcuts", which is a claim, not a blank.
    const { findings, rowCount } = check('## Register\n\n| # |\n| --- |\n');
    assert.equal(rowCount, 0);
    assert.match(findings.join('\n'), /no numbered rows/);
});

// ---------------------------------------------------------------------------
// numbering
// ---------------------------------------------------------------------------

test('register/check: a gap in the numbering is refused', () => {
    const { findings } = check(doc(row(1), row(3)));
    assert.match(findings.join('\n'), /has no row 2/);
});

test('register/check: a gap caused by deletion is named specifically', () => {
    const { findings } = check(doc(row(1), row(2), row(4)));
    assert.equal(findings.length, 1);
    assert.match(findings[0], /STRUCK THROUGH and kept/);
});

test('register/check: contiguous numbering with a struck-through row passes', () => {
    const { findings } = check(
        doc(
            row(1),
            '| ~~2~~ | Area | `src/a.ts` | Was bounded. | Resolved. | RESOLVED at abc123 |',
            row(3)
        )
    );
    assert.deepEqual(findings, [], 'a discharged row kept in place holds its number');
});

// ---------------------------------------------------------------------------
// citations
// ---------------------------------------------------------------------------

test('register/check: a citation to a defined row resolves', () => {
    const { findings } = check(doc(row(1)), [{ path: 'docs/X.md', text: 'See row 1.' }]);
    assert.deepEqual(findings, []);
});

test('register/check: a citation to a row that does not exist is refused', () => {
    // Worse than a malformed row: it promises a ceiling and a trigger.
    const { findings } = check(doc(row(1)), [{ path: 'docs/X.md', text: 'See row 4.' }]);
    assert.equal(findings.length, 1);
    assert.match(findings[0], /docs\/X\.md:1 cites row 4/);
});

test('register/check: a citation range is checked on both ends', () => {
    const { findings } = check(doc(row(1), row(2)), [{ path: 'docs/X.md', text: 'rows 1-4' }]);
    const missing = findings.map((f) => f.match(/cites row (\d+)/)?.[1]);
    assert.deepEqual(missing, ['3', '4']);
});

test('register/check: an en-dash range is a range too', () => {
    const { findings } = check(doc(row(1)), [{ path: 'docs/X.md', text: 'rows 1–3' }]);
    assert.equal(findings.length, 2, 'rows 2 and 3 are missing');
});

test('register/check: the singular and plural forms both cite', () => {
    const { findings } = check(doc(row(1)), [{ path: 'docs/X.md', text: 'row 1 and rows 9' }]);
    assert.match(findings.join('\n'), /cites row 9/);
});

test('register/check: the citation line number is reported', () => {
    const { findings } = check(doc(row(1)), [
        { path: 'docs/X.md', text: 'line one\nline two\nsee row 7' }
    ]);
    assert.match(findings[0], /docs\/X\.md:3 /);
});

test('register/check: the column count the header declares is the exported one', () => {
    // The checker and the register's own header must not drift apart.
    assert.equal(REGISTER_COLUMNS, 6);
});
