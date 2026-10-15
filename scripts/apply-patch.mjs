#!/usr/bin/env node
/**
 * @file scripts/apply-patch.mjs
 * @description Apply a patch, and refuse to call it applied unless EVERY file it
 * names actually changed.
 *
 * This exists because a half-applied tree is indistinguishable from work that
 * does not do what its author claimed — and the failure is easy to swallow:
 *
 *   - `git apply --reject` applies the hunks it can and leaves `.rej` beside the
 *     ones it could not. Measured on two files: the first was rewritten, the
 *     second was not, exit 1.
 *   - `git apply --3way` printed `Applied patch to 'b.txt' cleanly.` for a file
 *     whose bytes did not move. Measured; `git diff --stat` was empty.
 *   - `git apply p | tail -2` exits 0 whatever git decided. Measured.
 *
 * So the exit code is not evidence and the output is not evidence. The bytes on
 * disk are, and `scripts/lib/patch-apply.mjs` reads them.
 *
 * IT HAS ALREADY REFUSED, WHICH IS THE ONLY EVIDENCE WORTH HAVING
 *
 *   - a 16-file patch re-applied to a tree that already had it: every named file was
 *     byte-identical, and it reported `NO file this patch names changed` and NAMED all
 *     16, rather than succeeding because git's messages looked plausible;
 *   - a two-file patch whose second hunk could not apply, driven by the test suite: it
 *     reported `UNCHANGED b.txt` and exited 1, where git's own output says only that the
 *     patch does not apply and says nothing about which files it did touch.
 *
 * AND ONCE IT DID NOT REFUSE, WHICH IS WORTH RECORDING FOR THE SAME REASON
 *
 * A patch written against `8daf40a` was re-applied to a moved base, `3b9d417` — 18
 * files, `AGENTS.md` and `quality-baseline.json` among them, both of which the
 * intervening commit had edited. **It applied cleanly**, because git matches on context
 * and the intervening edits were in other regions of those files.
 *
 * That collision had been PREDICTED, in writing, and the prediction was wrong. **A
 * predicted conflict is a claim; running the tool is what settles it** — which is the
 * same lesson as the three notes above, one level up.
 *
 *   node scripts/apply-patch.mjs fix.patch
 *   node scripts/apply-patch.mjs fix.patch --dry-run     # git apply --check only
 *   node scripts/apply-patch.mjs fix.patch --verbose
 *
 * Exit codes: 0 every named file changed, 1 refused (nothing was applied, or the
 * application was partial — the files that did not change are named), 2 usage.
 *
 * It deliberately offers no `--reject`, `--include` or `--exclude`: each one
 * makes "every file this patch names changed" impossible by design, which is the
 * only property this wrapper checks.
 */

import { runApplyPatch } from './lib/patch-apply.mjs';

// The command itself lives in `scripts/lib/patch-apply.mjs`, and the reason is
// architectural rather than stylistic: the suite must never LOAD a file in
// `scripts/`, because `check:coverage-floor` refuses a coverage report it cannot
// map to `src/` or `scripts/lib/`. This file is verified the way the gate says a
// CLI is verified — by EXECUTING it and observing the result.
process.exit(runApplyPatch(process.argv.slice(2)));
