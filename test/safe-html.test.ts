// Tests for src/safe-html.ts — the one place this codebase turns data into
// markup — and for the structural rule that keeps it the one place.
//
// The vulnerability class this closes had NINE reproduced instances (a
// leaderboard import, a save file, a daily history, a keymap, a replay blob)
// reaching FIVE `innerHTML` sinks. Fixing those nine by hand leaves the tenth
// sink free to re-open all of them, so the last test in this file reads the
// SOURCE and refuses a sink that does not go through `mount`, and refuses an
// interpolation in an unquoted attribute. That test is the part that has to
// keep working after everybody has forgotten this commit.
//
// Runs in Node, no browser.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
    SafeHtml,
    clearHtml,
    escapeAttr,
    escapeText,
    html,
    mount,
    safeUrl
} from '../src/safe-html.ts';

/** A stub element that records the markup assigned to it, like a real one. */
function makeHost(): { innerHTML: string } {
    return { innerHTML: 'unset' };
}

// ---------------------------------------------------------------------------
// The escapers, one context at a time
// ---------------------------------------------------------------------------

test('escapeText: escapes the five characters that matter in text or a quoted attribute', () => {
    assert.equal(escapeText('a & b'), 'a &amp; b');
    assert.equal(escapeText('<b>hi</b>'), '&lt;b&gt;hi&lt;/b&gt;');
    assert.equal(escapeText('say "hi"'), 'say &quot;hi&quot;');
    assert.equal(escapeText("it's"), 'it&#39;s');
});

test('escapeText: leaves ordinary text alone, so legitimate content still renders', () => {
    // A REGRESSION GUARD, and the reason this is not one blanket escaper:
    // escaping the space as well would turn every rendered sentence into
    // `Keyboard&#32;shortcuts` in the DOM. It decodes to the same text in a
    // browser and it is still wrong — it makes every raw-markup assertion,
    // every diff and every a11y scan harder to read for no security gain.
    assert.equal(escapeText('Keyboard shortcuts'), 'Keyboard shortcuts');
    assert.equal(escapeText('WASD / ←↑↓→'), 'WASD / ←↑↓→');
    assert.equal(escapeText('Lv.5 — 1:40'), 'Lv.5 — 1:40');
});

test('escapeAttr: also escapes what would end an UNQUOTED attribute value', () => {
    // The declared gap: `escapeText` does not cover `title=${x}`, because a
    // space in the value would close it. This one does.
    assert.equal(escapeAttr('a b'), 'a&#32;b');
    assert.equal(escapeAttr('a\tb'), 'a&#9;b');
    assert.equal(escapeAttr('a\nb'), 'a&#10;b');
    assert.equal(escapeAttr('a`b'), 'a&#96;b');
    assert.equal(escapeAttr('a=b'), 'a&#61;b');
    // And a browser decodes every one of those back to the character it came
    // from, which is why escaping them costs nothing.
    assert.equal(
        'a&#32;b&#9;c'.replace(/&#(\d+);/g, (_m: string, n: string) =>
            String.fromCharCode(Number(n))
        ),
        'a b\tc'
    );
});

test('escaper output cannot break out of element content or a quoted attribute', () => {
    // The invariant is a COUNT, not a blacklist. The payload's characters are
    // still in the output — `onerror=` as text is not a vulnerability and
    // asserting its absence would be asserting the wrong thing — but every
    // quote and every angle bracket in the result belongs to the template. A
    // breakout is exactly one unescaped quote or one unescaped `<`.
    const payload = '"><img src=x onerror="window.__pwned=1">';
    const inText = `<span>${escapeText(payload)}</span>`;
    const inAttr = `<span title="${escapeText(payload)}">x</span>`;
    assert.equal(inText.split('"').length - 1, 0, `a quote escaped text content: ${inText}`);
    assert.equal(inText.split('<').length - 1, 2, `a live tag: ${inText}`);
    assert.equal(inAttr.split('"').length - 1, 2, `a quote broke the attribute: ${inAttr}`);
    assert.equal(inAttr.split('<').length - 1, 2, `a live tag: ${inAttr}`);
});

test('safeUrl: refuses every scheme that can execute', () => {
    // EVERY C0 control that Chromium strips out of a URL, not just tab and
    // newline. This test was NAMED "every scheme that can execute" and passed
    // while `\u0001javascript:...` came out of `safeUrl` as a live one — the
    // strip regex covered four characters and this list covered the same four,
    // so the name and the list agreed with each other and neither agreed with
    // the browser. Both halves are now the whole of C0.
    //
    // Measured in Chromium, with a positive control on a plain `javascript:`
    // URL first so an inert harness could not report these as safe:
    //   0001 0002 0003 0007 0008 0009 000a 000b 000c 000e 000f 001b 001f -> EXECUTED
    //   007f                                                            -> inert
    const stripped: number[] = [
        0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e,
        0x0f, 0x10, 0x1b, 0x1f, 0x7f
    ];
    for (const cp of stripped) {
        const ch = String.fromCharCode(cp);
        assert.equal(
            safeUrl(ch + 'javascript:window.__pwned=1').markup,
            '#',
            `leading U+${cp.toString(16).padStart(4, '0')} was not refused`
        );
    }
    for (const bad of [
        'javascript:alert(1)',
        'JaVaScRiPt:alert(1)',
        '  javascript:alert(1)  ',
        'java\tscript:alert(1)',
        'java\nscript:alert(1)',
        'data:text/html,<script>alert(1)</script>',
        'vbscript:msgbox(1)'
    ]) {
        assert.equal(safeUrl(bad).markup, '#', `not refused: ${JSON.stringify(bad)}`);
    }
});

test('escapeAttr: encodes every control, so a caller cannot emit a raw C0 either', () => {
    // `safeUrl` strips; this one ENCODES, so there is no way to emit a bare
    // control through either. The numeric reference decodes back to the same
    // character in a browser, which is why the cost is bytes and not fidelity.
    for (const cp of [0x00, 0x01, 0x0b, 0x0c, 0x1f, 0x7f]) {
        const ch = String.fromCharCode(cp);
        const out = escapeAttr('a' + ch + 'b');
        assert.ok(
            !/[\u0000-\u001f\u007f]/.test(out),
            `U+${cp.toString(16).padStart(4, '0')} passed through escapeAttr raw`
        );
        assert.equal(out, `a&#${cp};b`);
    }
    // And the characters it already covered still are.
    assert.equal(escapeAttr('a b'), 'a&#32;b');
    assert.equal(escapeAttr('a=b'), 'a&#61;b');
    assert.equal(escapeAttr('a`b'), 'a&#96;b');
});

test('safeUrl: allows what a link may legitimately be, and escapes it', () => {
    assert.equal(
        safeUrl('https://example.com/a?x=1&y=2').markup,
        'https://example.com/a?x&#61;1&amp;y&#61;2'
    );
    assert.equal(safeUrl('mailto:a@b.c').markup, 'mailto:a@b.c');
    assert.equal(safeUrl('/play').markup, '/play');
    assert.equal(safeUrl('#top').markup, '#top');
    assert.equal(safeUrl('').markup, '');
});

// ---------------------------------------------------------------------------
// The tagged template
// ---------------------------------------------------------------------------

test('html: escapes every interpolation, in text and in an attribute', () => {
    const payload = '<img src=x onerror="window.__pwned=1">';
    const node = html`<div class="hs-row" title="${payload}">${payload}</div>`;
    assert.ok(node instanceof SafeHtml);
    assert.ok(node.markup.includes('&lt;img'), 'the payload should still be visible as text');
    // Four quotes and two angle brackets: the ones THIS template wrote. Every
    // one of the payload's is a character reference, so it is data.
    assert.equal(node.markup.split('"').length - 1, 4, node.markup);
    assert.equal(node.markup.split('<').length - 1, 2, node.markup);
    assert.equal(
        node.markup,
        '<div class="hs-row" title="&lt;img src=x onerror=&quot;window.__pwned=1&quot;&gt;">&lt;img src=x onerror=&quot;window.__pwned=1&quot;&gt;</div>'
    );
});

test('html: a double-quoted attribute cannot be broken out of', () => {
    const payload = '"><img src=x onerror="window.__pwned=1">';
    const node = html`<div title="${payload}">x</div>`;
    assert.equal(node.markup.split('"').length - 1, 2, node.markup);
    assert.equal(node.markup.split('<').length - 1, 2, node.markup);
});

test('escapeText: a SINGLE-quoted attribute cannot be broken out of either', () => {
    // Written as a plain string rather than through `html` on purpose: Prettier
    // formats `html`-tagged templates as embedded HTML and normalises a
    // single-quoted attribute to a double-quoted one, which would leave this
    // case untested while looking tested.
    const payload = "' onmouseover='window.__pwned=1";
    const out = `<div title='${escapeText(payload)}'>x</div>`;
    assert.equal(out.split("'").length - 1, 2, out);
    assert.equal(out.split('<').length - 1, 2, out);
    assert.equal(out, "<div title='&#39; onmouseover=&#39;window.__pwned=1'>x</div>");
});

test('html: nests fragments and arrays without a join or a trust marker', () => {
    const rows = ['a', 'b', '<c>'].map((k) => html`<li>${k}</li>`);
    const node = html`<ul>
        ${rows}
    </ul>`;
    assert.ok(node.markup.includes('<li>a</li>'), node.markup);
    assert.ok(node.markup.includes('<li>&lt;c&gt;</li>'), node.markup);
});

test('html: renders 0, and renders null/false/undefined as nothing', () => {
    // `${0}` must not vanish: a level of 0 is a real value. The falsy cases are
    // what make `${cond && html`…`}` compose.
    assert.equal(html`${0}`.markup, '0');
    assert.equal(html`${1}`.markup, '1');
    assert.equal(html`${null}`.markup, '');
    assert.equal(html`${false}`.markup, '');
    assert.equal(html`${undefined}`.markup, '');
});

test('html: a SafeHtml passes through, a plain string does not', () => {
    const trusted = html`<b>bold</b>`;
    assert.equal(html`${trusted}`.markup, '<b>bold</b>');
    // The only way to get markup out of `html` is to have put it in through
    // `html`. This is what stops a future author marking user data as trusted:
    // there is no `raw()` for them to reach for.
    assert.equal(html`${'<b>bold</b>'}`.markup, '&lt;b&gt;bold&lt;/b&gt;');
});

test('mount / clearHtml: the only two writers of innerHTML', () => {
    const host = makeHost();
    mount(host, html`<i>${'<x>'}</i>`);
    assert.equal(host.innerHTML, '<i>&lt;x&gt;</i>');
    clearHtml(host);
    assert.equal(host.innerHTML, '');
    // A null host is a no-op, never a throw: a missing element is a layout
    // problem, and every caller already guards for it.
    assert.doesNotThrow(() => mount(null, html`x`));
    assert.doesNotThrow(() => clearHtml(null));
});

// ---------------------------------------------------------------------------
// The structural guard. This is the test that matters in a year's time.
// ---------------------------------------------------------------------------

/** Every tracked source file, read as text, RECURSIVELY.
 *
 * This used to be a single `readdirSync` of `src/`, which lists the top level
 * and nothing else — a hole with a loaded gun behind it. Splitting the
 * 1313-line `ui.ts` into `src/ui/` is an ordinary refactor, and the moment it
 * happened every file in the new directory would have gone UNSCANNED: the guard
 * would have gone quiet at exactly the moment the code moved, and a quiet guard
 * reads as a passing one. Watched: `src/sub/zz-nested.ts` containing
 * `el.innerHTML = payload` passed 17/0, while the same file at the top level
 * failed 16/1. `test/safe-html.test.ts` now also asserts the descent directly,
 * because this fix without it could be reverted silently.
 */
function sourceFiles(): Array<{ name: string; text: string }> {
    const root = fileURLToPath(new URL('../src/', import.meta.url));
    const out: Array<{ name: string; text: string }> = [];
    const walk = (dir: string, prefix: string): void => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
            const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
            if (entry.isDirectory()) {
                // Only dot-directories are skipped; `node_modules` cannot
                // appear under `src/`, and skipping it by name would be a
                // hiding place.
                if (!entry.name.startsWith('.')) walk(path.join(dir, entry.name), rel);
            } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.js')) {
                out.push({ name: rel, text: readFileSync(path.join(dir, entry.name), 'utf8') });
            }
        }
    };
    walk(root, '');
    return out;
}

/**
 * The `${…}` walk for TAG-POSITION safety.
 *
 * WHY A WALK AND NOT A REGEX. Three regexes were tried first and all three were
 * wrong in BOTH directions on the same eight fixtures, because the question is
 * not the shape of the text around the `${` — it is WHICH STATE the literal
 * text is in when the `${` arrives:
 *
 *   `value="${v}" ${v === value ? 'selected' : ''}`  — the second `${` is in
 *   ATTRIBUTE-NAME position and is LEGITIMATE, because its branches are string
 *   literals. `<input type="checkbox" ${payload}>` is the same position holding
 *   DATA, and that is the reported defect. They differ only in the expression.
 *
 * Quote state is tracked FORWARD, because a quoted value is one whose quotes are
 * still OPEN when the `${` arrives. Deciding it BACKWARDS was a bug: in
 * `<input type="checkbox" ${payload}>` the nearest preceding `"` is the CLOSING
 * quote of the previous attribute, so a value in NAME position was misread as
 * being safely inside a quoted value and passed.
 *
 * POSITIONS ARE ABSOLUTE. Every function takes the whole source and an index
 * into it, so a line number is always `lineOf(text, index)`. An earlier version
 * threaded RELATIVE offsets through two levels of recursion and was off by one
 * at each; there is no offset arithmetic here to get wrong.
 *
 * LIMIT, stated rather than implied: the body of an interpolation is not itself
 * walked for markup, only searched for nested `html`…``. Every sink in `src/`
 * is an `html` template, so this covers the tree, and the limit is written down
 * rather than left to be discovered.
 */
function endOfTemplate(text: string, from: number): number {
    let i = from + 1;
    while (i < text.length) {
        const c = text[i];
        if (c === '\\') {
            i += 2;
            continue;
        }
        if (c === '`') return i;
        if (c === '$' && text[i + 1] === '{') {
            i = endOfExpression(text, i + 1);
            continue;
        }
        i++;
    }
    return text.length;
}

/** The index just past the `}` closing the `{` at `open`. */
function endOfExpression(text: string, open: number): number {
    let depth = 0;
    let i = open;
    while (i < text.length) {
        const c = text[i];
        if (c === '\\') {
            i += 2;
            continue;
        }
        if (c === '`') {
            i = endOfTemplate(text, i) + 1;
            continue;
        }
        if (c === '{') depth++;
        else if (c === '}') {
            depth--;
            if (depth === 0) return i + 1;
        }
        i++;
    }
    return text.length;
}

/** The 1-based line of an absolute index. */
function lineOf(text: string, index: number): number {
    return text.slice(0, index).split('\n').length;
}

/** Walk one template body, `[from, to)` of the absolute source `text`. */
function walkTemplate(
    text: string,
    from: number,
    to: number,
    out: {
        refused: Array<{ line: number; expr: string }>;
        accepted: Array<{ line: number; expr: string }>;
    }
): void {
    let i = from;
    let inTag = false;
    let quote: string | null = null;
    while (i < to) {
        const c = text[i];
        if (quote) {
            if (c === quote) quote = null;
            i++;
            continue;
        }
        if (inTag) {
            if (c === '"' || c === "'") {
                quote = c;
                i++;
                continue;
            }
            if (c === '>') {
                inTag = false;
                i++;
                continue;
            }
            if (c === '$' && text[i + 1] === '{') {
                const end = endOfExpression(text, i + 1);
                const expr = text.slice(i + 2, end - 1);
                let k = i - 1;
                while (k >= from && /\s/.test(text[k])) k--;
                const before = k >= from ? text[k] : '';
                // `=` before it is the UNQUOTED-value form, which
                // `UNQUOTED_ATTRIBUTE` covers separately.
                if (before !== '=') {
                    (tagPositionInterpolationIsLiteral(expr) ? out.accepted : out.refused).push({
                        line: lineOf(text, i),
                        expr
                    });
                }
                i = end;
                continue;
            }
            i++;
            continue;
        }
        if (c === '<' && /[A-Za-z/]/.test(text[i + 1] || '')) {
            inTag = true;
            quote = null;
            i++;
            continue;
        }
        if (c === '$' && text[i + 1] === '{') {
            // TEXT position: safe, but it may CONTAIN a nested `html`…``.
            const end = endOfExpression(text, i + 1);
            let j = i + 2;
            while (j < end - 1) {
                const at = text.indexOf('html`', j);
                if (at === -1 || at >= end - 1) break;
                const open = at + 5;
                const close = endOfTemplate(text, open - 1);
                walkTemplate(text, open, close, out);
                j = close + 1;
            }
            i = end;
            continue;
        }
        i++;
    }
}

/** Every `html`-tagged template in `text`, walked. */
function scanTemplates(text: string): {
    refused: Array<{ line: number; expr: string }>;
    accepted: Array<{ line: number; expr: string }>;
} {
    const out = {
        refused: [] as Array<{ line: number; expr: string }>,
        accepted: [] as Array<{ line: number; expr: string }>
    };
    let i = 0;
    while (i < text.length) {
        const at = text.indexOf('html`', i);
        if (at === -1) break;
        const open = at + 5;
        const close = endOfTemplate(text, open - 1);
        walkTemplate(text, open, close, out);
        i = close + 1;
    }
    return out;
}

/** True when `text` contains an interpolation in NAME position that is refused. */
function hasBareTagInterpolation(text: string): boolean {
    return scanTemplates(text).refused.length > 0;
}

/**
 * The lines of a file that are CODE.
 *
 * Comment-only lines are dropped rather than stripped, because the modules
 * that explain these rules necessarily NAME them — this file's own prose says
 * `innerHTML` four times — and a guard that cannot tell an explanation from a
 * violation is a guard that gets deleted. Trailing comments are deliberately
 * NOT stripped: a false positive on a trailing comment fails loudly and costs
 * a reword, while a stripper clever enough to know a `/` in `https://` from a
 * comment start is a stripper with its own bugs.
 */
function codeLines(text: string): string[] {
    return text.split('\n').filter((line: string) => {
        const t = line.trim();
        return !(t.startsWith('//') || t.startsWith('*') || t.startsWith('/*'));
    });
}

/**
 * One branch of an accepted literal ternary, on its own.
 *
 * A run of attribute names, each optionally `="value"`, and nothing else. This
 * is ANCHORED, and that is the point: an earlier version hunted for quoted runs
 * and checked that each opened with a name, which matched `"1"` inside `x="1"`
 * and so rejected the pattern it was written to accept.
 */
const LITERAL_BRANCH = /^\s*(?:[A-Za-z][\w-]*(?:\s*=\s*"[^"]*")?\s*)*$/;
const LITERAL_TERNARY = /^\s*[^?'"]*\?\s*('(?:[^'\\]|\\.)*')\s*:\s*('(?:[^'\\]|\\.)*')\s*$/;

function attributeNameBranchIsLiteral(branch: string): boolean {
    return LITERAL_BRANCH.test(branch);
}

/**
 * Whether `${…}` in attribute-NAME position is one the rule accepts.
 *
 * ACCEPTED — a ternary whose BRANCHES ARE STRING LITERALS of plain attribute
 * names: `${cond ? 'selected' : ''}`, `${cond ? 'x="1"' : 'y="2"'}`. Such an
 * interpolation can produce a static attribute name or nothing; it cannot carry
 * a value, which is what makes the position safe. An accepted interpolation
 * therefore cannot hold data, which is the whole point.
 *
 * REFUSED — everything else, including `${cond ? name : ''}`. A variable there
 * might hold a constant today and be attacker-controlled tomorrow, so "it looks
 * static" is not the test; "it cannot hold data" is.
 */
function tagPositionInterpolationIsLiteral(expr: string): boolean {
    const m = LITERAL_TERNARY.exec(expr);
    if (!m) return false;
    // The capture RETAINS the quotes that delimit the literal, so strip them.
    return (
        attributeNameBranchIsLiteral(m[1].slice(1, -1)) &&
        attributeNameBranchIsLiteral(m[2].slice(1, -1))
    );
}

test('structural: the guards below are reading real files', () => {
    // A guard that scans nothing passes. This is the control for the three
    // tests after it: the file list is non-empty, and the one module that MUST
    // contain `innerHTML` does.
    const files = sourceFiles();
    assert.ok(files.length >= 20, `expected the whole of src/, saw ${files.length} files`);
    const safe = files.find((f) => f.name === 'safe-html.ts');
    assert.ok(safe, 'safe-html.ts is missing from the scan');
    assert.ok(safe.text.includes('innerHTML'), 'the scan is not reading file contents');
});

test('structural: src/ has exactly one innerHTML writer, and it is mount()', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles()) {
        if (file.name === 'safe-html.ts') continue;
        for (const line of codeLines(file.text)) {
            // A bare `= ''` clear is not a sink — a literal empty string cannot
            // carry a payload — but it is also not needed, because `clearHtml`
            // exists. Both forms are refused here so there is one way to do it.
            if (line.includes('innerHTML')) offenders.push(`${file.name}: ${line.trim()}`);
        }
    }
    assert.deepEqual(
        offenders,
        [],
        'innerHTML outside safe-html.ts — route it through mount(host, html`…`)'
    );
});

test('structural: src/ uses no other DOM markup entry point', () => {
    const banned = [
        'outerHTML',
        'insertAdjacentHTML',
        'document.write',
        'createContextualFragment',
        'new Function(',
        'eval('
    ];
    const found: string[] = [];
    for (const file of sourceFiles()) {
        if (file.name === 'safe-html.ts') continue;
        for (const line of codeLines(file.text)) {
            for (const needle of banned) {
                if (line.includes(needle)) found.push(`${file.name}: ${needle}`);
            }
        }
    }
    assert.deepEqual(found, [], 'a markup entry point that escaping at the sink does not cover');
});

test('structural: no interpolation sits in an attribute NAME position or an UNQUOTED value', () => {
    // Two positions `escapeText` does not cover, and one check that sees both.
    //
    //   UNQUOTED VALUE   `title=${x}` — a space in the value would end it.
    //   ATTRIBUTE NAME   `<input type="checkbox" ${x} />` — `escapeText` is a
    //                    complete NO-OP on `x onmouseover=window.__pwned=1` (it
    //                    escapes only `& < > " '`), so the browser creates a
    //                    live handler and dispatching it fires. The guard this
    //                    replaced required `name=` immediately before the `${`,
    //                    so it saw none of it.
    const unquoted = /[A-Za-z][\w-]*=\$\{/;
    const found: string[] = [];
    const approved: string[] = [];
    const files = sourceFiles();
    for (const file of files) {
        for (const line of codeLines(file.text)) {
            if (unquoted.test(line)) {
                found.push(`${file.name}: unquoted attribute value: ${line.trim()}`);
            }
        }
        const scan = scanTemplates(file.text);
        for (const bad of scan.refused) {
            found.push(`${file.name}:${bad.line}: ${bad.expr.replace(/\s+/g, ' ')}`);
        }
        for (const ok of scan.accepted) {
            approved.push(`${file.name}:${ok.line}: ${ok.expr.replace(/\s+/g, ' ')}`);
        }
    }
    // The control for the walk itself: "no findings" is only evidence if it
    // looked at something, so this names what it APPROVED. An empty list fails
    // rather than passing quietly.
    assert.ok(
        files.some((f) => f.text.includes('html`')),
        'the scan found no tagged templates at all, so it cannot have checked any'
    );
    // Two, and the count is a judgement the walk got RIGHT and an earlier
    // version of this list got wrong: `ui.ts:983` has the same ternary SHAPE
    // (`${conflictKeys.has(keys[0]) ? ' conflict' : ''}`) but sits INSIDE a
    // `class="…"` value, so it is a quoted interpolation and never reaches the
    // tag-position rule. Naming it made the walk look broken when it was right.
    assert.deepEqual(
        approved,
        ["ui.ts:1298: v === value ? 'selected' : ''", "ui.ts:1306: value ? 'checked' : ''"],
        'the set of ACCEPTED name-position interpolations changed — see tagPositionInterpolationIsLiteral'
    );
    assert.deepEqual(
        found,
        [],
        'an interpolation where an attribute NAME belongs — that position cannot be escaped; ' +
            "write name=\"${…}\" or a literal ternary such as ${cond ? 'checked' : ''}"
    );
});

test('structural: the scan reaches SUBDIRECTORIES, not just src/ top level', () => {
    // The control for the recursion. Without this, deleting the descent leaves
    // every other assertion in this file passing — which was MEASURED, not
    // assumed: with the `walk` call removed, a real `innerHTML = payload` sink
    // in `src/zz-recursion-probe/nested.ts` produced 18 pass / 0 fail.
    const dir = fileURLToPath(new URL('../src/', import.meta.url));
    const sub = path.join(dir, 'zz-recursion-probe');
    mkdirSync(sub, { recursive: true });
    try {
        writeFileSync(
            path.join(sub, 'nested.ts'),
            'export function f(el, payload) {\n    el.innerHTML = payload;\n}\n'
        );
        const names = sourceFiles().map((f) => f.name);
        assert.ok(
            names.includes('zz-recursion-probe/nested.ts'),
            `the scan did not descend into src/zz-recursion-probe — it saw: ${names.join(', ')}`
        );
        const offenders = sourceFiles()
            .filter((f) => f.name !== 'safe-html.ts')
            .filter((f) => codeLines(f.text).some((line) => line.includes('innerHTML')))
            .map((f) => f.name);
        assert.deepEqual(
            offenders,
            ['zz-recursion-probe/nested.ts'],
            'a nested sink was not refused'
        );
    } finally {
        rmSync(sub, { recursive: true, force: true });
    }
});

test('the tag-position walk can fail, and accepts exactly what it documents', () => {
    // Rule 11: a check is not a check until it has been watched to fail. Both
    // directions, against the walk directly, so this stays honest even after
    // `src/` changes shape.
    const regionOf = (s: string): string => `const x = html\`${s}\`;`;

    // REFUSED — data in attribute-NAME position.
    const refused = [
        '<input type="checkbox" ${payload} />',
        '<input type="checkbox" ${\'x onmouseover=window.__pwned=1\'} />',
        '<div ${x}>y</div>',
        '<div${x}>y</div>',
        '<a href="/" ${cond ? name : \'\'}>y</a>', // a VARIABLE branch
        '<a href="/" ${cond ? 1 : 2}>y</a>' // a NON-STRING branch
    ];
    for (const markup of refused) {
        assert.ok(
            hasBareTagInterpolation(regionOf(markup)),
            `the walk accepted a value in attribute-name position: ${markup}`
        );
    }

    // ACCEPTED — quoted values and text, which is where every `${` in `src/`
    // actually is. A guard that fires on legitimate templates gets deleted, and
    // deleting it is how the hole comes back.
    const accepted = [
        "<option value=\"${v}\" ${v === value ? 'selected' : ''}>${v}</option>",
        '<input type="checkbox" data-key="${key}" ${value ? \'checked\' : \'\'} />',
        "<a class=\"c ${s.id === currentId ? 'active' : ''}\">y</a>",
        '<div class="hs-row" title="${payload}">${payload}</div>',
        '<b>${plainText}</b>',
        "<b ${cond ? 'a' : 'b'}>y</b>" // a literal ternary even at tag start
    ];
    for (const markup of accepted) {
        assert.ok(
            !hasBareTagInterpolation(regionOf(markup)),
            `the walk refused a legitimate template: ${markup}`
        );
    }

    // THE DISCRIMINATING CASE, and the reason it is called out: every accepted
    // fixture whose `${` follows a quoted value also has a `name=` earlier in
    // the tag, so the OLD guard refused them too — reverting the rule to the old
    // regex left this whole test GREEN. Watched, not assumed. This fixture is
    // the one that tells the two apart.
    assert.ok(
        !hasBareTagInterpolation(
            regionOf("<option value=\"${v}\" ${v === value ? 'selected' : ''}>${v}</option>")
        ),
        'the discriminating case regressed to the old regex behaviour'
    );

    // The literal-ternary predicate, both directions.
    for (const expr of [
        "v === value ? 'selected' : ''",
        "value ? 'checked' : ''",
        "cond ? 'a' : 'b'",
        'cond ? \'x="1"\' : \'y="2"\''
    ]) {
        assert.ok(
            tagPositionInterpolationIsLiteral(expr),
            `refused a literal ternary it documents as accepted: ${expr}`
        );
    }
    for (const expr of [
        'payload',
        "cond ? name : ''",
        "cond ? 'a' : other",
        "cond ? 'x onmouseover=1' : ''",
        'cond ? 1 : 2'
    ]) {
        assert.ok(
            !tagPositionInterpolationIsLiteral(expr),
            `accepted a branch that is not a string literal: ${expr}`
        );
    }

    // The control for the control: the walk must actually be walking.
    assert.ok(
        !hasBareTagInterpolation('const s = `not a template ${x}`;'),
        'a plain template literal is not markup'
    );
});
