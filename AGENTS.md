# Agent & contributor mandate

**Read this before touching anything. It is not advisory.**

The full, versioned standard is [docs/ENGINEERING-STANDARDS.md](docs/ENGINEERING-STANDARDS.md).
The trap list for throwaway probes is [docs/PROBE-CAVEATS.md](docs/PROBE-CAVEATS.md).
This file is the short form that must be honoured on every single task.
Where this file and the standard disagree, the standard wins.

---

## The nineteen non-negotiables

Rules 1-7 are the original mandate. Rules 8-19 were each learned here the hard way --
each made more than twice before being written down, which is the threshold for a rule
worth having. Rule 15 cost nothing only because the agent that broke it noticed; rules 16
and 17 are the same finding at two levels -- the author of a thing is the worst person to
check it -- and rule 18 is what their evidence produced: four bugs a person found by looking,
none of which any assertion could have seen. **Rule 19 is that same finding applied to the
instrument**: rule 11 covers checks, and three agents in one night reported that their own
throwaway measurement had been dead.

### 1. A red baseline stops everything

All tests must pass before you change anything. If they do not, **STOP and
report.** Do not attempt repairs — a red baseline you did not create is
information, and guessing at it destroys that information.

Reproduce it in a pristine checkout to prove it is not yours:

```bash
git worktree add --detach /tmp/baseline HEAD
cd /tmp/baseline && npm test
```

Diagnose it from evidence, report it, then fix it as its own reviewed commit.

### 2. No hacks. No undeclared shortcuts.

A shortcut is permitted only if it is **declared, bounded, and tracked** in
`quality-baseline.json`. An undeclared `@ts-nocheck`, `eslint-disable`,
`.skip`, or `TODO` is a build failure — mechanically, not by opinion.

### 3. No claim of correctness without the command that proved it

"It should work" is not a status. Name the command and its result. If you
cannot name the command, you have not verified it — say so.

### 4. If you are unsure whether it is finished, it is not

Report it as **partial** and name the gap. Optimism in a status report is a
defect. "Done except X, which is untested" is useful; "done" is not.

### 5. Review before commit

Read the diff as if someone else wrote it. Check style, production readiness,
and that tests exist and pass. Then commit.

### 6. Never edit source text with a blunt instrument

**Do not run `sed -i`, `perl -pi`, or any global substitution across a source
file. Do not rewrite a file with a one-line script.** Every scripted edit to
source must:

1. **anchor on text that matches exactly once**, and refuse if it matches zero
   or more than one;
2. **verify the result after writing** — read the file back and assert the
   intended text is present;
3. **be followed by `npm run verify`** before anything else happens.

Two failures in one session, both self-inflicted, both from ignoring this:

- An annotator inserted a type at a parameter's identifier and produced
  `update(dt: number, height: number?)` — invalid syntax — because it assumed the
  identifier was never already followed by `?`.
- A global substitution stripping backticks, run across `src/effects.ts` to
  clean up after the first mistake, **removed every backtick in the file** —
  including the template literals it builds its colours from:
  ``ctx.strokeStyle = `rgba(160,255,160,${...})`;``

Both were caught by `typecheck` within seconds. That is the gate doing its job
and the agent not doing theirs.

**The rule for a bulk change is: do it per-position, in a script that checks its
own work, one file at a time, with the full gate between files.**

**A bulk edit must name how many matches it expects, and refuse any other number. A predicate is
not an identity.** The single-anchor helper does not cover a loop over a collection, and that is
where the damage actually happened: a loop on `gate == 'check:reach'` matched **seven** entries of
`gate-selftests.json` and overwrote all seven breaks with one string. Measured: 7 matched, 6
distinct break strings collapsed to 1, and 33 entries in, 33 out. Nothing errored, the file still
parsed, and every gate downstream stayed green -- because each surviving entry still had a break
that worked. **No check can see that after the fact**, so the count is refused at the edit.

```bash
node scripts/edit.mjs src/foo.ts --anchor 'x' --replace 'y' --count 7    # text, N occurrences
node scripts/edit-json.mjs gate-selftests.json --where 'gate=check:reach' \
    --expect 7 --set 'requires=godot'                                    # a JSON manifest
```

`--expect` is mandatory: a bulk edit that never says how many matches it expects cannot notice
its selection changing under it. `scripts/lib/source-edit.mjs` exports
`selectExactly(items, predicate, expected)` for a script doing its own selection, and
`scripts/lib/json-edit.mjs` reads the manifest, refuses the wrong count **before anything is
written**, and reads the file back afterwards.

**Use the helper. It is what makes this rule possible to follow.**

```bash
node scripts/edit.mjs src/foo.ts --anchor 'exact old text' --replace 'new text'
node scripts/edit.mjs src/foo.ts --anchor-file a.txt --replace-file b.txt  # multi-line
node scripts/edit.mjs src/foo.ts --anchor 'x' --replace 'y' --dry-run
```

It refuses an anchor that matches zero times or the wrong number of times, and
**after writing it reads the file back** to confirm the change is really there.
`scripts/lib/source-edit.mjs` is the same thing as a library for scripts, with
`planEdit` (pure, no writes) and `applyEdit`.

`npm run check:destructive` refuses `sed -i`/`perl -i`, shell redirection into a
source file, and direct `writeFileSync('src/...')` in committed tooling — but it
**cannot see a shell command that was never committed**, which is exactly where
the second failure happened. That half is on you.

**Do not mix mechanisms on one file.** A third failure, in one line of Python: read
`AGENTS.md` into memory, edit it with `edit.mjs` (which writes to disk), then write the
in-memory copy back — **clobbering the edit just made.** The file looked fine and one
change had silently vanished.

**One file, one tool, one write.** If a script must read and write, let IT do all the
edits, and never interleave a helper that writes with a buffer read before it.

---

### 7. Apple is the benchmark

How it looks, how smoothly it runs, how optimised the code is, how smooth the
interface is, how easy it is to use — we settle for nothing less. Perceived
quality comes from consistency, not features.

---

## What this project learned the hard way

Every rule below cost a round trip. They are written down because each one was made
**more than twice**, and a rule you have broken three times is a rule you will break
again.

### 8. A number in prose must cite the command that produced it

`strictNullChecks` in `src/` was reported as **zero for seven consecutive rounds** after
it had gone back to seven. Every one of those figures came from a hand-run shell command
and was then quoted rather than re-measured.

**If you state a metric, name the command — and re-run it in the round you state it.**
A metric with no gate behind it drifts, and prose does not notice.

### 9. When a port or migration is the goal, START IT

The Godot port was deferred for twenty rounds of TypeScript strictness work first.
Twenty rounds later: `strictNullChecks` had been worth every hour — GDScript has only
`null`, and the exporter's `undefined` branch is one line because of it — while
`noImplicitAny` had **no GDScript analogue at all** and 168 errors still outstanding.

**The port tells you what the source actually needs.** Doing the preparation first means
preparing for the wrong things, and nothing reveals which until the port begins.

### 10. Make the correct assertion the EASIER one

Half the red tests in this project were the _test_ being wrong, and they were not random
— they took seven distinct shapes: magnitude asserted where the claim was _direction_;
events counted where the claim was a _population_; state read _after_ it changed; a value
hardcoded that could be _read_; floats compared for _equality_; a _rate_ expected to be a
certainty; a _precondition_ assumed and never set.

"Be more careful" fixes none of these. `godot/assertions.gd` does, by making the correct
form the short form: `Check.rose(before, after)` is no longer than
`assert(before < 20.0)` and **cannot be wrong about which direction the claim was.**

### 11. A check is not a check until you have watched it FAIL

Twice in two rounds the verification layer itself was the defect:

- A suite mixing two assertion harnesses **printed `FAIL` and reported `PASS`.**
- A **GDScript runtime error did not fail a suite** — it printed a stack trace and
  carried on, so a crashing test was green.

**Break the thing on purpose and confirm the check catches it.** A green light nobody
investigates is worse than a red one.

### 12. If the data declares it, a test must prove the code reads it

Four times a field existed in `src/data.ts` and **nothing read it**: weapon `type`,
passive `effect`, enemy `archetype`, achievement `check`. Each was invisible because the
tests asserted the one case that happened to work.

**Drive the data table itself.** A test that iterates the real table and asserts every
entry does _something_ fails the moment a new entry is added without an implementation —
which is what `verify_weapons`, `verify_passives` and `verify_archetypes` do.

### 13. Generated code needs a DRIFT check, not a regeneration

`check:godot` regenerated the Godot data and then verified it — so it **silently repaired
drift and always passed.** Proved by corrupting a committed value: the check rewrote it
and reported `ok`.

**Generate to a temporary directory and DIFF.** A check that fixes the thing it is
checking can never fail.

### 14. Measure a cascade before starting it

A dozen changes were backed out because the cascade was larger than the increment — and
every one was discovered _after_ starting. `--explain`, `--dry-run` and a one-file probe
say how big a change is before it is half-made.

Backing out is correct. Backing out **repeatedly, for the same reason,** means the
measuring step was being skipped.

### 15. One working tree, one agent

Two agents shared this checkout. I ran `git switch` and `git pull` while a subagent was
mid-refactor, and **HEAD moved under it** — so its branch was created from the wrong
base and its commit landed on `main`.

It caught this itself and undid it cleanly (branch moved off `main`, `main` reset to
`origin/main`, nothing pushed), which is the only reason it cost nothing. **A commit
that reaches `main` and gets pushed is not undoable in the same way.**

The rule is not "be careful with git". It is:

```bash
git worktree add --detach /tmp/agent-a main   # each agent gets its OWN tree
```

**A shared checkout is a shared mutable global.** Any agent that switches branches
invalidates every other agent's baseline, its verification run, and its branch's
parentage — silently, and only at the moment it commits.

**Before delegating, ask where the other agent will work.** If the answer is "the same
directory", the delegation is already broken.

### 16. The author of a gate is the worst person to find its hole

**Four times in one session a defect was found in code written the same day and believed
correct** -- and **twice it was in a fix made specifically to address the previous finding.**

    `check-assertions` never read a `.gd` file        -- the gate's own author missed it
    the title screen rendered OFF-SCREEN             -- "strengthened" from "node exists"
                                                        to "text is correct", and called
                                                        that the fix
    argument-shape digest still missed equal(a,b)    -- shipped as the closure of the gap
       -> equal(a,a)                                    it did not close
    `found.name` did not exist                       -- in that same digest

**A person checks that a gate PASSES. An auditor checks that it CAN FAIL.** Different
questions, and the second is the one that matters.

So: **commission audits of your own tooling, and require a positive control.** For every
finding, the break (it stayed green when it should not) AND the control (something it
should catch went red) -- without the control, "nothing changed" proves nothing, because
the probe may simply not work.

**And know the ceiling: verification does not delegate.** An agent's report is a claim, not
a result. Fan out ONE level -- agents do not spawn agents -- and run the gate yourself
before building on the report. Where that was skipped, a fix shipped that closed a
different hole than the one claimed, and another audit round was needed to find out.

`docs/AUDITS.md` has the brief template that produced the results, and the anti-patterns
that produced nothing. A vague brief (_"analyse failures"_) yielded no trace and no report;
an adversarial one (_"construct the input that should fail it"_) found seven.

### 17. The author of a fix does not verify it

Rule 16 says the author of a **gate** is the worst person to find its hole. This is the same
finding one level up, and it took a count to see it:

| Shipped                      | Its hole                                                   | Found by                       |
| ---------------------------- | ---------------------------------------------------------- | ------------------------------ |
| `check:selftests`            | documented as a chain step, never added                    | an audit                       |
| the pixel tier               | three assertions passed while their subject was **broken** | me — _only because I broke it_ |
| argument-shape digest        | missed `equal(hp, maxHp)` -> `equal(hp, hp)`               | another agent                  |
| `check:coverage` direction C | could not see `npm test`                                   | an audit                       |
| the `NOTICE:` prefix         | two gates invisible to the counter built to see them       | an audit                       |
| a keyboard-focus check       | broke three assertions below it                            | me, by running it              |

**Six of seven were found by someone who did not write the work.** The one I found myself, I
found _because I broke it on purpose_ -- which is the whole lesson, applied inconsistently.

**So the practice is a split, not a resolution:**

1. **One agent writes the fix. A different agent writes the check.** The verifier works from
   the bug report, **against the unfixed tree**, and must paste the raw output of its check
   FAILING before it finishes. It must not be shown the fix.
2. **The conductor verifies both.** Their claims are claims; the gate output is the result.
3. **If a check cannot be watched failing, the change is REVERTED, not described.**
   "Reasoned from an audit's demonstration" is not a demonstration. This happened on F6 --
   `check-selftests` counting a crash as a watched failure -- and the fix was backed out
   rather than shipped with a confident message.

**Why this is a rule and not a preference:** every one of the six above was reported by its
author as working. Not one was a lie; each was a check run against the case its author had in
mind. **The gap is structural, and no amount of care closes it.**

`docs/AUDITS.md` has the brief templates for both halves.

### 18. A feature is not done until a check asks what a PLAYER sees

**Four player-visible bugs shipped in this session. Every one was found by a person looking at
the screen, and not one was a logic error.**

| What a player saw                     | The logic                    | What was actually wrong                  | Class        |
| ------------------------------------- | ---------------------------- | ---------------------------------------- | ------------ |
| WASD did nothing                      | movement was correct         | `project.godot` had no `[input]` section | Reachability |
| Menus could not be answered           | upgrades applied correctly   | `grep -c grab_focus` was **0**           | Reachability |
| The title was off-screen              | the text was right           | anchors put it outside the viewport      | Visibility   |
| The screen greyed out and stayed grey | the dim was the right colour | `visible = true` with no counterpart     | Lifecycle    |

**362 assertions were checking that the world was CORRECT. None was checking that it was
REACHABLE, VISIBLE, or REVERSIBLE -- and those are different claims.** A thing can be perfect
and completely unusable, and no amount of state assertion notices.

**So every player-facing change lands with a check that asks a player's question:**

- **Reachable?** Can the documented control actually produce the action, and is it shadowed?
  Declaring an action in `[input]` **replaces its built-in default**, so adding WASD while
  dropping the arrows silently kills the arrows.
- **Visible?** Is it inside the viewport, and does it survive a frame? The pixel tier is the
  only check in this repository that asks this. `verify_scene`'s "every simulated collection is
  ITERATED by `_draw`" is the cheap static half.
- **Reversible?** Does every state change have its counterpart? `check:lifecycle` exists for
  this.

**And the meta-rule, which is the one that actually matters: when a person reports something
they SAW, believe the report over the assertions.** Four times the assertions were green and
the person was right. The response to "it greys out after the first upgrade" is not to explain
why the state is correct -- it is to go and look at `visible`.

**`_lower_shade()` is what this rule looks like in code**: one function, called from every path
that closes the modal, with the reason written above it -- because three call sites are three
chances to forget, and forgetting is exactly what happened.

### 19. An instrument must be shown to read a KNOWN signal

Rule 11 is about **checks**: break the thing on purpose and confirm the check catches it.
`gate-selftests.json` holds that for 33 entries, and a ledger can reach them, because a gate is a
durable artifact with a name, a file and a place in the chain.

**The failures that produced this rule were not checks. They were instruments** -- throwaway
probes, written to answer one question and **deleted before anyone could inspect them**. No
ledger can reach a probe, so rule 11 did not cover this and nothing else did either.

**Three agents in one night reported that their own instrument had been dead**, each having
already produced confident, meaningless results:

    a synthetic element.click()   headless Chromium does not run `javascript:` URLs for it, so
                                  every payload reported SAFE -- and the verifier only noticed
                                  because its own control reported "safe" too. The same payloads
                                  fire under a trusted `page.mouse` click
    a dynamic `import()`          made a storage round trip inert, so the trip appeared not to
                                  persist. Found by the fix's own author
    `_resetStorageForTests`       cleared the very fallback being measured, so the fallback
                                  measured empty. Same author, same session

**And a fourth was true by construction:**

    const a = cond ? x : y;
    const changed = a !== y;      in the control branch that is `y !== y`

**Watched: mutating the probe produced failures only once the control was already broken** --
which is the signature of a control that cannot fail.

**So: show the instrument a KNOWN signal before you believe its reading.** A reading of "nothing
changed" or "secure" is worth nothing until the same instrument, in the same run, reported a
change on a case where a change exists. **The control is the only part of a probe whose answer
you can check without already knowing it**, which is why it is not a formality.

**And the control must ASSERT THE CONDITION IT DEPENDS ON.** A service-worker probe hardcoded a
cache-name bump to a string that later became the shipped name, so its control could no longer
reproduce the defect -- and went on passing. **A control that only performs its setup is a second
measurement, not a control.**

**Your own confidence is not evidence.** One agent tonight reported a rule 6 violation it caught
and fixed itself: right behaviour, and still a claim until somebody else runs something. Every
one of the three above believed its instrument worked, and not one was lying -- each was measuring
the case it had in mind.

**Nothing enforces this, and nothing can** -- which is why it is a rule and not a gate. There is
no artifact to register, no file for a check to open, and a gate that claimed to cover a deleted
script would be the exact defect this rule is about. `docs/PROBE-CAVEATS.md` is the trap list,
written from the measurements above: read it before writing a probe.

## Before you commit

```bash
npm run verify          # tier 1: lint, format, tests, clocks, baseline, hygiene
npm run verify:all      # tier 2 as well: boot smoke + accessibility (needs Chromium)
```

Both must pass. `npm run verify:all` is the definition of done.

Setup, once per clone:

```bash
npm install
npx playwright install chromium   # only needed for the browser gates
npm run setup                     # installs the git hooks
godot --headless --path godot --import   # ONLY if Godot is installed — see below
```

**The Godot import step is required, and a fresh clone fails without it.** `godot/.godot/`
holds the `class_name` cache and is gitignored, so until it exists every `verify_*.gd` dies
with `Parse Error: Identifier "Check" not declared`. **A tooling audit measured that the
failure surfaces at gate 5, blaming a document** — `claims "godotAssertions" is 309, but the
measurement is 0` — because the measurement runs the suites and they cannot load. One
`--import` and the same tree is 23/23.

**If Godot is NOT installed, skip that line and note what it means.** `check:godot` prints
`NOTICE:` and exits 0, so **the entire Godot half of this repository — 12 suites, 309
assertions and the generated-data drift check — is unverified on your machine**, and
`verify` says so in its "checked nothing" list. That is a declared gap, not a pass.

**So on a machine with Godot, the port is enforced. There is nowhere else it could be** —
GitHub Actions is gone, and for a while before that it did not install Godot either, so
`check:godot` printed NOTICE and exited 0 on every run and the port was enforced only by
whichever contributor happened to have it on PATH. A tooling audit proved that by setting
`CONFIG.VERSION` to `9.9.9` and getting "all 23 gates passed" under CI's PATH.

**Godot 4.7.2 specifically**, and the pin is deliberate: `godotAssertionFloors` are exact
per-suite counts derived from one particular Godot's output format, so a different version can
fail the gate for a reason that is not a behaviour change.

`check:pixels` needs a DISPLAY. **It used to NOTICE on every CI run and now simply runs**,
because the gate runs where a screen is — which closed a declared gap as a side effect of
moving the runner. It is still the only tier that asks what a PLAYER sees, and it is still the
one whose assertions were once green while their subject was broken.

**Re-run `npx playwright install chromium` after any Playwright upgrade.** The
browser is versioned with the library, so a bump leaves the old binary in place
and the new one missing. The failure is loud but misleading — `verify` passes every
gate and then stops at

```
boot-smoke: could not launch Chromium — Executable doesn't exist at
  .../chromium_headless_shell-1243/...
```

— which reads like a broken gate rather than a missing download. **Until recently CI installed
the browser on every run, so a green PR was not evidence that a local checkout worked.** There
is no CI now: if the browser is missing, `npm run ci` stops here for you and nobody else. Hit
for real when Playwright went 1.59 to 1.63.

---

## What is enforced, and by what

| Rule                                                         | Mechanism                                                      |
| ------------------------------------------------------------ | -------------------------------------------------------------- |
| No new test failures, no stale baseline                      | `scripts/check-baseline.mjs`                                   |
| Suppression ceilings can only shrink                         | `scripts/check-suppressions.mjs`                               |
| No conflicts, focused tests, debug logs, secrets, bloat      | `scripts/check-hygiene.mjs`                                    |
| Every source file is really linted                           | `scripts/check-coverage.mjs`                                   |
| Measured coverage never falls                                | `scripts/check-coverage-floor.mjs`                             |
| No test depends on today's date                              | `scripts/check-clocks.mjs`                                     |
| The game still boots and plays                               | `scripts/boot-smoke.mjs`                                       |
| Accessibility holds                                          | `scripts/a11y-audit.mjs`                                       |
| No bulk edits to source in committed tooling                 | `scripts/check-destructive.mjs`                                |
| The Godot port runs and has not drifted                      | `scripts/check-godot.mjs`                                      |
| The register's numbers match what was measured               | `scripts/check-claims.mjs`                                     |
| **The rows ABOVE this one**, in order, locally               | `.githooks/pre-push` → requires a receipt for HEAD             |
| **The rows ABOVE this one**, run here and recorded           | `npm run ci` — `verify:all` + a receipt naming the SHA         |
| The game boots and every dialog is accessible                | `npm run verify:all` — **tier 2, NOT in `verify`**             |
| **Tier 1 only**, on the runner, before anything is published | `.github/workflows/deploy-pages.yml` — `deploy` needs `verify` |

**Two gates are deliberately outside `verify`**: `boot-smoke.mjs` and `a11y-audit.mjs`
need a browser, so `verify` would fail on a machine without one. **`npm run verify:all` runs
them and is the definition of done**; a bare `npm run verify` does not, and this table once
said it did.

## YOU CANNOT PUSH WITHOUT HAVING RUN IT

`.githooks/pre-push` **refuses to push without a receipt for the exact commit being pushed.** No
receipt, a receipt for a different revision, a receipt from a failed run, or one written on a
dirty tree — all four refuse, each naming the command to fix it.

That is the mechanism. Everything else in this section is a description of it.

**The hook used to run `npm run verify` inline, and that was wrong twice over.** It ran **tier 1
only** — no boot smoke, no a11y, no pixel tier — so with CI gone those would have run _nowhere_
while the output said "all gates passed". And it printed **"CI will still enforce it"**, a
sentence that was true when written and false from the moment the workflows were deleted. **A
hook that lies about who is watching is worse than no hook, because it invites exactly the trust
it has not earned.**

**`git push --no-verify` still bypasses it**, deliberately: a hook that could not be bypassed
would have to be a server, and the point of this change was that there is no server. **What it
cannot be is bypassed by accident.** Skipping it now means typing the flag and meaning it.

## NO CI RUNNER GATES THE MERGE. `npm run ci` IS THE GATE.

GitHub Actions was removed as a **merge** gate at the maintainer's direction: **nothing
verifies a pull request, and the gate that decides whether a commit may be pushed runs on the
machine doing the work.** One workflow did come back, for the **publish** path only — see
"GitHub Pages" near the end of this file. It runs tier 1 before it will publish anything, and
it cannot gate a merge, because it triggers only on `push: main`.

What remains below is about the merge path, and it is unchanged. But `main` is protected with
`Verify` as a required status check, so deleting the workflow alone would have deadlocked the
repository — the check would never report and no pull request could ever merge, with
`enforce_admins` on so not even the owner could override it.

**`npm run ci` does what the workflow did**: runs `npm run verify:all` here, writes
`.verify-receipt.json` naming the exact revision, and POSTs a `Verify` status to GitHub. It
refuses on a dirty tree, because a status names a COMMIT and a dirty tree is not one.

**The status is EVIDENCE, not enforcement.** It was going to satisfy the required check until
measurement showed it cannot: GitHub scopes a required check to an APP, only a GitHub App can
post a check run, and a commit status is a different API. So it is posted, it is visible on the
commit, and **nothing reads it**. Its only job is to make "I ran the gate" checkable by
somebody else.

```bash
npm run ci                  # the full gate, writes the receipt, tries the status
npm run ci -- --no-report   # run the gate, record locally, tell GitHub nothing
npm run ci:report           # AFTER pushing: publish the status for that commit
```

**The receipt and the status happen at different moments, and that is unavoidable.** A commit
status can only attach to a commit GitHub has seen; `npm run ci` must run _before_ `git push`
because `pre-push` reads the receipt. So the receipt is written first (enforcement) and
`ci:report` publishes afterwards (evidence). **`ci` says so on an unpushed branch rather than
reporting a failure** -- the first version treated GitHub's `422 No commit found for SHA` as an
error and blamed `gh auth status`, which was fine.

**What it costs, and this is the honest part — it is more than was planned.** The intent was
to keep the required check and move only the runner. **That turned out to be impossible**: the
check was removed from branch protection, so nothing stops a merge now except the person doing
it. On top of that, a CI runner cannot be talked out of running and this script can simply not
be invoked.

**So the gate is reported by, and run by, nobody but the person it constrains. What stops a
bad commit reaching `main` is now `.githooks/pre-push` refusing to push without a passing
receipt for that exact revision — which makes "the gate passed" a fact about a commit rather
than a claim about one. It is still bypassable with `--no-verify`, and still not enforced by
anything that could not be talked out of it.

Nothing here should ever be described as "CI".

That is the class of defect this whole section exists to prevent: a claim about coverage
that is one row wider than the coverage. An audit found it by listing the gates
`verify.mjs` actually runs and comparing.

`check:coverage` exists because ESLint prints **nothing** — no warning, exit
0 — for a file that no config block matches, so `npm run lint` can report success
while whole directories are never linted. That is exactly what had happened to
`scripts/`, `service-worker.js` and `game.js`. Never trust `eslint .` on its own;
the coverage check is what makes it meaningful.

If a gate is wrong, fix the gate in a reviewed commit. **Never delete or weaken
a gate to make a change pass.** That is the one move that turns this repository
back into a project with good intentions instead of guarantees.

---

## Working on this codebase

- **Zero runtime dependencies.** Every added dependency is a liability we chose
  to accept, and the commit message must justify it.
- **Unit tests are the default.** `node --test`, no framework churn. Every bug
  fix lands with the test that would have caught it.
- **Tests are hermetic.** Inject time; never read the wall clock. (Two tests
  once passed for months and then failed forever because they hardcoded a date
  against a 14-day prune window. `scripts/check-clocks.mjs` exists because of
  that.)
- **Boundaries get pinned.** If code prunes, caps, or expires, test the value
  exactly on the boundary and one past it.
- **Performance is measured, not assumed.** Object pooling and spatial
  partitioning are load-bearing; `test/perf-budget.test.js` guards them.
- **Accessibility is a feature.** Every dialog needs an accessible name; see
  `test/a11y-dialogs.test.js`.

---

## Repository setup notes

**`main` is protected. Every change goes through a pull request.** Direct pushes
are rejected by GitHub, not merely discouraged:

```
remote: - Changes must be made through a pull request.
 ! [remote rejected] HEAD -> main (protected branch hook declined)
```

**That rejection used to name a required check as well.** It no longer does — see below — and
this block kept the old text for exactly one commit after the check was removed, which is the
drift this repository spends its time hunting.

Enforced on `main`: pull requests mandatory, force pushes denied, deletions denied, and
`enforce_admins` on. **There is NO required status check** — see the section above for why it
cannot be one: GitHub scopes a required check to an APP (`app_id: 15368`, Actions), only a
GitHub App can post a check run, and a local commit status does not satisfy it. The check was
therefore removed rather than left in place to block every merge forever.

**What that means in practice: the MERGE is unchecked.** GitHub will let a pull request
merge without the gate having run. What is checked is the PUSH, by the hook above -- so a
branch cannot reach GitHub unverified, but nothing stops an unverified branch being merged
into `main` once it is there. The protection that remains is procedural, and the hook is what
keeps it from being purely nominal.

The practical workflow is therefore:

```bash
git switch -c my-change
git commit -m "..."                     # pre-commit: fast gates
npm run ci                              # THE GATE -- verify:all, then the receipt
git push -u origin my-change            # pre-push: REFUSES without that receipt
gh pr create --fill
gh pr merge --squash --delete-branch    # nothing checks this for you any more

# The order is not a preference. `npm run ci` refuses a DIRTY tree, so it must come after the
# commit; and `pre-push` refuses without a receipt for HEAD, so it must come before the push.
# **One order satisfies both and this is it** -- commit, gate, push.
```

`required_approving_review_count` is 0, so a solo maintainer can merge their own
PR once the gate passes. Setting it to 1 would have locked the owner out of
their own repository, because GitHub does not allow self-approval.

**The merge is unchecked, but the publish after it is not.** Merging to `main` now triggers
`.github/workflows/deploy-pages.yml`, whose `verify` job runs tier 1 and whose `deploy` job
needs it — so a bundle that fails the gate cannot be published, whatever the merge did. The
gate runs too late to stop a bad commit reaching `main`; what it stops is that commit reaching
players. See "GitHub Pages" below for exactly what it covers, and what it does not.

**Never add a git remote named `upstream`.** The `gh` CLI prefers a remote with
that exact name over `origin`, which means every `gh` command run without an
explicit `-R` would silently target a repository you do not own. This bit us
once already: `gh repo view` in this working copy resolved to the original
public project rather than to ours. The reference remote is therefore named
`source`:

```
origin    https://github.com/NightShadeHuD/canvas-vampire-survivors.git
source    https://github.com/ricardo-foundry/canvas-vampire-survivors.git
```

Pass `-R NightShadeHuD/canvas-vampire-survivors` on any scripted `gh` command as
well. Belt and braces — the rename protects interactive use, the flag protects
automation.

**GitHub Pages is ENABLED, and the game is playable at**
<https://nightshadehud.github.io/canvas-vampire-survivors/>.

This was previously recorded here as _not enabled_, with the deploy workflow disabled so a
permanent red X could not mask real failures. Both were corrected once the workflow was
verified to gate on the full `Verify` job before deploying:

```bash
gh api --method POST repos/NightShadeHuD/canvas-vampire-survivors/pages -f build_type=workflow
gh workflow enable "Deploy to GitHub Pages"
```

First deploy verified end to end: the workflow ran `Verify`, built `dist/`, assembled `_site`
and deployed; every asset returned 200; and a headless browser confirmed the deployed game
starts a run, advances its clock and reports **0 page errors**.

**That gate was then deleted, and for several commits the deploy published without verifying
anything.** The workflow's own header said so out loud — `Publishing only. THE GATE IS NOT
HERE.` — and it was true: the only thing standing between a drifted bundle and production was
`.githooks/pre-push`, a hook on one laptop, bypassable with `--no-verify` and not run on merge
at all. The gate is back, as its own `verify` job that `deploy` needs, running `npm run verify`
— tier 1, the 26 gates `npm run ci` runs, and by `docs/ENGINEERING-STANDARDS.md` §2 the only
thing that may be described as "green".

**Godot 4.7.2 is installed and PINNED in that job, and the project is imported before it
runs.** Both are load-bearing, and the measurements are why. With no `godot` on PATH the gate
still exits 0 while checking none of the Godot half: `npm run verify` on a PATH without Godot
prints `verify: all 26 gates passed, 2 of which checked nothing`. Without the `--import` the
suites cannot load and the same gate fails at gate 5 blaming a document —
`claims "godotAssertions" is 453, but the measurement is 0`. So the job's last step refuses to
publish if `check:godot` or `check:reach` appears in that "checked nothing" list. **A green
gate is not a checked gate**, and that difference is now a step rather than a hope.

**What that gate does NOT cover, and this is the honest part:** the browser tier
(`boot-smoke.mjs`, `a11y-audit.mjs`, `check:sw-delivery.mjs`) and the pixel tier do NOT run on
the runner. Tier 2 would need `npx playwright install --with-deps chromium` on every deploy,
and `check:pixels` needs a DISPLAY that a GitHub runner does not have. **So a bundle can reach
players having passed tier 1 and no browser test** — and the workflow's own header says so,
where whoever reads a deploy log will see it.

**`__SURV_DEBUG__` is deliberately absent on the deployed site.** It is gated on
`location.hostname` being `localhost`, `127.0.0.1` or empty, so the debug hooks that
`scripts/boot-smoke.mjs` drives exist locally and not in production. That is intended, and it
means boot smoke cannot verify the live site — it is verified by observation instead.
