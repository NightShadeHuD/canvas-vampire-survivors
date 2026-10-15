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
import { readFileSync, readdirSync } from 'node:fs';
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

/** Every tracked source file, read as text. */
function sourceFiles(): Array<{ name: string; text: string }> {
    const dir = fileURLToPath(new URL('../src/', import.meta.url));
    return readdirSync(dir)
        .filter((name: string) => name.endsWith('.ts') || name.endsWith('.js'))
        .map((name: string) => ({ name, text: readFileSync(path.join(dir, name), 'utf8') }));
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

test('structural: no interpolation sits in an UNQUOTED attribute', () => {
    // `escapeText` covers element content and quoted attributes. It does NOT
    // cover `title=${x}`, where a space would end the value — so that form is
    // refused outright rather than left as a gap someone has to remember.
    // `escapeAttr` exists for a caller that genuinely needs it, and no template
    // does today.
    const unquoted = /[A-Za-z][\w-]*=\$\{/;
    const found: string[] = [];
    for (const file of sourceFiles()) {
        for (const line of codeLines(file.text)) {
            if (unquoted.test(line)) found.push(`${file.name}: ${line.trim()}`);
        }
    }
    assert.deepEqual(found, [], 'an unquoted attribute interpolation — write name="${…}" instead');
});
