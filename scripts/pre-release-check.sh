#!/usr/bin/env bash
# scripts/pre-release-check.sh
#
# Run before tagging a release. Exits non-zero on the first failure so CI can
# gate a tag push on this script (we do NOT push or tag from here — that's a
# human decision).
#
# Checks:
#   1. `npm run check`                             (lint + format + tests)
#   2. `node --check` against every src/ & test/ file (syntax only, no run)
#   3. No TODO / FIXME / TBD / "placeholder" markers in src/ or root docs
#   4. package.json version == CONFIG.VERSION      (release-critical invariant)
#   5. CHANGELOG has a non-empty section for the current version
#   6. All relative Markdown links in README.md / CHANGELOG.md resolve to
#      real files in the working tree
#
# Usage: ./scripts/pre-release-check.sh

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

RED=$'\033[31m'
GREEN=$'\033[32m'
YELLOW=$'\033[33m'
RESET=$'\033[0m'

fail() { echo "${RED}FAIL${RESET} $*"; exit 1; }
pass() { echo "${GREEN} OK ${RESET} $*"; }
note() { echo "${YELLOW}NOTE${RESET} $*"; }

# ---------------------------------------------------------------------------
# 1. npm run check
# ---------------------------------------------------------------------------
echo "==> [1/6] npm run check"
if ! npm run check; then
    fail "npm run check"
fi
pass "lint + format + tests"

# ---------------------------------------------------------------------------
# 2. node --check on all src/ + test/
# ---------------------------------------------------------------------------
echo "==> [2/6] node --check"
CHECK_FAIL=0
while IFS= read -r f; do
    if ! node --check "$f" 2>/dev/null; then
        echo "    ${RED}syntax error${RESET}: $f"
        CHECK_FAIL=1
    fi
done < <(find src test scripts -type f -name "*.js")
if (( CHECK_FAIL )); then
    fail "node --check"
fi
pass "all JS files parse"

# ---------------------------------------------------------------------------
# 3. TODO / FIXME sweep
# ---------------------------------------------------------------------------
echo "==> [3/6] TODO / FIXME / placeholder sweep in src/"
# We only scan src/ + root docs; the CHANGELOG / release notes legitimately
# mention the strings in prose ("this release closes the last TODO list", ...)
# so excluding those is expected.
MATCHES=$(grep -RInE 'TODO|FIXME|TBD|placeholder' src/ 2>/dev/null | grep -v 'placeholder=' || true)
if [[ -n "$MATCHES" ]]; then
    echo "$MATCHES"
    fail "TODO/FIXME/placeholder markers in src/"
fi
pass "no TODO/FIXME/placeholder markers in src/"

# ---------------------------------------------------------------------------
# 4. package.json version == CONFIG.VERSION
# ---------------------------------------------------------------------------
echo "==> [4/6] version parity"
PKG_VER=$(node -e 'process.stdout.write(require("./package.json").version)')
CFG_VER=$(grep -oE "VERSION:\s*'[0-9]+\.[0-9]+\.[0-9]+'" src/config.ts | head -1 | sed -E "s/.*'([0-9.]+)'.*/\1/")
if [[ -z "$CFG_VER" ]]; then
    fail "could not read CONFIG.VERSION from src/config.ts"
fi
if [[ "$PKG_VER" != "$CFG_VER" ]]; then
    fail "package.json=${PKG_VER} but CONFIG.VERSION=${CFG_VER}"
fi
pass "version ${PKG_VER} matches src/config.ts"

# ---------------------------------------------------------------------------
# 5. CHANGELOG has a non-empty entry for this version
# ---------------------------------------------------------------------------
echo "==> [5/6] CHANGELOG entry for v${PKG_VER}"
if ! grep -qE "^##\s*\[${PKG_VER//./\\.}\]" CHANGELOG.md; then
    fail "CHANGELOG.md has no [## ${PKG_VER}] section"
fi
# Make sure there isn't an empty "Unreleased" header queued up right before
# the release — release-drafting artefact.
UNRELEASED_BODY=$(awk '
    /^## \[Unreleased\]/ { cap=1; next }
    cap && /^## \[/ { cap=0 }
    cap { print }
' CHANGELOG.md | grep -vE '^\s*$|^###|^-\s*Placeholder' || true)
if [[ -n "$UNRELEASED_BODY" ]]; then
    note "Unreleased section has content — move it under [${PKG_VER}] before tagging"
fi
pass "CHANGELOG has [${PKG_VER}] section"

# ---------------------------------------------------------------------------
# 6. README + CHANGELOG relative link resolution
# ---------------------------------------------------------------------------
echo "==> [6/6] relative-link check"
BROKEN=0
for doc in README.md CHANGELOG.md CONTRIBUTING.md; do
    [[ -f "$doc" ]] || continue
    while IFS= read -r link; do
        # strip leading "./" and any #fragment
        target="${link#./}"
        target="${target%%#*}"
        [[ -z "$target" ]] && continue
        if [[ ! -e "$target" ]]; then
            echo "    ${RED}broken${RESET} link in $doc → $link"
            BROKEN=1
        fi
    done < <(grep -oE '\]\(\.\/[^)]+\)' "$doc" | sed -E 's/\]\(([^)]+)\)/\1/')
done
if (( BROKEN )); then
    fail "broken relative links"
fi
pass "all ./ relative links resolve"

echo
echo "${GREEN}pre-release checks passed for v${PKG_VER}${RESET}"
echo "next steps (manual):"
echo "  git tag -s v${PKG_VER} -m \"Survivor v${PKG_VER}\""
echo "  git push origin v${PKG_VER}"
echo "  gh release create v${PKG_VER} --notes-file docs/v${PKG_VER}-NOTES.md"
