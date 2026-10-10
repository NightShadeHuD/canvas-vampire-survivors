#!/usr/bin/env node
/**
 * @file scripts/lib/godot-data.mjs
 * @description Turn a JavaScript value into GDScript source. Pure: no I/O, no writes.
 *
 * Kept here rather than in `scripts/export-godot.mjs` because the coverage gate
 * tracks `src/` and `scripts/lib/` only -- the same split `port-hazards.mjs` and
 * `strict-flags.mjs` already follow.
 *
 * WHY A GENERATOR RATHER THAN A HAND PORT
 *
 * `docs/GODOT-PORT-RESEARCH.md` established that this port is a TRANSFORM, not a
 * rewrite. The data layer is the part of that transform which is purely mechanical:
 * eleven weapons, eleven enemies, thirteen passives, five bosses, twenty-one
 * achievements, and the tables that key them. Hand-copying 850 lines of literals
 * would produce a second source of truth that drifts the first time a weapon's
 * damage is tuned.
 *
 * This imports the ACTUAL `src/data.ts` -- Node runs it directly, no build step --
 * and writes GDScript. Tune a weapon in TypeScript and re-run this; the two cannot
 * disagree.
 *
 * WHAT IT REFUSES TO CONVERT, AND WHY THAT IS THE POINT
 *
 * Not everything in `data.ts` is data. An achievement carries
 * `check: (c) => c.game.kills >= 100` -- behaviour, not a literal -- and GDScript
 * cannot hold a lambda in a Dictionary any more than JSON can.
 *
 * The tempting move is to skip those quietly. Instead every one is COUNTED and
 * REPORTED, because that report is the port's actual worklist: it says exactly
 * which achievements still need a hand-written `func`. A generator that silently
 * dropped them would look finished and be hollow.
 *
 * @module scripts/lib/godot-data
 */

/** Godot identifiers: letters, digits and underscores, not starting with a digit. */
const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Convert one JavaScript value into a GDScript literal.
 *
 * @param {unknown} value
 * @param {string} at - Dotted path, for the report.
 * @param {{skipped: Array<{at: string, why: string}>}} report
 * @returns {string} A GDScript expression.
 */
export function toGd(value, at, report) {
    if (value === null) return 'null';
    // `undefined` does not exist in GDScript, and neither does it survive JSON.
    // It becomes `null` -- the ONE semantic difference this whole port turns on,
    // and the reason `strictNullChecks` was finished in `src/` first.
    if (value === undefined) return 'null';

    const t = typeof value;
    if (t === 'number') {
        if (!Number.isFinite(value)) {
            report.skipped.push({ at, why: `${String(value)} has no GDScript literal` });
            return 'null';
        }
        return Number.isInteger(value) ? String(value) : String(value);
    }
    if (t === 'boolean') return value ? 'true' : 'false';
    if (t === 'string') return JSON.stringify(value);

    if (t === 'function') {
        // The worklist entry that matters most.
        report.skipped.push({ at, why: 'a function -- needs a hand-written `func`' });
        return 'null';
    }

    if (Array.isArray(value)) {
        return `[${value.map((v, i) => toGd(v, `${at}[${i}]`, report)).join(', ')}]`;
    }

    if (t === 'object') {
        const parts = [];
        for (const [k, v] of Object.entries(value)) {
            parts.push(`${JSON.stringify(k)}: ${toGd(v, at ? `${at}.${k}` : k, report)}`);
        }
        return `{${parts.join(', ')}}`;
    }

    report.skipped.push({ at, why: `unsupported type \`${t}\`` });
    return 'null';
}

/**
 * A GDScript file holding one exported table.
 *
 * @param {string} constName
 * @param {unknown} value
 * @param {string} source - The TypeScript file this came from.
 * @param {{skipped: Array<{at: string, why: string}>}} report
 */
export function gdFile(constName, value, source, report) {
    if (!IDENT.test(constName)) throw new Error(`not a GDScript identifier: ${constName}`);
    return `# GENERATED FILE -- DO NOT EDIT BY HAND.
#
# Source of truth: ${source}
# Regenerate with:  npm run export:godot
#
# Editing this file directly creates a second source of truth, and the first time a
# weapon's damage is tuned in TypeScript the two will disagree with nothing to say so.
extends RefCounted
class_name ${constName.charAt(0) + constName.slice(1).toLowerCase().replace(/_/g, '')}

const ${constName} := ${toGd(value, constName, report)}
`;
}
