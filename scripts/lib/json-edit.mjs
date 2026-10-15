/**
 * @file scripts/lib/json-edit.mjs
 * @description The safe way to bulk-edit a JSON manifest from a script.
 *
 * See `scripts/edit-json.mjs` for the failure this exists to prevent, and
 * `scripts/lib/source-edit.mjs` for the single-text-edit version of the same
 * refusal. The property is one sentence:
 *
 *   **A bulk edit must name how many matches it expects, and refuse any other
 *   number.**
 *
 * WHY THE REFUSAL CANNOT LIVE ANYWHERE ELSE
 *
 * Measured on `gate-selftests.json`: a predicate matching seven entries was used
 * to overwrite all seven `break` strings with one. The entry count was unchanged
 * (33 -> 33), the file stayed valid, and every gate downstream stayed green —
 * because each surviving entry still had a break that worked. **The damage is
 * undetectable after the fact**, so the only place it can be refused is the edit
 * itself. Hence `selectExactly` from `source-edit.mjs`, called before any write.
 *
 * WHAT IT VERIFIES AFTER WRITING
 *
 * It re-reads the file, re-parses it, and requires the result to equal the plan
 * byte for byte — the same check `applyEdit` makes, for the same reason: "I wrote
 * it" is a claim and a read is a check. It also reports how many entries
 * *actually* differed, so an edit that matched a declared number of entries and
 * changed none of them is visible rather than reported as success.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { selectExactly } from './source-edit.mjs';

/**
 * Parse a `field=value` or `field!=value` selector.
 *
 * A tiny grammar rather than a JS expression: `eval`-ing a selection would make
 * the selection itself an unaudited program, and the shape that did the damage
 * was plain equality.
 *
 * @param {string} spec
 * @returns {{ ok: boolean, field?: string, value?: string, negated?: boolean, reason?: string }}
 */
export function parseWhere(spec) {
    const text = String(spec ?? '');
    const negated = text.includes('!=');
    const at = text.indexOf(negated ? '!=' : '=');
    if (at <= 0) {
        return {
            ok: false,
            reason: `--where must be 'field=value' or 'field!=value', got ${JSON.stringify(spec)}`
        };
    }
    const field = text.slice(0, at).trim();
    const value = text.slice(at + (negated ? 2 : 1));
    if (!field) return { ok: false, reason: '--where has no field name before the operator' };
    return { ok: true, field, value, negated };
}

/**
 * Read a manifest and resolve the array a bulk edit will operate on.
 *
 * @param {string} text
 * @param {string|null} list a top-level field naming the array, or null for the root
 * @returns {{ ok: boolean, manifest?: unknown, items?: unknown[], reason?: string }}
 */
export function readManifest(text, list) {
    let manifest;
    try {
        manifest = JSON.parse(text);
    } catch (err) {
        return { ok: false, reason: `the file is not valid JSON: ${err.message}` };
    }
    const items = list === null || list === undefined ? manifest : manifest?.[list];
    if (!Array.isArray(items)) {
        return {
            ok: false,
            reason:
                list === null || list === undefined
                    ? 'the file is not a JSON array. Pass --list <field> to name the array inside it.'
                    : `\`${list}\` is not an array, so there is nothing to edit in bulk`
        };
    }
    return { ok: true, manifest, items };
}

/**
 * Serialize a manifest the way the file it came from was serialized.
 *
 * A bulk edit that reformats 33 untouched entries turns a reviewable one-line
 * change into an unreviewable whole-file diff, which is its own way of hiding
 * what happened. The indentation is read from the file rather than assumed.
 *
 * @param {string} original the file's text before the edit
 * @param {unknown} value the manifest to write
 * @returns {string}
 */
export function serializeLike(original, value) {
    // The FIRST indented line, not the first indented quote: a quote line sits at the
    // nesting depth of whatever it holds, and reading that as the indent unit would
    // re-serialize gate-selftests.json at eight spaces and turn a one-entry change
    // into a whole-file diff.
    const indent = /^([ \t]+)\S/m.exec(original)?.[1].length || 4;
    const trailing = original.endsWith('\n') ? '\n' : '';
    return JSON.stringify(value, null, indent) + trailing;
}

/**
 * Plan a bulk edit: select, refuse, apply to a copy, report what differed.
 *
 * Pure — it takes the parsed manifest and returns the new one, so every refusal
 * is testable without a filesystem and the caller can dry-run.
 *
 * @param {object} input
 * @param {unknown} input.manifest the whole manifest
 * @param {unknown[]} input.items the array being edited
 * @param {string|null} input.list the field the array lives under, or null
 * @param {{field: string, value: unknown}} input.edit
 * @param {{all?: boolean, field?: string, value?: string, negated?: boolean}} input.selector
 * @param {number} input.expected how many matches are acceptable
 * @returns {{ ok: boolean, result?: unknown, matched?: number, differed?: number, total?: number, reason?: string }}
 */
export function planJsonEdit({ manifest, items, list, edit, selector, expected }) {
    const where = selector.all
        ? () => true
        : (item) => {
              const held = item?.[selector.field];
              const hit = String(held) === selector.value;
              return selector.negated ? !hit : hit;
          };

    const selection = selectExactly(items, where, expected, 'entries');
    if (!selection.ok) return { ok: false, reason: selection.reason };

    // A copy, so a refused edit cannot have touched anything and a dry run and a
    // real run plan identically.
    const next = structuredClone(manifest);
    const nextItems = list === null || list === undefined ? next : next[list];

    let differed = 0;
    for (const index of selection.matched) {
        const before = JSON.stringify(nextItems[index]);
        nextItems[index] = { ...nextItems[index], [edit.field]: edit.value };
        if (JSON.stringify(nextItems[index]) !== before) differed += 1;
    }

    if (differed === 0) {
        return {
            ok: false,
            matched: selection.matched.length,
            reason:
                `the edit would change nothing: all ${selection.matched.length} selected ` +
                `entr(ies) already hold \`${edit.field}\` = ${JSON.stringify(edit.value)}. ` +
                'A bulk edit that reports success having changed nothing is the same false ' +
                'green as one that changed seven entries instead of one.'
        };
    }

    return {
        ok: true,
        result: next,
        matched: selection.matched.length,
        differed,
        total: items.length
    };
}

/**
 * Apply a bulk edit, verifying its own work.
 *
 * @param {object} input
 * @param {string} input.path
 * @param {{all?: boolean, field?: string, value?: string, negated?: boolean}} input.selector
 * @param {number} input.expected
 * @param {{field: string, value: unknown}} input.edit
 * @param {string|null} [input.list]
 * @param {boolean} [input.dryRun]
 * @param {(p: string) => string} [input.read]
 * @param {(p: string, s: string) => void} [input.write]
 * @returns {{ ok: boolean, matched?: number, differed?: number, total?: number, wrote?: boolean, reason?: string }}
 */
export function applyJsonEdit({
    path,
    selector,
    expected,
    edit,
    list = null,
    dryRun = false,
    read,
    write
}) {
    // Injected, as in `applyEdit`, so the verification path is testable without
    // a real failure.
    const readFile = read ?? ((p) => readFileSync(p, 'utf8'));
    const writeFile = write ?? ((p, s) => writeFileSync(p, s));

    let before;
    try {
        before = readFile(path);
    } catch (err) {
        return { ok: false, wrote: false, reason: `could not read ${path}: ${err.message}` };
    }

    const parsed = readManifest(before, list);
    if (!parsed.ok) return { ok: false, wrote: false, reason: parsed.reason };

    const plan = planJsonEdit({
        manifest: parsed.manifest,
        items: parsed.items,
        list,
        edit,
        selector,
        expected
    });
    if (!plan.ok) return { ok: false, wrote: false, matched: plan.matched, reason: plan.reason };

    const planned = serializeLike(before, plan.result);
    if (dryRun) {
        return {
            ok: true,
            wrote: false,
            matched: plan.matched,
            differed: plan.differed,
            total: plan.total
        };
    }

    writeFile(path, planned);

    // The point, as in `applyEdit`: a write that "succeeded" is a claim, and a
    // read is a check.
    let after;
    try {
        after = readFile(path);
    } catch (err) {
        return {
            ok: false,
            wrote: true,
            reason: `wrote ${path} but could not read it back: ${err.message}`
        };
    }
    if (after !== planned) {
        return {
            ok: false,
            wrote: true,
            reason:
                `wrote ${path} but reading it back produced different content. The write did ` +
                'not take, or something else changed the file.'
        };
    }

    // THREE CHECKS STOOD HERE, AND NONE OF THEM COULD EVER FIRE. They re-verified
    // after the write that the manifest still parsed, still held the same number of
    // entries, and had changed exactly as many as the plan declared — and the
    // read-back equality check above already settles all three, because `planned` IS
    // the plan serialized: a file equal to it parses by construction, keeps the count
    // by construction, and changed what the plan changed by construction. A mocked
    // write that clobbers an unselected entry is caught by the equality check, which
    // is the test that watches this path fail.
    //
    // Found by `check:coverage-floor` asking which branches had never been taken —
    // the one question that makes dead defensive code visible.

    return {
        ok: true,
        wrote: true,
        matched: plan.matched,
        differed: plan.differed,
        total: plan.total
    };
}
