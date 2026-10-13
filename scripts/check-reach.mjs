#!/usr/bin/env node
/**
 * @file scripts/check-reach.mjs
 * @description Can a player actually REACH what the game advertises?
 *
 * WHY THIS EXISTS
 *
 * Four player-visible bugs shipped in this project. **Every one was found by a person
 * playing, and not one was a logic error.** Two of them are this gate's class, and both
 * passed every assertion the project had:
 *
 *   WASD did nothing. The movement code was correct. `project.godot` had NO `[input]`
 *   section, so `ui_*` carried Godot's built-in arrow-key defaults and the letters were
 *   bound to nothing -- while the HUD printed "WASD / arrows to move" and the how-to screen
 *   printed "WASD / arrow keys to move". **The HUD advertised a capability that did not
 *   exist.** 280 assertions about state could not see it.
 *
 *   The menus could not be answered with a keyboard. Godot delivers `ui_accept` to whatever
 *   Control has FOCUS, and `grep -c grab_focus main.gd` returned 0, so the focus owner was
 *   null on every panel and Enter, Space, `1`, Down and numpad-1 all left the level-up
 *   picker open.
 *
 * The commit that fixed the first one named the shape exactly: *"the simulation was wired
 * and the input was not. Neither is a logic error, and neither was visible to 309
 * assertions about state."*
 *
 * WHAT THIS GATE ASKS, AND THE TRAP IT EXISTS FOR
 *
 *   1. **Is every advertised key bound at all?** The claims are READ FROM THE SOURCE --
 *      `project.godot`'s `[input]` declarations and the player-visible text that advertises
 *      controls -- not from a list written here. Adding a hint to the HUD without a binding
 *      fails this gate the day it is added, which is rule 12's move applied to the HUD: a
 *      test must drive the real table.
 *
 *   2. **Is the binding SHADOWED?** Declaring an action in `[input]` REPLACES its built-in
 *      default rather than adding to it. So the edit that adds WASD is exactly the edit that
 *      can silently kill the arrow keys -- and a gate that only asked "does the action exist"
 *      would pass on that. This one resolves each action to the bindings it REALLY has:
 *      declared events if it is declared, the engine's built-in defaults if it is not.
 *
 *   3. **Does the key reach code that reads it?** A binding nothing consumes is the same
 *      defect wearing a different hat, so a claim counts as reachable only through an action
 *      the game's own source polls (`Input.is_action_pressed("ui_up")`) or a `KEY_*` compared
 *      in an input handler.
 *
 *   4. **And does it WORK?** That is the half no amount of reading can answer, and it is what
 *      `godot/reach_probe.gd` is for. The probe DRIVES the running game and reports what
 *      changed; the verdicts are here.
 *
 * STATIC AND DYNAMIC, AND WHICH HALF CATCHES WHAT
 *
 *   STATIC (no Godot needed; `project.godot` and the Godot source are read as text)
 *     - a declared action with no events, or with an event that carries no key
 *     - an advertised key bound to nothing                      <- the WASD bug, offline
 *     - an advertised key whose binding was REPLACED away       <- the shadowing trap
 *     - a key a claim names that this gate cannot read, or a verb it cannot observe
 *     - an action the game polls that no input can produce       <- WASD's root cause, stated
 *                                                                  structurally rather than
 *                                                                  as one missing key
 *     It runs on a machine with no Godot, which is why the two shipped input bugs are
 *     catchable in CI even if the engine were never installed.
 *
 *   DYNAMIC (needs `godot`; NOTICE and exit 0 without it, like `check:godot`)
 *     - the engine's real `InputMap` disagreeing with the static model, including the
 *       built-in defaults the static half has to state as data
 *     - **a modal that cannot be answered**: focus landing on nothing, or on a Control
 *       OUTSIDE the modal, or a Control that holds focus and still does not answer. Driving
 *       it is the only way to tell those apart -- `verify_scene.gd` asserts a focus owner
 *       EXISTS at the menu and passes while the picker has none at all.
 *     - a key that reaches the right action and still does nothing: the probe drives W and
 *       asserts the hero MOVED, drives Esc and asserts the run PAUSED.
 *     - **a modal whose controls do not all work**: one control answering is not an answerable
 *       modal. The probe presses EVERY control the screen offers, one per run, and requires
 *       each to apply the offer it DISPLAYS -- the displayed offer read from the control's own
 *       LABEL, and the applied one identified through the game's own `Upgrades.apply`. A probe
 *       that pressed only the FOCUSED control was green on `_on_pick.bind(0)`; a check that
 *       compared against the offer each button was BUILT from was green on buttons that
 *       displayed one upgrade and applied another; and a loop bounded by the number of OFFERS
 *       was green on a fourth control that was offered to the player and never driven.
 *     - **a key advertised for a verb it does not perform**: "to resume" is measured from the
 *       PAUSED state. The older check asked only whether the run was PLAYING after a SECOND tap
 *       -- a question a key that does nothing answers correctly -- and accepted
 *       `Esc / P / W to resume` with W bound to movement alone. The resume must also take the
 *       pause SCREEN with it: a state that flips back while the panel stays up is a modal the
 *       player has already dismissed.
 *     Only the dynamic half can say "the picker was answerable", and only the static half
 *     can run where Godot is not installed. Neither half is sufficient; both are required.
 *
 * WHAT THE PROBE MEASURED THAT A GATE AUTHOR WOULD OTHERWISE GET WRONG
 *
 *   - A focused Button fires `pressed` on the RELEASE of `ui_accept`, not on the press. A
 *     gate that pushed only a keydown would fail on CORRECT code.
 *   - `Viewport.push_input()` routes a key to the focused Control but does not update
 *     `Input.is_action_pressed()`, so it cannot answer "does W move the hero". Only
 *     `Input.parse_input_event()` does both.
 *   - On the level-up screen a stray focus owner in the MENU took the Enter and started a new
 *     run: the picker closed, and a check that asked only "did the state change" recorded the
 *     unreachable picker as reachable. `activated_inside` exists because of that measurement.
 *   - A `resume` claim measured from PLAYING is VACUOUS, and this gate published one. The
 *     probe tapped the key twice from PLAYING and asked only whether the state was PLAYING
 *     after the second tap. With `Esc / P to resume` edited to `Esc / P / W to resume` -- W
 *     bound to movement and to nothing else -- the probe reported
 *     `toggle key=W playing=1 after_first=1 after_second=1` and this gate exited 0. **A
 *     capability the game advertises and does not deliver, which is this gate's whole
 *     purpose.** `REACH resume` exists because of that measurement: the key is now pressed
 *     while the run is PAUSED, the state it was really in is part of the verdict, and the
 *     pause SCREEN has to go with it -- measured: removing `_show_pause(false)` from the
 *     resume path (the state flips, the panel stays) exits 1 and names the three nodes left
 *     on screen.
 *   - The control the game FOCUSES is not the only control a modal offers, and the offer a
 *     control was BUILT from is not the offer it SHOWS. `_screen` drives the focused control,
 *     and on the picker that is always `Pick0` -- so `b.pressed.connect(_on_pick.bind(0))`,
 *     with two of the three offers applying the wrong upgrade, was green here too. The first
 *     fix for it compared the hero against `main._offers[i]` alone, and a button that
 *     DISPLAYED the next offer's name while applying its own was green as well. `_drive_offers`
 *     presses every control the screen offers, reads what each one DISPLAYS from its label,
 *     and reports the offer it applied.
 *
 * WHAT THIS GATE DOES NOT REACH — the ceilings, so that a green light is not read as more
 * than it is
 *
 *   - **Direction and magnitude are not tested.** The probe asks whether W moved the hero, not
 *     whether it moved it the RIGHT WAY or by the right distance; and it asks whether the run
 *     paused, not what the pause screen says. `verify_play.gd` and `verify_pixels.gd` are the
 *     tiers that own those. Measured on a tree whose `Hero.move` was changed to
 *     `x -= d.x * step * 0.01` -- reversed AND 100x smaller, `dy=1.200` where the baseline reads
 *     `dy=-120.000`: `check-reach: ok`, exit 0.
 *   - **`keycode` and `physical_keycode` are indistinguishable here.** The probe sends events
 *     with both fields set, which is what a real keyboard sends, so a binding that works only
 *     because of one of the two is not told apart.
 *   - **A screen with nothing focusable is SKIPPED, not failed** -- unless it offers buttons,
 *     which is D5a's finding. Measured on this tree: the gate prints `9 screen(s) skipped
 *     (nothing focusable)` and exits 0, and the paused panel is one of them.
 *   - **Only the LEVEL-UP screen is re-reached per control.** The accept check drives each
 *     screen once, at the moment the game reveals it, and `_drive_offers` re-enters the
 *     level-up state once per offered control. A defect that only appears on a rebuilt panel of
 *     ANOTHER screen is outside this gate: the probe's own discovery shows the picker's
 *     `Choices` box renamed to `@VBoxContainer@N` on some rebuilds, and
 *     `_focus_first("Picker/Offers/Choices")` then finds the previous, queued-for-deletion
 *     node -- a real defect, measured with a throwaway probe, that this gate does not fail on
 *     because its accept check drives the FIRST level-up and that one is clean.
 *   - **An offered control that is not one of the offers is REPORTED, not modelled.** A control
 *     the level-up screen presents that is not an upgrade is a failure whether or not it works,
 *     because this gate cannot say what it is for -- measured BOTH ways: a fourth `Reroll`
 *     button bound to nothing exits 1 (`wired=0`), and the same button bound to a real
 *     `_show_picks()` reroll exits 1 as well (`wired=1, changed=1`). A bona fide extra control
 *     needs this gate TAUGHT, which is the same stance the static half takes for a key it
 *     cannot read -- not an exemption. The alternative, accepting anything that changes
 *     something, is what let a control be offered and never driven in the first place.
 *   - **A resume reached through the `panel` route is half a check, and says so.** Where the
 *     game advertises NO pause key, the probe calls the game's own pause entry and sets the
 *     state itself, so `before === PAUSED` holds BY CONSTRUCTION and only the "leaves the paused
 *     state" half is measured. That run prints a `NOTICE:` -- a declared, visible gap rather
 *     than a pass, counted by `verify` as a gate that checked less -- and measured on this tree
 *     with the pause hint changed into a second resume hint: `via=panel` for ESCAPE and P, exit
 *     0, and `noticesIn()` collects the line. On a tree with an advertised pause key the
 *     stronger route runs and no NOTICE is printed.
 *   - **The displayed text is matched by PRESENCE, not by shape.** A control passes when its
 *     text STARTS with the name of the offer it applied and CONTAINS that offer's label and
 *     description, so every part has to belong to one offer — measured: a title from one offer
 *     with another's DESCRIPTION exits 1, and a label belonging to no offer on screen exits 1.
 *     What it does not do: it does not check the ORDER or the QUANTITY of the parts (extra text
 *     appended still passes), and two offers whose labels render IDENTICALLY cannot be told
 *     apart by the label — measured: swapping the label between two ` (New!)` offers is GREEN,
 *     and the rendered text is byte-identical, so there is nothing for a player to see either.
 *     `description` is read in exactly one place in this repository — the line `_show_picks`
 *     builds each button with — and no `verify_*.gd` reads a picker button's text at all, which
 *     is why this gate reads it back instead of trusting it.
 *   - **Two offers whose effects are indistinguishable are not told apart.** `applied` is a
 *     scan over `_hero_sig`, which covers weapons, passives, `max_hp`, `hp`, `speed` and
 *     `level`. A control whose index matches is credited to its own index deliberately (the
 *     player got the same thing either way), and a control that applied something matching NONE
 *     of the offers is reported. `Upgrades.choose` picks distinct entries, so this does not
 *     arise today; a future upgrade that changes a hero field outside that set would be
 *     reported rather than silently credited.
 *   Exit 0 and one line when it holds; non-zero with the diagnosis when it does not.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { NOTICE_PREFIX, refuseEmptyScan } from './lib/gate-input.mjs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
const godotDir = path.join(repoRoot, 'godot');

// ---------------------------------------------------------------------------
// Godot's key constants.
//
// STATED AS DATA, because the static half has to run where Godot is not installed -- and
// MEASURED on every machine that has it: the probe prints the engine's own values and this
// gate FAILS if the two disagree. A table that is checked against the engine is a table that
// cannot drift silently; a table that is not is a reading of `project.godot` that could be
// wrong in a way nothing would notice.
//
// The four arrow values are also visible in this repository's own `project.godot`, and the
// three `ui_accept` values were read out of Godot 4.7.2 directly.
// ---------------------------------------------------------------------------
const KEY_VALUES = {
    ESCAPE: 4194305,
    TAB: 4194306,
    BACKSPACE: 4194308,
    ENTER: 4194309,
    KP_ENTER: 4194310,
    LEFT: 4194319,
    UP: 4194320,
    RIGHT: 4194321,
    DOWN: 4194322,
    SPACE: 32
};
for (let c = 65; c <= 90; c += 1) KEY_VALUES[String.fromCharCode(c)] = c;
for (let d = 0; d <= 9; d += 1) KEY_VALUES[String(d)] = 48 + d;

/** The name of a key value, for a report a reader can act on. */
function keyName(value) {
    for (const [name, v] of Object.entries(KEY_VALUES)) if (v === value) return name;
    return `KEY_${value}`;
}

/**
 * The bindings Godot gives a built-in action when the project does NOT declare it.
 *
 * This is the shadowing trap's whole mechanism: `[input]` REPLACES these rather than adding
 * to them. Where the project declares an action the declaration is used; where it does not,
 * this is -- so "the arrows still work" is a claim the static half can check rather than
 * assume.
 *
 * Every entry is verified against the engine by the dynamic half (`checkBuiltInsAgree`),
 * wherever Godot is installed, so a wrong value here is a red gate and not a silent
 * misreading.
 */
const BUILT_IN_ACTIONS = new Map([
    ['ui_accept', ['ENTER', 'KP_ENTER', 'SPACE']],
    ['ui_cancel', ['ESCAPE']],
    ['ui_up', ['UP']],
    ['ui_down', ['DOWN']],
    ['ui_left', ['LEFT']],
    ['ui_right', ['RIGHT']]
]);

/**
 * The key names a control hint may use, longest first so `arrow keys` is not read as a word
 * beginning with an arrow.
 *
 * `value: null` means the gate RECOGNISES the name and cannot drive it -- reported as a
 * failure asking to be taught rather than ignored, because a claim nothing checks is the
 * defect this gate exists for.
 */
const KEY_WORDS = [
    { label: 'WASD', pattern: /\bWASD\b/iy, keys: ['W', 'A', 'S', 'D'] },
    { label: 'arrow keys', pattern: /\barrow\s+keys?\b/iy, keys: ['UP', 'DOWN', 'LEFT', 'RIGHT'] },
    { label: 'arrows', pattern: /\barrows?\b/iy, keys: ['UP', 'DOWN', 'LEFT', 'RIGHT'] },
    { label: 'Esc', pattern: /\bEsc(?:ape)?\b/iy, keys: ['ESCAPE'] },
    { label: 'Enter', pattern: /\bEnter\b/iy, keys: ['ENTER'] },
    { label: 'Space', pattern: /\bSpace(?:bar)?\b/iy, keys: ['SPACE'] },
    { label: 'Tab', pattern: /\bTab\b/iy, keys: ['TAB'] },
    { label: 'numpad', pattern: /\bnumpad\s*[0-9]\b/iy, keys: null }
];

/** A lone capital letter or digit is a key too -- `Esc / P to pause` names P that way. */
const SINGLE_KEY_WORDS = [
    { label: 'letter', pattern: /\b[A-Z]\b/y },
    { label: 'digit', pattern: /\b[0-9]\b/y }
];

/**
 * What a hint's verb has to be OBSERVED as, because "advertised" and "works" are different
 * claims. Only the first word of the verb is read, so "pause the game" and "move around"
 * are understood while a genuinely new control is not silently accepted.
 */
const VERBS = new Map([
    ['move', 'move'],
    ['run', 'move'],
    ['walk', 'move'],
    ['travel', 'move'],
    ['steer', 'move'],
    ['pause', 'pause'],
    ['resume', 'resume'],
    ['unpause', 'resume'],
    ['continue', 'resume']
]);

/** Words that may sit inside a key list without being key names themselves. */
const FILLER = /\b(?:press|hold|tap|hit|the|a|an|your|key|keys|then|using|use|with|or|and)\b/gi;

/** The actions the game's own source POLLS. Matched with their argument literals. */
const CONSUMES =
    /\b(?:is_action_pressed|is_action_just_pressed|is_action_just_released|is_action_released|get_action_strength|get_action_raw_strength|get_axis|get_vector)\s*\(([^)]*)\)/g;

// ---------------------------------------------------------------------------
// Reading the source
// ---------------------------------------------------------------------------

/**
 * Every file under `dir` whose name ends with `ext`, as paths relative to `dir`.
 *
 * RELATIVE TO `dir`, and that is not a style choice. It used to return repo-relative paths
 * and the caller then asked `path.relative(godotDir, f)` -- an ABSOLUTE directory against a
 * RELATIVE file, which `path.relative` resolves against the process's cwd. Where cwd and the
 * gate's own path disagree (`/tmp` is a symlink to `/private/tmp` on macOS) the answer was
 * `../../tmp/...` for EVERY file, so the "is this file in a subdirectory" test was true of
 * everything and every `verify_*.gd` was scanned as if it were the game. Four real control
 * claims became twenty-one, most of them prose from a test's own messages.
 */
function walk(dir, ext, prefix = '', out = []) {
    for (const entry of readdirSync(path.join(dir, prefix), { withFileTypes: true })) {
        const rel = prefix === '' ? entry.name : path.join(prefix, entry.name);
        if (entry.isDirectory()) {
            if (entry.name === '.godot') continue;
            walk(dir, ext, rel, out);
        } else if (entry.name.endsWith(ext)) {
            out.push(rel);
        }
    }
    return out;
}

/** `godot/`-relative to repo-relative, for a source label a reader can open. */
function inGodot(rel) {
    return path.join(path.relative(repoRoot, godotDir), rel);
}

/** A GDScript or scene string literal, with its escapes resolved. */
function unescape(literal) {
    return literal
        .replace(/\\n/g, '\n')
        .replace(/\\t/g, '\t')
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, '\\');
}

/**
 * The player-visible text of the game.
 *
 * THE CLAIM SOURCES ARE DISCOVERED, NOT LISTED. Two rules, both structural:
 *
 *   `.gd` under a SUBDIRECTORY of `godot/` -- the game's own source. Every test suite,
 *   the assertion harness and this gate's probe live at the TOP level of `godot/`, so the
 *   depth is what separates the game from the things that talk about it. A new script in a
 *   new subdirectory joins the scan the day it is added.
 *
 *   `.tscn` at ANY depth, for the display properties only. Extracting every string in a
 *   scene would read `path="res://A/B.tscn"` as a claim about the key A.
 */
function claimTexts() {
    const texts = [];
    const gd = walk(godotDir, '.gd').filter((f) => path.dirname(f) !== '.');
    for (const rel of gd) {
        const src = readFileSync(path.join(godotDir, rel), 'utf8');
        for (const m of src.matchAll(/"((?:[^"\\\n]|\\.)*)"/g)) {
            texts.push({ source: inGodot(rel), text: unescape(m[1]) });
        }
    }
    const scenes = walk(godotDir, '.tscn');
    for (const rel of scenes) {
        const src = readFileSync(path.join(godotDir, rel), 'utf8');
        for (const m of src.matchAll(
            /^[ \t]*(?:text|tooltip_text|placeholder_text|title)[ \t]*=[ \t]*"((?:[^"\\]|\\.)*)"/gm
        )) {
            texts.push({ source: inGodot(rel), text: unescape(m[1]) });
        }
    }
    return { texts, files: [...gd, ...scenes].map(inGodot) };
}

/** Every key word at its position in `clause`, longest match first. */
function keyWords(clause) {
    const found = [];
    let i = 0;
    while (i < clause.length) {
        let matched = false;
        for (const word of KEY_WORDS) {
            word.pattern.lastIndex = i;
            const m = word.pattern.exec(clause);
            if (m && m.index === i) {
                found.push({ label: word.label, keys: word.keys, start: i, end: i + m[0].length });
                i += m[0].length;
                matched = true;
                break;
            }
        }
        if (matched) continue;
        for (const word of SINGLE_KEY_WORDS) {
            word.pattern.lastIndex = i;
            const m = word.pattern.exec(clause);
            if (m && m.index === i) {
                found.push({ label: m[0], keys: [m[0]], start: i, end: i + m[0].length });
                i += m[0].length;
                matched = true;
                break;
            }
        }
        if (!matched) i += 1;
    }
    return found;
}

/**
 * The control claims in the game's player-visible text.
 *
 * A claim is `<keys> to <verb>`, which is the shape every hint in this game already has:
 *
 *     WASD / arrow keys to move
 *     Esc / P to pause
 *     Esc / P to resume
 *
 * Prose is skipped because it names no key -- "How to play", "Weapons auto-attack nearby
 * foes". A clause that names a key and something this gate cannot read as a key is a
 * FAILURE and not a skip, so a typo (`Wsad`) cannot hide a claim.
 */
/** A clause split on its separators, remembering WHERE each piece started. */
function segmentsWithOffsets(clause) {
    const out = [];
    const re = /;|\band\b/gi;
    let start = 0;
    let m;
    while ((m = re.exec(clause)) !== null) {
        out.push({ text: clause.slice(start, m.index), at: start });
        start = m.index + m[0].length;
    }
    out.push({ text: clause.slice(start), at: start });
    return out;
}

function controlClaims(texts) {
    const claims = [];
    const problems = [];
    for (const { source, text } of texts) {
        for (const clause of text.split(/[\n•]/)) {
            const words = keyWords(clause);
            for (const segment of segmentsWithOffsets(clause)) {
                const to = /\bto\b/i.exec(segment.text);
                if (!to) continue;
                const end = segment.at + to.index;
                const inBefore = words.filter((w) => w.start >= segment.at && w.end <= end);
                // NO KEY, NO CLAIM. This is the line that keeps prose out: "How to play",
                // "Lashes to both sides of the hero" and a hundred other sentences contain
                // the word "to" and would otherwise be read as controls. Removing it turned
                // 4 real claims into 21 phantom ones, every one of them a false failure.
                if (inBefore.length === 0) continue;
                const after = segment.text.slice(to.index + 2);
                const verbWord = (/^\s*([A-Za-z]+)/.exec(after) ?? [])[1];
                // A chunk of the key list that names no key: a typo, or a control this gate
                // cannot read. Either way it must not be silently dropped, and the chunk is
                // re-tokenized ON ITS OWN rather than by position -- a chunk that repeats
                // cannot then borrow the first one's match.
                for (const chunk of segment.text.slice(0, to.index).split(/[/,+]|\bor\b/i)) {
                    if (keyWords(chunk).length > 0) continue;
                    if (chunk.replace(FILLER, '').trim() === '') continue;
                    problems.push(
                        `${source}: the hint "${clause.trim()}" advertises "${chunk.trim()}", ` +
                            'which this gate cannot read as a key. Either it is a typo or ' +
                            '`scripts/check-reach.mjs` needs teaching -- an advertised control ' +
                            'nothing can check is what this gate exists for.'
                    );
                }
                if (inBefore.some((w) => w.keys === null)) {
                    problems.push(
                        `${source}: the hint "${clause.trim()}" advertises ` +
                            `${inBefore
                                .filter((w) => w.keys === null)
                                .map((w) => w.label)
                                .join(', ')}, ` +
                            'which this gate recognises and cannot drive. Teach it the key ' +
                            'values, or the claim goes unchecked.'
                    );
                    continue;
                }
                const verb = verbWord ? verbWord.toLowerCase() : '';
                if (!VERBS.has(verb)) {
                    problems.push(
                        `${source}: the hint "${clause.trim()}" says the key does ` +
                            `"${verbWord ?? 'nothing'}", and this gate has no way to observe ` +
                            'that. Teach `scripts/check-reach.mjs` the observation, or the ' +
                            'hint is an unchecked claim.'
                    );
                    continue;
                }
                claims.push({
                    source,
                    clause: clause.trim(),
                    keys: [...new Set(inBefore.flatMap((w) => w.keys ?? []))],
                    verb: VERBS.get(verb)
                });
            }
        }
    }
    return { claims, problems };
}

/** `[input]`'s declared actions and the events each one carries. */
function declaredActions(projectText) {
    const actions = new Map();
    let inInput = false;
    let name = null;
    let body = [];
    const flush = () => {
        if (name === null) return;
        const events = [];
        for (const piece of body.join('\n').split('Object(').slice(1)) {
            const blob = piece.slice(0, piece.indexOf(')'));
            events.push({
                type: /^(\w+)/.exec(blob)?.[1] ?? '?',
                keycode: Number(/"keycode":(-?\d+)/.exec(blob)?.[1] ?? 0),
                physical: Number(/"physical_keycode":(-?\d+)/.exec(blob)?.[1] ?? 0)
            });
        }
        actions.set(name, events);
        name = null;
        body = [];
    };
    for (const line of projectText.split('\n')) {
        if (/^\s*\[/.test(line)) {
            flush();
            inInput = line.trim() === '[input]';
            continue;
        }
        if (!inInput) continue;
        const open = /^([A-Za-z0-9_]+)=\{\s*$/.exec(line);
        if (open) {
            flush();
            name = open[1];
            continue;
        }
        if (name === null) continue;
        if (/^\}\s*$/.test(line)) {
            flush();
            continue;
        }
        body.push(line);
    }
    flush();
    return actions;
}

/** Every action the game's own source polls, and every `KEY_*` an input handler compares. */
function consumed() {
    const actions = new Map();
    const rawKeys = new Set();
    const handlers = [];
    const gd = walk(godotDir, '.gd').filter((f) => path.dirname(f) !== '.');
    for (const rel of gd) {
        const src = readFileSync(path.join(godotDir, rel), 'utf8');
        for (const m of src.matchAll(CONSUMES)) {
            for (const lit of m[1].matchAll(/"([^"]+)"/g)) {
                if (!actions.has(lit[1])) actions.set(lit[1], []);
                if (!actions.get(lit[1]).includes(rel)) actions.get(lit[1]).push(rel);
            }
        }
        if (/^func\s+_(?:unhandled_)?input\s*\(/m.test(src)) {
            handlers.push(rel);
            for (const m of src.matchAll(/\bKEY_([A-Z0-9_]+)\b/g)) {
                if (KEY_VALUES[m[1]] !== undefined) rawKeys.add(KEY_VALUES[m[1]]);
            }
        }
    }
    return { actions, rawKeys, handlers };
}

/** The keys an action REALLY answers: its declaration if it has one, else Godot's default. */
function effectiveKeys(action, declared) {
    if (declared.has(action)) {
        return declared
            .get(action)
            .filter((e) => e.type === 'InputEventKey')
            .flatMap((e) => [e.keycode, e.physical])
            .filter((v) => v > 0);
    }
    return (BUILT_IN_ACTIONS.get(action) ?? []).map((n) => KEY_VALUES[n]);
}

// ---------------------------------------------------------------------------
// The static half
// ---------------------------------------------------------------------------
const failures = [];
const staticNotes = [];

const projectText = readFileSync(path.join(godotDir, 'project.godot'), 'utf8');
const declared = declaredActions(projectText);
const { texts, files: claimFiles } = claimTexts();
const { claims, problems } = controlClaims(texts);
const { actions: consumedActions, rawKeys, handlers } = consumed();

for (const problem of problems) failures.push(problem);
for (const empty of [
    refuseEmptyScan(
        claimFiles.length,
        'Godot source files',
        "The advertised controls are read from the game's own source."
    ),
    refuseEmptyScan(
        claims.length,
        'advertised control claims',
        'This gate checks that what the game advertises is reachable, so finding no ' +
            'advertisement means it checked nothing.'
    ),
    refuseEmptyScan(
        consumedActions.size,
        'input actions the game polls',
        'Reachability needs a consumer: a binding nothing reads is the same defect as a ' +
            'key bound to nothing.'
    )
]) {
    if (empty) failures.push(empty);
}

// 1. A declared action must carry a key. `ui_up={ "events": [] }` is a declaration that
//    promises a capability and delivers none, and every other check here would pass it.
for (const [action, events] of declared) {
    if (events.length === 0) {
        failures.push(
            `project.godot declares the action "${action}" with NO events, so no input can ` +
                'produce it. A declaration is not a binding.'
        );
    } else if (!events.some((e) => e.type !== 'InputEventKey' || e.keycode > 0 || e.physical > 0)) {
        // A joypad or mouse event IS a binding, so only a declaration whose every event is a
        // KEY carrying no key at all is dead. Failing on "no keycode" alone would have
        // rejected a legitimate gamepad-only action -- a false failure on correct code, which
        // is the shape half the red tests in this project turned out to be.
        failures.push(
            `project.godot declares the action "${action}" with ${events.length} event(s) ` +
                'and every one of them is an InputEventKey carrying neither a keycode nor a ' +
                'physical keycode. A dead event is not a binding.'
        );
    }
}

// 2. Every advertised key must be REACHABLE: through an action the game polls, whose real
//    bindings answer that key -- or through a `KEY_*` compared in an input handler.
function reachable(value) {
    for (const action of consumedActions.keys()) {
        if (effectiveKeys(action, declared).includes(value)) return `the action ${action}`;
    }
    if (rawKeys.has(value)) return 'a KEY_ constant in an input handler';
    return null;
}

for (const claim of claims) {
    for (const name of claim.keys) {
        const value = KEY_VALUES[name];
        if (value === undefined) {
            failures.push(
                `${claim.source}: "${claim.clause}" names the key ${name}, which this gate has ` +
                    'no value for. Teach it the value, or the claim goes unchecked.'
            );
            continue;
        }
        if (reachable(value)) continue;
        failures.push(
            `${claim.source}: "${claim.clause}" advertises ${name}, and NOTHING can produce ` +
                `it.\n        No action the game polls answers ${name}` +
                (declared.size === 0
                    ? ', and `project.godot` has no `[input]` section at all -- which is ' +
                      'exactly the WASD bug: the HUD advertised keys that were bound to nothing.'
                    : ` (declared: ${[...declared.keys()].join(', ') || 'none'}).`) +
                `\n        The game compares KEY_${name} in none of its ` +
                `${handlers.length} input handler(s) either` +
                `${handlers.length > 0 ? ` (${handlers.join(', ')})` : ''}.`
        );
    }
}

// 3. Every action the game polls must be producible. This is WASD's root cause stated
//    structurally: code that reads an action nothing is bound to is a capability the player
//    cannot reach, whether or not anything advertises it.
for (const [action, where] of consumedActions) {
    const events = declared.get(action);
    const keys = effectiveKeys(action, declared);
    if (events !== undefined && events.length === 0) continue; // already reported above
    if (keys.length > 0) continue;
    failures.push(
        `${where.join(', ')} polls the action "${action}", and nothing can produce it: it is ` +
            `not declared in \`[input]\` and it is not one of Godot's built-in actions this ` +
            `gate knows (${[...BUILT_IN_ACTIONS.keys()].join(', ')}).\n        This is the ` +
            'WASD bug stated structurally -- the code is wired and the input is not.'
    );
}

staticNotes.push(
    `${claims.length} advertised claim(s) from ${claimFiles.length} file(s), ` +
        `${declared.size} declared action(s), ${consumedActions.size} polled action(s)`
);

if (failures.length > 0) {
    console.error(`check-reach: FAILED — ${failures.length} unreachable capability(ies).\n`);
    for (const f of failures) console.error(`  ${f}\n`);
    console.error(
        '  A capability the game advertises, and no input can produce, is invisible to every\n' +
            '  assertion about state -- which is how WASD shipped.'
    );
    process.exit(1);
}

// ---------------------------------------------------------------------------
// The dynamic half
// ---------------------------------------------------------------------------
function has(cmd) {
    try {
        execFileSync('which', [cmd], { stdio: 'pipe' });
        return true;
    } catch {
        return false;
    }
}

if (!has('godot')) {
    console.log(
        `check-reach: ok — ${staticNotes[0]}; no advertised key is bound to nothing and no ` +
            'polled action is unproducible.'
    );
    // The `NOTICE:` prefix with its COLON: `verify.mjs` counts that exact string, and a gate
    // that reports "checked nothing" in a shape the counter cannot see is a gate that
    // silently did nothing. /tmp/gate-input.mjs is the source of truth for the prefix.
    console.log(
        `check-reach: ${NOTICE_PREFIX} \`godot\` is not on PATH, so the DRIVEN half did NOT ` +
            'run. The configuration was read and the shadowing trap was checked, but no key ' +
            'was pressed and no modal was answered -- the focus and "it works when pressed" ' +
            'classes are UNVERIFIED on this machine.'
    );
    process.exit(0);
}

// The `class_name` cache lives in the gitignored `godot/.godot/`, so a fresh clone cannot
// load `Config`, `Hero` or the scene until this has run once. `check:godot` does the same.
try {
    execFileSync('godot', ['--headless', '--path', godotDir, '--import'], { stdio: 'ignore' });
} catch {
    /* `--import` exits non-zero on some builds even when it worked; the probe is the test. */
}

// Each key is driven in the state the claim is about, so the VERB the game advertises goes
// with it: a `resume` claim is measured from PAUSED, and a key advertised for both verbs is
// driven for both. A key with no claim at all cannot happen -- the list is built from claims.
const verbsByKey = new Map();
for (const claim of claims) {
    for (const name of claim.keys) {
        if (!verbsByKey.has(name)) verbsByKey.set(name, new Set());
        verbsByKey.get(name).add(claim.verb);
    }
}
const claimedKeys = [...verbsByKey.keys()].map((name) => ({
    name,
    value: KEY_VALUES[name],
    verbs: verbsByKey.get(name)
}));
// The key that gets the game INTO the paused state, so a `resume` claim is measured from a
// state a player can really be in. The first key advertised for `pause`, or none.
const pauseClaim = claims.find((c) => c.verb === 'pause');

let probeOut = '';
let probeErr = '';
try {
    probeOut = execFileSync(
        'godot',
        [
            '--headless',
            '--path',
            godotDir,
            '--script',
            'res://reach_probe.gd',
            '--',
            ...claimedKeys.map((k) => `--claim-key=${k.name},${k.value},${[...k.verbs].join('+')}`),
            ...(pauseClaim === undefined
                ? []
                : [`--pause-key=${pauseClaim.keys[0]},${KEY_VALUES[pauseClaim.keys[0]]}`]),
            `--declared=${[...declared.keys()].join(',')}`
        ],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 180_000 }
    );
} catch (err) {
    probeOut = `${err.stdout ?? ''}`;
    probeErr = `${err.stderr ?? ''}`;
    if (err.killed || err.signal) {
        probeErr +=
            '\n  (the probe was KILLED after 180s. A GDScript runtime error does not stop a ' +
            'SceneTree -- it prints a stack trace and the tree keeps running -- so a timeout ' +
            'usually means the probe script itself failed to load.)';
    }
}

const lines = probeOut.split('\n').map((l) => l.trim());
const read = (prefix) =>
    lines.filter((l) => l.startsWith(prefix)).map((l) => l.slice(prefix.length));
const fields = (line) => {
    const out = {};
    for (const m of line.matchAll(/([a-z_]+)=(.*?)(?= [a-z_]+=|$)/g)) out[m[1]] = m[2];
    return out;
};

const done = lines.includes('REACH done');
if (!done) {
    const tail = `${probeOut}\n${probeErr}`
        .split('\n')
        .filter((l) => l.trim())
        .slice(-12)
        .join('\n');
    console.error(
        'check-reach: FAILED — the probe did not finish, so nothing was driven. A gate that ' +
            'reports success by not running is worse than no gate.\n\n' +
            tail
    );
    process.exit(1);
}

const engineConstants = new Map();
for (const line of read('REACH constant ')) {
    const [name, value] = line.split('=');
    engineConstants.set(name, Number(value));
}
const engineActions = new Map();
for (const line of read('REACH action ')) {
    const f = fields(line);
    engineActions.set(f.name, {
        declared: f.declared === '1',
        keys: f.keys ? f.keys.split(',').map((k) => Number(k.split(':')[0])) : [],
        kinds: f.kinds ? f.kinds.split(',') : []
    });
}
const states = new Map();
for (const line of read('REACH state ')) {
    const [name, value] = line.split('=');
    states.set(name, Number(value));
}
const screens = read('REACH screen ').map(fields);
const accepts = read('REACH screenaccept ').map(fields);
const summaries = read('REACH screens ').map(fields);
const holds = new Map(read('REACH hold ').map((l) => [fields(l).key, fields(l)]));
const toggles = new Map(read('REACH toggle ').map((l) => [fields(l).key, fields(l)]));
const reached = new Map(read('REACH reached ').map((l) => [fields(l).label, fields(l)]));
const resumes = new Map(read('REACH resume ').map((l) => [fields(l).key, fields(l)]));
const offerScreens = read('REACH offers ').map(fields);
const offerDrives = read('REACH offer ').map(fields);

const dynamic = [];

// D0. The probe's own report has to be complete. Every section below reads from it, and a
// section that silently came back empty would turn every check that uses it into a pass.
const completeness = [
    ['engine key constants', engineConstants.size],
    ['engine actions', engineActions.size],
    ['scene states', states.size],
    ['screen summaries', summaries.length],
    ['screens with a focusable control', accepts.length],
    ['key observations', holds.size],
    ['key toggles', toggles.size],
    ['reachable states the probe drove to', reached.size],
    ['offer screens the probe discovered', offerScreens.length]
];
// Required only where the game makes the claim. A tree with no `resume` hint has no resume
// observation to be missing, and demanding one would be a false failure on correct code.
if (claims.some((c) => c.verb === 'resume')) {
    completeness.push(['resume observations', resumes.size]);
}
for (const [what, count] of completeness) {
    if (count === 0) {
        dynamic.push(
            `the probe reported 0 ${what}. Nothing below it can be checked, so this is a ` +
                'failure and not an empty result.'
        );
    }
}

// D1. The gate's own key table against the engine's. The static half reads
// `project.godot` through this table, so a wrong value would make the offline half lie.
for (const [name, value] of Object.entries(KEY_VALUES)) {
    if (!/^[A-Z]+$/.test(name)) continue;
    if (!engineConstants.has(name)) continue;
    if (engineConstants.get(name) === value) continue;
    dynamic.push(
        `this gate believes KEY_${name} is ${value} and the engine says ` +
            `${engineConstants.get(name)}. The static half reads \`project.godot\` through ` +
            'that table, so its verdicts cannot be trusted until this is fixed.'
    );
}

// D2. The engine's binding for every action the game polls -- the authority behind the
// static reading, and the half that resolves anything the static parser got wrong.
for (const action of consumedActions.keys()) {
    const found = engineActions.get(action);
    if (!found) {
        dynamic.push(`the game polls the action "${action}" and the engine has no such action.`);
        continue;
    }
    if (found.keys.length === 0 && found.kinds.length === 0) {
        dynamic.push(
            `the game polls the action "${action}" and the engine binds NOTHING to it, so no ` +
                'input can produce it.'
        );
    }
}

// D3. The built-in defaults are the one part of the static model that is not read from a
// file, so they are checked against the engine wherever the project does not declare them.
for (const action of consumedActions.keys()) {
    const found = engineActions.get(action);
    if (!found || found.declared) continue;
    const expected = BUILT_IN_ACTIONS.get(action);
    if (expected === undefined) continue;
    const want = expected.map((n) => KEY_VALUES[n]).sort((a, b) => a - b);
    const have = [...new Set(found.keys)].sort((a, b) => a - b);
    if (want.join(',') === have.join(',')) continue;
    dynamic.push(
        `this gate states Godot's built-in default for "${action}" as ` +
            `${want.map(keyName).join('+')} and the engine answers ` +
            `${have.map(keyName).join('+')}. The shadowing half of this gate is built on ` +
            'that table.'
    );
}

// D4. Every advertised key, in the engine's real map.
for (const claim of claims) {
    for (const name of claim.keys) {
        const value = KEY_VALUES[name];
        let via = null;
        for (const action of consumedActions.keys()) {
            const found = engineActions.get(action);
            if (found && found.keys.includes(value)) via = action;
        }
        if (via === null && rawKeys.has(value)) via = 'an input handler';
        if (via === null) {
            dynamic.push(
                `${claim.source}: "${claim.clause}" advertises ${name}, and the engine's own ` +
                    'InputMap answers it for no action the game polls.'
            );
        }
    }
}

// D5. THE MODALS. A screen that owns a focusable Control must be ANSWERABLE: focus inside
// it, `ui_accept` reaching a Control inside it, and the observable state changing. All
// three, and the third is why the first two are not enough -- a stray focus owner in the
// menu took an Enter and closed the picker without answering it.
const reported = new Set();

// D5a. A screen that OFFERS buttons and lets none of them take focus is unanswerable by
// keyboard, and the focus walk cannot see it -- the screen it describes has nothing
// focusable to report, so it would be skipped as "nothing to answer". `focus_mode` is what
// `grab_focus()` requires, and a Button left at FOCUS_NONE is a Button a keyboard player
// can never press.
for (const screen of screens) {
    if (Number(screen.buttons) === 0 || Number(screen.focusable) > 0) continue;
    if (reported.has(screen.path)) continue;
    reported.add(screen.path);
    dynamic.push(
        `the screen ${screen.path} offers ${screen.buttons} button(s) and NOT ONE can take ` +
            'focus, so no keyboard can press any of them. A focus_mode of NONE on a Button ' +
            'is a button with no keyboard path at all.'
    );
}

for (const accept of accepts) {
    const screen = screens.find((s) => s.path === accept.path) ?? {};
    if (accept.changed === '1' && accept.activated_inside === '1') continue;
    // One report per screen. An unanswerable menu stays visible for the rest of the run, so
    // it is re-driven at every later state -- and four copies of one finding read as four
    // findings, which is a report nobody can act on.
    if (reported.has(accept.path)) continue;
    reported.add(accept.path);
    const why = [];
    if (screen.focus_inside !== '1') {
        why.push(
            `focus is ${screen.focus === '-' ? 'NOWHERE' : `on ${screen.focus}`}, not inside it`
        );
    }
    if (accept.activated_inside !== '1') {
        why.push(
            accept.activated === '-'
                ? 'Enter and Space activated NOTHING'
                : `Enter activated ${accept.activated}`
        );
    }
    if (accept.changed !== '1') why.push('the game did not change at all');
    dynamic.push(
        `the screen ${accept.path} has ${screen.focusable} focusable control(s) and cannot be ` +
            `answered with the keyboard: ${why.join('; ')}.\n        A player with no mouse ` +
            'is stuck here, and this is the focus bug a second time -- `verify_scene.gd` ' +
            'asserts a focus owner exists at the MENU and passes while this screen has none.'
    );
}

// D6. Every advertised claim, DRIVEN. A key that reaches the right binding and does nothing
// is the same defect one layer further in, and only pressing it can tell.
const PLAYING = states.get('PLAYING');
const PAUSED = states.get('PAUSED');
for (const claim of claims) {
    for (const name of claim.keys) {
        const held = holds.get(name);
        const toggled = toggles.get(name);
        if (claim.verb === 'move') {
            if (!held) {
                dynamic.push(`${claim.source}: "${claim.clause}" -- ${name} was never driven.`);
            } else if (held.moved !== '1') {
                dynamic.push(
                    `${claim.source}: "${claim.clause}" -- holding ${name} moved the hero by ` +
                        `(${held.dx}, ${held.dy}). The key is bound and the hero does not move, ` +
                        'which is the WASD bug with the binding present.'
                );
            }
        }
        if (claim.verb === 'pause') {
            if (!toggled) {
                dynamic.push(`${claim.source}: "${claim.clause}" -- ${name} was never driven.`);
                continue;
            }
            if (Number(toggled.playing) !== PLAYING) {
                dynamic.push(
                    `${claim.source}: "${claim.clause}" -- ${name} was driven from state ` +
                        `${toggled.playing}, not PLAYING, so nothing was measured.`
                );
                continue;
            }
            if (Number(toggled.after_first) !== PAUSED) {
                dynamic.push(
                    `${claim.source}: "${claim.clause}" -- pressing ${name} during play left ` +
                        `the state at ${toggled.after_first}, not PAUSED (${PAUSED}).`
                );
            }
        }
        // A `resume` claim is judged FROM PAUSED, not from the second half of a toggle chain.
        // The chain asked only whether the state came back to PLAYING, and a key that does
        // NOTHING answers that correctly while the run never left PLAYING. Measured on the
        // tree before this check existed: `Esc / P to resume` edited to `Esc / P / W to resume`
        // -- W bound to movement and to nothing else -- reported `toggle key=W playing=1
        // after_first=1 after_second=1`, `check-reach: ok`, exit 0. A capability the game
        // advertises and does not deliver is exactly what this gate is for.
        if (claim.verb === 'resume') {
            const resumed = resumes.get(name);
            if (!resumed) {
                dynamic.push(
                    `${claim.source}: "${claim.clause}" -- ${name} was never driven from the ` +
                        'paused state, so the claim was not measured at all.'
                );
                continue;
            }
            if (Number(resumed.before) !== PAUSED) {
                dynamic.push(
                    `${claim.source}: "${claim.clause}" -- ${name} was pressed with the run in ` +
                        `state ${resumed.before}, not PAUSED (${PAUSED}), so nothing about ` +
                        `resuming was measured. The probe entered the paused state via ` +
                        `${resumed.via}, and that route did not pause the game.`
                );
            } else if (Number(resumed.after) !== PLAYING) {
                dynamic.push(
                    `${claim.source}: "${claim.clause}" -- pressing ${name} while PAUSED left ` +
                        `the state at ${resumed.after}, not PLAYING (${PLAYING}). The key is ` +
                        'advertised as the way out of the pause screen and does not take it.'
                );
            } else if (resumed.restored !== '1') {
                dynamic.push(
                    `${claim.source}: "${claim.clause}" -- pressing ${name} returned the state ` +
                        `to PLAYING but left ${resumed.lingering} on screen. A pause screen that ` +
                        'outlives the resume is a modal the player has already dismissed, and it ' +
                        'is the same class as the dim that covered the run: the state says the ' +
                        'thing is over and the screen says it is not.'
                );
            }
        }
    }
}

// D7. EVERY control a modal offers, not only the one the game focused. D5 above drives the
// FOCUSED control, and on the level-up picker that is always `Pick0` -- so
// `b.pressed.connect(_on_pick.bind(0))`, which makes two of the three offers apply the wrong
// upgrade, passed every check in this gate (measured: `check-reach: ok`, exit 0). A modal is
// not answerable because ONE of its controls answers.
//
// Each offered control is pressed in its own run. Three things are required of it, and each
// one was a measured hole in the version before it:
//
//   1. IT IS DRIVEN. `for i in mini(controls, offers)` left a fourth control discovered,
//      printed in `REACH offers`, and never driven -- silence read as success.
//   2. IT APPLIES THE OFFER IT DISPLAYS. Comparing the hero against `main._offers[i]` alone
//      passed a button that DISPLAYED the next offer's name while applying its own, because
//      the offer a button was BUILT from is not the offer it SHOWS. `displayed` is read from
//      the control's own label now, and ALL of it: the name it starts with plus that offer's
//      label and description, so one offer's title cannot be shown over another's text.
//   3. IT IS ONE OF THE OFFERS AT ALL. A control the gate has no model of is reported rather
//      than driven-and-forgotten: an offered control nothing can say anything about is the
//      class of silence this gate exists to break.
const summary = offerScreens[0] ?? {};
const offeredCount = Number(summary.total ?? 0);
const drivenIndexes = new Set(offerDrives.map((d) => Number(d.i)));
for (let i = 0; i < offeredCount; i += 1) {
    if (drivenIndexes.has(i)) continue;
    dynamic.push(
        `the level-up screen offers ${offeredCount} keyboard-reachable control(s) and control ` +
            `${i} was DISCOVERED and never driven, so nothing about it was checked. A control ` +
            'that is offered to the player and produces no verdict is silence, and silence is ' +
            'not a pass.'
    );
}
if (offerScreens.length > 0 && offeredCount === 0) {
    dynamic.push(
        'the level-up screen offered NO control a keyboard can reach, so which offer each ' +
            'control applies was never measured. A screen that offers a choice and cannot be ' +
            'driven is the unanswerable-modal bug this gate exists for.'
    );
}
for (const drive of offerDrives) {
    const where = `the level-up control ${drive.path} (control ${drive.i})`;
    if (drive.driven === '0') {
        dynamic.push(
            `${where} was never driven -- the control was not in the tree when its turn came, ` +
                'so nothing about it is checked.'
        );
        continue;
    }
    if (drive.focused !== '1') {
        dynamic.push(`${where} could not take focus, so Enter could not reach it.`);
        continue;
    }
    if (drive.fired !== '1') {
        dynamic.push(
            `${where} held focus and its own \`pressed\` never fired when Enter was sent, so ` +
                'the control cannot be activated at all.'
        );
        continue;
    }
    if (drive.beyond === '1') {
        const what =
            drive.wired === '0'
                ? 'it is bound to NOTHING, so activating it can never do anything'
                : drive.changed === '0'
                  ? 'it is wired, and activating it changes nothing observable'
                  : 'it is wired, and activating it did change something';
        dynamic.push(
            `${where} is not one of the offers on screen (${drive.offers}) -- it is an extra ` +
                `control this screen presents, and ${what}. This gate has no model of what such ` +
                'a control is for, so it cannot say whether it works, and a control offered to ' +
                'the player with no verdict is exactly the silence this gate exists to break. ' +
                'Teach `check-reach` what this control does, or remove it.'
        );
        continue;
    }
    if (drive.pristine !== '1') {
        dynamic.push(
            `${where} was measured against a hero that the pressed run did not start from ` +
                '(`pristine=0`), so "which offer was applied" compared two different starting ' +
                'states and measured nothing. `godot/reach_probe.gd` assumes a deterministic ' +
                'start; make that true or teach the probe the difference.'
        );
        continue;
    }
    if (drive.labelled !== '1') {
        dynamic.push(
            `${where} carries no text, so which offer it DISPLAYS could not be read from the ` +
                'control and was not measured. Comparing it against the offer it was BUILT ' +
                'from is the weaker claim that passed a mislabelled button.'
        );
        continue;
    }
    if (Number(drive.displayed) !== Number(drive.applied)) {
        dynamic.push(
            `${where} ` +
                (drive.displayed === '-1'
                    ? 'shows text matching NONE of the offers it could have been built from'
                    : `DISPLAYS offer ${drive.displayed}`) +
                ` and APPLIED offer ${drive.applied}. The offers on screen were ` +
                `${drive.offers}, and the whole displayed text has to belong to ONE of them -- ` +
                'title, label and description -- or the player is choosing from a description ' +
                'that belongs to a different upgrade.'
        );
        continue;
    }
    if (Number(drive.applied) !== Number(drive.i)) {
        dynamic.push(
            `${where} applied offer ${drive.applied} rather than its own. The offers on screen ` +
                `were ${drive.offers}. With every button bound to the same handler argument, ` +
                'two of the three offers apply the wrong upgrade and nothing else notices.'
        );
        continue;
    }
    if (drive.changed !== '1') {
        dynamic.push(
            `${where} applied its own offer, which it displays, and the game did not change at ` +
                'all, so the pick was not taken.'
        );
    }
}

if (dynamic.length > 0) {
    console.error(
        `check-reach: FAILED — ${dynamic.length} capability(ies) the game presents to a ` +
            'player are not reachable by one, measured by driving the game.\n'
    );
    for (const d of dynamic) console.error(`  ${d}\n`);
    console.error(
        '  Every one of these passed every assertion this project had. They are not logic\n' +
            '  errors; they are capabilities nobody could reach -- which is how WASD and the\n' +
            '  unanswerable menus shipped.'
    );
    process.exit(1);
}

const skipped = summaries.reduce((n, s) => n + (Number(s.visible) - Number(s.focusable)), 0);
console.log(
    `check-reach: ok — ${claims.length} advertised claim(s) reachable from the source AND ` +
        `driven, ${accepts.length} screen(s) answered by keyboard, ` +
        `${consumedActions.size} polled action(s) bound, ${skipped} screen(s) skipped ` +
        '(nothing focusable), engine constants and bindings AGREE'
);
// THE WEAKER ROUTE IS SAID OUT LOUD. See `_enter_paused` in the probe: where the game
// advertises no pause key, the probe sets the paused state itself, so `before === PAUSED` holds
// by construction and only the other half of those resume claims was measured. A `NOTICE:` here
// is what makes `verify` count this run as having checked less than the line above suggests --
// the same shape `check:godot` uses when the engine is absent.
const panelResumes = [...resumes.values()].filter((r) => r.via === 'panel');
if (panelResumes.length > 0) {
    console.log(
        `check-reach: ${NOTICE_PREFIX} ${panelResumes.length} resume claim(s) ` +
            `(${panelResumes.map((r) => r.key).join(', ')}) were measured from a PAUSED state ` +
            'the PROBE set, because the game advertises no pause key to reach it through. ' +
            '`before === PAUSED` therefore holds by construction, and only the "leaves the ' +
            'paused state" half of those claims was measured.'
    );
}
