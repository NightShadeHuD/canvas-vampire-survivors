#!/usr/bin/env node
/**
 * @file scripts/check-lifecycle.mjs
 * @description Finds state this project SETS and never UNSETS.
 *
 * WHY THIS EXISTS
 *
 * Four player-visible bugs shipped here, and three were not logic errors — the logic was
 * correct and the thing was unreachable, invisible, or IRREVERSIBLE:
 *
 *     WASD did nothing            movement was right    `project.godot` had no [input]
 *     Menus unanswerable          upgrades applied      nothing called `grab_focus()`
 *     Title rendered off-screen   the string was right  anchors put it outside the viewport
 *     The screen stayed grey      the dim's colour was  `visible = true`, NO counterpart
 *
 * The last one is this gate's target. `shade_rect.visible = true` was added with the picker
 * and **NOTHING ever set it false**, so the dim raised at the player's first level-up and
 * covered the rest of the run. A player reported it; 356 assertions did not, because the two
 * assertions that covered the shade read `shade.color.a` — the ALPHA.
 *
 *     **Alpha is a property of the dim. Visibility is its LIFECYCLE.**
 *
 * No assertion about a VALUE could have seen it. The value was right. What was missing was
 * the other half of a two-sided contract, and a two-sided contract is checkable without
 * running anything: if one half is written and the other is not, the text says so.
 *
 * WHAT IT CHECKS — four shapes of the same asymmetry
 *
 *   A. NODE LIFECYCLE PROPERTIES. `X.visible = true` that nothing on the raising path ever
 *      lowers. The table also holds `disabled`, `frozen`, `monitoring`, `monitorable`,
 *      `paused`, `editable`, `input_pickable` — the booleans that decide whether a node
 *      takes part in the frame.
 *
 *      **Reachability, not existence**, and that distinction was measured here rather than
 *      assumed: the fix for the grey screen added `_lower_shade()` and called it from three
 *      places, and deleting ONE of those calls — the fix commit's own positive control —
 *      leaves the assignment in the file while the dim again covers the run. An
 *      "is `= false` written anywhere" check stays green on that. This one does not: a
 *      lowering counts only if the code that RAISES the latch can reach it, by call or by
 *      signal connection — **or** the frame loop drives that lowering AND the same function
 *      can reach the code that RAISES the latch, which is the arm/re-arm cycle and nothing
 *      wider. That second clause used to be a wildcard — "any lowering inside an engine
 *      callback, wherever the raise is" — and the wildcard was measured ACCEPTING the dim
 *      being lowered only when the player pauses, which is the shipped bug. See `engineRuns`.
 *   B. ZERO-GATED COUNTERS. A member that is accumulated (`+=`) and read as a gate
 *      (`if pending_picks > 0:`) must be able to return to zero, or the gate never closes
 *      again. `pending_picks` is decremented, so it PASSES — this class exists to keep it
 *      that way, not to accuse it.
 *   C. ACQUIRE/RELEASE CALLS. `add_child(...)` with no `remove_child`/`queue_free` anywhere;
 *      `open(...)` with no `close()`; `lock()` with no `unlock()`.
 *   D. INPUT ACTIONS. `project.godot` is where the WASD bug lived: code read an action that
 *      nothing had declared. Every action read must be declared in `[input]`, or be one of
 *      Godot's built-in `ui_*` actions.
 *
 * THE SCOPE DECISION: PROJECT-WIDE, KEYED BY NAME
 *
 * A file-scoped gate would be wrong here, and measurably so: `wants_to_fire = true` lives in
 * `enemy.gd` and its release is `foe.wants_to_fire = false` in `game.gd`. That is a correct
 * pair across two files, and a per-file gate would report it as a defect on the first run —
 * **a gate whose first act is a false positive is a gate that gets weakened.** So the search
 * is project-wide and keyed on the NAME (`shade_rect.visible`, `pending_picks`), reading both
 * the bare and the qualified form.
 *
 * **The cost, stated because it is the price of that choice:** two different objects that
 * share a member name merge. A release on one satisfies a raise on the other, and `dead` on a
 * foe is not distinguished from `dead` on the hero. The gate cannot see the difference, so it
 * errs toward silence — which is the direction rule 16 says a gate should err. Every finding
 * it does report names the raise site AND the release site, so a reader can audit the pairing
 * rather than trust it.
 *
 * WHAT IT DELIBERATELY DOES NOT CHECK
 *
 *   - `dead`, `collected`, `expired`, `fuse_armed`: domain flags on a per-entity object. They
 *     are one-way because the object is one-shot and its release is its destruction, which no
 *     static text can see. Only the declared NODE lifecycle properties are checked, and the
 *     reason is that a node outlives the raise.
 *   - Comparisons inside a lambda. Every lambda here is an achievement predicate, and an
 *     achievement is a one-way ratchet BY DESIGN (`first_blood` is not un-earned by a reset).
 *     Counting those as gates would report the scoreboard as a lifecycle defect.
 *   - `godot/verify_*.gd` and `godot/assertions.gd`. A latch inside a test suite is not
 *     shipped state, and a lowering that exists ONLY in a suite is not a lowering — so a
 *     release written in a suite does not count as one either. Both halves are excluded, or
 *     the exclusion would create false positives instead of removing them.
 *
 * WHAT STILL GETS PAST THIS — the honest list, because a gate with an unstated ceiling is
 * read as a guarantee. Every entry here was MEASURED against this gate; the edit and the
 * exit code are the record, and none of them is published on reasoning alone.
 *
 *   - **Order inside a function.** A lowering written BEFORE the raise in the same function
 *     still counts: `x.visible = false ... x.visible = true` in one body passes. Measured:
 *     green, with the latch listed as reached. Ordering is modelled nowhere, deliberately — a
 *     half-model (same function only) would report a legitimate close-then-reopen as a
 *     defect, and a false positive is the failure that gets a gate weakened instead of fixed.
 *   - **State set from a `.tscn` scene file.** The scan is `.gd` text, and a node left visible
 *     in `godot/scenes/main.tscn` is outside it — which is the shape of the FIRST shade bug.
 *     Measured: a `.tscn`-only latch is invisible to this gate (green).
 *   - **Anything behind a string.** `set("visible", true)`, `call("_lower_shade")`, and an
 *     action name assembled at runtime are all invisible to a text scan. Measured: green.
 *     That cuts BOTH ways, and the other direction was a hole: a name merely MENTIONED in a
 *     string used to count as a reachability edge, so
 *     `push_warning("remember to call _lower_shade() sometime")` satisfied a lifecycle
 *     contract while the dim was never lowered — measured exit 0 before the fix and exit 1
 *     after it. See `stripStrings`.
 *   - **A lifecycle property not in the table** (`freeze` on a RigidBody2D, `stream_paused`,
 *     `autoplay`). Widening the table is a one-line edit that carries a reason; leaving it
 *     narrow is why this gate can ship with zero exemptions.
 *   - **A domain flag on a per-entity object** — see above.
 *
 * "A LOWERING THAT IS CALLED, BUT NOT FROM THE CLOSING PATH" IS NOT A CEILING — IT FAILS
 *
 * This list used to publish that as something which gets past. It does not. Measured: with
 * the `_lower_shade()` call removed from `_on_pick` and a lowering written inline in
 * `_restart`, this gate exits 1 — "`shade_rect.visible` is only lowered by … code that runs
 * once at startup, or on a path this raise is not part of."
 *
 * The one thing a differently-placed lowering buys is the FRAME LOOP, and that allowance is
 * now a cycle rather than a wildcard: a lowering in a function the engine runs (one hop from
 * `_process`/`_draw`/`_unhandled_input` …) counts ONLY IF that same function can reach the
 * code that raises the latch. Measured three ways — the re-arm pair (raise in `_on_pick`,
 * lowering in `_show_picks`, which `_process` calls) is green; the same pair with that clause
 * disabled is red on the raise; and a lowering parked in `_show_pause` or `_draw_hero` —
 * engine-driven, but reaching no raise — is red, which is the shipped bug.
 *
 * WHAT IT FAILS ON CORRECT CODE — THREE FALSE POSITIVES, MEASURED (these are not ceilings)
 *
 * Every one of these was published above as a ceiling. They are the opposite: the gate goes
 * RED on code that is correct. **A published ceiling nobody measured is how a gate gets
 * deleted** — a reader trusts the text, writes the aliased form, hits a hard fail and
 * concludes the gate is broken. Measured by editing `godot/scripts/main.gd` and running
 * `node scripts/check-lifecycle.mjs`:
 *
 *     `var d := shade_rect` then `d.visible = true`     exit 1 — "nothing in the shipped
 *                                                       code sets `d.visible` to false"
 *     `var s := shade_rect` then `s.visible = false`    exit 1 — "nothing in the shipped
 *                                                       code sets `shade_rect.visible` to false"
 *     `stats.visible = true` with the PARENT            exit 1 — "nothing in the shipped
 *     `hud.visible` doing the hiding                    code sets `stats.visible` to false"
 *
 * The first two are one fact: **this gate pairs by the RECEIVER NAME**, so an alias splits a
 * pair that is really one pair. The third is that a child's latch is not excused by its parent
 * being hidden. Both are left as failures rather than closed, and that direction is
 * deliberate: closing them needs alias resolution and a Control-tree model, and the cheap
 * versions of both MERGE KEYS — which accepts a lowering on a DIFFERENT node, the direction
 * that hides the shipped bug. So the gate keeps the false positive and states it here, and the
 * failure report names the alias so the reader who hits it is told why.
 *
 * AN EXEMPTION IS AS HARD TO ADD AS A SHORTCUT (rule 2)
 *
 * There are NO exemptions in this tree, and that is the strongest position the gate can be
 * in. When one is genuinely needed it goes in `quality-baseline.json` under
 * `lifecycleExemptions`, and the gate refuses an entry that:
 *
 *   - is missing `id`, `why`, `bound` or `trackedBy`  (declared),
 *   - names a PATTERN rather than one site            (bounded to one line),
 *   - or no longer matches an open finding            (tracked — a stale exemption fails).
 *
 * The count is printed on every run, so an exemption that is added cannot be forgotten.
 * An escape hatch that never fails is a hole; this one is checked every time it is used.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { refuseEmptyScan } from './lib/gate-input.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
const BASELINE = path.join(repoRoot, 'quality-baseline.json');
const PROJECT = path.join(repoRoot, 'godot', 'project.godot');

// ---------------------------------------------------------------------------
// THE DECLARATIONS. Every entry carries a REASON, and an entry without one is refused:
// a table of magic words is a table nobody can review.
// ---------------------------------------------------------------------------

/**
 * Boolean properties whose value decides whether a node takes part in the frame.
 * A latch on one of these is something a player can see and cannot undo.
 */
const LIFECYCLE_PROPERTIES = [
    ['visible', 'raised over the screen and never lowered, it covers what is behind it'],
    ['disabled', 'a Button or CollisionShape disabled once stops responding, and says nothing'],
    ['frozen', 'a body that freezes and never thaws stops being simulated'],
    ['monitoring', 'an Area2D that stops monitoring stops detecting anything'],
    ['monitorable', 'and stops being detected by every other area'],
    ['paused', 'a latch that suspends processing and never resumes'],
    ['editable', 'an editor latch that stays on'],
    ['input_pickable', 'a Control that stops taking input never takes it again']
];

/**
 * Acquire -> release call pairs. The acquire is a state change; the release is the only
 * thing that can undo it. Reported only when the acquire is PRESENT: a pair this tree does
 * not use is a rule with nothing to apply to, and saying so is better than failing on it.
 */
const CALL_PAIRS = [
    {
        acquire: 'add_child',
        release: ['remove_child', 'queue_free', 'free'],
        why: 'a node added to the tree with no path that removes it lives as long as the process'
    },
    {
        acquire: 'open',
        release: ['close'],
        why: 'a file opened and never closed holds its handle for the life of the object'
    },
    {
        acquire: 'lock',
        release: ['unlock'],
        why: 'a lock taken and never released is a deadlock'
    }
];

/**
 * Pairs that LOOK like an acquire with a release and are deliberately NOT checked.
 *
 * Each is a decision someone would otherwise re-litigate on reading the table, and an
 * undeclared exclusion is how a hole becomes policy. The first two would fail on CORRECT
 * code today, which is the specific reason a gate stops being believed.
 */
const NOT_A_PAIR = [
    [
        'grab_focus -> release_focus',
        'focus moves on its own — a Control that is hidden or freed drops it — and this project ' +
            'calls `grab_focus` to hand focus TO a panel rather than to hold it. Requiring a ' +
            'release would fail the fix for "the menus could not be answered".'
    ],
    [
        'connect -> disconnect',
        'a signal connection dies with the Object that owns it, so "every connect needs a ' +
            'disconnect" would fail on all three of this project’s button connections and ' +
            'refuse correct code.'
    ],
    [
        'add_theme_*_override -> remove_theme_*_override',
        'an override lives on the node that carries it and goes when the node does; the ' +
            'remove_* form exists for CHANGING an override, not for balance.'
    ]
];

/**
 * Godot's built-in actions. Declaring one in `[input]` REPLACES its default binding, so a
 * project may read them without declaring them — and REQUIRING a declaration would push a
 * contributor into declaring `ui_left` to satisfy this gate and silently dropping the arrow
 * keys while adding WASD. A rule that trades one reachability bug for another is not a rule.
 */
const BUILT_IN_ACTIONS = new Set([
    'ui_accept',
    'ui_select',
    'ui_cancel',
    'ui_focus_next',
    'ui_focus_prev',
    'ui_left',
    'ui_right',
    'ui_up',
    'ui_down',
    'ui_page_up',
    'ui_page_down',
    'ui_home',
    'ui_end',
    'ui_cut',
    'ui_copy',
    'ui_paste',
    'ui_undo',
    'ui_redo',
    'ui_menu',
    'ui_text_backspace',
    'ui_text_backspace_word',
    'ui_text_delete',
    'ui_text_delete_word',
    'ui_text_caret_left',
    'ui_text_caret_right',
    'ui_text_caret_up',
    'ui_text_caret_down',
    'ui_text_caret_line_start',
    'ui_text_caret_line_end',
    'ui_text_caret_document_start',
    'ui_text_caret_document_end',
    'ui_text_caret_page_up',
    'ui_text_caret_page_down',
    'ui_text_scroll_up',
    'ui_text_scroll_down',
    'ui_text_select_all',
    'ui_text_toggle_insert_mode',
    'ui_text_submit',
    'ui_text_indent',
    'ui_text_dedent',
    'ui_text_swap_line_up',
    'ui_text_swap_line_down',
    'ui_text_completion_query',
    'ui_text_completion_accept',
    'ui_text_completion_replace',
    'ui_swap_input_direction'
]);

/**
 * Functions that run ONCE, before the node takes part in any frame.
 *
 * A raising assignment needs a lowering that can run AFTER it, and a lowering buried in
 * `_ready` has already happened by the time `_show_picks` raises the shade. This is what
 * makes the check about the LIFECYCLE rather than about the text: `shade_rect.visible = false`
 * in `_ready` is not the counterpart of `shade_rect.visible = true` in `_show_picks` even
 * when the two sentences are spelled identically.
 */
const INIT_FUNCTIONS = new Set(['_init', '_ready', '_enter_tree']);

// ---------------------------------------------------------------------------
// THE SCAN SET
// ---------------------------------------------------------------------------

/**
 * Strip a GDScript line's comment, respecting string literals.
 *
 * It MUST be done before anything is matched. The fix for this very bug contains the
 * sentence ``shade_rect.visible = true` was added with the picker`` inside a comment, so a
 * gate that read comments would find a "raise" that is prose — and, worse, a lowering that
 * exists only in a comment would satisfy it. That is the defect `check:workflow-parity`
 * found in itself: **a check that reads comments is checking the documentation, not the
 * thing.**
 *
 * String contents are KEPT (class D needs the action names in them); only the comment goes.
 * `godot/data/*.gd` is full of `"#8844ff"`, so a naive cut at `#` would truncate real code.
 */
function stripComment(line) {
    let out = '';
    let quote = null;
    for (let i = 0; i < line.length; i += 1) {
        const ch = line[i];
        if (quote !== null) {
            out += ch;
            if (ch === '\\') {
                out += line[i + 1] ?? '';
                i += 1;
            } else if (ch === quote) {
                quote = null;
            }
            continue;
        }
        if (ch === '"' || ch === "'") {
            quote = ch;
            out += ch;
            continue;
        }
        if (ch === '#') break;
        out += ch;
    }
    return out;
}

/**
 * The same line with every string literal's CONTENTS removed, quotes kept.
 *
 * The token graph is built from these, and a name inside a string is not an edge. This was
 * a hole and not a precaution: with the `_lower_shade()` call in `_on_pick` replaced by
 * `push_warning("remember to call _lower_shade() sometime")` — a message and nothing else —
 * this gate reported "every SET has its UNSET" and exited 0 while the dim was never
 * lowered. Measured on this gate before the fix.
 *
 * `stripComment` deliberately KEEPS string contents, because class D needs the action names
 * inside them (`Input.is_action_pressed("ui_up")`). This is the opposite requirement over
 * the same text, which is why it is a second function and not a flag on the first.
 */
function stripStrings(line) {
    let out = '';
    let quote = null;
    for (let i = 0; i < line.length; i += 1) {
        const ch = line[i];
        if (quote !== null) {
            if (ch === '\\') {
                i += 1;
            } else if (ch === quote) {
                quote = null;
                out += ch;
            }
            continue;
        }
        if (ch === '"' || ch === "'") {
            quote = ch;
            out += ch;
            continue;
        }
        out += ch;
    }
    return out;
}

/** Not shipped game code: the suites and the assertion library they share. */
const isSuite = (rel) => /^godot\/(assertions|verify_[a-z_]+)\.gd$/.test(rel);

const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: repoRoot, encoding: 'utf8' })
    .split('\0')
    .filter(Boolean);

const files = tracked
    .filter((rel) => rel.endsWith('.gd') && !isSuite(rel))
    .map((rel) => ({
        rel,
        lines: readFileSync(path.join(repoRoot, rel), 'utf8').split('\n').map(stripComment)
    }));

const emptyScan = refuseEmptyScan(
    files.length,
    'production GDScript file(s)',
    'The glob is wrong, the tree moved, or the Godot port was reverted.'
);
if (emptyScan) {
    console.error(`check-lifecycle: FAILED — ${emptyScan}`);
    process.exit(1);
}

const reasonsMissing = [...LIFECYCLE_PROPERTIES, ...CALL_PAIRS.map((p) => [p.acquire, p.why])]
    .filter(([, why]) => typeof why !== 'string' || why.trim() === '')
    .map(([name]) => name);
if (LIFECYCLE_PROPERTIES.length === 0 || CALL_PAIRS.length === 0 || reasonsMissing.length > 0) {
    console.error(
        'check-lifecycle: FAILED — the declarations are unusable, so this gate would scan ' +
            'for nothing.\n' +
            (LIFECYCLE_PROPERTIES.length === 0 ? '  LIFECYCLE_PROPERTIES is empty\n' : '') +
            (CALL_PAIRS.length === 0 ? '  CALL_PAIRS is empty\n' : '') +
            reasonsMissing.map((n) => `  no reason declared for: ${n}\n`).join('')
    );
    process.exit(1);
}

// ---------------------------------------------------------------------------
// THE MATCHERS
// ---------------------------------------------------------------------------

const PROP_ALT = LIFECYCLE_PROPERTIES.map(([name]) => name).join('|');
/**
 * An assignment `=`, and not the `=` of `==`, `!=`, `<=`, `>=`, `+=` … nor the `:=` of a
 * DECLARATION. That last one is load-bearing and was found by breaking the gate: with `:=`
 * read as an assignment, `var pending_picks := 0` counted as "reset to zero", so deleting
 * the only decrement left the gate GREEN. **A declaration is not a release** — it runs once,
 * at construction, which is the same reason a lowering in `_ready` is not a lowering.
 */
const IS_ASSIGN = '(?<![=!<>+\\-*/%:])=(?!=)';
/** A declaration, which initialises rather than changes state. */
const IS_DECLARATION = /^\s*(?:@\w+(?:\([^)]*\))?\s+)?(?:static\s+)?var\s/;
/** A dotted identifier chain: `shade_rect`, `game.pending_picks`, `self.picker`. */
const CHAIN = '([A-Za-z_]\\w*(?:\\.[A-Za-z_]\\w*)*)';

/** `receiver.property = value` */
const ASSIGN_CHAIN = new RegExp(`\\b${CHAIN}\\.(${PROP_ALT})\\s*${IS_ASSIGN}\\s*(.*)$`);
/** `property = value` — implicit `self`, which is how a Control script writes it. */
const ASSIGN_BARE = new RegExp(`^\\s*(${PROP_ALT})\\s*${IS_ASSIGN}\\s*(.*)$`);

const INCREMENT = new RegExp(`\\b${CHAIN}\\s*\\+=`, 'g');
const DECREMENT = new RegExp(`\\b${CHAIN}\\s*-=`, 'g');
/** A reset to zero: the other way a gate closes again. */
const RESET_ZERO = new RegExp(`\\b${CHAIN}\\s*${IS_ASSIGN}\\s*0(?:\\.0+)?\\s*[;,]?\\s*$`);
/** A declaration of state, as opposed to a temporary inside a function. */
const MEMBER_DECL = /^(?:@\w+(?:\([^)]*\))?\s+)?(?:static\s+)?var\s+([A-Za-z_]\w*)/;
/** A function header, with a name. Lambdas (`func(x):`) have none and are skipped. */
const FUNC_DECL = /^\s*(?:static\s+)?func\s+([A-Za-z_]\w*)\s*\(/;
/** A gate: a control-flow decision, as opposed to a predicate that is merely evaluated. */
const GATE_LINE = /^\s*(?:if|elif|while)\b/;
const CMP_ZERO_LEFT = new RegExp(`\\b${CHAIN}\\s*(?:>=|<=|==|!=|>|<)\\s*0(?:\\.0+)?\\b`, 'g');
const CMP_ZERO_RIGHT = new RegExp(`\\b0(?:\\.0+)?\\s*(?:>=|<=|==|!=|>|<)\\s*${CHAIN}\\b`, 'g');

/** A call, and not a longer name that merely ends in it (`free` inside `queue_free`). */
const callPattern = (name) => new RegExp(`(?<![\\w])${name}\\s*\\(`, 'g');

/** Actions the code READS. `get_axis` and `get_vector` take more than one name. */
const INPUT_READ =
    /Input(?:Map)?\s*\.\s*(?:is_action_pressed|is_action_just_pressed|is_action_just_released|get_action_strength|get_action_raw_strength|action_press|action_release|has_action|action_erase_events|get_axis|get_vector)\s*\(([^)]*)\)/g;
const QUOTED = /"([^"]*)"/g;

/** The last identifier of a chain: the name the whole project is keyed on. */
const leafOf = (chain) => chain.split('.').pop();

// ---------------------------------------------------------------------------
// THE WALK
// ---------------------------------------------------------------------------

/** key -> sites, where a site is `{ rel, line, text, fn }`. */
const newIndex = () => new Map();
const note = (index, key, site) => {
    if (!index.has(key)) index.set(key, []);
    index.get(key).push(site);
};

const raises = newIndex();
const lowers = newIndex();
const increments = newIndex();
const releases = newIndex();
const gates = newIndex();
const calls = newIndex();
const inputReads = newIndex();
const members = new Set();

/**
 * Every named function's body, so a lowering can be checked for REACHABILITY and not only
 * for existence. Collisions merge (four classes define `update`), and that direction is
 * deliberate: merging adds edges, so it can only make the gate quieter.
 */
const functionBodies = new Map();
let reading = null;
const closeFunction = () => {
    if (reading === null) return;
    const prior = functionBodies.get(reading.name);
    functionBodies.set(
        reading.name,
        prior === undefined ? reading.lines.join('\n') : `${prior}\n${reading.lines.join('\n')}`
    );
    reading = null;
};

for (const { rel, lines } of files) {
    let fn = null;
    for (let i = 0; i < lines.length; i += 1) {
        const raw = lines[i];
        const header = FUNC_DECL.exec(raw);
        if (header) {
            closeFunction();
            reading = { name: header[1], lines: [] };
            fn = header[1];
        }
        // STRING CONTENTS GONE: the token graph must not accept a name that exists only in a
        // message. See `stripStrings`.
        if (reading !== null) reading.lines.push(stripStrings(raw));
        const site = { rel, line: i + 1, text: raw.trim(), fn };

        const member = MEMBER_DECL.exec(raw);
        if (member) members.add(member[1]);

        // A. node lifecycle properties
        const assignments = [];
        const chain = ASSIGN_CHAIN.exec(raw);
        if (chain) assignments.push([chain[1], chain[2], chain[3]]);
        const bare = ASSIGN_BARE.exec(raw);
        if (bare) assignments.push(['self', bare[1], bare[2]]);
        for (const [receiver, property, value] of assignments) {
            const key = `${leafOf(receiver)}.${property}`;
            // `= true` is a raise. Everything else — `false`, a parameter, `not x` — can be
            // false at runtime, so it is a lowering and never a raise. That asymmetry is
            // deliberate: it is what keeps a two-way toggle from being read as a latch.
            const value_ = value
                .trim()
                .replace(/[;,]+$/, '')
                .trim();
            note(value_ === 'true' ? raises : lowers, key, site);
        }

        // B. counters
        for (const m of raw.matchAll(INCREMENT)) note(increments, leafOf(m[1]), site);
        for (const m of raw.matchAll(DECREMENT)) note(releases, leafOf(m[1]), site);
        if (!IS_DECLARATION.test(raw) && RESET_ZERO.test(raw)) {
            const reset = new RegExp(`\\b${CHAIN}\\s*${IS_ASSIGN}\\s*0(?:\\.0+)?`).exec(raw);
            if (reset) note(releases, leafOf(reset[1]), site);
        }
        if (GATE_LINE.test(raw)) {
            for (const m of raw.matchAll(CMP_ZERO_LEFT)) note(gates, leafOf(m[1]), site);
            for (const m of raw.matchAll(CMP_ZERO_RIGHT)) note(gates, leafOf(m[1]), site);
        }

        // C. acquire/release calls
        for (const pair of CALL_PAIRS) {
            for (const name of [pair.acquire, ...pair.release]) {
                if (callPattern(name).test(raw)) note(calls, name, site);
            }
        }

        // D. input actions
        for (const m of raw.matchAll(INPUT_READ)) {
            for (const q of m[1].matchAll(QUOTED)) note(inputReads, q[1], site);
        }
    }
    closeFunction();
}

// ---------------------------------------------------------------------------
// THE CALL GRAPH — "was the lowering REACHED, or only WRITTEN?"
//
// Existence is not enough, and this is measured rather than argued. The fix for the grey
// screen introduced `_lower_shade()` and called it from three places. Deleting ONE call --
// `_lower_shade()` in `_on_pick`, which is the fix commit's own positive control -- leaves
// the assignment in place, so an existence check stays GREEN while the dim again covers the
// rest of the run (`verify_scene` fails on it: "and LOWERS the dim").
//
// So a raise must be able to REACH a lowering: through a call, or through a signal
// connection, from the function that raises it. `_show_picks` builds the buttons and
// connects `_on_pick`, so `_show_picks -> _on_pick -> _lower_shade` is a path -- and when
// that one call goes, the path goes with it.
//
// The edges are NAME TOKENS, not parsed calls: if a function's body mentions the name of
// another function, there is an edge. That is deliberately generous -- a `Callable` passed
// by name, a `connect(_foo)` and a `Foo.bar()` static call all count -- because an edge the
// gate cannot see becomes a FALSE POSITIVE, and a false positive is the one failure that
// gets a gate weakened rather than fixed.
//
// A `"_foo"` STRING does NOT count, and it used to. That generosity was a hole: a name that
// exists only inside a message satisfied a lifecycle contract. See `stripStrings`.
// ---------------------------------------------------------------------------
const tokensOf = new Map();
for (const [name, body] of functionBodies) {
    tokensOf.set(name, new Set(body.match(/[A-Za-z_]\w*/g) ?? []));
}

/**
 * What the ENGINE runs without being asked: the per-frame and per-event callbacks, plus the
 * functions one of them names directly.
 *
 * A latch that is ARMED when the thing closes and RE-ARMED when it opens again is ordinary
 * code, and the frame loop is what re-arms it: that pair -- the RAISE in the handler that
 * CLOSES the modal, the LOWERING in the function `_process` calls to open the next one -- was
 * reported as a defect without this, and a gate that reports correct code is a gate that gets
 * weakened. Measured on this tree: `stats.visible = true` in `_on_pick` with
 * `stats.visible = false` in `_show_picks` is GREEN, and the SAME pair is RED the moment the
 * clause below is disabled -- so the clause is load-bearing and not decoration.
 *
 * **BUT BEING ENGINE-DRIVEN IS NOT ENOUGH, AND THAT WAS THIS GATE'S WORST HOLE.** The
 * allowance used to be a WILDCARD -- any lowering inside an engine callback, or one hop from
 * one, was accepted no matter where the raise was -- so the headline ("a lowering counts
 * only if the code that RAISES the latch can reach it") was not true as written. Measured
 * against this gate before the fix, with `_lower_shade()` deleted from `_on_pick`:
 *
 *     `shade_rect.visible = false` parked at the top of `_show_pause`   exit 0
 *     the same line parked in `_draw_hero`                              exit 0
 *
 * The first is the dim coming down only when the player PAUSES, which is the shipped bug
 * this gate exists to catch; the second is a dim that never comes up at all.
 *
 * So `engineRuns` is not an acceptance on its own. The pairing test below asks for a CYCLE:
 * an engine-driven lowering counts only if that same function can reach the code that
 * RAISES the latch. `_show_picks` connects `_on_pick`, so the arm/re-arm pair passes;
 * `_show_pause` and `_draw_hero` reach nothing that raises the shade, so a parked lowering
 * is reported. Measured both ways -- see `scripts/check-selftests.json` and the ceiling list
 * at the top of this file.
 *
 * **ONE hop, not the transitive closure.** `_process -> _show_game_over -> _restart ->
 * _start_run -> _lower_shade` is four, and following it would blind this gate to the very
 * bug it was written for: in the broken tree the dim IS lowered four calls from the frame
 * loop, when a NEW RUN starts, and that is not the modal being lowered. That is still
 * rejected: `_lower_shade` is not one hop from a callback.
 *
 * Signal handlers are deliberately NOT entry points here, for the same measured reason:
 * `_restart` is connected to a button, so treating its contents as universally reachable
 * would accept a dim lowered only on restart — the exact defect, wearing a signal.
 */
const ENGINE_CALLBACKS = new Set([
    '_process',
    '_physics_process',
    '_draw',
    '_input',
    '_unhandled_input',
    '_gui_input',
    '_shortcut_input',
    '_notification'
]);

const engineRuns = new Set();
for (const name of ENGINE_CALLBACKS) {
    if (!functionBodies.has(name)) continue;
    engineRuns.add(name);
    for (const token of tokensOf.get(name) ?? []) {
        if (functionBodies.has(token)) engineRuns.add(token);
    }
}

/** Every function `start` can reach by name reference. */
function reachableFrom(start) {
    const seen = new Set([start]);
    const queue = [start];
    while (queue.length > 0) {
        for (const token of tokensOf.get(queue.pop()) ?? []) {
            if (functionBodies.has(token) && !seen.has(token)) {
                seen.add(token);
                queue.push(token);
            }
        }
    }
    return seen;
}

/** The actions `project.godot` declares, from its `[input]` section. */
function declaredActions() {
    if (!existsSync(PROJECT)) return null;
    const out = new Set();
    let section = null;
    for (const raw of readFileSync(PROJECT, 'utf8').split('\n')) {
        const heading = /^\[([^\]]+)\]\s*$/.exec(raw);
        if (heading) {
            section = heading[1];
            continue;
        }
        const entry = /^([A-Za-z_]\w*)\s*=\s*\{/.exec(raw);
        if (section === 'input' && entry) out.add(entry[1]);
    }
    return out;
}

const declared = declaredActions();
const findings = [];

// ---------------------------------------------------------------------------
// A. every raise needs a lowering that can run after it
// ---------------------------------------------------------------------------
const latches = [];
const describe = (site) => `${site.fn ?? '(top level)'}() at ${site.rel}:${site.line}`;
for (const [key, sites] of raises) {
    const lowerings = lowers.get(key) ?? [];
    let paired = 0;
    let because = '';
    for (const site of sites) {
        const reached = reachableFrom(site.fn ?? '');
        const ok = lowerings.filter((low) => {
            // The same function is trivially paired with itself.
            if (low.fn === site.fn) return true;
            // A lowering that runs once at startup has already happened. `_ready` is not
            // reachable from anywhere anyway; this says so explicitly so a future refactor
            // that calls an init function by hand cannot quietly count it as a lowering.
            if (low.fn === null || INIT_FUNCTIONS.has(low.fn)) return false;
            // (a) The raise’s own path can reach the lowering.
            if (reached.has(low.fn)) return true;
            // (b) The frame loop drives the lowering AND that function is part of the SAME
            // open/close cycle as the raise -- it can reach the code that arms the latch.
            // Being engine-driven alone is NOT enough: that wildcard accepted the dim being
            // lowered at the top of `_show_pause`, which is the shipped bug. See `engineRuns`.
            return engineRuns.has(low.fn) && reachableFrom(low.fn).has(site.fn ?? '');
        });
        if (ok.length > 0) {
            paired += 1;
            continue;
        }
        const where = [...new Set(lowerings.map(describe))];
        because =
            lowerings.length === 0
                ? `nothing in the shipped code sets \`${key}\` to false.`
                : `${describe(site)} raises it, and nothing on that path lowers it. ` +
                  `\`${key}\` is only lowered by ${where.join(', ')} — code that runs once at ` +
                  'startup, or on a path this raise is not part of.';
        findings.push({
            site: `${site.rel}:${key}`,
            line: `${site.rel}:${site.line}  ${site.text}`,
            because,
            how:
                lowerings.length === 0
                    ? 'lower it on every path that closes the thing it belongs to, or exempt it below.'
                    : 'lower it from the path that raises it — a lowering nothing on that path ' +
                      'calls is a lowering that never runs — or exempt it below.'
        });
    }
    if (paired === sites.length) latches.push(key);
}

// ---------------------------------------------------------------------------
// B. a counter used as a gate must be able to close it again
// ---------------------------------------------------------------------------
const counters = [...increments.keys()].filter((leaf) => members.has(leaf) && gates.has(leaf));
const countersReleased = [];
for (const leaf of counters) {
    if (releases.has(leaf)) {
        countersReleased.push(leaf);
        continue;
    }
    const site = increments.get(leaf)[0];
    findings.push({
        site: `${site.rel}:${leaf}`,
        line: `${site.rel}:${site.line}  ${site.text}`,
        because:
            `\`${leaf}\` is accumulated there and read as a gate at ` +
            `${gates.get(leaf)[0].rel}:${gates.get(leaf)[0].line} ` +
            `(\`${gates.get(leaf)[0].text}\`), and nothing anywhere decrements it or resets ` +
            'it to zero. The gate can open once and never close.',
        how: 'give it a decrement or a reset on the path that consumes it, or exempt it below.'
    });
}

// ---------------------------------------------------------------------------
// C. an acquire needs its release somewhere in the shipped code
// ---------------------------------------------------------------------------
const exercisedPairs = [];
for (const pair of CALL_PAIRS) {
    if (!calls.has(pair.acquire)) continue;
    exercisedPairs.push(pair.acquire);
    if (pair.release.some((name) => calls.has(name))) continue;
    const site = calls.get(pair.acquire)[0];
    findings.push({
        site: `${site.rel}:${pair.acquire}`,
        line: `${site.rel}:${site.line}  ${site.text}`,
        because:
            `${pair.why} — and no ${pair.release.map((r) => `\`${r}\``).join(' / ')} call ` +
            'appears anywhere in the shipped code.',
        how: 'add the release, or declare the pair in NOT_A_PAIR with a reason.'
    });
}

// ---------------------------------------------------------------------------
// D. an action the code reads must exist
// ---------------------------------------------------------------------------
if (declared === null) {
    console.error('check-lifecycle: FAILED — godot/project.godot is missing, so the input');
    console.error('  declarations this gate reads cannot be read at all.');
    process.exit(1);
}
const actionsRead = [...inputReads.keys()].sort();
for (const action of actionsRead) {
    if (declared.has(action) || BUILT_IN_ACTIONS.has(action)) continue;
    const site = inputReads.get(action)[0];
    findings.push({
        site: `${site.rel}:${action}`,
        line: `${site.rel}:${site.line}  ${site.text}`,
        because:
            `\`Input.…("${action}")\` reads an action that \`godot/project.godot\` does not ` +
            'declare in `[input]` and that is not a Godot built-in, so the read can never be ' +
            'true and the control does nothing.',
        how: 'declare it in `[input]`, or read an action that exists.'
    });
}

// ---------------------------------------------------------------------------
// THE EXEMPTIONS. Declared, bounded, tracked -- and a stale one FAILS.
// ---------------------------------------------------------------------------
let baseline = {};
try {
    baseline = JSON.parse(readFileSync(BASELINE, 'utf8'));
} catch (err) {
    console.error(
        `check-lifecycle: FAILED — quality-baseline.json could not be read: ${err.message}`
    );
    process.exit(1);
}
const exemptions = baseline.lifecycleExemptions ?? [];
if (!Array.isArray(exemptions)) {
    console.error(
        'check-lifecycle: FAILED — `lifecycleExemptions` in quality-baseline.json is not an ' +
            'array. A register that cannot be read must not read as "no exemptions".'
    );
    process.exit(1);
}

const exemptionProblems = [];
for (const [i, entry] of exemptions.entries()) {
    const where = `lifecycleExemptions[${i}]`;
    for (const field of ['id', 'why', 'bound', 'trackedBy']) {
        if (typeof entry?.[field] !== 'string' || entry[field].trim() === '') {
            exemptionProblems.push(`${where} has no \`${field}\``);
        }
    }
    if (typeof entry?.id === 'string' && /[*?[\]]/.test(entry.id)) {
        exemptionProblems.push(
            `${where} (\`${entry.id}\`) is a PATTERN. An exemption names ONE site — ` +
                '`<file>:<name>` — or it exempts everything that will ever look like it.'
        );
    }
    if (typeof entry?.trackedBy === 'string' && !entry.trackedBy.includes('check-lifecycle')) {
        exemptionProblems.push(
            `${where} claims to be tracked by \`${entry.trackedBy}\`, which is not this gate. ` +
                'A shortcut tracked by nothing is a shortcut nobody counts.'
        );
    }
}
if (exemptionProblems.length > 0) {
    console.error('check-lifecycle: FAILED — the exemption register is malformed\n');
    for (const p of exemptionProblems) console.error(`  ${p}`);
    console.error('\n  A shortcut must be declared, bounded and tracked (rule 2).\n');
    process.exit(1);
}

const granted = new Set(exemptions.map((e) => e.id));
const open = findings.filter((f) => !granted.has(f.site));
const stale = exemptions.filter((e) => !findings.some((f) => f.site === e.id));

// ---------------------------------------------------------------------------
// REPORT
// ---------------------------------------------------------------------------
if (open.length === 0 && stale.length === 0) {
    console.log(
        `check-lifecycle: ${files.length} production file(s), every SET has its UNSET — ` +
            `${latches.length} node latch(es), ${countersReleased.length} zero-gated ` +
            `counter(s), ${exercisedPairs.length} call pair(s) and ${actionsRead.length} ` +
            `input action(s) checked; ${exemptions.length} exemption(s) declared.`
    );
    console.log(
        `  node latches, raised and REACHED by their own path: ` +
            `${latches.join(', ') || 'none (nothing to check)'}`
    );
    console.log(
        `  zero-gated counters, all releasable: ` +
            `${countersReleased.join(', ') || 'none (nothing to check)'}`
    );
    console.log(
        `  call pairs with an acquire present, all released: ` +
            `${exercisedPairs.join(', ') || 'none (nothing to check)'}`
    );
    console.log(
        `  input actions read, all declared or built in: ` +
            `${actionsRead.join(', ') || 'none (nothing to check)'}`
    );
    console.log(`  considered and NOT checked: ${NOT_A_PAIR.map(([pair]) => pair).join('; ')}`);
    process.exit(0);
}

console.error(
    `check-lifecycle: FAILED — ${open.length} piece(s) of state are SET and never UNSET` +
        `${stale.length > 0 ? `, and ${stale.length} exemption(s) no longer match anything` : ''}\n`
);
for (const f of open) {
    console.error(`  ${f.line}`);
    console.error(`      ${f.because}`);
    console.error(`      ${f.how}\n`);
}
for (const e of stale) {
    console.error(`  ${e.id} is exempted and NOT FOUND.`);
    console.error(`      Declared: ${e.why}`);
    console.error(
        '      An exemption that no longer matches anything is a licence nobody revoked.\n' +
            '      Remove it from `lifecycleExemptions` in quality-baseline.json.\n'
    );
}
console.error(
    '  This is the class that shipped the greyed-out screen: one line set the dim true and\n' +
        '  nothing set it false, so it covered the rest of the run. The assertions passed\n' +
        '  because they read the dim’s ALPHA, and alpha is a property — this is a lifecycle.\n' +
        '\n' +
        '  This gate pairs by the RECEIVER NAME, so `var s := shade_rect` then `s.visible =\n' +
        '  false` pairs `s.visible` and NOT `shade_rect.visible` — an alias splits a pair that\n' +
        "  is really one. That is a KNOWN FALSE POSITIVE, listed in this file's header with its\n" +
        '  measurement; the fix is to assign to the receiver itself, not to exempt it.\n' +
        '\n' +
        '  To exempt one, add to `lifecycleExemptions` in quality-baseline.json:\n' +
        '      { "id": "<file>:<name>", "why": "...", "bound": "...",\n' +
        '        "trackedBy": "scripts/check-lifecycle.mjs" }\n' +
        '  An exemption that stops matching an open finding FAILS this gate.\n'
);
process.exit(1);
