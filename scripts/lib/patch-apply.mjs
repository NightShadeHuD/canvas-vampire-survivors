/**
 * @file scripts/lib/patch-apply.mjs
 * @description Which files a patch NAMES, and whether every one of them changed.
 *
 * `AGENTS.md` rule 6 is about edits that lie about having worked. A patch is the
 * same hazard one level up: `git apply` decides for itself which files it
 * touches, and the two ways it misleads are both measured in this tree.
 *
 *   - **`git apply` REFUSES THE WHOLE PATCH by default**, which is safe — but its
 *     output still says `Applied patch to 'x' cleanly.` for a file it never
 *     wrote. Measured: `git apply --3way` printed exactly that line for a file
 *     whose bytes did not move, and `git diff --stat` was empty.
 *   - **`git apply --reject` APPLIES WHAT IT CAN.** Measured: with two files and
 *     one failing hunk, the first file was rewritten, a `.rej` was left beside
 *     the second, and the exit code was 1 — a half-applied tree whose damage
 *     reads as the author's work being wrong. `scripts/apply-patch.mjs` refuses
 *     `--reject` for this reason.
 *   - **A pipeline swallows the exit code.** `git apply p | tail -2` exits 0.
 *     Measured. So neither the exit code nor the output is evidence.
 *
 * WHAT IS EVIDENCE: the bytes on disk, before and after, for every path the
 * patch names. That is all this module computes.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 *
 * It does not judge whether the patch is correct, or whether `git apply` was
 * right to refuse. It answers one question — *did every file this patch names
 * actually change?* — because a "no" there is the difference between a broken
 * patch and a broken claim.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync, readlinkSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

/** How the CLI is invoked. Printed on a usage error, and asserted in the tests. */
export const USAGE =
    'usage: node scripts/apply-patch.mjs <patch-file> [--dry-run] [--verbose] [-- <git apply args>]';

/** Arguments that make a partial application BY DESIGN, so the check is void. */
export const DEFEATS_THE_CONTRACT = ['--reject', '--include', '--exclude'];

/** `diff --git a/x b/y`, with either side optionally quoted. */
const DIFF_GIT = /^diff --git (?:"((?:[^"\\]|\\.)*)"|(\S+)) (?:"((?:[^"\\]|\\.)*)"|(\S+))\s*$/;
/** `--- a/x` / `+++ b/x`, including the `--- /dev/null` of a creation. */
const UNIFIED = /^(?:---|\+\+\+) (?:"((?:[^"\\]|\\.)*)"|(\S+))/;
/** `rename from x` / `copy to y`. A rename names BOTH sides. */
const RENAME = /^(?:rename|copy) (?:from|to) (?:"((?:[^"\\]|\\.)*)"|(\S+))\s*$/;

/** A path as git writes it, with the `a/` or `b/` prefix removed. */
function stripPrefix(path) {
    return path.replace(/^[ab]\//, '');
}

/**
 * Read one path token, unquoting only where it is unambiguous.
 *
 * Git C-quotes a path containing special characters. A quoted path with a
 * backslash escape is a path this module cannot decode — and **a patch whose
 * file list cannot be fully determined cannot be verified**, so it is refused
 * rather than partially read. A refusal is the honest outcome: "I checked the
 * three files I understood" is the false green this whole module exists for.
 *
 * @param {string|undefined} quoted the quoted alternative, if it matched
 * @param {string|undefined} bare the bare alternative, if it matched
 * @returns {{ ok: true, path: string } | { ok: false, reason: string }}
 */
function readPath(quoted, bare) {
    if (bare !== undefined && bare !== null) return { ok: true, path: stripPrefix(bare) };
    if (quoted === undefined || quoted === null) {
        return { ok: false, reason: 'the patch has a path this module could not read' };
    }
    if (quoted.includes('\\')) {
        return {
            ok: false,
            reason:
                `the patch quotes the path "${quoted}", which uses a C escape this module ` +
                'cannot decode. A patch whose file list cannot be fully determined cannot be ' +
                'verified, so it is refused rather than half-checked.'
        };
    }
    return { ok: true, path: stripPrefix(quoted) };
}

/**
 * Every path a patch names, in the order they appear.
 *
 * Both sides of a rename are included, and a creation or deletion is recorded
 * from its `diff --git` line, because "the old path is gone" and "the new path
 * appeared" are both changes a half-application can leave undone.
 *
 * @param {string} text the patch
 * @returns {{ ok: boolean, paths: string[], reason?: string }}
 */
export function patchPaths(text) {
    const paths = [];
    const add = (p) => {
        if (p && p !== '/dev/null' && !paths.includes(p)) paths.push(p);
    };

    for (const line of String(text ?? '').split('\n')) {
        const diff = DIFF_GIT.exec(line);
        if (diff) {
            const left = readPath(diff[1], diff[2]);
            const right = readPath(diff[3], diff[4]);
            if (!left.ok) return { ok: false, paths: [], reason: left.reason };
            if (!right.ok) return { ok: false, paths: [], reason: right.reason };
            add(left.path);
            add(right.path);
            continue;
        }
        const renamed = RENAME.exec(line);
        if (renamed) {
            const only = readPath(renamed[1], renamed[2]);
            if (!only.ok) return { ok: false, paths: [], reason: only.reason };
            add(only.path);
            continue;
        }
        const unified = UNIFIED.exec(line);
        if (unified) {
            const only = readPath(unified[1], unified[2]);
            if (!only.ok) return { ok: false, paths: [], reason: only.reason };
            add(only.path);
        }
    }

    if (paths.length === 0) {
        return {
            ok: false,
            paths: [],
            reason:
                'the patch names no files at all. Either it is empty or this parser does not ' +
                'read its shape, and **a scan that matches nothing must never report success** ' +
                '— that is how a check that verifies nothing reads exactly like one that ' +
                'verified everything.'
        };
    }
    return { ok: true, paths };
}

/**
 * A path's identity: whether it exists, what it is, and a digest of its bytes.
 *
 * The mode is part of it because `git apply` can apply a mode-only change, which
 * moves no bytes at all. Without the mode, a legitimate `chmod` patch would be
 * reported as "did not change".
 *
 * @param {string} path
 * @param {object} io
 * @param {(p: string) => import('node:fs').Stats} io.stat
 * @param {(p: string) => string} io.read
 * @param {(p: string) => string} io.readlink
 * @returns {string}
 */
function stateOf(path, io) {
    let stats;
    try {
        stats = io.stat(path);
    } catch {
        return 'absent';
    }
    const mode = (stats.mode & 0o777).toString(8);
    if (stats.isSymbolicLink()) {
        try {
            return `symlink:${mode}:${io.readlink(path)}`;
        } catch {
            return `symlink:${mode}:unreadable`;
        }
    }
    let digest;
    try {
        digest = createHash('sha256').update(io.read(path)).digest('hex');
    } catch {
        digest = 'unreadable';
    }
    return `file:${mode}:${digest}`;
}

/**
 * Record the state of every named path.
 *
 * @param {string[]} paths
 * @param {object} io as `stateOf`
 * @returns {Map<string, string>}
 */
export function snapshot(paths, io) {
    const before = new Map();
    for (const path of paths) before.set(path, stateOf(path, io));
    return before;
}

/**
 * Which of the named paths differ from the snapshot.
 *
 * @param {Map<string, string>} before
 * @param {object} io as `stateOf`
 * @returns {{ changed: string[], unchanged: string[] }}
 */
export function diffSnapshot(before, io) {
    const changed = [];
    const unchanged = [];
    for (const [path, was] of before) {
        if (stateOf(path, io) === was) unchanged.push(path);
        else changed.push(path);
    }
    return { changed, unchanged };
}

/**
 * The verdict: did EVERY file the patch names actually change?
 *
 * Pure, so the refusal is testable without a filesystem — the same shape
 * `planEdit` uses, and for the same reason.
 *
 * @param {{ named: string[], changed: string[] }} input
 * @returns {{ ok: boolean, changed: string[], unchanged: string[], reason?: string }}
 */
export function judgeApplication({ named, changed }) {
    if (named.length === 0) {
        return {
            ok: false,
            changed: [],
            unchanged: [],
            reason: 'the patch names no files, so there is nothing to verify'
        };
    }
    const changedSet = new Set(changed);
    const unchanged = named.filter((p) => !changedSet.has(p));
    if (unchanged.length === 0) return { ok: true, changed: named, unchanged: [] };

    const none = changedSet.size === 0;
    return {
        ok: false,
        changed: named.filter((p) => changedSet.has(p)),
        unchanged,
        reason: none
            ? 'NO file this patch names changed. If git apply reported an error, the patch ' +
              'did not apply at all; if it reported success, the patch is already applied. '
            : `${unchanged.length} of ${named.length} file(s) this patch names did NOT ` +
              'change, so the application is PARTIAL. '
    };
}

/**
 * The whole command, as a function of its arguments.
 *
 * WHY THE ORCHESTRATION LIVES HERE AND NOT IN THE CLI
 *
 * `check:coverage-floor` refuses a coverage report containing a file it cannot map
 * to `src/` or `scripts/lib/`, and its own comment says why: the CLI entry points in
 * `scripts/` are "deliberately excluded", because "their coverage is not meaningful
 * ... they are verified by EXECUTING them and observing the result". Measured: an
 * end-to-end test that spawned `scripts/apply-patch.mjs` produced
 *
 *     coverage reported for 1 file(s) that are not tracked under src/: apply-patch.mjs
 *
 * in both verification trees, and the child's coverage **cannot be suppressed from
 * inside a test** — Node seeds `NODE_V8_COVERAGE` into a spawned process whatever
 * `options.env` says, measured with a probe: the child saw the runner's coverage
 * directory after the variable had been deleted from the copied environment.
 *
 * So the rule the gate enforces is the architecture: **logic here, the CLI a wrapper
 * the suite never loads**, and the end-to-end test drives this function directly
 * instead of spawning anything.
 *
 * @param {string[]} argv arguments after the script name
 * @param {object} [io]
 * @param {string} [io.cwd] the tree the patch applies to
 * @param {(message: string) => void} [io.log]
 * @param {(message: string) => void} [io.error]
 * @returns {number} 0 every named file changed, 1 refused, 2 usage
 */
export function runApplyPatch(
    argv,
    { cwd = process.cwd(), log = console.log, error = console.error } = {}
) {
    const patchArg = argv.find((a) => !a.startsWith('-'));
    const passthrough = argv.includes('--')
        ? argv.slice(argv.indexOf('--') + 1)
        : argv.filter((a) => a.startsWith('-') && !['--dry-run', '--verbose'].includes(a));

    if (!patchArg) {
        error(USAGE);
        return 2;
    }
    const patchFile = resolve(cwd, patchArg);
    if (!existsSync(patchFile)) {
        error(`apply-patch: ${patchArg} does not exist`);
        return 2;
    }

    const offending = passthrough.filter((a) => DEFEATS_THE_CONTRACT.some((d) => a.startsWith(d)));
    if (offending.length > 0) {
        error(
            `apply-patch: REFUSED — ${offending.join(', ')} makes "every file this patch names\n` +
                '  changed" impossible by design, which is the only property this wrapper checks.\n' +
                '  Run git apply yourself if that is genuinely what you want — and then verify the\n' +
                '  tree by hand, because nothing else will.'
        );
        return 2;
    }

    const parsed = patchPaths(readFileSync(patchFile, 'utf8'));
    if (!parsed.ok) {
        error(`apply-patch: REFUSED — ${parsed.reason}`);
        return 1;
    }

    const dryRun = argv.includes('--dry-run');
    const verbose = argv.includes('--verbose');

    /**
     * Run git apply in `cwd`, returning its exit status and BOTH streams.
     *
     * `spawnSync` rather than `execFileSync`, because git reports what it is doing
     * on STDERR: `execFileSync` returns stdout only on success, so `--verbose`
     * printed nothing while the exit code was right. Measured by the `--verbose`
     * test, which asserted on `Checking patch a.txt` and got an empty string.
     */
    const gitApply = (args) => {
        const result = spawnSync('git', ['apply', ...args], {
            cwd,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe']
        });
        return {
            status: result.status ?? 1,
            output: `${result.stdout ?? ''}${result.stderr ?? ''}`
        };
    };

    if (dryRun) {
        const result = gitApply(['--check', ...passthrough, patchFile]);
        if (verbose && result.output.trim()) log(result.output.trimEnd());
        if (result.status !== 0) {
            error(
                `apply-patch: REFUSED — git apply --check would not apply ${patchArg} ` +
                    `(exit ${result.status}). It names ${parsed.paths.length} file(s):\n` +
                    parsed.paths.map((p) => `    ${p}`).join('\n')
            );
            return 1;
        }
        log(
            `apply-patch: dry run — ${parsed.paths.length} file(s) would change, and git apply ` +
                `--check accepted the patch:\n` +
                parsed.paths.map((p) => `    ${p}`).join('\n')
        );
        return 0;
    }

    // Paths in a patch are relative to the tree it applies to, so the snapshot
    // resolves them against `cwd` rather than against this process's directory.
    const io = {
        stat: (p) => lstatSync(resolve(cwd, p)),
        read: (p) => readFileSync(resolve(cwd, p), 'utf8'),
        readlink: (p) => readlinkSync(resolve(cwd, p))
    };

    const before = snapshot(parsed.paths, io);
    const started = gitApply(
        verbose ? ['--verbose', ...passthrough, patchFile] : [...passthrough, patchFile]
    );
    if (started.output.trim()) log(started.output.trimEnd());

    const { changed, unchanged } = diffSnapshot(before, io);
    const verdict = judgeApplication({ named: parsed.paths, changed });

    log(
        `apply-patch: ${patchArg} names ${parsed.paths.length} file(s); ${changed.length} ` +
            `changed, ${unchanged.length} did not.`
    );
    for (const p of changed) log(`    CHANGED   ${p}`);
    for (const p of unchanged) log(`    UNCHANGED ${p}`);

    if (!verdict.ok || started.status !== 0) {
        error(`\napply-patch: REFUSED — ${verdict.reason ?? 'git apply reported a failure.'}`);
        if (unchanged.length > 0) {
            error('  These files did not change:');
            for (const p of unchanged) error(`    ${p}`);
            error(
                '\n  A tree holding some of a patch is not a tree holding the work, and the two\n' +
                    '  look identical from the outside. Nothing here was reverted; inspect the tree\n' +
                    '  before drawing any conclusion about the work itself.'
            );
        } else {
            error(
                `  Every file this patch names DID change, but git apply exited ${started.status} ` +
                    '— so the tree is not in a state this tool will call applied. Inspect it.'
            );
        }
        return 1;
    }

    log('apply-patch: every file this patch names changed, and git apply reported success.');
    return 0;
}
