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

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');

/** Tracked Markdown documents, excluding the register's own review table. */
const documents = execFileSync('git', ['ls-files', '*.md'], { cwd: repoRoot, encoding: 'utf8' })
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.includes('node_modules'))
    .sort();

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

console.log(
    `check-docs: ${loaded.length} document(s), tables well formed, ` +
        `${references} document reference(s) resolve.`
);
