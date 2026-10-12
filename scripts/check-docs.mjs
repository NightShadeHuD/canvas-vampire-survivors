#!/usr/bin/env node
/**
 * @file scripts/check-docs.mjs
 * @description Checks the documents that carry this project's rules for the two
 * ways they have actually broken here.
 *
 * Adopted from the agent-scaffold method (`mechanisms/check_docs.py`):
 *
 *   "The rules live in prose, and prose has structure that can rot silently.
 *    Every check here exists because the structure DID rot."
 *
 * Both checks below found a real defect in this tree the first time they ran:
 * a malformed table row in `BALANCE.md`, and two citations of a document that
 * does not exist. Neither was noticed by a reader, and neither could have been
 * caught by a test.
 *
 * Scoped to tracked files, like every other check here, so a scratch document
 * left in the working tree is not judged.
 */

import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { checkDocuments } from './lib/rule-docs.mjs';
import { refuseEmptyScan } from './lib/gate-input.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');

/**
 * Documents this gate READS, and the ones it deliberately does not.
 *
 * A gate with a filter is a gate with a scope, and an undeclared scope drifts. The glob
 * below matches `*.md` at any depth, so a document in another format -- or a directory
 * nobody thought about -- is silently outside the gate, and the pass line reads the same
 * either way. That is the defect `check:hygiene` had when it printed "275 tracked files
 * checked" while reading 183.
 *
 * Adopted from `agent-scaffold`'s `check_docs`. Its own words: **"a gate with a filter is a
 * gate with a scope, and an undeclared scope drifts."**
 */

/** Every extension this gate reads. A new one is a deliberate edit here. */
const READ_EXTENSIONS = ['.md'];

/**
 * Directories whose documents are NOT this gate's business. Each needs a reason, because
 * an exclusion without one is how a hole becomes policy.
 */
const UNCHECKED_DIRS = [
    ['node_modules/', 'not tracked, and not ours'],
    ['.git/', 'not documents']
];
const documents = execFileSync('git', ['ls-files', '*.md'], { cwd: repoRoot, encoding: 'utf8' })
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.includes('node_modules'))
    .sort();

const emptyScan = refuseEmptyScan(
    documents.length,
    'rule documents',
    'The glob is wrong, the tree moved, or nothing is tracked.'
);
if (emptyScan) {
    console.error(`check-docs: FAILED — ${emptyScan}`);
    process.exit(1);
}

const loaded = documents.map((rel) => ({
    path: rel,
    text: readFileSync(path.join(repoRoot, rel), 'utf8')
}));

// Resolve a named document from the repository root, and separately from the
// citing document's directory — see checkReferences for why both are needed.
const exists = (candidate) => existsSync(path.join(repoRoot, candidate));

/**
 * Documents this project intends to have and does not yet.
 *
 * DECLARED, not inferred. `docs/audio-credits.md` is a deliverable offered to a
 * contributor in `docs/GOOD_FIRST_ISSUES.md`, so a citation of it is a promise
 * rather than a broken link. An entry is removed the moment the document exists,
 * and every other rule then applies to it.
 */
const OWED_DOCUMENTS = new Set(['docs/audio-credits.md']);

const { findings, references } = checkDocuments(loaded, exists, OWED_DOCUMENTS);

if (findings.length) {
    console.error('check-docs: FAILED\n');
    for (const finding of findings) console.error(`  ${finding}`);
    console.error('');
    process.exit(1);
}

// ---------------------------------------------------------------------------
// THE SCOPE CHECK, and it runs even when every document PASSES.
//
// A handful of immaculate documents proves nothing about the ones the glob never reached.
// This finds tracked files that a reader would call a rule document and the scope does not
// read, and refuses each unless it is declared above with a reason.
//
// "Zero found" is not a pass either: a scope check that examined nothing is the same false
// green as an empty scan, so `refuseEmptyScan` guards it the way the documents are guarded.
// ---------------------------------------------------------------------------
const tracked = execFileSync('git', ['ls-files'], { cwd: repoRoot, encoding: 'utf8' })
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

const inScope = (rel) =>
    READ_EXTENSIONS.some((ext) => rel.endsWith(ext)) ||
    UNCHECKED_DIRS.some(([dir]) => rel.startsWith(dir));

// A "rule document" is anything a reader would go looking for rules in: the repo root, or
// `docs/`. Prose that is not in either is a README of a tool, not a rule.
const looksLikeARuleDoc = (rel) =>
    (rel.startsWith('docs/') || !rel.includes('/')) &&
    /\.(md|markdown|mdx|rst|txt|adoc)$/.test(rel);

const outsideScope = tracked.filter((rel) => looksLikeARuleDoc(rel) && !inScope(rel));

if (outsideScope.length > 0) {
    console.error('check-docs: FAILED — document(s) outside the declared scope\n');
    for (const rel of outsideScope) {
        console.error(`  ${rel}`);
        console.error(
            '    This is a rule document by its extension and its location, and the gate\n' +
                '    does not read it. Add its extension to READ_EXTENSIONS, or declare why\n' +
                '    it is out of scope. An undeclared exclusion is how a hole becomes policy.\n'
        );
    }
    process.exit(1);
}

// NUMERATOR AND DENOMINATOR FROM THE SAME SET. The first version took the numerator from
// `git ls-files '*.md'` (any depth) and the denominator from `looksLikeARuleDoc` (root or
// docs/ only), so it printed "read 47 of 46" -- two definitions of "a document" in one
// sentence. A scope line that cannot be read is not a scope line.
const withReadableExtension = tracked.filter((rel) =>
    READ_EXTENSIONS.some((ext) => rel.endsWith(ext))
);
console.log(
    `check-docs: scope — opened ${documents.length} of ${withReadableExtension.length} ` +
        `tracked ${READ_EXTENSIONS.join('/')} file(s); ${outsideScope.length} rule-shaped ` +
        `document(s) outside the scope; ${tracked.length} tracked file(s) examined.`
);

console.log(
    `check-docs: ${loaded.length} document(s); tables well formed, ` +
        `${references} document reference(s) resolve, acceptance criteria are numbered ` +
        'without gaps and carry evidence that is not a restatement of the build.'
);
