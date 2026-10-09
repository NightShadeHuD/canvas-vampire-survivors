/**
 * @file scripts/lib/shortcut-register.mjs
 * @description Checks a shortcut register: well-formed rows, no gaps, no
 * dangling citations.
 *
 * Adopted from the agent-scaffold method (`mechanisms/check_register.py`).
 *
 * The mandate already says a shortcut is legitimate only when it is
 * **declared, bounded and tracked**. What did not exist here was anywhere to
 * declare one, or anything to check the declaration. Measured before this file:
 * `declaredGaps` was an empty array with no field for a ceiling or a trigger,
 * `suppressionCeilings` held eight numeric ceilings and **not one revisit
 * trigger**, and there was no register document at all — so the real shortcuts
 * this repository carries lived in prose that nothing reads.
 *
 * A register is only worth what its weakest row is worth. Three failures are
 * possible, and all three have happened in the project this came from:
 *
 *   1. **A row loses a column.** The table still renders, the missing cell shows
 *      blank, and a blank ceiling reads exactly like an unreviewed row.
 *   2. **The numbering develops a gap.** A row deleted to tidy up cannot be told
 *      from a row moved elsewhere, and every citation to it becomes a dead end.
 *   3. **A citation points at a row that does not exist.** Worse than a
 *      malformed row: a malformed row still shows its content, while a dangling
 *      citation promises a ceiling and a trigger that are not there.
 */

/** A row's number, plain or struck through. Both are a definition. */
const ROW = /^\|\s*(?:~~)?(\d+)(?:~~)?\s*\|/;
/** A citation: "row 4", "rows 2-5" (hyphen or en dash). */
const CITATION = /\brows?\s+(\d+)(?:\s*[-–—]\s*(\d+))?/g;

/** The register's columns: #, Area, Location, Ceiling accepted, Revisit trigger, Status. */
export const REGISTER_COLUMNS = 6;

/** Split a markdown table row into trimmed cells. */
function splitRow(line) {
    return line
        .trim()
        .replace(/^\||\|$/g, '')
        .split('|')
        .map((cell) => cell.trim());
}

/**
 * Numbered rows inside the `## Register` section, and nowhere else.
 *
 * Scoped to the section, and it has to be: the review table further down is a
 * different shape whose first cell is also a number, so a file-wide scan reads
 * its rows as malformed register rows and reports defects that are not there.
 *
 * @param {string} text the register document
 * @returns {Array<{ line: number, cells: string[] }>}
 */
export function registerRows(text) {
    const rows = [];
    let inRegister = false;
    for (const [index, line] of text.split('\n').entries()) {
        if (line.startsWith('## ')) {
            if (inRegister) break;
            inRegister = line.startsWith('## Register');
            continue;
        }
        if (!inRegister || !line.startsWith('|')) continue;
        if (ROW.test(line)) {
            const cells = splitRow(line);
            // A struck-through row carries its strike INSIDE the first cell
            // (`| ~~1~~ |`), so the number has to be unwrapped before it can be
            // compared. The scaffold's own parser tests `cells[0].isdigit()` on
            // the raw cell, which `~~1~~` fails — so its documented "keep a
            // discharged row" format would be read as a numbering gap. This
            // unwraps it instead, which is what the format means.
            cells[0] = cells[0].replace(/^~~|~~$/g, '').trim();
            rows.push({ line: index + 1, cells });
        }
    }
    return rows;
}

/**
 * Check a register and the documents that cite it.
 *
 * @param {object} input
 * @param {string} input.registerPath path shown in findings
 * @param {string} input.registerText the register's contents
 * @param {Array<{ path: string, text: string }>} input.citing documents whose
 *   "row N" citations must resolve
 * @returns {{ findings: string[], rowCount: number }}
 */
export function checkRegister({ registerPath, registerText, citing = [] }) {
    const rows = registerRows(registerText);
    const findings = [];

    if (!rows.length) {
        findings.push(
            `${registerPath} has a Register section with no numbered rows. An empty ` +
                'register reads as "no shortcuts", which is a claim, not a blank.'
        );
        return { findings, rowCount: 0 };
    }

    const defined = new Set();

    // 1. Every row declares every column, and no load-bearing cell is blank.
    for (const { line, cells } of rows) {
        defined.add(Number(cells[0]));
        if (cells.length !== REGISTER_COLUMNS) {
            findings.push(
                `${registerPath}:${line} row ${cells[0]} has ${cells.length} cell(s) but the ` +
                    `header declares ${REGISTER_COLUMNS} — a missing cell renders blank, and a ` +
                    'blank ceiling reads as an unreviewed row'
            );
            continue;
        }
        for (const [index, label] of [
            [3, 'ceiling accepted'],
            [4, 'revisit trigger'],
            [5, 'status']
        ]) {
            if (!cells[index]) {
                findings.push(`${registerPath}:${line} row ${cells[0]} has no ${label}`);
            }
        }
    }

    // 2. No gap in the numbering.
    const numbers = [...defined].sort((a, b) => a - b);
    for (let n = numbers[0]; n <= numbers[numbers.length - 1]; n += 1) {
        if (!defined.has(n)) {
            findings.push(
                `${registerPath} has no row ${n}. A discharged row is STRUCK THROUGH and kept ` +
                    `(\`| ~~${n}~~ |\`), because a number that vanishes cannot be told from a row ` +
                    'deleted to tidy up'
            );
        }
    }

    // 3. Every cited row exists.
    for (const document of citing) {
        for (const [index, line] of document.text.split('\n').entries()) {
            for (const match of line.matchAll(CITATION)) {
                const low = Number(match[1]);
                const high = match[2] ? Number(match[2]) : low;
                for (let cited = low; cited <= high; cited += 1) {
                    if (!defined.has(cited)) {
                        findings.push(
                            `${document.path}:${index + 1} cites row ${cited}, which the register ` +
                                'does not define — a citation to a row that does not exist ' +
                                'promises a ceiling and a trigger that are not there'
                        );
                    }
                }
            }
        }
    }

    return { findings, rowCount: rows.length };
}
