# Probe caveats: the traps that make a throwaway measurement lie

**For whoever is about to write a throwaway probe.** Not a test, not a gate — the script you
write to answer one question and then delete.

This document exists because of one night. **Three separate agents reported that their own
measurement instrument had been dead**, and every one of them had already produced confident,
meaningless results from it. Two of the three found it themselves, which is the only reason it
cost a round trip instead of a wrong commit.

It is not a list of mistakes. It is the list of traps that make a probe report **"secure"**,
**"no change"** or **"not a defect"** when the opposite is true — the direction that cannot be
noticed by reading the output, because the output is exactly what you hoped for.

---

## The rule this whole document is an instance of

> **An instrument must be shown to read a KNOWN signal before its reading is believed.**

A probe that reports "nothing changed" has told you **nothing at all** until the same probe, on
the same run, has reported a change on a case where a change exists. That case is the **positive
control**, and it is not a formality: it is the only part of the probe whose result you can
check without already knowing the answer.

Three corollaries, each of which cost someone a false result:

1. **A reading of "secure" is only meaningful if the same instrument said "vulnerable" on a
   case that is vulnerable.** A scanner that fires on nothing is indistinguishable from a
   scanner that is broken, and the first one is rarer than the second.
2. **The control must assert the condition it depends on**, not merely exercise it. A control
   that runs and silently stops reproducing the defect has become a second copy of the
   measurement (entry 10).
3. **Your own confidence is not evidence.** Every agent in this document believed its probe was
   working. Not one was lying; each had run it against the case it had in mind.

Rule 19 in `AGENTS.md` is this rule written down. Rule 11 covers durable checks — a check is not
a check until you have watched it fail, and `gate-selftests.json` names a break for each of its
**33 entries across 22 gates** (7 of them needing Godot, 2 declared incomplete). **This document
is about the probes no ledger can reach**, which is why it is prose and not a gate. See the last
section.

---

## The thirteen traps

| #   | Trap                                                       | The false reading it produces                        |
| --- | ---------------------------------------------------------- | ---------------------------------------------------- |
| 1   | `javascript:` URLs under a synthetic `element.click()`     | "every payload is safe"                              |
| 2   | A dynamic `import()` inside a storage round trip           | "the round trip does not persist"                    |
| 3   | `_resetStorageForTests` clearing the fallback under test   | "the fallback path is broken"                        |
| 4   | Stubbing `window.localStorage` after the module loads      | storage numbers that describe the in-memory fallback |
| 5   | `git apply` half-applying, with the failure swallowed      | "the work does not do what its author claimed"       |
| 6   | A bulk edit keyed on a field that is not unique            | "the manifest is fine, only one entry changed"       |
| 7   | `git reset --hard` in a test loop                          | "the fix does not work"                              |
| 8   | `check:selftests` NOTICEing on a dirty tree                | "the gate self-tests passed"                         |
| 9   | A fresh worktree, before one `godot --import`              | a document blamed for a missing cache                |
| 10  | A control that hardcodes the defect it is meant to produce | "the fix holds"                                      |
| 11  | A control that is true by construction                     | "the fix holds", with no measurement at all          |
| 12  | A corpse as the slow condition                             | "the slow is a flawless 0px per frame"               |
| 13  | A name says one quantity, the regex reads another          | "the document is wrong", when a test is failing      |

**Reproduced in this session** — entries 5, 6, 8, 9 and 13 carry the exact command that was
run to re-measure them here, and entry 10's general pattern is the one addition this session
made to an entry it did not re-run. The others record the measurement that found them, named as it was
reported. **Nothing here is an entry nobody measured**, and nothing here was invented to fill a
heading.

---

### 1. Headless Chromium does not run `javascript:` URLs on a synthetic `element.click()`

**The trap.** A probe drives an XSS payload by finding the element and calling `.click()` on it
from script. That is a _synthetic_ (untrusted) activation, and the browser refuses to navigate
to a `javascript:` URL for it.

**How it lies.** Every payload reports safe. The probe's output is a clean sheet, and a clean
sheet is what you are hoping to see, so nothing about the output invites a second look.

**The measurement that caught it.** The probe's own control returned **"safe"** — a payload that
is known to fire reported safe. That is the entire value of a positive control: it turned a
result into a contradiction. The same payloads **do** fire under a trusted `page.mouse` click.

**What to do instead.** Drive interaction with the input layer (`page.mouse`, `page.keyboard`),
not with a DOM method, whenever the claim is about what a _user's_ activation can do. And in
every such probe, include one payload you know fires and require the probe to report it.

---

### 2. A dynamic `import()` can make a storage round trip inert

**The trap.** The round trip is measured across a dynamic `import()`, so the module instance
that writes and the module instance that reads are not the ones the probe believes it is
measuring.

**How it lies.** The write appears not to survive, so the probe reports that the round trip does
not persist — the opposite of the truth if the real path persists fine.

**Found by.** The fix's own author, in the same session as the fix. Nothing external caught it;
the author re-read the probe and saw that the trip was crossing an import boundary.

**What to do instead.** Measure a round trip inside one module instance, and **assert the
premise** — that the value was written, and that the reader is the same instance that wrote it.
If the probe must cross an import, assert the import resolved before reading anything from it.

---

### 3. `_resetStorageForTests` clears the very fallback being measured

**The trap.** The probe calls the reset helper to get a known starting state — and the helper
clears the in-memory fallback that is the subject of the measurement.

**How it lies.** The fallback measures empty, so the probe reports the fallback path broken.
It is not broken; the probe emptied it and then asked it a question.

**Found by.** The same author, in the same session. **This is the same author twice and the same
session twice**, which is the point: a probe can pass its own review and still be measuring the
wrong object, and only re-reading the setup finds it.

**What to do instead.** A reset helper is part of the instrument. After calling it, **assert the
state you believe you just created** — if the fallback is the subject, assert it is populated
(or empty) in the way the measurement requires _before_ the measurement runs.

---

### 4. `window.localStorage` must be stubbed BEFORE the module loads

**The trap.** Storage selection happens at module load. Stub `window.localStorage` afterwards
and the module has already chosen its backend.

**How it lies.** The numbers you get describe the in-memory fallback while your report says
they describe `localStorage`. The author's own warning, verbatim: **"a verifier without that
stub will measure nonsense."**

**The measurement that caught it.** The author's, by knowing the load order of their own code —
and it is written here because the _next_ person to verify that fix will not know it.

**What to do instead.** Install the stub in an init script that runs before any application
module (Playwright's `addInitScript`), and then **prove the stub is the backend in use** — read
something back through the stub and require the seam to be visible. If you cannot show the
module is using your stub, you have not measured `localStorage`.

---

### 5. `git apply` can half-apply, and the failure is easy to swallow

**The trap.** Two independent halves. **First:** `git apply` refuses the whole patch by default
when one file's hunk does not apply — but `--reject` applies what it can, writes a `.rej` beside
the file it could not, and exits 1. **Second:** the exit code is easy to lose. Run the command
through anything (`| tail`, a wrapper, a script that only checks the last command) and `$?` is
the pipe's, not git's.

**How it lies.** A tree with four of six files applied looks exactly like an agent's work being
wrong. In the incident this came from, **it looked exactly like the agent's central claim was
false. It was the application, not the work.**

**The measurements that caught it.** Re-measured here with three commands.

```
$ git apply --verbose p.patch          # a.txt and b.txt, b.txt's hunk cannot apply
error: patch failed: b.txt:1
error: b.txt: patch does not apply
EXIT=1
$ cat a.txt
one                                     # unchanged: default mode is atomic

$ git apply --reject p.patch           # the same patch
Applied patch a.txt cleanly.
Applying patch b.txt with 1 reject...
Rejected hunk #1.
EXIT=1
$ cat a.txt
one-changed                             # HALF APPLIED, and a b.txt.rej left behind

$ git apply p.patch 2>&1 | tail -2     # the same failure, through a pipe
EXIT=0                                  # what a script sees
```

A fourth, worse shape, measured while writing this: **`git apply --3way` prints
`Applied patch to 'b.txt' cleanly.` and does not write the file.**

```
$ git apply --3way p.patch
Applied patch to 'b.txt' cleanly.
EXIT=1
$ git diff --stat
                                        # empty: b.txt is byte-identical to before
```

**Git's own per-file success message is not evidence that the file changed.** The message is
printed before the operation is abandoned.

**What to do instead.** `node scripts/apply-patch.mjs <file>` — it applies the patch, then
**reads every file the patch names** and refuses unless each one actually changed, naming the
ones that did not. It does not trust the exit code or any message. Never run a patch through a
pipe, and never conclude anything about the _work_ from a tree the _application_ touched.

---

### 6. A bulk edit keyed on a field that is not unique destroys a manifest

**The trap.** A loop selects entries by a field that is not an identity — `gate == 'check:reach'`
— and writes one value to all of them.

**How it lies.** Nothing errors, nothing is malformed, and the file still parses. Six of the
seven entries are simply gone, and **every gate downstream stays green**, because each surviving
entry still has a break that works. Nothing can tell a collapsed entry from a deliberate one.

**The measurements that caught it.** Two commands, both re-run here.

```
$ node -e '... filter(e => e.gate === "check:reach") ...'
entries matched by gate == "check:reach": 7
distinct break strings before: 6
distinct break strings after : 1
total entries: 33 -> 33
```

Seven entries were overwritten with one string. The entry count is unchanged, the file is valid,
and six self-tests silently stopped testing anything. **The second measurement is the reason
this cannot be a gate:** the seven entries did not have seven distinct break strings to begin
with — two of them legitimately share one — so "no duplicate breaks in the manifest" is a check
that **cries wolf on today's tree** while still missing the real damage.

**What to do instead.** **A bulk edit must name how many matches it expects, and refuse any
other number.**

- For source text: `node scripts/edit.mjs <file> --anchor '<exact>' --replace '<new>' --count N`.
- For a JSON manifest or any collection: `node scripts/edit-json.mjs <file> --where 'field=value'
--expect N --set field=value`. `--expect` is **mandatory**, and a predicate that matches any
  other number is refused before anything is written.
- In a script of your own: `selectExactly(items, predicate, expected)` from
  `scripts/lib/source-edit.mjs`, which refuses the selection rather than the write.

**And after any bulk edit, count what you changed and compare it to the number you declared.**
The count you did not write down is the count you cannot notice changing.

---

### 7. `git reset --hard` in a test loop reverts the thing under test

**The trap.** A probe loops over cases and resets the tree between iterations to keep them
independent. The reset also reverts the uncommitted fix being tested.

**How it lies.** The loop reports the fix failing on every case. The evidence is consistent,
reproducible and completely about the wrong tree — the fix was discarded before it was ever
exercised. In the incident, **it was discarded this way before it was committed.**

**What to do instead.** Never reset in a loop. Use a fresh `git worktree` per case (rule 15), or
have the loop restore exactly the paths it touched (the pattern `check-selftests` uses, after
`git checkout HEAD -- .` destroyed five pieces of work in one session). **Commit the thing under
test before measuring it**, so no reset can remove it.

---

### 8. `check:selftests` NOTICEs on a dirty tree, and a NOTICE reads like a pass

**The trap.** `check:selftests` will not run its breaks on a dirty tree, because the restore is
a checkout and it would destroy uncommitted work. It prints a `NOTICE:` line and exits 0.

**How it lies.** It hides a real failure. In the incident **a broken break command was hidden for
six rounds** — a `check:reach` entry whose anchor no longer matched, reported as "its BREAK
command itself failed to run". `check:selftests` only ran on the clean trees, mid-work runs
NOTICE'd past it, and the intermittent result read as a flake.

A second, more specific trap sits under it: **a symlinked `node_modules` makes an otherwise clean
tree look dirty.**

```
$ mkdir -p /tmp/ignore-probe && cd /tmp/ignore-probe && git init -q .
$ printf 'node_modules/\n' > .gitignore
$ git add .gitignore && git commit -qm init
$ mkdir -p /tmp/ignore-probe-real && ln -s /tmp/ignore-probe-real node_modules
$ git status --porcelain
?? node_modules                         # .gitignore's `node_modules/` does NOT match a symlink
```

The trailing slash makes it a _directory_ pattern, and a symlink is not a directory to git. Run
the same probe with a slash-less `node_modules` in the `.gitignore` and the status goes clean.

**The measurement that caught it.** Re-measured here, both halves:

```
$ git -C /tmp/work-hygiene check-ignore -v node_modules
/Users/.../canvas-vampire-survivors/.git/info/exclude:10:node_modules   node_modules
```

This checkout is clean with a symlinked `node_modules` because `.git/info/exclude` carries a
slash-less `node_modules` **with the reason written above it**. That mitigation is local — it is
not committed, so a fresh clone does not have it, and this trap is waiting there.

**What to do instead.** Read the NOTICE lines. `verify` prints how many gates "checked nothing";
**a run whose count is not zero has not verified those gates.** And when a probe's result changes
between two runs, suspect the tree state before you suspect a flake.

---

### 9. A fresh worktree fails at gate 5, blaming a document

**The trap.** `godot/.godot/` holds the `class_name` cache and is gitignored, so a fresh worktree
does not have it. Every `verify_*.gd` dies with `Parse Error: Identifier "Check" not declared`,
so the _assertion count_ measures zero.

**How it lies.** The failure names a **document**. It reads as a documentation defect — "your
number is wrong" — when the document is correct and the cache is missing. In this session it was
reported as `claims "godotAssertions" is 453, but the measurement is 0`. Both numbers are right;
the measurement had nothing to count.

**The measurement that caught it.** Re-run here in a worktree with no `godot/.godot/`:

```
$ git worktree add --detach /tmp/probe-nocache main && cd /tmp/probe-nocache
$ ls -d godot/.godot
ls: godot/.godot: No such file or directory
$ npm run --silent check:claims
check-claims: FAILED
  line 1090: claims "godotAssertions" is 453, but the measurement is 0.
EXIT=1
```

**What to do instead.** `godot --headless --path godot --import` before believing any Godot
number, and **treat "the measurement is 0" as a question about the instrument, not about the
document.** A number that measures zero when it has never measured zero before is the classic
dead-instrument reading.

---

### 10. A control can silently stop firing

**The trap.** A service-worker probe hardcoded a cache-name bump to the name that later became
the **shipped** name. After that, the control could not reproduce the defect it was there to
produce — it was bumping the name to itself.

**How it lies.** The control still runs, still passes, and still appears in the output. Only its
_result_ is meaningless: it now proves that nothing happens when nothing changes. The probe's
verdict — "the fix holds" — rests on a control that stopped testing anything, silently, at the
moment the code changed around it.

**What to do instead.** **Derive both sides of the control from the bytes served**, so no string
in the probe can go stale, and **assert the premise** — after setting up, require the probe to
observe the defect condition (here: that the served bytes differ from the cached bytes) before
it is allowed to report a verdict.

**The general pattern, which belongs with the caveats rather than with this one entry: a control
must assert the condition it depends on.** A control that only _performs_ its setup is a
measurement, not a control.

---

### 11. A control can be true by construction

**The trap.**

```js
const a = cond ? x : y;
const changed = a !== y;
```

In the control branch, `a` **is** `y`, so `changed` is `y !== y` — false, always, by
construction. The control branch cannot report a change no matter what the code under test does.

**How it lies.** The control passes. It is not a weak control or a stale control; it is not a
control at all, and it will pass against any implementation, including a broken one.

**The measurement that caught it.** **Watched: mutating the probe produced failures only once the
control was already broken.** That is the signature — the break only shows up after you have
already damaged the control, which is exactly when you are least likely to trust it.

**What to do instead.** Write the control so that its two branches differ in an input the
assertion reads, then **mutate the thing under test and require the control to notice**. If
mutating the subject does not change the control's reading, the control is measuring its own
construction.

---

### 12. A corpse is a perfect slow

**The trap.** A slow effect is measured by comparing how far two foes travel. One of them was
killed by the same blast that applied the slow.

**How it lies.** **The corpse travelled 0px**, and any naive distance comparison reads 0px as a
flawless slow — the best possible result for the effect being tested. The measurement is not
merely noisy; it is maximally favourable, which is the shape of result that never gets a second
look.

**The measurement that caught it.** **Four separations were needed** before the comparison meant
anything: the slow had to be measured on a foe that survived, with the damage separated from the
effect, the effect's application separated from its magnitude, and the magnitude separated from
the frame timing.

**What to do instead.** Assert the subject is **alive and eligible for the measurement** before
comparing, and check that the population you measured is the population you meant (rule 10's
"events counted where the claim was a _population_", in a probe rather than a test). **When a
result is perfect, look for the reason it could be zero.**

---

### 13. A measurement whose NAME says one thing and whose REGEX reads another

**The trap.** The instrument reads a number that is not the number its name claims.
`measurements.tests` read `ℹ pass N` — the count of **passing** tests — and was called
`tests`, and the documents claim a test **count**.

**How it lies.** The moment one test fails, the measurement is one lower than the number
it is compared against, and the gate reports:

```
claims "tests" is 1054, but the measurement is 1053
```

That sentence **names the document**, and it invites exactly one action: edit the number.
The number is right. A test is failing.

**The measurement that caught it.** Two regexes over one run, with one test deliberately
red:

```
$ node --test test/*.test.ts
ℹ tests 1054   ℹ pass 1053   ℹ fail 1

OLD regex /pass (\d+)/          -> 1053   <-- the number that blamed a document
NEW regex /^ℹ tests (\d+)$/m    -> 1054
```

The runner prints both, and the fix is to read the one whose name matches the claim. It is
anchored to the summary line as well, because an unanchored pattern can match a number a
test printed about itself, and the first match wins.

**The sibling, and it is the same genre.** `measurements.godotAssertions` counts
`  ok   ` lines from the Godot suites — the count of **passing** assertions.

```
verify_save.gd green:              21 ok   0 FAIL
verify_save.gd, one assertion broken:  20 ok   1 FAIL   (21 assertions ran)
```

So a failing Godot assertion reads one lower, and `check:claims` would report a mismatch
against `docs/GODOT-PORT.md` — **blaming a document for a red suite.** There is no
"total" line to read instead, so the entry now reports **nothing** rather than a wrong
number when any suite fails: a figure about a green tree is not measurable on a red one,
and the failing suite is `check:godot`'s finding to report, which it does loudly.

**And the fix was wrong the first time, which is the best part of this entry.** Counting
`ok + FAIL` looks obviously more correct, and it was written, and the **green tree**
falsified it immediately: the figure went 453 → 466, because `verify_assertions.gd`
**prints thirteen deliberate FAIL lines** — its whole job is to show that `Check.rose`,
`Check.fell`, `Check.at_most` and `Check.rate` _can_ fail, so it provokes each one, and
its suite reports PASS. **The control for a change to an instrument is the ordinary green
run**, and it is the one nobody thinks to do.

**What to do instead.**

- Read the number the runner **names**, not an aggregate that happens to be nearby.
- Anchor the pattern to the summary line; the first match in a stream of test output is
  not necessarily a summary.
- When the output has no unambiguous total, **return "could not be measured"** rather
  than a number that means a different quantity. An unmeasured claim reported as
  unmeasured is a smaller lie than a measured claim compared against the wrong figure.
- **Any claim compared against a figure measured from a DIFFERENT population is this
  trap**, and the population here was "things that passed" where the claim said "things
  that ran".

---

## Why this is prose and no gate can enforce it

Rule 11 is enforced: `gate-selftests.json` names a break and a run command for every gate in the
chain, and `check:selftests` executes them. That works because a gate is a **durable artifact**
with a name, a location and a ledger.

**A throwaway probe has none of those.** The three dead instruments from tonight were scripts
written to answer one question and deleted before anyone could inspect them. There is nothing to
register, nothing to re-run, and no file for a check to read. A gate that claimed to cover them
would be exactly the defect this document is about: **an instrument reporting on something it
cannot see.**

So the mechanism cannot exist, and the rule is stated instead — in `AGENTS.md`, rule 19. The
honest position is that this half of verification is on the person writing the probe, and the
only thing this repository can do is make the trap list readable _before_ the probe is written.

## What a probe should carry out of the door with it

If you take one thing from this document, take this shape:

```
1. The claim.            one sentence, falsifiable
2. The instrument.       what it reads, and from where
3. The positive control. a case where the reading MUST be non-trivial
4. The premise assert.   what the control depends on, asserted before it runs
5. The raw output.       both branches, pasted, not summarised
```

Steps 3 and 4 are the ones that were missing every time.
