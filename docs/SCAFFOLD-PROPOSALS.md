# Proposals for `agent-scaffold`

**Status: proposals, not patches.** Nothing here modifies `agent-scaffold`. Each item
was learned by building a real project against it — a TypeScript game ported to Godot —
and each names the failure that produced it, because a mechanism without its failure
story is a mechanism the next person deletes.

Written after two adversarial audits of this project's own gates, which found **seven
demonstrated false greens**. Every item below is something we had to build, or wish we
had, because the scaffold did not cover it.

---

## What the scaffold already covers, so these are not duplicating it

`check_assertions` (a **weakened** assertion), `check_claims` (handoff numbers against
measured ones), `check_docs` (document structure), `check_register` (shortcut rows),
`check_suite` (suite report against CI), `gates.sh`, `session-end.sh` (uncommitted work).

The gaps are all in one direction: **the scaffold's mechanisms assume the project is the
thing being checked. Nothing checks the CHECKS, and nothing covers code the project
GENERATES or a language it CONVERTS TO.**

---

## 1. `check_generated` — drift, not regeneration

**The failure.** Our Godot data is generated from `src/data.ts`. `check:godot`
regenerated it and then verified it, so it **silently repaired drift and always passed.**
Proved by corrupting a committed value (`baseDamage: 20` → `999`) and watching the check
rewrite it back and report `ok`.

The consequence is the exact problem two sources of truth create: edit the source,
forget to re-export, and **CI passes while the product runs on yesterday's numbers.**

**The mechanism.** Generate to a temporary directory and **diff** against what is
committed. A check that fixes the thing it is checking can never fail.

**And the second half, which we found separately.** The diff looped over the files the
generator _just produced_. A stale file left behind by a rename — still carrying its
`GENERATED FILE — DO NOT EDIT` banner — was never compared, because nothing enumerated
the output **directory**. Enumerate the directory and report files that are present but
not generated.

## 2. `check_errors` — a target language's runtime errors must fail a gate

**The failure.** A GDScript runtime error **does not fail a suite.** It prints a stack
trace and carries on, so a crashing test reported `PASS`. We had a green suite whose
subject threw on every assertion.

**The mechanism.** For each test target, know whether a runtime error is fatal, and if it
is not, **scan the output** for the language's error markers and fail on any. Ours greps
for `SCRIPT ERROR|Parse Error|Invalid access|Invalid call|nonexistent function`.

**Why this generalises far beyond GDScript.** The same shape exists in Python warnings,
in shell with `set +e`, in JS without strict mode, in any runner that reports per-test
results rather than per-process exit codes. **If a runner can print an error and still
exit 0, the scaffold has no defence against it.**

## 3. `check_worklist` — a migration's hand-work needs a ceiling

**The failure.** Our exporter has always printed `22 value(s) could NOT be converted` —
the port's remaining hand-work — and **nothing recorded the number.** Close one and it
fell silently; add an unconvertible value and it rose silently. **A worklist nobody
measures is a worklist that grows.**

**The mechanism.** A ceiling that may only fall, with the `--update` ratchet, and **the
paths, not just the count** — so a failure names what was ADDED rather than listing the
oldest entries. A failure you have to debug by hand is half a failure.

**And a trap worth writing down:** our exporter's scope was a hardcoded table list, so
**a new export in the source was never ported, never reported, never noticed** — the
"data the code ignores" bug, living inside the tool built to prevent it. **A migration
tool must enumerate the SOURCE, not a list someone maintains.**

## 4. `check_gate_coverage` — the gates' own blind spots

**The failure, five times in one audit.** Five gates filtered by a file extension or path
list written **before a new language and directory existed**, so the half of the codebase
being ported was outside every check:

| Gate                 | Blind to                                                                        |
| -------------------- | ------------------------------------------------------------------------------- |
| `check-destructive`  | `.gd` — so the rule against bulk edits did not cover the code being transformed |
| `check-hygiene`      | `.gd`, `.tscn`, `.godot`, `.uid`, and every extensionless file                  |
| `check-suppressions` | GDScript's `@warning_ignore` — a whole suppression family with no ceiling       |
| `check-docs`         | markdown-link citations (34 in our repo), only backticked ones were read        |
| `check-assertions`   | every `.gd` suite                                                               |

**The mechanism.** For each gate that filters by extension or path, assert the filter
**reaches every tracked file of the kinds it claims to cover.** A gate with an
allow-list is a gate with a scope, and scope drifts as a project grows.

**The related rule, which cost us a false claim in our own output:**

> **A pass line must report what was READ, not what was TRACKED.**

Ours said `clean — 275 tracked files checked` while reading 183 of them. Proved by
putting an unfinished merge and a fake AWS key in a `.gd` file and watching it pass.
**A count in a pass line is a claim of coverage**, and overstating it is worse than the
gap, because a reader stops looking. Name the files you did not read.

## 5. `check_vacuous` — checks that cannot fail

**The failure.** Three in one suite:

- `assert(foes.size() >= 0)` — **true of every array.** The surrounding 90-second test
  proved nothing about surviving it.
- A test named _"owes a pick each"_ that **never read the pick queue** — it asserted the
  XP curve and called it the pick queue.
- Title checks asserting a node **exists**, so an empty label passed.

**`check_assertions` catches an assertion that got WEAKER. Nothing catches one that was
never able to fail.** The distinction matters: a weakened assertion still encodes a
claim, while a vacuous one occupies the place a real assertion would go and **reports
green.**

**The mechanism is hard to make complete**, and we would rather propose the honest
version: flag comparison shapes that are tautological for their operand types
(`size() >= 0`, `x != x`, `len >= 0`), and require a **falsifying input** in review for
anything else. We have not built this yet, and say so rather than implying we have.

## 6. `check_assertion_counts` — a floor for suites a digest cannot reach

**The failure.** Our assertion-digest gate reads `test/*.test.ts`. Every Godot suite was
invisible to it, so a deleted `Check.*` call passed. A subagent found this by noticing
the gate passed **its own refactor** of those files without ever inspecting them.

**The mechanism.** A per-suite count of verdicts the suite actually printed, as a
**floor that may only rise.** Counting what the suite _reports_ rather than what its
source looks like means a directive inside a comment counts for nothing.

**And its stated limit, which we then hit.** The floor catches a **deletion**; it cannot
catch a **value→property substitution** — `assert(hp == max_hp - 10)` becoming
`assert(hp <= max_hp)` keeps the count identical. We verified that ourselves, after
writing the floor and believing it closed the hole. **A count is a proxy for strength and
it is a weak one; say so where the floor is defined, or the next person will trust it.**

---

## Method additions

### 7. One working tree, one agent

**The failure.** Two agents shared a checkout. One ran `git switch` while the other was
mid-refactor, so **HEAD moved under it**: its branch was created from the wrong base and
its commit landed on `main`. It cost nothing only because the second agent noticed and
undid it with plumbing commands.

**The rule.** A shared checkout is a shared mutable global. Each agent gets
`git worktree add --detach <path> <base>`. **Before delegating, ask where the other agent
will work — if the answer is "the same directory", the delegation is already broken.**

### 8. Make the correct assertion the EASIER one

**The failure.** Half our red tests were the **test** being wrong, and they were not
random — seven repeatable shapes: magnitude asserted where the claim was _direction_;
events counted where the claim was a _population_; state read _after_ it changed; a value
hardcoded that could be _read_; floats compared for _equality_; a _rate_ expected to be a
certainty; a _precondition_ assumed and never set.

**"Be more careful" fixes none of these.** An assertion helper library does, by making
the correct form the short form — `Check.rose(before, after)` is no longer than
`assert(before < 20.0)` and **cannot be wrong about which direction the claim was.**

This is the highest-leverage item here and the least like a gate: it is a **library**, and
its value is that it removes the opportunity to make the mistake rather than detecting it
afterwards.

### 9. Markers for machine-checkable numbers

**The failure.** `check_claims` needs numbers it can compare. Ours were **prose that
happened to contain figures**, in two different shapes, so nothing could parse them
without also matching historical ones — `"375 -> 0"` is a legitimate sentence.

**The mechanism.** A delimited block (`<!-- claims:begin -->`) the parser reads, with
prose explicitly out of its reach. **A narrow parser that misses something is a bug; a
broad one that cries wolf is a gate nobody keeps.**

### 10. Measure a cascade before starting it

**The failure.** A dozen changes were backed out because the cascade was larger than the
increment, and **every one was discovered after starting.** Backing out is correct;
backing out _repeatedly, for the same reason_ means the measuring step was being skipped.

`--explain`, `--dry-run` and a one-file probe say how big a change is before it is
half-made.

---

## The meta-lesson, which we would put at the top of §0

**Four times in one project the verification layer was the defect rather than the code it
verifies.** Each was found by someone other than the person who wrote the gate:

- a gate that regenerated the thing it was checking, so it could not fail
- a suite that printed `FAIL` and reported `PASS`, because it mixed two harnesses
- a runtime error that did not fail a suite
- a gate counting only one directory, while the product's other half went unchecked

**The person who writes a gate is the worst person to find its hole.** If the scaffold
has one sentence to add, it is that one — and the practice that follows from it: **for
every gate, construct the input that should fail it, and watch it fail.** A gate nobody
has watched fail is a gate nobody knows works.
