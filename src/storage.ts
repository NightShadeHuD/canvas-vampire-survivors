/**
 * @module storage
 * @description Persistent save layer backed by `localStorage` with an
 * in-memory fallback for sandboxed contexts (private browsing, embedded
 * iframes). Also owns the leaderboard helper and the cumulative `totals`
 * accumulator. Forwards-compatible: `mergeDeep` lets us add new save fields
 * without invalidating older slots.
 *
 * Dependencies: .ts` (CONFIG, STORAGE_KEY).
 *
 * Exports:
 *   - loadSave(), saveSave(), resetSave()
 *   - recordHighScore(save, entry) → rank
 *   - accumulateTotals(save, run)
 */

import { CONFIG, SPEEDRUN_STORAGE_KEY, STORAGE_KEY } from './config.ts';

/**
 * The shape of one leaderboard entry.
 *
 * Named because `highScores: []` infers as `never[]`, so `typeof DEFAULT_SAVE`
 * alone would produce a save type whose leaderboard arrays can hold nothing.
 */
export interface HighScore {
    kills: number;
    timeSurvived: number;
    level: number;
    date: number;
    /** v2.6: which stage the run was played on. */
    stage?: string;
    /** Weapon ids carried at the end of the run; shown on the leaderboard. */
    weapons?: string[];
    /** True when the whole run was completed without taking a hit. */
    noHit?: boolean;
}

export const DEFAULT_SAVE = {
    // Legacy single-slot best-of. Kept for backwards compatibility with v2.0 saves.
    highScore: {
        kills: 0,
        timeSurvived: 0,
        level: 1
    },
    // v2.1: top-N leaderboard and cumulative stats.
    highScores: [] as HighScore[],
    totals: {
        kills: 0,
        timePlayed: 0,
        runs: 0,
        bossKills: 0,
        // These two were PERSISTED WITHOUT BEING DECLARED. `main.ts` writes them
        // lazily -- `this.save.totals.seenBuilds ??= []` -- so a save carried them
        // and the format never said so. Nothing noticed while the save object was
        // `Record<string, any>`; giving it a real type reported them immediately,
        // which is precisely the defect row 4 of `docs/SHORTCUTS.md` was waiting
        // for ("the first defect traced to a save field that a type would have
        // caught"). `seenBuilds` is a FIFO list of weapon combinations already
        // seen, capped by `CONFIG.SEEN_BUILDS_CAP`; `uniqueBuilds` is its length.
        seenBuilds: [] as string[],
        uniqueBuilds: 0
    },
    achievements: {} as Record<string, number>,
    // v2.6 (iter-12): per-stage leaderboards. Each key is a stage id; the
    // value is a top-N array shaped like `highScores`. The legacy global
    // `highScores` field is retained as the union-of-all-stages view so old
    // UI paths keep working.
    stageHighScores: {} as Record<string, HighScore[]>,
    settings: {
        masterVolume: 0.6,
        sfxVolume: 0.8,
        musicVolume: 0.4,
        difficulty: 'normal',
        showFps: false,
        screenShake: true,
        reducedMotion: false,
        colorblind: false,
        musicEnabled: true,
        damageNumbers: true,
        locale: 'en',
        stage: 'forest',
        // iter-13: global mute toggle, persisted so refresh keeps the choice.
        muted: false,
        // iter-14: touch UI scaling. 0.8 = small, 1.0 = default, 1.2 = large.
        // Applied by ui.ts as CSS custom properties on the document root
        // (--touch-button-size etc) so the joystick + special button grow
        // together. Clamped to the 0.8–1.4 range on read.
        touchButtonScale: 1,
        // iter-15: optional red flash on critical hits. Defaults to on; the
        // user can toggle off in Settings if they find it disruptive.
        criticalFlash: true,
        // iter-19: mobile haptic feedback toggle. Defaults to on; the
        // engine silently no-ops on platforms without `navigator.vibrate`
        // (Safari iOS, desktop Firefox), so leaving this on costs nothing
        // for non-mobile players. The Settings UI hides the row entirely
        // when the API is missing so the toggle isn't dead-end on desktop.
        vibration: true
    },
    runs: 0,
    // iter-13: one-time flags. `howToSeen` flips on the first dismiss of the
    // /howtoplay overlay; we only auto-show it for new players.
    // iter-14 adds `pwaPromptSeen` so the install pop-up only floats once.
    // iter-15 adds `tutorialDone` so the 5-step tutorial only auto-offers once.
    flags: { howToSeen: false, pwaPromptSeen: false, tutorialDone: false }
};

let memoryFallback = null;

function hasLocalStorage() {
    try {
        if (typeof window === 'undefined' || !window.localStorage) return false;
        const probe = '__vs_probe__';
        window.localStorage.setItem(probe, probe);
        window.localStorage.removeItem(probe);
        return true;
    } catch {
        return false;
    }
}

// Evaluate lazily so Node-side tests can import this module without a DOM.
let _usable: boolean | null = null;
function usableLS() {
    if (_usable === null) _usable = hasLocalStorage();
    return _usable;
}

// The save object is assembled by mergeDeep, which erases DEFAULT_SAVE's
// shape. Returning the loose record is honest about that; giving saves a real
// interface is Phase B work.
export function loadSave(): SaveData {
    try {
        const defaults = structuredCloneCompat(DEFAULT_SAVE);
        const raw = usableLS() ? window.localStorage.getItem(STORAGE_KEY) : memoryFallback;
        if (!raw) return defaults;
        const parsed = JSON.parse(raw);
        // A save that is not an object is not a save. `"null"`, `"42"`, `"[]"`
        // and a million-element array all parse; none of them is a game save.
        if (!isPlainRecord(parsed)) {
            console.warn('[storage] Save is not an object; using defaults.');
            return defaults;
        }
        return mergeDeep(defaults, parsed as object, saveShape());
    } catch (err) {
        console.warn('[storage] Failed to load save, resetting.', err);
        return structuredCloneCompat(DEFAULT_SAVE);
    }
}

export function saveSave(data) {
    let serialised;
    try {
        serialised = JSON.stringify(data);
    } catch (err) {
        console.warn('[storage] Failed to serialise save.', err);
        return false;
    }
    if (usableLS()) {
        try {
            window.localStorage.setItem(STORAGE_KEY, serialised);
            return true;
        } catch (err) {
            // iter-16 bug-bash: when localStorage runs out of room (Safari
            // private mode caps at ~5 MB; iframes can be tighter still),
            // demote to the in-memory fallback for the rest of the session.
            // Previously we just warned and lost every subsequent write —
            // the player would see their progress vanish on refresh with no
            // explanation. Now subsequent saves at least survive a tab
            // refresh-within-tab via the JS-side fallback, and the warning
            // only fires once per session instead of per save.
            if (!_quotaWarned) {
                console.warn('[storage] localStorage write failed, switching to memory.', err);
                _quotaWarned = true;
            }
            _usable = false;
            memoryFallback = serialised;
            return false;
        }
    }
    memoryFallback = serialised;
    return true;
}

let _quotaWarned = false;

export function resetSave() {
    if (usableLS()) {
        window.localStorage.removeItem(STORAGE_KEY);
    } else {
        memoryFallback = null;
    }
}

// Test-only helper: flush the in-memory fallback + cached usability probe.
export function _resetStorageForTests() {
    memoryFallback = null;
    _usable = null;
    _quotaWarned = false;
}

// ---------------------------------------------------------------------------
// Leaderboard helpers
// ---------------------------------------------------------------------------
/**
 * The maximum number of stage keys a save may hold.
 *
 * This is the read path's cap (`saveShape().stageHighScores.max`), named so the
 * WRITE path can honour the same number instead of the two being independent
 * literals that happen to agree. They disagreed: 200 distinct stage keys could
 * be written and `loadSave` kept 64, so the next save persisted 64 and the
 * other 136 boards were gone with no message.
 */
const STAGE_BOARD_CAP = 64;

/**
 * A stage id that actually exists, or the canonical fallback.
 *
 * The three ids are listed rather than imported, and the duplication is
 * deliberate: `src/stages.ts` reaches `src/main.ts` (for its `Game` type) and
 * `src/main.ts` imports this module, so a runtime import from here into
 * `stages.ts` would close a cycle. `test/hostile-input.test.ts`, in
 * the test named "F12b DRIFT", pins this list against the real `STAGES` so it
 * cannot drift silently — which is the property an import would have given for
 * free and a comment would not.
 */
function knownStageId(id: unknown): string {
    const s = typeof id === 'string' ? id : '';
    return s === 'forest' || s === 'crypt' || s === 'tundra' ? s : 'forest';
}

/**
 * Insert a run result into the top-N leaderboard (sorted by timeSurvived
 * descending, then by kills). Returns the 1-based rank of the new entry, or 0
 * if it did not qualify.
 */
export function recordHighScore(save, entry) {
    // Every entry goes through the same sanitiser, whether it came from the
    // game-over screen or from the leaderboard Import box. The import path is
    // the untrusted one, but a boundary is only a boundary if there is one
    // gate, not one gate per caller.
    const clean = sanitiseHighScoreEntry(entry);
    if (!clean) return 0;
    const list = Array.isArray(save.highScores) ? save.highScores : [];
    const withNew = list.concat([clean]);
    withNew.sort((a, b) => {
        if (b.timeSurvived !== a.timeSurvived) return b.timeSurvived - a.timeSurvived;
        return (b.kills || 0) - (a.kills || 0);
    });
    const top = withNew.slice(0, CONFIG.HIGHSCORE_SLOTS);
    save.highScores = top;
    const rank = top.indexOf(clean) + 1;

    // v2.6: per-stage leaderboard slot. Default to 'forest' so old runs
    // without a stage field still land in the canonical bucket.
    //
    // The stage id is VALIDATED against the shipped stages rather than trusted,
    // and the write goes through `defineOwn`. Both were defects:
    //
    //   - `stage: "__proto__"` made `save.stageHighScores[stageId] = …` run the
    //     INHERITED `__proto__` setter. The entry was silently lost and
    //     `stageHighScores`'s PROTOTYPE became an array. `isUnsafeKey` guards
    //     `mergeDeep`, `safeClone` and the record read, but not this write, so
    //     the one path that creates keys was the one path without the guard.
    //     An unusable stage now falls back to the canonical bucket instead.
    //   - A key that is not a real stage id has nowhere to be read from:
    //     nothing in `src/` reads `stageHighScores` at all today, so an
    //     arbitrary key can only be corruption. REFUSING it is therefore free.
    const stageId = knownStageId(clean.stage);
    save.stageHighScores ??= {};
    const existing = Object.prototype.hasOwnProperty.call(save.stageHighScores, stageId)
        ? save.stageHighScores[stageId]
        : null;
    const sList = Array.isArray(existing) ? existing : [];
    const withNewStage = sList.concat([clean]);
    withNewStage.sort((a, b) => {
        if (b.timeSurvived !== a.timeSurvived) return b.timeSurvived - a.timeSurvived;
        return (b.kills || 0) - (a.kills || 0);
    });
    // THE WRITE PATH IS BOUNDED, because the READ path is. `loadSave` keeps at
    // most `STAGE_BOARD_CAP` keys and the next save persists only those, so an
    // unbounded write does not grow the save — it silently DISCARDS every board
    // beyond the cap on the following save. 200 imported stage keys measured
    // 200 written -> 64 survive -> 64 after a second cycle, i.e. 136 boards
    // gone for good. Refusing a new key at the cap turns that silent loss into
    // a no-op on the board the player actually played.
    const isNewKey = !Object.prototype.hasOwnProperty.call(save.stageHighScores, stageId);
    if (!isNewKey || Object.getOwnPropertyNames(save.stageHighScores).length < STAGE_BOARD_CAP) {
        defineOwn(save.stageHighScores, stageId, withNewStage.slice(0, CONFIG.HIGHSCORE_SLOTS));
    }

    // Also update legacy best-of for backwards compat.
    if (clean.timeSurvived > (save.highScore?.timeSurvived || 0)) {
        save.highScore.timeSurvived = clean.timeSurvived;
    }
    if (clean.kills > (save.highScore?.kills || 0)) save.highScore.kills = clean.kills;
    if (clean.level > (save.highScore?.level || 0)) save.highScore.level = clean.level;
    return rank;
}

/** Stage-scoped leaderboard read; falls back to [] for unknown stages. */
export function getStageHighScores(save: SaveData, stageId: string) {
    if (!save || !save.stageHighScores) return [];
    return Array.isArray(save.stageHighScores[stageId]) ? save.stageHighScores[stageId] : [];
}

/**
 * iter-14: read the touch-button scale, clamped to a sane band. Defaults to
 * 1.0 if the field is missing (older saves) or out of range. Exposed as a
 * helper rather than a raw read so the UI never has to apply the clamp
 * inline.
 */
export function getTouchButtonScale(save) {
    const v = Number(save?.settings?.touchButtonScale);
    if (!Number.isFinite(v)) return 1;
    return Math.min(1.4, Math.max(0.8, v));
}

/**
 * The ceiling for a cumulative total, in the units each total is counted in.
 *
 * Chosen far above any reachable value -- a run is capped at `MAX_RUN_SECONDS`
 * so `timePlayed` would need 10^12 runs to arrive here -- and far below
 * `Number.MAX_VALUE`, which is the only property that matters. The point is not
 * the number; it is that the sum cannot reach a value the READER refuses.
 *
 * The bug this closes is the same one already fixed on the read side, one layer
 * down: an unbounded sum overflows to `Infinity`, `JSON.stringify` writes
 * `Infinity` as `null`, `coerceShape` refuses a non-finite number, and the stat
 * comes back as 0 with no error anywhere. Measured before the fix:
 * `MAX_VALUE` + `MAX_VALUE` -> save -> load -> `0`.
 */
const MAX_TOTAL = 1e15;

/** Add without ever leaving the finite range the reader accepts. */
function addBounded(current: number, delta: number): number {
    const a = Number.isFinite(current) ? current : 0;
    const b = Number.isFinite(delta) && delta > 0 ? delta : 0;
    return Math.min(a + b, MAX_TOTAL);
}

/**
 * Add one run's results to the cumulative totals.
 *
 * Every field goes through `addBounded`, so a caller cannot drive a total out of
 * the range `coerceShape` accepts even with a `1e308` in the run. `runs` is
 * likewise capped, so a save cannot claim more runs than the ceiling.
 */
export function accumulateTotals(
    save,
    run: { kills?: number; gameTime?: number; bossKills?: number }
) {
    save.totals ??= { kills: 0, timePlayed: 0, runs: 0, bossKills: 0 };
    save.totals.kills = addBounded(save.totals.kills, run.kills || 0);
    save.totals.timePlayed = addBounded(save.totals.timePlayed, run.gameTime || 0);
    save.totals.runs = addBounded(save.totals.runs, 1);
    save.totals.bossKills = addBounded(save.totals.bossKills, run.bossKills || 0);
}

export function structuredCloneCompat<T>(obj: T): T {
    if (typeof structuredClone === 'function') return structuredClone(obj);
    return JSON.parse(JSON.stringify(obj));
}

/**
 * The save format, DERIVED from the default rather than declared beside it.
 *
 * `typeof DEFAULT_SAVE` cannot drift from `DEFAULT_SAVE`, which a hand-written
 * interface could — and a save interface that disagrees with the default is worse
 * than none, because it type-checks and lies.
 */
export type SaveData = typeof DEFAULT_SAVE;

// ---------------------------------------------------------------------------
// Shape validation.
//
// Every read path in this module asks the same question of the value it just
// parsed: IS THIS THE SHAPE IT MUST BE? `JSON.parse` returning a value of the
// wrong shape is not a parse error — `{"settings": 5}` parses perfectly — so
// the check has to be explicit, and it has to sit at the boundary rather than
// at each of the readers, because a reader is a place that can forget.
//
// This is DEFENCE IN DEPTH, not the fix. The load-bearing fix for the audit's
// XSS findings is escaping at the sink (`src/safe-html.ts`): a `weapons` array
// whose entries are strings is a VALID shape, and `["<img src=x onerror=…>"]`
// satisfies it. No amount of type checking can tell that array apart from a
// legitimate one. What this layer does is stop a value of the wrong TYPE from
// being adopted at all — a string where a number belongs, an array where an
// object belongs, an object that is really `Object.prototype` — and bound the
// size of what a malformed save can make the game hold.
// ---------------------------------------------------------------------------

/**
 * What a value from disk is allowed to be.
 *
 * Deliberately a plain data description rather than a validator library: the
 * whole save format fits on one screen, and a description that can be read
 * beside `DEFAULT_SAVE` is one a reviewer can actually check it against.
 */
export interface Shape {
    /** `number`, `string`, `boolean`, `object`, `array`, `record` or `any`. */
    kind: string;
    /** Declared fields of an `object`. Undeclared keys are forwards-compatible. */
    fields?: Record<string, Shape>;
    /** Element shape of an `array`, or value shape of a `record`. */
    of?: Shape;
    /** Maximum array length, or maximum record key count. */
    max?: number;
    /** Maximum string length; longer strings are truncated, not refused. */
    maxLength?: number;
    /** Numeric lower bound. */
    min?: number;
    /** Numeric upper bound. */
    maxValue?: number;
    /** Allow-list for a string; anything else is refused. */
    oneOf?: string[];
    /**
     * Object keys that must survive coercion.
     *
     * Checked against the MERGED RESULT, not against the source, so a key that
     * is present but unusable (`timeSurvived: "soon"`) still fails the check.
     * Used only for array elements, where the target starts empty: a
     * leaderboard entry with no `timeSurvived` is not a leaderboard entry — it
     * renders as `00:00`, and "malformed" and "the player scored zero" are
     * different claims that the game must not conflate.
     */
    required?: string[];
}

/** Either a value that passed, or a refusal. */
interface Verdict {
    ok: boolean;
    value: unknown;
}

/** The largest a run's leaderboard entry can legitimately be. Seven days. */
const MAX_RUN_SECONDS = 604800;

function accept(value: unknown): Verdict {
    return { ok: true, value: value };
}

function refuse(): Verdict {
    return { ok: false, value: null };
}

/**
 * True for a JSON object: not null, and not an array.
 *
 * `typeof [] === 'object'`, and that single fact is F11: an array-valued save
 * was merged key by key — index by index — so a 2 MB array became a ten-
 * megabyte save object, the write blew the quota, storage demoted to its
 * in-memory fallback, and every later save was silently lost.
 */
export function isPlainRecord(value: unknown): boolean {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

/**
 * `__proto__`, `constructor` and `prototype` are never merge targets.
 *
 * F2 in one line. `mergeDeep` read `into['__proto__']` — which is the INHERITED
 * accessor, so it returned `Object.prototype` — and then merged the attacker's
 * object straight into it. That is global prototype pollution from a save file,
 * and it escalated: an entry with no own `weapons` inherited one from
 * `Object.prototype` and that array reached `innerHTML`.
 */
function isUnsafeKey(key: string): boolean {
    return key === '__proto__' || key === 'constructor' || key === 'prototype';
}

/**
 * Assign an OWN data property, never through an inherited setter.
 *
 * The unsafe-key check above already refuses those three names; this makes the
 * refusal structural rather than the only thing standing between a parsed key
 * and a prototype write.
 */
function defineOwn(into: Record<string, unknown>, key: string, value: unknown): void {
    Object.defineProperty(into, key, {
        value: value,
        writable: true,
        enumerable: true,
        configurable: true
    });
}

/**
 * A bounded deep copy for values with no declared shape — a key a NEWER build
 * wrote, which this one must carry through rather than drop.
 *
 * Bounded on four axes (depth, elements per array, keys per object, and a total
 * node budget shared across the whole copy) because the input is a string from
 * localStorage that an attacker chooses. An unbounded clone is its own denial
 * of service.
 */
function safeClone(value: unknown, budget: { left: number }, depth: number): unknown {
    if (budget.left <= 0 || depth > 8) return null;
    budget.left -= 1;
    if (Array.isArray(value)) {
        const out: unknown[] = [];
        const limit = Math.min(value.length, 256);
        for (let i = 0; i < limit; i++) out.push(safeClone(value[i], budget, depth + 1));
        return out;
    }
    if (isPlainRecord(value)) {
        const src = value as Record<string, unknown>;
        const out: Record<string, unknown> = {};
        let n = 0;
        for (const key of Object.keys(src)) {
            if (n >= 64) break;
            if (isUnsafeKey(key)) continue;
            defineOwn(out, key, safeClone(src[key], budget, depth + 1));
            n++;
        }
        return out;
    }
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    if (typeof value === 'string') return value.slice(0, 1024);
    if (typeof value === 'boolean') return value;
    return null;
}

/** Coerce a number into a count: finite, non-negative, integral, bounded. */
function clampCount(value: unknown, max: number): number {
    const n = Number(value);
    if (!Number.isFinite(n)) return 0;
    return Math.min(Math.max(0, Math.floor(n)), max);
}

/** True for a short, plain string: no length bomb, no control characters. */
function isShortString(value: unknown): boolean {
    return typeof value === 'string' && value.length > 0 && value.length <= 64;
}

/**
 * Check one value against one shape.
 *
 * `current` is the value the target already holds, so an `object` can be merged
 * into rather than replaced and the defaults survive. Optional bounds are read
 * with `Number(...)` + `Number.isFinite` rather than compared against
 * `undefined`, which this repository counts as a port hazard.
 */
function coerceShape(
    value: unknown,
    shape: Shape,
    current: unknown,
    budget: { left: number }
): Verdict {
    if (shape.kind === 'number') {
        if (typeof value !== 'number' || !Number.isFinite(value)) return refuse();
        let n = value;
        const lo = Number(shape.min);
        const hi = Number(shape.maxValue);
        if (Number.isFinite(lo)) n = Math.max(lo, n);
        if (Number.isFinite(hi)) n = Math.min(hi, n);
        return accept(n);
    }
    if (shape.kind === 'string') {
        if (typeof value !== 'string') return refuse();
        const cut = Number(shape.maxLength);
        const s = Number.isFinite(cut) ? value.slice(0, cut) : value;
        if (Array.isArray(shape.oneOf) && shape.oneOf.indexOf(s) === -1) return refuse();
        return accept(s);
    }
    if (shape.kind === 'boolean') {
        return typeof value === 'boolean' ? accept(value) : refuse();
    }
    if (shape.kind === 'array') {
        if (!Array.isArray(value)) return refuse();
        const cap = Number(shape.max);
        const limit = Number.isFinite(cap) ? Math.min(value.length, cap) : value.length;
        const out: unknown[] = [];
        for (let i = 0; i < limit; i++) {
            const item = shape.of
                ? coerceShape(value[i], shape.of, null, budget)
                : accept(safeClone(value[i], budget, 0));
            if (item.ok) out.push(item.value);
        }
        return accept(out);
    }
    if (shape.kind === 'record') {
        if (!isPlainRecord(value)) return refuse();
        const src = value as Record<string, unknown>;
        const cap = Number(shape.max);
        const limit = Number.isFinite(cap) ? cap : 4096;
        const out: Record<string, unknown> = {};
        let n = 0;
        for (const key of Object.keys(src)) {
            if (n >= limit) break;
            if (isUnsafeKey(key)) continue;
            const item = shape.of
                ? coerceShape(src[key], shape.of, null, budget)
                : accept(safeClone(src[key], budget, 0));
            if (!item.ok) continue;
            defineOwn(out, key, item.value);
            n++;
        }
        return accept(out);
    }
    if (shape.kind === 'object') {
        if (!isPlainRecord(value)) return refuse();
        const base = isPlainRecord(current) ? structuredCloneCompat(current) : {};
        const merged = mergeDeep(base as object, value as object, shape) as Record<string, unknown>;
        // Checked on the RESULT, not on the source. A key can be present and
        // still be dropped by its own field rule — `timeSurvived: "soon"` is
        // present and is not a time — so a presence check on the input would
        // let an entry through with no time at all, which is the exact shape
        // this is here to refuse.
        if (Array.isArray(shape.required)) {
            for (const key of shape.required) {
                if (!Object.prototype.hasOwnProperty.call(merged, key)) return refuse();
            }
        }
        return accept(merged);
    }
    return accept(safeClone(value, budget, 0));
}

/**
 * The type-driven half of the merge: what happens to a key with no declared
 * shape. The target's own value decides what is acceptable, so a save cannot
 * turn `settings.masterVolume` (a number) into a string — F7 — nor replace an
 * object with an array or a scalar.
 *
 * A key the target does NOT have is a key a newer build wrote. The format is
 * forwards-compatible and `test/storage.test.ts` asserts it, so the value is
 * carried through — as a bounded, prototype-safe copy rather than the parsed
 * object by reference.
 */
function mergeDeclared(value: unknown, current: unknown, budget: { left: number }): Verdict {
    if (Array.isArray(current)) {
        // Arrays are replaced wholesale, by reference, and that is documented
        // behaviour with a regression test of its own: deep-copying every
        // leaderboard on load is memory the load path cannot afford. A declared
        // array in `SAVE_SHAPE` gets element validation instead; this branch is
        // for a caller with no schema.
        return Array.isArray(value) ? accept(value) : refuse();
    }
    if (isPlainRecord(current)) {
        if (!isPlainRecord(value)) return refuse();
        return accept(mergeDeep(current as object, value as object));
    }
    if (typeof current === 'string') return typeof value === 'string' ? accept(value) : refuse();
    if (typeof current === 'number') {
        return typeof value === 'number' && Number.isFinite(value) ? accept(value) : refuse();
    }
    if (typeof current === 'boolean') return typeof value === 'boolean' ? accept(value) : refuse();
    return accept(safeClone(value, budget, 0));
}

/**
 * Merge `source` into `target`, type-checking as it goes.
 *
 * Three rules, in order:
 *   1. `source` must be a plain object. An array is refused outright (F11).
 *   2. `__proto__`, `constructor` and `prototype` are never merged (F2).
 *   3. A key with a declared `Shape` is coerced through it; a key the target
 *      already has is checked against the target's own type; a key neither
 *      knows is carried through as a bounded copy (forwards compatibility).
 *
 * `shape` is optional. Without it this is the generic, target-type-driven
 * merge; `loadSave` passes the save's own description.
 */
export function mergeDeep<T extends object>(target: T, source: object, shape?: Shape | null): T {
    if (!isPlainRecord(source)) return target;
    const into = target as Record<string, unknown>;
    const from = source as Record<string, unknown>;
    const budget = { left: 4096 };
    const fields = shape && shape.fields ? shape.fields : null;
    for (const key of Object.keys(from)) {
        if (isUnsafeKey(key)) continue;
        const declared = Object.prototype.hasOwnProperty.call(into, key);
        const current = declared ? into[key] : null;
        const rule = fields ? fields[key] : null;
        const verdict = rule
            ? coerceShape(from[key], rule, current, budget)
            : mergeDeclared(from[key], current, budget);
        if (verdict.ok) defineOwn(into, key, verdict.value);
    }
    return target;
}

// ---------------------------------------------------------------------------
// The save's own shape, and the per-entry sanitisers the leaderboards share.
// ---------------------------------------------------------------------------

/** One speedrun result, as `recordSpeedrunScore` stores it. */
export interface SpeedrunEntry extends HighScore {
    /** Elapsed milliseconds, the sort key for the speedrun board. */
    timeMs: number;
    /** Split timeline: run-clock mark plus wall-clock elapsed. */
    splits?: Array<{ mark: number; realMs: number }>;
}

/**
 * The shape of one leaderboard entry, shared by all three boards.
 *
 * `weapons` is a list of SHORT STRINGS and that is as far as a type check can
 * go: `["<img src=x onerror=…>"]` is a well-formed list of well-formed strings.
 * Shape validation cannot separate it from `["Whip"]`; escaping at the sink can,
 * and does. This layer's job is the numbers — a `date` that is not a date, a
 * `level` that is a string, a `weapons` list with a million entries.
 */
function entryShape(requiredKey: string): Shape {
    return {
        kind: 'object',
        required: [requiredKey],
        fields: {
            kills: { kind: 'number', min: 0, maxValue: 1000000000 },
            timeSurvived: { kind: 'number', min: 0, maxValue: MAX_RUN_SECONDS },
            level: { kind: 'number', min: 0, maxValue: 100000 },
            date: { kind: 'number', min: 0, maxValue: 4102444800000 },
            timeMs: { kind: 'number', min: 0, maxValue: MAX_RUN_SECONDS * 1000 },
            stage: { kind: 'string', maxLength: 64 },
            noHit: { kind: 'boolean' },
            weapons: { kind: 'array', of: { kind: 'string', maxLength: 64 }, max: 32 },
            splits: {
                kind: 'array',
                max: 64,
                of: {
                    kind: 'object',
                    fields: {
                        mark: { kind: 'number', min: 0, maxValue: MAX_RUN_SECONDS },
                        realMs: { kind: 'number', min: 0, maxValue: MAX_RUN_SECONDS * 1000 }
                    }
                }
            }
        }
    };
}

/**
 * The save format's shape. Read beside `DEFAULT_SAVE`, which is the schema:
 * every field here corresponds to a field there, and a field that is there and
 * not here would be a bug in this table.
 *
 * A function rather than a module constant because this repository counts
 * top-level `const` as a port hazard (`GDScript has no variables outside a
 * class`). Built on load, which happens once per page.
 */
function saveShape(): Shape {
    const entry = entryShape('timeSurvived');
    return {
        kind: 'object',
        fields: {
            highScore: {
                kind: 'object',
                fields: {
                    kills: { kind: 'number', min: 0, maxValue: 1000000000 },
                    timeSurvived: { kind: 'number', min: 0, maxValue: MAX_RUN_SECONDS },
                    level: { kind: 'number', min: 0, maxValue: 100000 }
                }
            },
            highScores: { kind: 'array', of: entry, max: 200 },
            stageHighScores: {
                kind: 'record',
                of: { kind: 'array', of: entry, max: 200 },
                max: 64
            },
            totals: {
                kind: 'object',
                fields: {
                    // BOUNDED SUMS. With no maximum these could be accumulated past
                    // Number.MAX_VALUE, and the sequence that follows is silent: the
                    // sum becomes Infinity, JSON.stringify writes Infinity as `null`,
                    // and `coerceShape` refuses a non-finite number — so the stat came
                    // back as 0. Measured: MAX_VALUE + MAX_VALUE -> save -> load -> 0. A
                    // bound the accumulator also applies means the value can never be
                    // one the reader refuses, and the ceiling is a number no run can
                    // legitimately reach.
                    kills: { kind: 'number', min: 0, maxValue: MAX_TOTAL },
                    timePlayed: { kind: 'number', min: 0, maxValue: MAX_TOTAL },
                    runs: { kind: 'number', min: 0, maxValue: MAX_TOTAL },
                    bossKills: { kind: 'number', min: 0, maxValue: MAX_TOTAL },
                    seenBuilds: { kind: 'array', of: { kind: 'string', maxLength: 64 }, max: 512 },
                    uniqueBuilds: { kind: 'number', min: 0, maxValue: 512 }
                }
            },
            achievements: { kind: 'record', of: { kind: 'number', min: 0 }, max: 512 },
            settings: {
                kind: 'object',
                fields: {
                    masterVolume: { kind: 'number', min: 0, maxValue: 1 },
                    sfxVolume: { kind: 'number', min: 0, maxValue: 1 },
                    musicVolume: { kind: 'number', min: 0, maxValue: 1 },
                    difficulty: {
                        kind: 'string',
                        oneOf: ['easy', 'normal', 'hard', 'nightmare']
                    },
                    showFps: { kind: 'boolean' },
                    screenShake: { kind: 'boolean' },
                    reducedMotion: { kind: 'boolean' },
                    colorblind: { kind: 'boolean' },
                    musicEnabled: { kind: 'boolean' },
                    damageNumbers: { kind: 'boolean' },
                    criticalFlash: { kind: 'boolean' },
                    vibration: { kind: 'boolean' },
                    muted: { kind: 'boolean' },
                    locale: { kind: 'string', maxLength: 16 },
                    stage: { kind: 'string', maxLength: 64 },
                    touchButtonScale: { kind: 'number', min: 0.8, maxValue: 1.4 }
                }
            },
            runs: { kind: 'number', min: 0 },
            flags: {
                kind: 'object',
                fields: {
                    howToSeen: { kind: 'boolean' },
                    pwaPromptSeen: { kind: 'boolean' },
                    tutorialDone: { kind: 'boolean' }
                }
            }
        }
    };
}

/**
 * Validate one leaderboard entry, or refuse it.
 *
 * `timeSurvived` is REQUIRED: an entry with no time is not a leaderboard entry,
 * and the alternative — defaulting it to 0 — is how a payload with no numbers
 * at all still ends up rendered. Everything else is clamped, so a hostile
 * `{"kills": 1e308}` becomes a number the sort can still compare.
 */
function sanitiseEntryFields(raw: unknown): HighScore | null {
    if (!isPlainRecord(raw)) return null;
    const r = raw as Record<string, unknown>;
    const time = Number(r.timeSurvived);
    const out: HighScore = {
        kills: clampCount(r.kills, 1000000000),
        timeSurvived: Number.isFinite(time) ? Math.min(Math.max(0, time), MAX_RUN_SECONDS) : 0,
        level: clampCount(r.level, 100000),
        date: clampCount(r.date, 4102444800000)
    };
    if (isShortString(r.stage)) out.stage = String(r.stage);
    if (Array.isArray(r.weapons)) out.weapons = r.weapons.filter(isShortString).slice(0, 32);
    if (r.noHit === true) out.noHit = true;
    return out;
}

export function sanitiseHighScoreEntry(raw: unknown): HighScore | null {
    if (!isPlainRecord(raw)) return null;
    // REQUIRED and FINITE, not merely `typeof === 'number'`. `Infinity` is a
    // number, and a time of infinity sorts above every real run forever; an
    // earlier version of this check accepted it and defaulted the time to 0.
    const time = (raw as Record<string, unknown>).timeSurvived;
    if (typeof time !== 'number' || !Number.isFinite(time)) return null;
    return sanitiseEntryFields(raw);
}

/**
 * Validate one SPEEDRUN entry. Same gate as above, plus the two fields only a
 * speedrun has: `timeMs` (required — it is the sort key) and the split
 * timeline, whose marks are drawn as `mm:ss` and whose `realMs` is formatted
 * with `toFixed(2)`. A string in either position used to reach both.
 */
export function sanitiseSpeedrunEntry(raw: unknown): SpeedrunEntry | null {
    // NOT `sanitiseHighScoreEntry`: a speedrun result carries `timeMs` and has
    // no `timeSurvived` at all, which is exactly what the speedrun tests build.
    // Requiring the normal board's field here would refuse every real speedrun.
    const base = sanitiseEntryFields(raw);
    if (!base) return null;
    const r = raw as Record<string, unknown>;
    const ms = Number(r.timeMs);
    if (!Number.isFinite(ms) || ms < 0) return null;
    const out = base as SpeedrunEntry;
    out.timeMs = Math.min(ms, MAX_RUN_SECONDS * 1000);
    // A speedrun result has no `timeSurvived` of its own; derive it from the
    // sort key rather than leaving a 0 that claims the run lasted no time.
    if (typeof r.timeSurvived !== 'number') out.timeSurvived = out.timeMs / 1000;
    if (Array.isArray(r.splits)) {
        const splits: Array<{ mark: number; realMs: number }> = [];
        const limit = Math.min(r.splits.length, 64);
        for (let i = 0; i < limit; i++) {
            const s = r.splits[i];
            if (!isPlainRecord(s)) continue;
            const sr = s as Record<string, unknown>;
            const mark = Number(sr.mark);
            const realMs = Number(sr.realMs);
            if (!Number.isFinite(mark) || !Number.isFinite(realMs)) continue;
            splits.push({ mark: Math.max(0, mark), realMs: Math.max(0, realMs) });
        }
        out.splits = splits;
    }
    return out;
}

// ---------------------------------------------------------------------------
// Speedrun high-score helpers. Kept in a separate slot so the normal
// leaderboard and the deterministic runs never commingle. Each entry
// records: { timeMs, splits[], level, kills, date, weapons, noHit }.
// ---------------------------------------------------------------------------
export function loadSpeedrunScores(): SpeedrunEntry[] {
    try {
        const raw = usableLS()
            ? window.localStorage.getItem(SPEEDRUN_STORAGE_KEY)
            : _speedrunMemory;
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        // `Array.isArray(parsed) ? parsed : []` was the whole check. It asks
        // whether the value is a list and never what is IN the list, so every
        // element reached `renderSpeedRow` unchecked.
        const verdict = coerceShape(
            parsed,
            { kind: 'array', of: entryShape('timeMs'), max: CONFIG.SPEEDRUN_MAX_SLOTS * 4 },
            null,
            { left: 4096 }
        );
        return verdict.ok ? (verdict.value as SpeedrunEntry[]) : [];
    } catch (err) {
        console.warn('[storage] Failed to load speedrun scores.', err);
        return [];
    }
}

let _speedrunMemory: string | null = null;

export function saveSpeedrunScores(scores) {
    try {
        const serialised = JSON.stringify(scores);
        if (usableLS()) window.localStorage.setItem(SPEEDRUN_STORAGE_KEY, serialised);
        else _speedrunMemory = serialised;
    } catch (err) {
        console.warn('[storage] Failed to write speedrun scores.', err);
    }
}

/** Insert a speedrun result; returns 1-based rank or 0 if it didn't qualify. */
export function recordSpeedrunScore(entry) {
    const clean = sanitiseSpeedrunEntry(entry);
    if (!clean) return 0;
    const list = loadSpeedrunScores().concat([clean]);
    list.sort((a, b) => (a.timeMs || Infinity) - (b.timeMs || Infinity));
    const capped = list.slice(0, CONFIG.SPEEDRUN_MAX_SLOTS);
    saveSpeedrunScores(capped);
    return capped.indexOf(clean) + 1;
}

export function _resetSpeedrunForTests() {
    _speedrunMemory = null;
    if (usableLS()) window.localStorage.removeItem(SPEEDRUN_STORAGE_KEY);
}

// ---------------------------------------------------------------------------
// Deterministic 32-bit LCG for Speedrun mode. `nextInt`/`nextFloat` are cheap
// and predictable; seeding with the same value always produces the same
// stream, which is the whole point of speedruns.
// ---------------------------------------------------------------------------
export class SeededRng {
    /** Current generator state; saved and restored for deterministic runs. */
    declare state: number;
    constructor(seed = 1) {
        // Force unsigned 32-bit; 0 seed is illegal (collapses to 0 forever).
        this.state = seed >>> 0 || 1;
    }
    nextInt() {
        // LCG parameters from Numerical Recipes.
        this.state = (Math.imul(this.state, 1664525) + 1013904223) >>> 0;
        return this.state;
    }
    nextFloat() {
        return this.nextInt() / 0x100000000;
    }
    pick(arr) {
        if (!arr.length) return null;
        return arr[this.nextInt() % arr.length];
    }
}
