/**
 * @file scripts/lib/measurements.mjs
 * @description The registry of numbers a document is allowed to state.
 *
 * WHY THIS EXISTS
 *
 * `check:claims` guarded ONE marked block in ONE file. An audit measured **176 numeric lines
 * across five documents and one guarded block** -- and found 15 stale numbers in the
 * unguarded remainder, including `Tests: 512` on the README badge against a real 845.
 *
 * The reason the block is marked rather than scraped is real: prose legitimately contains
 * HISTORICAL numbers ("792 test(s) agreed", "375 -> 0", "was 227"), and a parser that
 * matched any sentence with a digit would flag all of them and be switched off within a week.
 *
 * **So the fix is not a smarter parser. It is more marked blocks** -- and this is the list of
 * measurements they may refer to. A name that is not in here is a claim nothing can check,
 * which is how a number becomes folklore.
 *
 * Each entry returns the CURRENT measured value. None of them takes its value from a
 * document, and none from `quality-baseline.json`'s prose: a claim compared against another
 * hand-written number proves nothing.
 *
 * @module scripts/lib/measurements
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Build the registry. `repoRoot` is passed in rather than resolved here so a test can point
 * it at a fixture.
 *
 * @param {string} repoRoot
 * @returns {Record<string, () => number>}
 */
export function measurements(repoRoot) {
    const run = (args) => execFileSync(process.execPath, args, { cwd: repoRoot, encoding: 'utf8' });

    const suite = () => {
        const out = run(['--test', 'test/*.test.ts']);
        // The runner prints `ℹ pass 845`, not TAP's `# pass`. A wrong pattern here returns
        // NaN, and NaN !== anything -- so every claim would fail with a number nobody could
        // act on. Measured rather than assumed.
        return Number(/^\u2139 pass (\d+)$/m.exec(out)?.[1] ?? NaN);
    };

    const floor = () =>
        JSON.parse(readFileSync(path.join(repoRoot, 'quality-baseline.json'), 'utf8'))
            .testCountFloor;

    const data = async () => import(path.join(repoRoot, 'src', 'data.ts'));

    return {
        /** Executed tests, from the runner's own report. */
        tests: suite,
        /** The recorded suite floor -- a number a gate writes, not a person. */
        testFloor: floor,
        /** Entries in `src/data.ts`. The tables are the game's single source of truth. */
        weapons: async () => Object.keys((await data()).WEAPONS).length,
        passives: async () => Object.keys((await data()).PASSIVES).length,
        achievements: async () => (await data()).ACHIEVEMENTS.length,
        unlocks: async () => Object.keys((await data()).UNLOCKS).length,
        /** Gates `verify.mjs` actually runs, counted from the file that runs them. */
        verifySteps: () =>
            [
                ...readFileSync(path.join(repoRoot, 'scripts', 'verify.mjs'), 'utf8').matchAll(
                    /script:\s*'([^']+)'/g
                )
            ].length,
        /** Suppression ceilings, counted from the baseline rather than from prose. */
        suppressionCeilings: () =>
            Object.keys(
                JSON.parse(readFileSync(path.join(repoRoot, 'quality-baseline.json'), 'utf8'))
                    .suppressionCeilings ?? {}
            ).length
    };
}
