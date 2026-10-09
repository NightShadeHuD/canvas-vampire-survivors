<!--
Thanks for opening a pull request! Keep PRs focused — one concern per PR is
much easier to review. The standards this repo holds itself to are in
docs/ENGINEERING-STANDARDS.md; the checklist below is the short form.
-->

## Summary

<!-- One or two sentences describing what this PR does and why. -->

## What was wrong, and how do you know?

<!--
Evidence, not vibes. If this fixes a bug: how was it diagnosed, and what
command reproduced it? If it is a feature: what was the requirement?
-->

## Type of change

- [ ] feat — new gameplay / UI feature
- [ ] fix — bug fix
- [ ] perf — performance improvement
- [ ] refactor — internal change, no behaviour change
- [ ] docs — README / comments / wiki
- [ ] chore — tooling, deps, CI
- [ ] test — test-only changes

## Related issues

<!-- e.g. Closes #123, Refs #456 -->

## Verification

Paste the exact command you ran and its result. An unverifiable claim will be
rejected in review — see docs/ENGINEERING-STANDARDS.md §1.3.

```
$ npm run verify:all
...
```

## How was this tested?

<!-- Browsers / OS / input devices exercised. Include framerate throttling if relevant. -->

- [ ] Manually playtested in Chrome / Firefox / Safari
- [ ] Ran at 30 fps (DevTools CPU throttle) and at native refresh rate
- [ ] Tested with keyboard, touch joystick, and/or gamepad where applicable

## Checklist

**The non-negotiables** (docs/ENGINEERING-STANDARDS.md §1):

- [ ] **Red baseline respected.** I did not build on top of pre-existing
      failures. If I found one, I stopped, reproduced it in a pristine
      `git worktree`, reported it, and fixed it in its own commit.
- [ ] **`npm run verify:all` passes** — lint, format, unit tests, date
      hermeticity, test baseline, suppression ceilings, hygiene, boot smoke,
      accessibility.
- [ ] **Tests cover the change.** Every bug fix lands with the test that would
      have caught it. Boundaries are pinned on and one past the edge.
- [ ] **Tests are hermetic.** No wall clock, no network, no shared mutable
      state, no order dependence.
- [ ] **No undeclared shortcuts.** No new `@ts-nocheck`, `@ts-ignore`,
      `eslint-disable`, `.skip`, `debugger`, or `TODO` — or, if genuinely
      unavoidable, it is declared, bounded and tracked in
      `quality-baseline.json` in this same PR.
- [ ] **No gate was weakened, skipped or deleted** to make this pass.
- [ ] **Honest status.** Anything unfinished is reported as partial with the
      gap named. No optimistic summaries.

**Project conventions:**

- [ ] `npm run lint` and `npm run format:check` pass
- [ ] `CHANGELOG.md` updated under `[Unreleased]` (if user-visible)
- [ ] New UI strings added to `src/i18n.js` in English and 简体中文
- [ ] Gameplay code uses delta time (no raw per-frame increments)
- [ ] No new runtime dependencies introduced (or justified below)
- [ ] Apple bar: I read the diff as if someone else wrote it, and I would ship
      this to a player

## Declared gaps introduced

<!--
List any declaredGaps entries added to quality-baseline.json, with their bound.
Write "none" if there are none. A gap without a bound is a bug being hidden.
-->

none

## Screenshots / clips

<!-- Drag files here. Before/after clips are very welcome for gameplay tweaks. -->

## Notes for reviewers

<!-- Anything that's non-obvious: trade-offs, follow-ups, known limitations. -->
