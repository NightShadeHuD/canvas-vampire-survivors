/**
 * @file scripts/lib/rule-docs.mjs
 * @description Structural checks for the documents that carry this project's
 * rules.
 *
 * Adopted from the agent-scaffold method (`mechanisms/check_docs.py`), whose
 * framing is the reason it exists at all: the rules live in prose, prose has
 * structure, and that structure rots silently. Every check below earned its
 * place by finding a real defect in this tree on its first run:
 *
 *   - `BALANCE.md:18` had a table row with two cells under a three-cell header.
 *     It renders wrong and reads wrong, and nothing was watching.
 *   - `docs/GOOD_FIRST_ISSUES.md` cited `docs/audio-credits.md` twice, and that
 *     file does not exist. A reader sent to a document that is not there has no
 *     way to tell whether it was renamed or never written.
 *
 * DOCUMENTS THE PROJECT OWES
 *
 * `docs/audio-credits.md` is cited twice by `docs/GOOD_FIRST_ISSUES.md` and does
 * not exist, because it is a deliverable a contributor is being invited to
 * write. That is not a broken citation, so it is DECLARED in the checker rather
 * than inferred. The scaffold records why inference was rejected: a heuristic
 * ("does this line mention a phase?") reported eight findings on its tree, all
 * of them legitimate, and inferring intent from prose is how a check becomes
 * noise.
 *
 * WHAT IS NOT CHECKED, AND WHY
 *
 * The original also checks duplicated definition ids, criteria cited but never
 * defined, and `§` section references. None of those apply here: this project's
 * documents carry no numbered invariant or criteria ids, so there is nothing to
 * duplicate or dangle. Section references were considered and REJECTED rather
 * than implemented badly — resolving `§2` to a heading means parsing Markdown
 * headings, and a check that guesses at intent reports phantoms. This
 * project's rule is to declare rather than guess, so it is left out and said so
 * here instead of shipped as a check that cries wolf.
 */

/** A table's separator row: `| --- | :--: |`. */
const TABLE_SEPARATOR = /^\|[\s:|-]+\|$/;

/**
 * A backticked path naming a document.
 *
 * Code files are deliberately excluded: `main.ts` is legitimately renamed, and a
 * doc citing a file it cannot resolve is a weaker claim than a doc citing a
 * missing rulebook.
 */
const DOCUMENT_REFERENCE = /`((?:docs\/)?[A-Za-z][A-Za-z0-9._-]*\.md)`/g;

/** Split a markdown table row into its cells. */
function cells(line) {
    return (
        line
            .trim()
            .replace(/^\||\|$/g, '')
            // `\|` is a legitimate Markdown escape for a pipe INSIDE a cell,
            // and this repository uses it: a criteria row runs
            // `git ls-files 'src/*.js' \| wc -l`. Splitting on the raw character
            // read that row one cell too wide and reported defects in a correct
            // document — measured on the first run of the acceptance check.
            .split(/(?<!\\)\|/)
            .map((cell) => cell.trim())
    );
}

/**
 * Every table in a document must have rows that match its header's shape.
 *
 * @param {string} documentPath path used in findings
 * @param {string} text the document
 * @returns {string[]}
 */
export function checkTables(documentPath, text) {
    const findings = [];
    let headerCells = null;
    let headerLine = 0;

    for (const [index, line] of text.split('\n').entries()) {
        const lineNumber = index + 1;
        const trimmed = line.trim();

        if (!trimmed.startsWith('|')) {
            headerCells = null;
            continue;
        }
        if (TABLE_SEPARATOR.test(trimmed)) continue;

        const width = cells(trimmed).length;
        if (headerCells === null) {
            headerCells = width;
            headerLine = lineNumber;
            continue;
        }
        if (width !== headerCells) {
            findings.push(
                `${documentPath}:${lineNumber} has ${width} cell(s) but the table header at ` +
                    `line ${headerLine} declares ${headerCells}. A table renders wrong when its ` +
                    'rows are the wrong shape, and a missing cell shows blank.'
            );
        }
    }
    return findings;
}

/**
 * Every document a doc names must exist.
 *
 * A reference is resolved against the repository root first and then against the
 * citing document's own directory, because a doc inside `docs/` naming
 * `v2.8.0-NOTES.md` means its sibling and not a root-level file. Resolving only
 * from the root reported five phantoms on this tree before that was fixed, and a
 * document check that cries wolf gets skimmed.
 *
 * @param {string} documentPath path used in findings
 * @param {string} text the document
 * @param {(candidate: string) => boolean} exists resolved-path probe
 * @param {Set<string>} owed documents the project intends to have, declared
 * @returns {string[]}
 */
export function checkReferences(documentPath, text, exists, owed = new Set()) {
    const findings = [];
    const directory = documentPath.includes('/')
        ? documentPath.slice(0, documentPath.lastIndexOf('/'))
        : '';

    for (const [index, line] of text.split('\n').entries()) {
        for (const match of line.matchAll(DOCUMENT_REFERENCE)) {
            const named = match[1];
            if (owed.has(named)) continue;
            const siblings = directory ? [`${directory}/${named}`] : [];
            if (!exists(named) && !siblings.some(exists)) {
                findings.push(
                    `${documentPath}:${index + 1} cites \`${named}\`, which does not exist. ` +
                        'A reader sent to a missing document cannot tell whether it was ' +
                        'renamed or never written.'
                );
            }
        }
    }
    return findings;
}

/** An acceptance criterion's id: `AC-14`, optionally struck through. */
const CRITERION_ID = /^(?:~~)?\s*(AC-\d+)\s*(?:~~)?$/;
/** Evidence that restates the build rather than producing a value. */
const BUILD_RESTATEMENT = /^\s*(all\s+)?tests?\s+pass(es)?\s*\.?\s*$/i;

/**
 * Acceptance criteria must be claims a command can settle.
 *
 * Adopted from the agent-scaffold's ACCEPTANCE.md, whose central rule is the one
 * this enforces: *"A criterion whose evidence column is 'tests pass' is not a
 * criterion. It restates the build."*
 *
 * Checked here: the ids do not renumber or develop gaps (a vanished number takes
 * every citation to it with it), no load-bearing cell is blank, and the evidence
 * is a produced value rather than a restatement of the suite.
 *
 * @param {string} documentPath path used in findings
 * @param {string} text the document
 * @returns {string[]}
 */
export function checkAcceptanceCriteria(documentPath, text) {
    const findings = [];
    const lines = text.split('\n');

    let inSection = false;
    let header = null;
    const ids = [];

    for (const [index, line] of lines.entries()) {
        const lineNumber = index + 1;
        const trimmed = line.trim();

        if (trimmed.startsWith('## ')) {
            inSection = /^##\s+Acceptance criteria/i.test(trimmed);
            header = null;
            continue;
        }
        if (!inSection || !trimmed.startsWith('|')) continue;
        if (TABLE_SEPARATOR.test(trimmed)) continue;

        const row = cells(trimmed);
        if (header === null) {
            header = row;
            continue;
        }

        const id = row[0] ?? '';
        if (!CRITERION_ID.test(id)) continue;
        ids.push({ id: id.replace(/[~\s]/g, ''), lineNumber });

        if (row.length !== header.length) continue; // checkTables already reports this

        // #, claim, check, evidence, tier, status
        for (const [cell, label] of [
            [1, 'claim'],
            [2, 'check'],
            [3, 'evidence'],
            [4, 'tier'],
            [5, 'status']
        ]) {
            if (!row[cell]) {
                findings.push(`${documentPath}:${lineNumber} ${id} has no ${label}`);
            }
        }

        const evidence = row[3] ?? '';
        if (BUILD_RESTATEMENT.test(evidence)) {
            findings.push(
                `${documentPath}:${lineNumber} ${id} uses "${evidence.trim()}" as evidence. ` +
                    'That restates the build rather than settling the claim — name what the ' +
                    'check PRODUCES: a count, a hash, a listing, an observation.'
            );
        }
    }

    // Numbering: ids keep their meaning forever, so a gap is a deleted criterion
    // or a renumbered one, and both take every citation with them.
    const numbers = ids
        .map((entry) => Number(entry.id.replace('AC-', '')))
        .filter((n) => Number.isFinite(n));
    if (numbers.length) {
        const low = Math.min(...numbers);
        const high = Math.max(...numbers);
        for (let n = low; n <= high; n += 1) {
            if (!numbers.includes(n)) {
                findings.push(
                    `${documentPath} has no AC-${n}. A superseded criterion is STRUCK THROUGH ` +
                        'and kept, because a number that vanishes takes every citation to it with it'
                );
            }
        }
        const seen = new Set();
        for (const entry of ids) {
            if (seen.has(entry.id)) {
                findings.push(
                    `${documentPath}:${entry.lineNumber} defines ${entry.id} more than once, ` +
                        'which makes every citation of it ambiguous'
                );
            }
            seen.add(entry.id);
        }
    }

    return findings;
}

/**
 * Run both checks over a set of documents.
 *
 * @param {Array<{ path: string, text: string }>} documents
 * @param {(candidate: string) => boolean} exists
 * @param {Set<string>} owed documents the project intends to have, declared
 * @returns {{ findings: string[], tables: number, references: number }}
 */
export function checkDocuments(documents, exists, owed = new Set()) {
    const findings = [];
    let references = 0;

    for (const document of documents) {
        findings.push(...checkTables(document.path, document.text));
        findings.push(...checkReferences(document.path, document.text, exists, owed));
        findings.push(...checkAcceptanceCriteria(document.path, document.text));
        for (const _ of document.text.matchAll(DOCUMENT_REFERENCE)) references += 1;
    }

    return { findings, references, tables: documents.length };
}
