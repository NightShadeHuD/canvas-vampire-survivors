/**
 * @file scripts/lib/annotate.mjs
 * @description Plan a type annotation for a parameter the compiler could not infer.
 *
 * This exists because `noImplicitAny` is 817 errors and almost all of them are a
 * parameter written while these files were JavaScript. Doing them by hand is
 * slow and doing them with a blunt instrument is what damaged `src/effects.ts`
 * once already:
 *
 *     update(dt: number, height: number?) {     // invalid
 *
 * `height` was ALREADY optional, and the annotator inserted at the identifier
 * instead of after the `?`. The lesson is not "do not script it" — it is
 * "script it, and make the script refuse anything it does not fully understand".
 *
 * SO THIS MODULE IS DELIBERATELY PESSIMISTIC
 *
 * `planAnnotation` is pure and returns either a new line or a reason it will not
 * touch the line. It refuses when:
 *
 *   - the identifier is not exactly where the compiler said it was;
 *   - the character after it is not one this module knows how to handle
 *     (`?`, `,`, `)`, `=` or end of line);
 *   - the name has no entry in the type table.
 *
 * A refusal is cheap. A wrong annotation costs a debugging session and, in the
 * case above, a corrupted file. Nothing here writes anything: see
 * `scripts/edit.mjs` for the write path, which anchors and verifies.
 */

/**
 * Types for the parameter names this codebase actually uses.
 *
 * Deliberately a table rather than a guess about the function body: inferring a
 * type from surrounding code is how an annotator becomes confidently wrong, and
 * every entry here is a name whose type is not in question.
 */
export const TYPE_BY_NAME = {
    // Time and geometry — the bulk of it.
    dt: 'number',
    t: 'number',
    x: 'number',
    y: 'number',
    w: 'number',
    h: 'number',
    r: 'number',
    i: 'number',
    n: 'number',
    size: 'number',
    alpha: 'number',
    life: 'number',
    speed: 'number',
    angle: 'number',
    radius: 'number',
    seconds: 'number',
    amount: 'number',
    value: 'number',
    level: 'number',
    width: 'number',
    height: 'number',
    // NOT a number. `effects.ts` reads `viewport.h`, so this is the shape object
    // the caller passes. It was in the table as `number` — a wrong entry that
    // cost nothing only because the guard below refuses to keep a change that
    // raises the error count.
    viewport: '{ w: number; h: number }',
    count: 'number',
    index: 'number',
    ms: 'number',
    fps: 'number',
    decay: 'number',
    duration: 'number',
    threshold: 'number',
    ratio: 'number',
    scale: 'number',
    damage: 'number',
    baseDamage: 'number',
    // Comparators and arithmetic operands: `(a, b) => a - b`.
    a: 'number',
    b: 'number',
    hp: 'number',
    score: 'number',
    total: 'number',

    // Text and identifiers.
    color: 'string',
    text: 'string',
    id: 'string',
    key: 'string',
    name: 'string',
    label: 'string',
    glyph: 'string',
    query: 'string',
    tag: 'string',
    type: 'string',
    message: 'string',
    url: 'string',
    selector: 'string',

    // Rendering.
    ctx: 'CanvasRenderingContext2D',

    // Loose, because these genuinely are heterogeneous in this codebase. They are
    // declared as `any` rather than guessed, and they are what `strictNullChecks`
    // and the follow-up work will tighten.
    // Real classes, not `any`. Each was `any` in the first version of this
    // table, which silenced the error and told a GDScript translator nothing.
    game: 'Game',
    player: 'Player',
    enemy: 'Enemy',
    def: 'any',
    opts: 'any',
    options: 'any',
    save: 'any',
    settings: 'any',
    map: 'any',
    fn: 'any',
    cb: 'any',
    obj: 'any',
    target: 'any',
    el: 'any',
    e: 'any',
    ev: 'any',
    data: 'any',
    entry: 'any',
    item: 'any',
    state: 'any',
    result: 'any',

    // A caught value is genuinely unknown.
    err: 'unknown',
    error: 'unknown'
};

/**
 * Types that name a class in this project, and where that class lives.
 *
 * WHY THIS EXISTS, AND WHY IT IS THE POINT OF THE EXERCISE
 *
 * A parameter left as `any` silences the error without saying anything. For a
 * GDScript port that is the worst possible outcome: `any` has no GDScript
 * equivalent, so the translator has to guess, and a guess is exactly what the
 * port cannot afford. `game: Game` translates; `game: any` does not.
 *
 * So the loose entries in `TYPE_BY_NAME` are being replaced by the real class,
 * and this table is what lets the annotator emit it. Every entry is a `type`
 * import, which the compiler erases — `verbatimModuleSyntax` is on and requires
 * the keyword, so there is no runtime cycle even where the module graph is
 * circular, which `src/game-render.ts` already relies on.
 */
export const NAMED_TYPES = {
    Game: './main.ts',
    Player: './entities.ts',
    Enemy: './entities.ts',
    Weapon: './weapons.ts',
    UI: './ui.ts'
};

/** Characters that may legally follow a parameter name and what to do about them. */
const FOLLOWERS = new Set(['?', ',', ')', '=', ' ', '\t', '\n', '']);

/**
 * Plan an annotation.
 *
 * @param {object} input
 * @param {string} input.line the source line, verbatim
 * @param {number} input.col the compiler's 1-based column of the parameter name
 * @param {string} input.name the parameter name the compiler reported
 * @param {Record<string, string>} [input.types] the type table to use
 * @returns {{ ok: boolean, line?: string, type?: string, reason?: string }}
 */
export function planAnnotation({ line, col, name, types = TYPE_BY_NAME }) {
    if (typeof line !== 'string') return { ok: false, reason: 'no line given' };
    if (typeof name !== 'string' || name === '') {
        return { ok: false, reason: 'no parameter name given' };
    }
    if (!Number.isInteger(col) || col < 1) return { ok: false, reason: `bad column ${col}` };

    const at = col - 1;
    if (line.slice(at, at + name.length) !== name) {
        // The compiler's position and the file disagree. Refuse rather than
        // search for the name elsewhere: a search finds the wrong occurrence and
        // that is how an edit lands in the wrong place.
        return {
            ok: false,
            reason:
                `the identifier is not at column ${col} — found ` +
                `${JSON.stringify(line.slice(at, at + name.length))}. ` +
                'The file has changed since the compiler read it.'
        };
    }

    const type = types[name];
    if (!type) {
        return {
            ok: false,
            reason: `no type known for '${name}'. Add it to the table deliberately rather than guessing.`
        };
    }

    let end = at + name.length;
    let optional = false;
    if (line[end] === '?') {
        // `name?` is already optional. TypeScript wants `name?: Type`, so the
        // annotation goes AFTER the marker. Inserting at the identifier produces
        // `name: Type?`, which is invalid — the exact failure that damaged a file.
        optional = true;
        end += 1;
    }

    const follower = line[end] ?? '';
    if (!FOLLOWERS.has(follower)) {
        return {
            ok: false,
            reason:
                `the character after '${name}${optional ? '?' : ''}' is ` +
                `${JSON.stringify(follower)}, which this does not know how to handle. ` +
                'Expected one of ? , ) = or end of line.'
        };
    }

    return {
        ok: true,
        type,
        line: line.slice(0, end) + `: ${type}` + line.slice(end)
    };
}
