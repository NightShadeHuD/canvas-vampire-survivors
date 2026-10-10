/**
 * Test doubles for the parts of `Game` a unit test actually needs.
 *
 * WHY THIS EXISTS
 *
 * A unit test of an entity wants a player with a position and a magnet range, not
 * a whole running game. Five test files were each building that by hand:
 *
 *     const game = {
 *         player: { x: 12, y: 10, getMagnetRange: () => 120, gainExp: (v) => … },
 *         createFloatingText: (...a) => floaters.push(a),
 *         audio: { pickup: () => sounds.push('pickup') },
 *         run
 *     };
 *
 * That is a deliberate, correct decision -- the alternative is booting a browser
 * and a real `Game` for every assertion about an orb -- but it became a problem
 * the moment `game: Game` started being declared on the entity methods. A partial
 * object does not satisfy the full type, so the compiler refused thirty call sites.
 *
 * WHY ONE CAST IS BETTER THAN THIRTY
 *
 * The cast is unavoidable: a partial genuinely is not a `Game`. What is avoidable
 * is thirty of them, scattered, each looking like an accident. Here there is one,
 * it has a name that says `stub`, and the reason is written down. `check:types`
 * counts one use of the escape hatch instead of a spray of them.
 *
 * WHAT THIS DOES NOT DO
 *
 * It does not pretend the double is complete. A method the test forgets to supply
 * is a `TypeError` at the call, exactly as before -- this makes the partial
 * *legal*, not *safe*. Tests that need real behaviour should use `withGame` in
 * `test/game.test.ts`, which boots a real `Game` inside the browser stub.
 *
 * @module test/helpers/game-stub
 */

import type { Enemy, Player } from '../../src/entities.ts';
import type { Game } from '../../src/main.ts';
import type { SaveData } from '../../src/storage.ts';

/**
 * A `Game`-shaped double, built from whatever the test cares about.
 *
 * @param overrides - The parts of `Game` the code under test will touch.
 * @returns The same object, typed as `Game`.
 */
export function makeGameStub<T extends object>(overrides: T): Game {
    return overrides as unknown as Game;
}

/**
 * A `Player`-shaped double.
 *
 * `Player` has thirty-odd fields; a test about an achievement needs `level`.
 */
export function makePlayerStub<T extends object>(overrides: T): Player {
    return overrides as unknown as Player;
}

/**
 * A save-shaped double, for the same reason and with the same trade-off.
 *
 * `SaveData` has sixteen fields and a test that exercises a high-score sort needs
 * about three of them.
 */
/**
 * An `Enemy`-shaped double.
 *
 * `Enemy` has thirty fields. The fixtures that need this one are checking that a
 * weapon slows, damages or knocks back a target -- they care about four of them.
 *
 * This was the LAST blocker named before it was written: `src/weapons.ts` could not
 * be annotated without it, and `src/main.ts` needs it too.
 */
export function makeEnemyStub<T extends object>(overrides: T): Enemy {
    return overrides as unknown as Enemy;
}

export function makeSaveStub(overrides: object) {
    return overrides as unknown as SaveData;
}
