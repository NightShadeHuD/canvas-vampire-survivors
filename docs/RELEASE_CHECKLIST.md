# Release Checklist — v2.8 "Launch Ready"

Pre-flight gate before tagging `v2.8.0`, drafting GitHub Releases, and
announcing on Show HN / Reddit / Twitter. Each item is a single, verifiable
action; tick them in order. Anything red below means **stop, fix, repeat**.

The full sister-document set lives under `docs/`:

- `docs/RELEASE_v2.5.md` — last published release notes (template baseline)
- `docs/SHOW_HN_DRAFT.md` — copy/paste post for HN
- `docs/REDDIT_POST.md` / `docs/TWEET_DRAFTS.md` — long-form announcements
- `docs/REPO_SETTINGS.md` — GitHub repo-side knobs
- `docs/PRESS_KIT.md` — logos, screenshots, one-liner

---

## A. Source of truth (5)

1. [ ] `package.json` `version` bumped to `2.8.0` (no prerelease suffix).
2. [ ] `CHANGELOG.md` has a `## [2.8.0] - YYYY-MM-DD` section that names
       every visible behaviour change, links the relevant PR/commit, and
       moves "unreleased" entries above the line.
3. [ ] `README.md` "What's new" lists v2.8 first; older entries left intact.
4. [ ] `docs/v2.5.0-NOTES.md` (or new `v2.8.0-NOTES.md`) carries the long-form
       narrative, "Known non-issues", "What's next" sections updated.
5. [ ] `manifest.json` `name` / `short_name` / `theme_color` reviewed. The PWA
       cache version in `service-worker.js` is DERIVED from the release's own
       content — do not hand-edit it. `npm run check:sw-cache` refuses a name
       that does not match; run `npm run gen:sw-cache` and commit the result.

## B. Code health gates (6)

6. [ ] `npm run lint` — 0 errors, 0 warnings.
7. [ ] `npm run format:check` — clean (run `npm run format` if not).
8. [ ] `npm test` — every `node:test` case green; total count printed in the
       README badge matches reality (`grep -c "test(" test/*.test.js`).
9. [ ] `npm run smoke` — local headless run finishes with `0 console.error`,
       `0 pageerror`, `0 finding(s)`.
10. [ ] `npm run smoke:live` against the Pages URL — same triple zero. The
        documented `service-worker.js` 404 warning is allowed; an actual
        `console.error` is **not**.
11. [ ] `npm run smoke:extended` — multi-stage / pause-resume / replay path
        clean; the report writes to `docs/EXTENDED_SMOKE_REPORT.md`.

## C. Visual + copy QA (5)

12. [ ] All six screenshots under `docs/screenshots/real-*.png` re-captured
        on the v2.8 branch (the smoke harness regenerates them; commit any
        diffs).
13. [ ] `docs/hero.svg` and `docs/og-card.svg` reflect the new version
        string (or are intentionally evergreen).
14. [ ] `docs/FAQ.md`, `docs/USER_GUIDE.md`, `docs/CONTROLS.md`,
        `docs/ACCESSIBILITY.md` reviewed against the v2.8 build for stale
        keybindings, removed features, or broken anchor links.
15. [ ] README badges all resolve (CI green, top-language fresh,
        last-commit fresh, "tests: N+" matches `npm test`).
16. [ ] No emoji-only commits, no leaked secrets, no TODO/XXX/FIXME left in
        the diff (`git diff origin/main..HEAD | grep -E "TODO|FIXME|XXX"`).

## D. GitHub Pages + repo settings (5)

17. [ ] Pages source = "Deploy from a branch", branch `main`, folder `/` —
        `docs/REPO_SETTINGS.md` mirror is current.
18. [ ] Custom 404 not introduced; `service-worker.js` is at repo root and
        served as `application/javascript` (the live-smoke script verifies
        the MIME line).
19. [ ] `index.html` `<meta>` tags: `og:image` resolves, `og:url` matches
        the Pages URL, `theme-color` matches manifest.
20. [ ] Topics on the GitHub repo include `html5-canvas-game`, `vanilla-js`,
        `roguelite`, `vampire-survivors`, `zero-dependencies`,
        `pwa`, `open-source`.
21. [ ] Issue templates (`.github/ISSUE_TEMPLATE/`) reviewed; pinned
        "good first issue" set rotated — see
        `docs/GOOD_FIRST_ISSUES.md`.

## E. Release packaging (5)

22. [ ] `git tag -a v2.8.0 -m "v2.8.0 — launch ready"`, `git push --tags`.
23. [ ] `gh release create v2.8.0 --title "v2.8.0 — Launch ready"
--notes-file docs/v2.8.0-NOTES.md` (or paste the body from the
        notes file). Mark **not** prerelease.
24. [ ] Attach a zip of the prebuilt `dist/` (just `git archive`) so users
        without a Node toolchain can grab a runnable folder.
25. [ ] Past release notes audit: `gh release view v2.5.0` is still the
        latest published; v2.6 and v2.7 ship as CHANGELOG entries only,
        which matches the policy "only major polish releases get a GitHub
        Release". Verified during iter-18 — see "Cross-promo + cross-check"
        section of `docs/JOURNEY.md`. **No backfill needed.**
26. [ ] Create a "Star History" snapshot in `docs/screenshots/` so future
        retros can compare deltas.

## F. Announce (4)

27. [ ] Show HN post drafted in `docs/SHOW_HN_DRAFT.md`, title ≤ 80 chars,
        URL = Pages URL (not the repo). Submit at the Tuesday-Thursday
        13:00–15:00 UTC sweet spot. Pre-stage the first comment with the
        repo link, the 16-iter story, and the "16 KB JS, no deps" line.
28. [ ] Reddit `/r/incremental_games`, `/r/roguelites`, `/r/webdev`, `/r/javascript`
        (read each subreddit's self-promo rules; some require X:1 ratio).
        Reuse `docs/REDDIT_POST.md`.
29. [ ] Tweet thread from `docs/TWEET_DRAFTS.md`; first tweet has a 15-second
        gameplay GIF (the script in `docs/gif-script.md` produces a
        ≤ 5 MB clip), reply tweets link the repo + the Pages URL + the
        feature grid.
30. [ ] Cross-link the **sister projects** (`openhand`,
        `terminal-quest-cli`) in the announce thread and on each repo's
        README sister-projects block. See `docs/CROSSPROMO.md`.

---

## Rollback plan

If post-launch the live URL throws, hotfix on a `hotfix/v2.8.x` branch,
re-run sections **B** + **C**, fast-forward `main`, retag. Pages auto-deploys
within ~60 s. The service worker's cache name is derived from the release's
own content, so a hotfix reaches returning players on their next load instead
of sitting behind the old cache — and a rollback reaches them the same way,
which is the point. It is not "invisible during the deploy window"; it is
delivered.

If the bug is data-shaped (corrupt save, runaway leaderboard), bump
`CONFIG.SAVE_SCHEMA_VERSION` so the loader migrates instead of crashes.
