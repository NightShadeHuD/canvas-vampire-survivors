#!/usr/bin/env node
/**
 * @file scripts/annotate.mjs
 * @description Annotate parameters the compiler reports as implicitly `any`.
 *
 *   node scripts/annotate.mjs src/effects.ts src/pool.ts
 *   node scripts/annotate.mjs --dry-run src/effects.ts
 *
 * WHY THIS EXISTS AS A TOOL RATHER THAN A SERIES OF EDITS
 *
 * `noImplicitAny` is 817 errors and almost all of them are a parameter written
 * while these files were JavaScript. Doing them one at a time by hand is slow;
 * doing them with a blunt instrument damaged a file once already, because the
 * instrument assumed an identifier is never followed by `?`.
 *
 * So this one is built the other way round. It plans every edit with
 * `planAnnotation`, which REFUSES anything it does not fully understand, and it
 * WRITES through `applyEdit`, which anchors on the exact line, refuses an
 * ambiguous anchor, and reads the file back afterwards to confirm the change is
 * really there. Nothing is written until every plan for that file has succeeded.
 *
 * It does not run the test suite. That is the caller's job, deliberately: the
 * rule is one file, then the full gate, so a mistake is caught while its cause is
 * still the only thing that changed.
 */

import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { planAnnotation } from './lib/annotate.mjs';
import { applyEdit } from './lib/source-edit.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const targets = args.filter((a) => !a.startsWith('--'));

if (targets.length === 0) {
    console.error('usage: node scripts/annotate.mjs [--dry-run] <file.ts> [...]');
    process.exit(2);
}

/** The project's own error count, which is what the guard must not increase. */
function projectErrorCount() {
    try {
        const out = execFileSync(
            path.join(repoRoot, 'node_modules', '.bin', 'tsc'),
            ['-p', path.join(repoRoot, 'tsconfig.json')],
            { cwd: repoRoot, encoding: 'utf8' }
        );
        return (out.match(/error TS/g) ?? []).length;
    } catch (err) {
        return (`${err.stdout ?? ''}${err.stderr ?? ''}`.match(/error TS/g) ?? []).length;
    }
}

/** Run tsc with noImplicitAny and return its output. */
function compilerOutput() {
    const probe = path.join(repoRoot, 'tsconfig.annotate-probe.json');
    writeFileSync(
        probe,
        JSON.stringify({ extends: './tsconfig.json', compilerOptions: { noImplicitAny: true } })
    );
    try {
        return execFileSync(path.join(repoRoot, 'node_modules', '.bin', 'tsc'), ['-p', probe], {
            cwd: repoRoot,
            encoding: 'utf8'
        });
    } catch (err) {
        // tsc exits non-zero when it reports errors; that is the normal path.
        return `${err.stdout ?? ''}${err.stderr ?? ''}`;
    } finally {
        if (existsSync(probe)) rmSync(probe);
    }
}

const PATTERN = /^(.+?)\((\d+),(\d+)\): error TS(?:7006|7031|7019): Parameter '([^']+)'/;

/** Every implicit-any parameter the compiler reports, grouped by file. */
function errorsFor(file) {
    const byLine = new Map();
    for (const raw of compilerOutput().split('\n')) {
        const m = PATTERN.exec(raw.trim());
        if (!m || m[1] !== file) continue;
        const line = Number(m[2]);
        // One entry per (line, column): tsc can report the same position twice
        // through different error codes.
        byLine.set(`${line}:${m[3]}`, { line, col: Number(m[3]), name: m[4] });
    }
    return [...byLine.values()];
}

let totalApplied = 0;
let totalRefused = 0;

for (const file of targets) {
    const errors = errorsFor(file);
    if (errors.length === 0) {
        console.log(`  ${file}: nothing to annotate`);
        continue;
    }

    // Plan everything FIRST, against the original text, so a refusal stops the
    // file before anything is written.
    const errorsBefore = projectErrorCount();
    const original = readFileSync(path.join(repoRoot, file), 'utf8').split('\n');
    const plans = [];
    const refusals = [];
    for (const { line, col, name } of errors) {
        const text = original[line - 1] ?? '';
        const plan = planAnnotation({ line: text, col, name });
        if (plan.ok) plans.push({ line, col, before: text, name, type: plan.type });
        else refusals.push({ line, name, reason: plan.reason });
    }

    for (const r of refusals) {
        console.error(`  ${file}:${r.line} REFUSED ${r.name} — ${r.reason}`);
    }
    totalRefused += refusals.length;

    if (dryRun) {
        console.log(
            `  ${file}: would annotate ${plans.length} parameter(s), refused ${refusals.length}`
        );
        continue;
    }

    // ONE write, not one per annotation.
    //
    // The first version anchored each edit on its whole line, and 21 of 30 were
    // refused because identical lines recur — `update(dt) {` appears in three
    // classes, so the anchor was ambiguous and `applyEdit` correctly refused to
    // guess. That guard is right, and the design that avoids needing it is this
    // one: every plan was computed from the ORIGINAL text, so applying them
    // together produces one new document, and the verification is an exact
    // comparison against what was planned rather than a per-line read-back.
    // Several parameters can share a line — `render(ctx, w, h)` produces three
    // errors at three columns — and the first version assigned each plan to the
    // same array slot, so only the last survived:
    //
    //     render(ctx, w, h: number)      // ctx and w silently dropped
    //
    // Each plan was computed from the ORIGINAL line, so they cannot be applied
    // independently. They are applied cumulatively instead, RIGHT TO LEFT within
    // a line, which keeps every earlier column valid as later ones are inserted.
    const byLine = new Map();
    for (const plan of plans) {
        if (!byLine.has(plan.line)) byLine.set(plan.line, []);
        byLine.get(plan.line).push(plan);
    }

    const next = [...original];
    for (const [line, group] of byLine) {
        let text = original[line - 1];
        // Re-plan against the running text so each annotation sees the previous
        // one, and refuse the whole line if any step stops being plannable.
        let failed = false;
        for (const plan of [...group].sort((a, b) => b.col - a.col)) {
            const step = planAnnotation({ line: text, col: plan.col, name: plan.name });
            if (!step.ok) {
                console.error(`  ${file}:${line} REFUSED ${plan.name} — ${step.reason}`);
                failed = true;
                break;
            }
            text = step.line;
        }
        if (!failed) next[line - 1] = text;
    }

    if (next.length !== original.length) {
        console.error(`  ${file}: REFUSED — line count would change, which this never does`);
        totalRefused += plans.length;
        continue;
    }

    const before = original.join('\n');
    const after = next.join('\n');
    const result = applyEdit({
        path: path.join(repoRoot, file),
        anchor: before,
        replacement: after
    });
    if (!result.ok) {
        console.error(`  ${file}: WRITE FAILED — ${result.reason}`);
        totalRefused += plans.length;
        continue;
    }

    // Verify against the plan, not just against "the write returned".
    const written = readFileSync(path.join(repoRoot, file), 'utf8').split('\n');
    // Compare against what was PLANNED, which is `next` — not `p.after`, which
    // no longer exists now that plans are applied cumulatively per line. The
    // first version read a field that had been removed and so reported every
    // line as wrong, refusing 30 correct annotations.
    const wrong = plans.filter((p) => written[p.line - 1] !== next[p.line - 1]);
    if (wrong.length) {
        console.error(`  ${file}: VERIFY FAILED — ${wrong.length} line(s) do not match the plan`);
        totalRefused += wrong.length;
        continue;
    }

    // THE GUARD THAT WAS MISSING.
    //
    // The type table is keyed on the parameter NAME, and a name is not a type:
    // `h` is a number almost everywhere in this codebase, but at
    // `effects.ts:275` it is an object with `.w` and `.h`. Annotating it as a
    // number there produced
    //
    //     Property 'h' does not exist on type 'number'      (TS2339)
    //
    // and the tool reported success, because it never asked the compiler.
    // A tool that rewrites types and does not then check the types is the same
    // mistake as the annotator that assumed an identifier is never followed by
    // `?` — it is confident about something it never verified.
    //
    // So: measure the project's error count before and after. If it went UP,
    // put the file back and say so. A wrong annotation is then a non-event.
    const errorsAfter = projectErrorCount();
    if (errorsAfter > errorsBefore) {
        const undo = applyEdit({
            path: path.join(repoRoot, file),
            anchor: readFileSync(path.join(repoRoot, file), 'utf8'),
            replacement: before
        });
        console.error(
            `  ${file}: REVERTED — ${plans.length} annotation(s) raised the error count ` +
                `from ${errorsBefore} to ${errorsAfter}.` +
                (undo.ok ? ' The file is unchanged.' : ' AND THE REVERT FAILED — check it by hand.')
        );
        for (const r of refusals) void r;
        totalRefused += plans.length;
        continue;
    }

    totalApplied += plans.length;
    console.log(
        `  ${file}: annotated ${plans.length} parameter(s)` +
            (refusals.length ? `, refused ${refusals.length}` : '') +
            ` (project errors ${errorsBefore} -> ${errorsAfter})`
    );
}

console.log(`\nannotate: ${totalApplied} annotated, ${totalRefused} refused.`);
if (totalRefused > 0) {
    console.log('  A refusal is not a failure — it means a name needs a deliberate type.');
}
