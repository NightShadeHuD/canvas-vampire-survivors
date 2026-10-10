// Unit tests for scripts/lib/annotate.mjs.
//
// The module exists because a previous annotator damaged a file, so the tests are
// mostly about REFUSALS. Each refusal is cheap; a wrong annotation cost a
// debugging session and a corrupted `src/effects.ts`.
//
// The regression case is the optional parameter, and it is written from the real
// line that broke.
//
// Runs in Node, no DOM, no filesystem.

import test from 'node:test';
import assert from 'node:assert/strict';
import { planAnnotation, TYPE_BY_NAME, NAMED_TYPES } from '../scripts/lib/annotate.mjs';

/** Plan against a single line, with the column worked out from a marker. */
function plan(lineWithMarker: string, name: string) {
    const col = lineWithMarker.indexOf('|') + 1;
    const line = lineWithMarker.replace('|', '');
    return planAnnotation({ line, col, name });
}

// ---------------------------------------------------------------------------
// the shapes it must handle
// ---------------------------------------------------------------------------

test('annotate: a plain parameter is annotated', () => {
    const result = plan('    update(|dt) {', 'dt');
    assert.equal(result.ok, true);
    assert.equal(result.line, '    update(dt: number) {');
});

test('annotate: a parameter followed by a comma is annotated', () => {
    const result = plan('    move(|x, y) {', 'x');
    assert.equal(result.ok, true);
    assert.equal(result.line, '    move(x: number, y) {');
});

test('annotate: the last parameter before the closing paren', () => {
    const result = plan('    move(x, |y) {', 'y');
    assert.equal(result.ok, true);
    assert.equal(result.line, '    move(x, y: number) {');
});

test('annotate: an optional parameter keeps its marker FIRST', () => {
    // THE REGRESSION. Inserting at the identifier produced
    //     update(dt: number, height: number?) {
    // which is invalid TypeScript: the `?` must follow the type.
    const result = plan('    update(dt: number, |height?) {', 'height');
    assert.equal(result.ok, true);
    assert.equal(result.line, '    update(dt: number, height?: number) {');
});

test('annotate: a parameter with a default keeps the default', () => {
    const result = plan("    emit(x, y, |color = 'red') {", 'color');
    assert.equal(result.ok, true);
    assert.equal(result.line, "    emit(x, y, color: string = 'red') {");
});

test('annotate: an optional parameter with a default', () => {
    const result = plan('    spawn(|count? = 3) {', 'count');
    assert.equal(result.ok, true);
    assert.equal(result.line, '    spawn(count?: number = 3) {');
});

test('annotate: a context parameter gets the canvas type', () => {
    const result = plan('    render(|ctx, w, h) {', 'ctx');
    assert.equal(result.ok, true);
    assert.equal(result.line, '    render(ctx: CanvasRenderingContext2D, w, h) {');
});

test('annotate: a caught value is unknown, not any', () => {
    // `unknown` forces the caller to narrow; `any` does not.
    const result = plan('    catch (|err) {', 'err');
    assert.equal(result.ok, true);
    assert.equal(result.line, '    catch (err: unknown) {');
});

test('annotate: only the named occurrence is touched', () => {
    // The same name appearing earlier on the line must not be rewritten.
    const result = plan('    fn(dt, |dt) {', 'dt');
    assert.equal(result.ok, true);
    assert.equal(result.line, '    fn(dt, dt: number) {');
});

// ---------------------------------------------------------------------------
// the refusals
// ---------------------------------------------------------------------------

test('annotate: a stale column is refused, not searched for', () => {
    // If the file changed since the compiler read it, finding the name elsewhere
    // would land the edit on the wrong occurrence.
    const result = planAnnotation({ line: '    move(a, b) {', col: 11, name: 'x' });
    assert.equal(result.ok, false);
    assert.match(result.reason ?? '', /not at column 11/);
});

test('annotate: an unknown name is refused rather than guessed', () => {
    const result = plan('    f(|widget) {', 'widget');
    assert.equal(result.ok, false);
    assert.match(result.reason ?? '', /no type known for 'widget'/);
});

test('annotate: an unexpected following character is refused', () => {
    // `name: Existing` should never reach here for TS7006, and if it does this
    // must not silently produce `name: number: Existing`.
    const result = planAnnotation({ line: '    f(count: number) {', col: 7, name: 'count' });
    assert.equal(result.ok, false);
    assert.match(result.reason ?? '', /does not know how to handle/);
});

test('annotate: a bad column is refused', () => {
    assert.equal(planAnnotation({ line: 'x', col: 0, name: 'x' }).ok, false);
    assert.equal(planAnnotation({ line: 'x', col: 1.5, name: 'x' }).ok, false);
});

test('annotate: a missing line is refused', () => {
    assert.equal(planAnnotation({ line: undefined as never, col: 1, name: 'x' }).ok, false);
});

// ---------------------------------------------------------------------------
// the table itself
// ---------------------------------------------------------------------------

test('annotate: a caller can supply its own table', () => {
    const result = planAnnotation({
        line: '    f(widget) {',
        col: 7,
        name: 'widget',
        types: { widget: 'Widget' }
    });
    assert.equal(result.ok, true);
    assert.equal(result.line, '    f(widget: Widget) {');
});

test('annotate: every table entry is a plausible type', () => {
    for (const [name, type] of Object.entries(TYPE_BY_NAME)) {
        assert.match(name, /^[a-zA-Z_$][\w$]*$/, `${name} is not an identifier`);
        assert.equal(typeof type, 'string');
        assert.equal(type.length > 0, true, `${name} has an empty type`);
        // A `?` in the type is what produces `name: T?`, which is invalid.
        assert.equal(type.includes('?'), false, `${name} maps to '${type}', which contains '?'`);
    }
});

test('annotate: the table never maps to an empty or whitespace type', () => {
    for (const [name, type] of Object.entries(TYPE_BY_NAME)) {
        assert.equal(type.trim(), type, `${name} maps to a type with surrounding space`);
    }
});

test('annotate: a missing name is refused, not thrown on', () => {
    // Defence in depth. A caller parsing compiler output can get this wrong — as
    // this module's own CLI did, reading group 5 of a four-group regex — and a
    // pure planner that promises to refuse must not throw instead.
    assert.equal(planAnnotation({ line: 'f(x)', col: 3, name: undefined as never }).ok, false);
    assert.equal(planAnnotation({ line: 'f(x)', col: 3, name: '' }).ok, false);
});

test('annotate: a named type is emitted as the class, not as any', () => {
    // `any` has no GDScript equivalent, so it is the one answer that does not
    // help the port. These names map to real classes.
    assert.equal(plan('    f(|game) {', 'game').line, '    f(game: Game) {');
    assert.equal(plan('    f(|player) {', 'player').line, '    f(player: Player) {');
    assert.equal(plan('    f(|enemy) {', 'enemy').line, '    f(enemy: Enemy) {');
});

test('annotate: every named type says where it is defined', () => {
    // The annotator has to add the import, so an entry without a specifier would
    // produce a type that does not resolve.
    for (const [name, specifier] of Object.entries(NAMED_TYPES)) {
        assert.match(name, /^[A-Z]/, `${name} should be a class name`);
        assert.match(specifier, /^\.\/[\w-]+\.ts$/, `${name} has no importable specifier`);
    }
});

test('annotate: no table entry stays as a bare any unless it says why', () => {
    // Tightening this table is the whole exercise. `any` is still allowed for
    // genuinely heterogeneous parameters, but the count is asserted so it cannot
    // grow unnoticed.
    const loose = Object.entries(TYPE_BY_NAME).filter(([, t]) => t === 'any');
    assert.equal(
        loose.length <= 20,
        true,
        `too many parameters are still 'any': ${loose.map(([n]) => n).join(', ')}`
    );
});
