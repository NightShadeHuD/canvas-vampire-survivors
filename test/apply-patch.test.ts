// Unit tests for scripts/lib/patch-apply.mjs, plus one end-to-end run of
// scripts/apply-patch.mjs against a real throwaway git repository.
//
// This module exists because a half-applied tree is indistinguishable from work
// that does not do what its author claimed — the failure that cost a night. So
// the tests are about the two refusals: a patch whose file list cannot be read,
// and a patch that only some of the files named actually changed.
//
// The end-to-end test is the important one: it reproduces the measured incident
// (two files, one hunk that cannot apply) and requires the tool to name the file
// that did not change.

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
    patchPaths,
    snapshot,
    diffSnapshot,
    judgeApplication,
    runApplyPatch
} from '../scripts/lib/patch-apply.mjs';

const TWO_FILE_PATCH = [
    'diff --git a/a.txt b/a.txt',
    'index 5626abf..ab479d6 100644',
    '--- a/a.txt',
    '+++ b/a.txt',
    '@@ -1 +1 @@',
    '-one',
    '+one-changed',
    'diff --git a/b.txt b/b.txt',
    'index f719efd..8664502 100644',
    '--- a/b.txt',
    '+++ b/b.txt',
    '@@ -1 +1 @@',
    '-two',
    '+two-changed',
    ''
].join('\n');

// ---------------------------------------------------------------------------
// patchPaths — which files does this patch name?
// ---------------------------------------------------------------------------

test('patch-apply/paths: both sides of a two-file diff are found', () => {
    const parsed = patchPaths(TWO_FILE_PATCH);
    assert.equal(parsed.ok, true);
    assert.deepEqual(parsed.paths, ['a.txt', 'b.txt']);
});

test('patch-apply/paths: a creation is named from its diff header', () => {
    // `--- /dev/null` must not become a path, and the file it creates must not
    // be lost: a creation that did not happen is exactly the half-application
    // this tool is for.
    const patch = [
        'diff --git a/new.txt b/new.txt',
        'new file mode 100644',
        '--- /dev/null',
        '+++ b/new.txt',
        '@@ -0,0 +1 @@',
        '+hello',
        ''
    ].join('\n');
    assert.deepEqual(patchPaths(patch).paths, ['new.txt']);
});

test('patch-apply/paths: a rename names BOTH paths', () => {
    // The old path must stop existing and the new one must start; each is a
    // change a partial application can leave half-done.
    const patch = [
        'diff --git a/old.txt b/new.txt',
        'similarity index 100%',
        'rename from old.txt',
        'rename to new.txt',
        ''
    ].join('\n');
    assert.deepEqual(patchPaths(patch).paths, ['old.txt', 'new.txt']);
});

test('patch-apply/paths: a plain unified diff with no diff --git is read', () => {
    const patch = ['--- a/x.txt', '+++ b/x.txt', '@@ -1 +1 @@', '-a', '+b', ''].join('\n');
    assert.deepEqual(patchPaths(patch).paths, ['x.txt']);
});

test('patch-apply/paths: a patch naming nothing is refused, not passed', () => {
    // A scan that matches nothing must never report success.
    const parsed = patchPaths('this is not a patch\n');
    assert.equal(parsed.ok, false);
    assert.match(parsed.reason ?? '', /names no files at all/);
});

test('patch-apply/paths: a quoted path with a C escape is refused', () => {
    // "A patch whose file list cannot be fully determined cannot be verified."
    const patch = 'diff --git "a/x\\ty.txt" "b/x\\ty.txt"\n--- "a/x\\ty.txt"\n';
    const parsed = patchPaths(patch);
    assert.equal(parsed.ok, false);
    assert.match(parsed.reason ?? '', /C escape/);
});

test('patch-apply/paths: a quoted path WITHOUT an escape is read', () => {
    const patch = 'diff --git "a/my file.txt" "b/my file.txt"\n--- "a/my file.txt"\n';
    assert.deepEqual(patchPaths(patch).paths, ['my file.txt']);
});

// ---------------------------------------------------------------------------
// snapshot / diffSnapshot / judgeApplication — did they change?
// ---------------------------------------------------------------------------

/** A filesystem backed by a Map, so a half-application can be simulated. */
function fakeIo(files: Record<string, string>) {
    return {
        files,
        stat: (p: string) => {
            if (!(p in files)) throw new Error(`ENOENT: ${p}`);
            return { mode: 0o100644, isSymbolicLink: () => false };
        },
        read: (p: string) => files[p],
        readlink: () => ''
    };
}

test('patch-apply/diff: an unchanged file is reported unchanged', () => {
    const io = fakeIo({ 'a.txt': 'one' });
    const before = snapshot(['a.txt'], io as never);
    assert.deepEqual(diffSnapshot(before, io as never), { changed: [], unchanged: ['a.txt'] });
});

test('patch-apply/diff: a changed file is reported changed', () => {
    const io = fakeIo({ 'a.txt': 'one' });
    const before = snapshot(['a.txt'], io as never);
    io.files['a.txt'] = 'two';
    assert.deepEqual(diffSnapshot(before, io as never), { changed: ['a.txt'], unchanged: [] });
});

test('patch-apply/diff: a mode-only change counts as a change', () => {
    // `git apply` applies mode changes, which move no bytes at all.
    const io = fakeIo({ 'a.txt': 'one' });
    const before = snapshot(['a.txt'], io as never);
    io.stat = () => ({ mode: 0o100755, isSymbolicLink: () => false });
    assert.deepEqual(diffSnapshot(before, io as never).changed, ['a.txt']);
});

test('patch-apply/judge: every named file changed is a pass', () => {
    const verdict = judgeApplication({ named: ['a.txt', 'b.txt'], changed: ['a.txt', 'b.txt'] });
    assert.equal(verdict.ok, true);
    assert.deepEqual(verdict.unchanged, []);
});

test('patch-apply/judge: PARTIAL application is refused and names the file', () => {
    // The measured incident: `git apply --reject` rewrote a.txt and left b.txt
    // alone with a .rej beside it.
    const verdict = judgeApplication({ named: ['a.txt', 'b.txt'], changed: ['a.txt'] });
    assert.equal(verdict.ok, false);
    assert.deepEqual(verdict.unchanged, ['b.txt']);
    assert.match(verdict.reason ?? '', /1 of 2 file\(s\).*did NOT/);
});

test('patch-apply/judge: nothing changed says so in different words', () => {
    // "The patch did not apply" and "the patch is already applied" are the same
    // measurement and different situations, and the reader needs to know which.
    const verdict = judgeApplication({ named: ['a.txt'], changed: [] });
    assert.equal(verdict.ok, false);
    assert.match(verdict.reason ?? '', /NO file this patch names changed/);
});

test('patch-apply/judge: an empty file list is refused', () => {
    const verdict = judgeApplication({ named: [], changed: [] });
    assert.equal(verdict.ok, false);
    assert.match(verdict.reason ?? '', /nothing to verify/);
});

// ---------------------------------------------------------------------------
// the CLI, end to end, against a real git repository
// ---------------------------------------------------------------------------

/** A throwaway repository holding a.txt and b.txt, plus a patch for both. */
function scratchRepo() {
    const dir = mkdtempSync(path.join(tmpdir(), 'apply-patch-'));
    const git = (...args: string[]) =>
        execFileSync('git', args, { cwd: dir, stdio: 'pipe', encoding: 'utf8' });
    git('init', '-q', '.');
    writeFileSync(path.join(dir, 'a.txt'), 'one\n');
    writeFileSync(path.join(dir, 'b.txt'), 'two\n');
    git('add', '-A');
    git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init');
    writeFileSync(path.join(dir, 'a.txt'), 'one-changed\n');
    writeFileSync(path.join(dir, 'b.txt'), 'two-changed\n');
    writeFileSync(path.join(dir, 'p.patch'), git('diff'));
    git('checkout', '--', 'a.txt', 'b.txt');
    return { dir, git };
}

/**
 * Run the command IN PROCESS, against `dir`.
 *
 * It used to spawn `scripts/apply-patch.mjs`, and the end-to-end value was real —
 * but `check:coverage-floor` refuses a coverage report containing a file it cannot
 * map to `src/` or `scripts/lib/`, and the child's coverage cannot be suppressed
 * from inside a test (measured: Node seeds `NODE_V8_COVERAGE` into the spawned
 * process even after it is deleted from the copied environment). So the
 * orchestration moved into the lib, where it is mapped and floored, and this drives
 * it directly. The only thing not covered here is the wrapper's own
 * `process.exit(runApplyPatch(...))` line, which is declared in the report rather
 * than pretended.
 */
function runCli(dir: string, ...args: string[]) {
    const lines: string[] = [];
    const status = runApplyPatch(args, {
        cwd: dir,
        log: (message: string) => lines.push(String(message)),
        error: (message: string) => lines.push(String(message))
    });
    return { status, output: lines.join('\n') };
}

test('apply-patch/cli: a patch that applies cleanly is reported applied', () => {
    // The control. Without this, "it refused" proves nothing.
    const { dir } = scratchRepo();
    const result = runCli(dir, 'p.patch');
    assert.equal(result.status, 0, result.output);
    assert.match(result.output, /2 changed, 0 did not/);
    assert.equal(readFileSync(path.join(dir, 'b.txt'), 'utf8'), 'two-changed\n');
});

test('apply-patch/cli: a PARTIAL application is refused, naming the file', () => {
    // The incident, reproduced: b.txt is changed underneath the patch so its hunk
    // cannot apply, and git apply refuses the whole thing. Whichever way git
    // goes, the tool must not call this applied.
    const { dir } = scratchRepo();
    writeFileSync(path.join(dir, 'b.txt'), 'TWO-DIFFERENT\n');
    const result = runCli(dir, 'p.patch');
    assert.notEqual(result.status, 0, 'a refused application must exit non-zero');
    assert.match(result.output, /REFUSED/);
    assert.match(result.output, /UNCHANGED b\.txt/);
    assert.match(result.output, /a\.txt/);
});

test('apply-patch/cli: --reject is refused because it defeats the contract', () => {
    const { dir } = scratchRepo();
    const result = runCli(dir, 'p.patch', '--', '--reject');
    assert.equal(result.status, 2);
    assert.match(result.output, /impossible by design/);
});

test('apply-patch/cli: --dry-run reports without applying', () => {
    const { dir } = scratchRepo();
    const result = runCli(dir, 'p.patch', '--dry-run');
    assert.equal(result.status, 0, result.output);
    assert.match(result.output, /would change/);
    assert.equal(readFileSync(path.join(dir, 'a.txt'), 'utf8'), 'one\n', 'nothing may be written');
});

test('apply-patch/cli: an already-applied patch is refused, not silently accepted', () => {
    // git apply reports an error here; the tool must not report success, and the
    // message must tell the reader the patches are the same rather than broken.
    const { dir } = scratchRepo();
    assert.equal(runCli(dir, 'p.patch').status, 0);
    const again = runCli(dir, 'p.patch');
    assert.notEqual(again.status, 0);
    assert.match(again.output, /already applied|did not apply at all/);
});

// ---------------------------------------------------------------------------
// stateOf — what counts as a change, and what a broken state looks like
// ---------------------------------------------------------------------------

test('patch-apply/diff: a file that DISAPPEARED has changed', () => {
    // A deletion is a change, and `--diff-filter` patches delete files.
    const io = fakeIo({ 'gone.txt': 'x' });
    const before = snapshot(['gone.txt'], io as never);
    delete io.files['gone.txt'];
    assert.deepEqual(diffSnapshot(before, io as never), { changed: ['gone.txt'], unchanged: [] });
});

test('patch-apply/diff: a symlink whose TARGET changed has changed', () => {
    // The bytes of a symlink are its target, so hashing contents would miss this.
    let target = 'one';
    const io = {
        files: {},
        stat: () => ({ mode: 0o120777, isSymbolicLink: () => true }),
        read: () => {
            throw new Error('a symlink has no contents to read');
        },
        readlink: () => target
    };
    const before = snapshot(['link'], io as never);
    target = 'two';
    assert.deepEqual(diffSnapshot(before, io as never).changed, ['link']);
});

test('patch-apply/diff: a symlink whose target cannot be read is a state, not a throw', () => {
    const io = {
        files: {},
        stat: () => ({ mode: 0o120777, isSymbolicLink: () => true }),
        read: () => '',
        readlink: () => {
            throw new Error('ELOOP');
        }
    };
    const before = snapshot(['link'], io as never);
    assert.deepEqual(snapshot(['link'], io as never).get('link'), before.get('link'));
    assert.deepEqual(diffSnapshot(before, io as never).unchanged, ['link']);
});

test('patch-apply/diff: an unreadable file is a state, not a throw', () => {
    // `git apply` can leave a file whose bytes cannot be read; a tool that throws
    // there reports nothing about the other files.
    const io = {
        files: { 'a.txt': 'x' },
        stat: () => ({ mode: 0o100644, isSymbolicLink: () => false }),
        read: () => {
            throw new Error('EACCES');
        },
        readlink: () => ''
    };
    const before = snapshot(['a.txt'], io as never);
    assert.deepEqual(diffSnapshot(before, io as never).unchanged, ['a.txt']);
});

// ---------------------------------------------------------------------------
// the command's own refusals, none of which need a git repository
// ---------------------------------------------------------------------------

test('apply-patch/cli: no arguments prints the usage and exits 2', () => {
    const result = runCli(process.cwd());
    assert.equal(result.status, 2);
    assert.match(result.output, /usage: node scripts\/apply-patch\.mjs/);
});

test('apply-patch/cli: a patch file that does not exist exits 2', () => {
    const result = runCli(process.cwd(), 'no-such.patch');
    assert.equal(result.status, 2);
    assert.match(result.output, /does not exist/);
});

test('apply-patch/cli: a file that is not a patch is refused', () => {
    // A parser that reads no paths must refuse rather than verify nothing.
    const dir = mkdtempSync(path.join(tmpdir(), 'apply-patch-not-a-patch-'));
    writeFileSync(path.join(dir, 'p.patch'), 'this is not a patch\n');
    const result = runCli(dir, 'p.patch');
    assert.equal(result.status, 1);
    assert.match(result.output, /names no files at all/);
});

test('apply-patch/cli: --dry-run refuses a patch git cannot apply', () => {
    const { dir } = scratchRepo();
    writeFileSync(path.join(dir, 'b.txt'), 'TWO-DIFFERENT\n');
    const result = runCli(dir, 'p.patch', '--dry-run');
    assert.equal(result.status, 1);
    assert.match(result.output, /would not apply/);
    assert.equal(readFileSync(path.join(dir, 'a.txt'), 'utf8'), 'one\n', 'nothing may be written');
});

test('apply-patch/cli: --verbose passes git output through and still applies', () => {
    const { dir } = scratchRepo();
    const result = runCli(dir, 'p.patch', '--verbose');
    assert.equal(result.status, 0, result.output);
    assert.match(result.output, /Checking patch a\.txt/);
    assert.match(result.output, /every file this patch names changed/);
});
