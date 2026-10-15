/**
 * @module safe-html
 * @description The ONE place this codebase turns data into markup.
 *
 * WHY THIS MODULE EXISTS
 *
 * A security audit found nine ways for untrusted data to reach an `innerHTML`
 * sink: the leaderboard import box, the save file's settings block, the daily
 * history, the keymap, and the replay blob. They were not nine bugs. They were
 * one bug — *a value reached HTML without being escaped* — reproduced nine
 * times, and the repository's own rule 10 says the answer to that class is to
 * make the safe form the EASY form rather than to fix nine call sites by hand.
 * A tenth sink added next month re-opens all nine.
 *
 * So there are exactly two things anyone needs to know:
 *
 *   1. `html` escapes EVERY interpolation. There is no way to interpolate a
 *      value into markup without it going through the escaper, so forgetting
 *      is not a mistake that is available.
 *   2. `mount(host, html`...`)` is the only way markup reaches the DOM, and
 *      `html()` returns a `SafeHtml`, which is deliberately NOT assignable to
 *      `innerHTML`. `el.innerHTML = html`...`` is a type error, not a code
 *      review question.
 *
 * WHAT IS COVERED, AND WHAT IS NOT
 *
 * Covered, and this is the whole list of contexts any sink here uses:
 *
 *   - element content          `<b>${value}</b>`
 *   - double-quoted attribute  `title="${value}"`
 *   - single-quoted attribute  `title='${value}'`
 *   - URL attributes           `href="${safeUrl(value)}"` — scheme allow-list.
 *     Escaping alone is NOT sufficient here: `javascript:alert(1)` is perfectly
 *     well-escaped and still executes. `safeUrl` is a separate function because
 *     it is a separate problem. `safeUrl` returns a fragment, so interpolating
 *     it never double-escapes.
 *
 * NOT covered, and there is no helper here for any of them:
 *
 *   - UNQUOTED attribute values (`title=${value}`). `escapeText` does not escape
 *     whitespace, so a space in the value would end it early. `escapeAttr` does
 *     cover this and is exported for it, but nothing in `src/` needs it today and
 *     `test/safe-html.test.ts` refuses an unquoted interpolation, so the gap is
 *     declared and mechanical rather than latent. QUOTE YOUR ATTRIBUTES.
 *
 *   - `<script>` / `<style>` raw-text contexts. Escaping cannot make text safe
 *     inside a script; the only safe value there is one you did not interpolate.
 *   - Event-handler attributes (`onclick="..."`) and `javascript:` URLs that did
 *     not come through `safeUrl`.
 *   - `style` attributes and CSS values.
 *   - DOM entry points other than `innerHTML`: `outerHTML`, `insertAdjacentHTML`,
 *     `document.write`, `Range.createContextualFragment`, `DOMParser`. None of
 *     them appears in `src/`, and `test/safe-html.test.ts` fails if one appears.
 *
 * Dependencies: none. This module must stay dependency-free — it is the floor
 * every other module stands on.
 *
 * Exports:
 *   - class SafeHtml
 *   - html, mount, clearHtml
 *   - escapeText, escapeAttr, safeUrl
 */

/**
 * A fragment of markup that has already been escaped.
 *
 * The type exists so the compiler, rather than a reviewer, enforces the rule:
 * `SafeHtml` has no index signature and is not a `string`, so assigning one to
 * `innerHTML` does not type-check. The only way in is `mount`.
 */
export class SafeHtml {
    /** The escaped markup. Never a raw, unescaped value. */
    declare markup: string;
    constructor(markup: string) {
        this.markup = markup;
    }
    toString(): string {
        return this.markup;
    }
}

/** Anything that can receive markup: a real element, or a test stub. */
export interface HtmlHost {
    innerHTML: string;
}

/**
 * One character of TEXT-OR-QUOTED-ATTRIBUTE content to its character reference.
 *
 * The quote characters are escaped here even though they are not special
 * between tags, and that is the whole design: ONE escaper whose output is valid
 * in element content AND in a single- or double-quoted attribute value means a
 * template author never has to decide which context they are in, so they cannot
 * decide wrongly. Escaping a quote in text content costs three bytes and
 * renders identically — the browser decodes `&#39;` back to `'` before anyone
 * reads it.
 *
 * What this does NOT cover is an UNQUOTED attribute value, where a space would
 * end the value early. `escapeAttr` covers that; `test/safe-html.test.ts`
 * refuses an unquoted interpolation in `src/`, which is why the gap is
 * declared rather than latent.
 */
function textRef(ch: string): string {
    if (ch === '&') return '&amp;';
    if (ch === '<') return '&lt;';
    if (ch === '>') return '&gt;';
    if (ch === '"') return '&quot;';
    return '&#39;';
}

/**
 * One character of an ATTRIBUTE VALUE to its character reference.
 *
 * Beyond the three text escapes this covers both quote characters, so it is
 * safe quoted either way, plus the three characters that can end an UNQUOTED
 * value (`` ` ``, `=`, and ASCII whitespace, which takes the numeric-reference
 * branch at the bottom). A numeric reference decodes back to the same character
 * inside a quoted value, so the extra escapes cost nothing but bytes.
 */
function attrRef(ch: string): string {
    if (ch === '&') return '&amp;';
    if (ch === '<') return '&lt;';
    if (ch === '>') return '&gt;';
    if (ch === '"') return '&quot;';
    if (ch === "'") return '&#39;';
    if (ch === '`') return '&#96;';
    if (ch === '=') return '&#61;';
    return '&#' + ch.charCodeAt(0) + ';';
}

/**
 * Escape a value for element content or a quoted attribute value.
 *
 * This is what `html` interpolates with, and it is deliberately the ONLY thing
 * `html` interpolates with: one escaper that is correct in both of the contexts
 * a template can put a value in, so there is no context to get wrong.
 *
 * See `escapeAttr` for the strictly stronger form, needed only by an unquoted
 * attribute (none exists in `src/`, and a test refuses one).
 */
export function escapeText(value: unknown): string {
    return String(value).replace(/[&<>"']/g, textRef);
}

/**
 * Every character `escapeAttr` must encode, as one class.
 *
 * The last term is the one that matters and it used to be five characters
 * (`\u0009\u000a\u000c\u000d\u0020`) rather than the whole of C0. That gap was
 * not cosmetic: **a browser strips a leading C0 control out of a URL and then
 * executes what is left**, so `\u0001javascript:…` is a live `javascript:` URL
 * while the `javascript:` a scheme check would look for is not at the start of
 * the string. Escaping these as numeric references does not help either — the
 * parser decodes `&#1;` back to the control BEFORE the URL is read, which was
 * measured in Chromium, not reasoned about:
 *
 *   href="&#1;javascript:…"  ->  property `javascript:…`  ->  EXECUTES
 *
 * Hence `safeUrl` below strips them, and this class encodes them so that a
 * caller who uses `escapeAttr` directly has no way to emit a raw C0 either.
 * U+007F is included for the same reason and is NOT known to be exploitable:
 * Chromium leaves it in the URL rather than stripping it, so it is inert. It is
 * encoded because "refuse every non-printable" is a rule that cannot go stale,
 * while a list of the specific ones a particular browser strips can.
 */
const ATTR_UNSAFE = /[&<>"'`=\u0000-\u0020\u007f]/g;

/**
 * Escape a value for an ATTRIBUTE VALUE, quoted or unquoted.
 *
 * Beyond `escapeText` this covers the characters that can end an UNQUOTED value
 * and everything that can be decoded back into a URL's scheme: `` ` ``, `=`,
 * ASCII whitespace and every C0 control (see `ATTR_UNSAFE`). A numeric reference
 * decodes back to the same character inside a quoted value, so the extra cost is
 * bytes, not fidelity.
 */
export function escapeAttr(value: unknown): string {
    return String(value).replace(ATTR_UNSAFE, attrRef);
}

/**
 * Every character `safeUrl` strips before it reads a scheme: the whole of C0,
 * plus DEL. NOT a global regex, deliberately — this is used with `.test()`, and
 * a `/g` regex carries `lastIndex` between calls, so the second `.test()` on a
 * string starting with a control would skip it. One regex, no flag, no state.
 */
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

/**
 * A URL that is safe to place in `href`, `src`, `action`, `formaction`,
 * `poster` or `srcset`, already escaped for the attribute.
 *
 * Escaping is not enough for a URL: `javascript:alert(1)` contains nothing an
 * attribute escaper would touch and still executes when clicked. So the scheme
 * is checked against an allow-list, and anything else collapses to `#`, which
 * is inert and visibly wrong rather than silently dangerous.
 *
 * EVERY C0 control and DEL is stripped BEFORE the scheme is read, and that set
 * is the whole of U+0000-U+001F rather than the four characters this used to
 * list. Tabs and newlines were only ever the ones that were noticed: Chromium
 * strips a leading U+0001 out of a URL exactly as it strips a tab, and what is
 * left is then executed. Measured in Chromium, one row per control:
 *
 *   \u0001javascript:...  ->  href property `javascript:...`  ->  EXECUTES
 *   \u0002 \u0003 \u0007 \u0008 \u000b \u000c \u000e \u000f \u001b \u001f  ->  EXECUTES
 *   \u0009 (tab), \u000a (LF)                                ->  EXECUTES (handled)
 *   \u007f (DEL)                                             ->  inert: NOT stripped
 *
 * DEL is stripped anyway. It is inert in Chromium today because the URL parser
 * leaves it in place rather than stripping it, but stripping a character that
 * cannot appear in a URL costs nothing and missing the next such character
 * costs an XSS -- so the rule here is "nothing non-printable survives" rather
 * than "nothing on this browser's strip list survives".
 *
 * Stripping is not enough on its own, because escaping cannot rescue it either:
 * the markup a caller interpolates this into is parsed BEFORE the URL is read,
 * so `escapeAttr` turns a control into `&#1;` and the parser then decodes it
 * straight back. That was measured as well. So the string is RE-CHECKED after
 * the strip and a surviving control refuses the whole URL rather than being
 * emitted.
 */
export function safeUrl(value: unknown): SafeHtml {
    const cleaned = String(value).replace(CONTROL_CHARS, '').trim();
    // Belt and braces: the strip above is the fix, and this is the assertion
    // that it worked. A URL reaching an `href` with a control still in it is
    // the whole defect, so refuse rather than emit one.
    if (CONTROL_CHARS.test(cleaned)) return new SafeHtml('#');
    if (!cleaned) return new SafeHtml('');
    const scheme = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(cleaned);
    if (scheme) {
        const name = scheme[1].toLowerCase();
        if (name !== 'http' && name !== 'https' && name !== 'mailto' && name !== 'tel') {
            return new SafeHtml('#');
        }
    }
    // No scheme at all is a relative reference (`/play`, `?q=1`, `#top`) or a
    // protocol-relative one (`//host/path`), both of which inherit the page's
    // scheme and cannot introduce `javascript:`.
    return new SafeHtml(escapeAttr(cleaned));
}

/**
 * Render one interpolated value.
 *
 * A nested fragment passes through (it is escaped already), an array renders
 * element by element so `${rows.map(...)}` needs no `.join('')`, and everything
 * else is escaped. There is deliberately no "trust me" branch: a value can only
 * reach the output unescaped by having been built here.
 */
function renderValue(value: unknown): string {
    if (value instanceof SafeHtml) return value.markup;
    if (Array.isArray(value)) return value.map(renderValue).join('');
    // `== null` rather than `=== null || typeof value === 'undefined'`: it is
    // the one form that catches both, and neither `undefined` as a value nor
    // `typeof x === 'undefined'` may be written in `src/` (both are tracked
    // port hazards, and the ceiling may only fall).
    if (value == null) return '';
    // `false` renders as nothing so `${cond && html`…`}` composes; `0` does NOT,
    // because a level of 0 is a real value a caller may interpolate.
    if (value === false) return '';
    return escapeText(value);
}

/**
 * Tagged template that escapes every interpolation.
 *
 *     mount(host, html`<div title="${tip}">${label}</div>`);
 *
 * Every value is escaped; a value already built by `html` is passed through
 * untouched, so fragments nest and arrays of fragments concatenate without any
 * explicit "this one is safe" marker for a future author to misuse.
 */
export function html(strings: TemplateStringsArray, ...values: unknown[]): SafeHtml {
    let out = '';
    for (let i = 0; i < strings.length; i++) {
        out += strings[i];
        if (i < values.length) out += renderValue(values[i]);
    }
    return new SafeHtml(out);
}

/**
 * The only way markup reaches the DOM.
 *
 * `host` may be null so callers keep the `if (!el) return;` guard they already
 * have. A null host is a no-op, never an error — a missing element is a layout
 * problem, and throwing on it would turn one into a crash.
 */
export function mount(host: HtmlHost | null, node: SafeHtml): void {
    if (host) host.innerHTML = node.markup;
}

/** Empty a container. The only legitimate use of a raw empty assignment. */
export function clearHtml(host: HtmlHost | null): void {
    if (host) host.innerHTML = '';
}
