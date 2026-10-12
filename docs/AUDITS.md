# Commissioning an adversarial audit

**This is a process, not an aspiration.** It exists because of a measured result: in one
session, six agents were commissioned, and **five found defects that the author of the code
could not have found** — four of them holes in work that had _just been shipped and believed
correct_.

Read [AGENTS.md](../AGENTS.md) rule 16 first. This file is how you act on it.

---

## Why this works, and why it is narrower than "more hands"

**It is not throughput.** In the session that produced this file, two audits ran and the
author did minor work alongside both times. Parallelism was never the value.

**The value is that the author of a gate is the worst person to find its hole.** Four
findings, all in code the author had just written and believed finished:

| Finding                                                                    | What the author had just done                                                                         |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `check-assertions` never read a `.gd` file                                 | built that gate                                                                                       |
| The title screen rendered **entirely off-screen**                          | _strengthened_ that assertion from "the node exists" to "the text is correct" — and called it the fix |
| An argument-shape digest still missed `equal(hp, maxHp)` → `equal(hp, hp)` | shipped that fix, and claimed it closed the gap                                                       |
| `found.name` did not exist, so the digest was kind-only                    | changed that code the same round                                                                      |

**A person checks that a gate PASSES. An auditor checks that it CAN FAIL.** Those are
different questions, and the second one is the one that matters.

---

## The hard ceiling: verification does not delegate

**An agent's report is a claim, not a result.** In the session above, one agent's git work
was verified independently before anything was built on it — four claims, all four held. That
was luck as much as diligence, and it is the _only_ reason a commit that landed on `main` by
accident cost nothing.

**So: a tree does not work.** In a two-level tree a sub-sub-agent's claim reaches the
conductor third-hand, and the conductor cannot construct the falsifying input for a claim
they cannot see. **Fan out one level. Agents do not spawn agents.** Every claim comes back
with the command that produced it, and the conductor runs the gate themselves before
believing it.

**And the conductor must not build on an unverified claim.** Where that rule was broken in
the session above, a fix was shipped that closed a _different_ hole than the one claimed —
and it took another audit round to discover.

---

## What made the good reports good

**Adversarial framing.** The brief that produced nothing said _"analyse failures and TS-port
readiness."_ The four that produced everything said variants of:

- _"construct the input that should fail it, and watch it fail"_
- _"demonstrate, do not speculate"_
- _"I audited 12 suites and found 3 real problems is a better report than 15 suspicions"_

**A required positive control.** Every demonstrated finding had to show BOTH the break (the
check stayed green) AND the control (something it _should_ catch went red). Without the
control, "nothing changed" proves nothing — the probe may simply not work.

**A required clean list.** Auditors were asked to name what they checked and found
**correct**, so the report is calibrated and an unmentioned gate is not assumed broken.

**A required uncertainty section.** Honesty was requested explicitly, and the good reports
volunteered demoted suspicions separately from findings.

---

## The brief template

Copy this. Fill the brackets. **Delete nothing** — the parts that look like boilerplate are
the parts that produced the results.

```markdown
You are auditing <AREA> in the repository at <PATH>.

## Work in your own worktree — this is mandatory

Other agents are working in this repo concurrently. Do NOT work in the main checkout.

    git -C <PATH> worktree add --detach /tmp/audit-<NAME> main
    cd /tmp/audit-<NAME>
    ln -s <PATH>/node_modules /tmp/audit-<NAME>/node_modules

Do not `git switch`, commit, or push anything in the main checkout.

## Background

<WHAT THE AREA IS, AND WHAT IT IS FOR.>

**<THE KNOWN GAPS, SO THEY ARE NOT RE-REPORTED.>**

## Your task

<ONE SENTENCE STATING THE ADVERSARIAL GOAL. "Find gates that cannot fail" beats "review the
gates". Name the specific shapes to look for, and say which are already known.>

## Method — this matters more than the findings

**Do not report a theoretical weakness.** For every finding, paste the raw output of BOTH:

- **The break**: you changed <X> and the check still reported OK.
- **The positive control**: you changed something it SHOULD catch, and it reported FAIL with
  a non-zero exit.

**"I audited <N> and found 3 real problems" is a better report than 15 suspicions.** A
finding you could not demonstrate is a SUSPICION and must be labelled one.

## Rules you must follow

- Read `AGENTS.md` at the repo root first. It has <N> rules.
- **Never edit with `sed -i` or a raw file write.** Use
  `node scripts/edit.mjs <file> --anchor '<exact old>' --replace '<new>'`. It refuses an
  ambiguous anchor and reads the file back.
- Restore every break. `git diff` must be empty when you finish. Do not commit.
- Report honestly. If you are unsure, say so. Do not pad.

## Report format

1. **What you checked**, by name and count.
2. **Demonstrated findings**, ranked, each with the command, the raw output, and why it
   matters.
3. **Suspicions** you could not demonstrate, clearly marked.
4. **What you checked and found CLEAN** — so unmentioned areas are not assumed broken.
5. **What you are unsure about.**

Do not open a PR. Report back to me.
```

---

## What to point them at, in priority order

**1. Your own tooling.** Ten of roughly fourteen real findings in the session above came from
auditing the gates, not the product. The gates are the thing nobody else will ever check
properly, because they look like they work.

**2. Anything you just finished.** The whole point. An audit of last month's code finds less
than an audit of this morning's, because this morning's is the part you have not had time to
be wrong about yet.

**3. What a user perceives.** Behaviour and feel, not state. The worst bug this project ever
shipped had a perfect simulation and a hero nobody could see.

**4. The documentation.** Every number, command and path — checked against the tool that
produces it, not against another document.

---

## Anti-patterns, each of which happened

**A vague brief.** _"Analyse failures and TS-port readiness"_ produced no trace, no report and
no commits. The agent had nothing to be right or wrong about. **Every brief needs a
falsifiable goal.**

**Delegating implementation you will verify anyway.** A refactor was delegated, then verified
line by line — the verification cost more than writing it would have. **Delegate
investigation. Keep authorship of the things you are accountable for.**

**Two agents in one checkout.** One ran `git switch` while another was mid-refactor; HEAD
moved, its branch came from the wrong base, and its commit landed on `main`. It cost nothing
only because the second agent noticed. **`git worktree`, every time.** (AGENTS.md rule 15.)

**Building on an unverified claim.** Two rounds of work rested on a fix that had closed a
different hole than the one claimed. **Run the gate yourself before you build on the report.**

---

## The result, stated so it can be checked

Six agents commissioned; five delivered. Roughly fourteen defects found; **four of them in
code written the same day and believed correct.**

**Two of those four were in a fix that had been made specifically to address the previous
finding.** That is the argument for this file.
