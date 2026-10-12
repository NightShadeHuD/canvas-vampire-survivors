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

/** Whether a tool this registry needs is on PATH. */
function hasCommand(cmd) {
    try {
        // `which`, not `command -v` in a shell. Passing args with `shell: true` is
        // deprecated for the escaping reason Node gives, and `which` is a real binary.
        execFileSync('which', [cmd], { stdio: 'pipe' });
        return true;
    } catch {
        return false;
    }
}
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
    /**
     * Run a command and return its OUTPUT whether or not it succeeded.
     *
     * `execFileSync` throws on a non-zero exit, and **every measurement here runs a command
     * that exits non-zero when the thing it measures is bad**: `node --test` fails when a
     * test fails, `godot` fails when a suite fails. The first version let that propagate.
     *
     * TWO CI FAILURES from this one shape: `spawnSync godot ENOENT` took the gate down on a
     * runner without Godot, and then a FAILING TEST did the same on a runner with it.
     * **A measurement that throws on a bad value cannot report a bad value.**
     */
    const run = (args) => {
        try {
            return execFileSync(process.execPath, args, { cwd: repoRoot, encoding: 'utf8' });
        } catch (err) {
            return `${err.stdout ?? ''}${err.stderr ?? ''}`;
        }
    };

    const suite = () => {
        const out = run(['--test', 'test/*.test.ts']);
        // The runner prints `ℹ pass 845`, not TAP's `# pass`. A wrong pattern here returns
        // NaN, and NaN !== anything -- so every claim would fail with a number nobody could
        // act on. Measured rather than assumed.
        const m = /pass (\d+)/.exec(out);
        // NaN where the report could not be read at all -- reported as unmeasured rather
        // than compared, because NaN !== NaN would fail every claim with no useful number.
        return m ? Number(m[1]) : null;
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
        /**
         * GDScript assertions, counted from the suites' own output.
         *
         * Runs Godot, so it is the slowest entry here -- and it is worth it, because this is
         * the number `docs/GODOT-PORT.md` quotes in almost every section.
         */
        godotAssertions: () => {
            if (!hasCommand('godot')) return null;
            // NULL WHERE GODOT IS ABSENT, not a throw.
            //
            // CI proved this the first time it ran there: `spawnSync godot ENOENT` took
            // `check:claims` down, because a measurement that needs a tool crashes where the
            // tool is missing. Same defect the self-test ledger had, same fix -- **a thing
            // that could not be measured is not a thing that failed.**
            if (!hasCommand('godot')) return null;
            const checks = [
                'verify_data',
                'verify_slice',
                'verify_scene',
                'verify_play',
                'verify_xp',
                'verify_weapons',
                'verify_passives',
                'verify_invariants',
                'verify_archetypes',
                'verify_assertions',
                'verify_achievements',
                'verify_save'
            ];
            let total = 0;
            for (const c of checks) {
                // A NON-ZERO EXIT IS DATA, not an error. `execFileSync` throws when a suite
                // fails, and the first version let that take `check:claims` down -- so a
                // failing suite crashed the measurement instead of contributing its count.
                let out = '';
                try {
                    out = execFileSync(
                        'godot',
                        [
                            '--headless',
                            '--path',
                            path.join(repoRoot, 'godot'),
                            '--script',
                            `res://${c}.gd`
                        ],
                        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 120_000 }
                    );
                } catch (err) {
                    out = `${err.stdout ?? ''}${err.stderr ?? ''}`;
                }
                total += (out.match(/^ {2}ok {3}/gm) ?? []).length;
            }
            return total;
        },
        /** Godot verification suites in the chain. */
        godotSuites: () =>
            [
                ...readFileSync(path.join(repoRoot, 'scripts', 'check-godot.mjs'), 'utf8').matchAll(
                    /\['res:\/\/(verify_[a-z_]+)\.gd'/g
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
