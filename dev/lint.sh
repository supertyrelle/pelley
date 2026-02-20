#!/usr/bin/env bash
# pelley linter
# Validates agent frontmatter, required sections, JSON configs, and command structure.
# Exit 0 if all checks pass, exit 1 if any fail.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"

# Colors (matches install.sh)
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m' # No Color

log()  { echo -e "${GREEN}[+]${NC} $1"; }
warn() { echo -e "${YELLOW}[!]${NC} $1"; }
info() { echo -e "${BLUE}[i]${NC} $1"; }
fail() { echo -e "${RED}[x]${NC} $1"; }

PASS=0
FAIL=0

check_pass() {
    log "PASS: $1"
    PASS=$((PASS + 1))
}

check_fail() {
    fail "FAIL: $1"
    FAIL=$((FAIL + 1))
}

echo ""
echo "pelley linter"
echo "======================"
echo ""

# =============================================================================
# 1. Agent frontmatter and required sections
# =============================================================================
info "Checking agents..."

for agent in "$REPO_ROOT"/agents/*.md; do
    [ -f "$agent" ] || continue
    name="$(basename "$agent")"

    # --- Check YAML frontmatter exists and has required fields ---
    # Frontmatter is between the first two '---' lines
    if ! head -1 "$agent" | grep -q '^---$'; then
        check_fail "$name: missing YAML frontmatter"
        continue
    fi

    # Extract frontmatter (between first and second ---)
    FRONTMATTER=$(sed -n '2,/^---$/p' "$agent" | sed '$d')

    if [ -z "$FRONTMATTER" ]; then
        check_fail "$name: empty YAML frontmatter"
        continue
    fi

    FM_OK=true
    for field in name description tools model; do
        if ! echo "$FRONTMATTER" | grep -qE "^${field}:"; then
            check_fail "$name: frontmatter missing required field '$field'"
            FM_OK=false
        fi
    done

    if [ "$FM_OK" = true ]; then
        check_pass "$name: frontmatter has all required fields"
    fi

    # --- Check required sections ---
    # Skip frontmatter (everything between first two --- lines), then search the body
    BODY=$(awk 'BEGIN{n=0} /^---$/{n++; next} n>=2{print}' "$agent")

    SECTIONS_OK=true
    for section in "Investigation Protocol" "Context Management" "Knowledge Transfer"; do
        if ! echo "$BODY" | grep -q "## ${section}"; then
            check_fail "$name: missing required section '${section}'"
            SECTIONS_OK=false
        fi
    done

    if [ "$SECTIONS_OK" = true ]; then
        check_pass "$name: has all required sections"
    fi
done

echo ""

# =============================================================================
# 2. OpenCode config validation
# =============================================================================
info "Checking opencode.json..."

OPENCODE_CONFIG="$REPO_ROOT/.opencode/opencode.json"
if [ -f "$OPENCODE_CONFIG" ]; then
    if python3 -c "import json; json.load(open('$OPENCODE_CONFIG'))" 2>/dev/null; then
        check_pass "opencode.json: valid JSON"
    else
        check_fail "opencode.json: invalid JSON"
    fi
else
    check_fail ".opencode/opencode.json: file not found"
fi

echo ""

# =============================================================================
# 3. Skills validation
# =============================================================================
info "Checking skills..."

for skill_dir in "$REPO_ROOT"/skills/*/; do
    [ -d "$skill_dir" ] || continue
    name="$(basename "$skill_dir")"
    skill_file="$skill_dir/SKILL.md"

    if [ ! -f "$skill_file" ]; then
        check_fail "skills/$name: missing SKILL.md"
        continue
    fi

    # Check non-empty
    if [ ! -s "$skill_file" ]; then
        check_fail "skills/$name: SKILL.md is empty"
        continue
    fi

    # Check YAML frontmatter exists
    if ! head -1 "$skill_file" | grep -q '^---$'; then
        check_fail "skills/$name: missing YAML frontmatter"
        continue
    fi

    # Extract frontmatter
    FRONTMATTER=$(sed -n '2,/^---$/p' "$skill_file" | sed '$d')

    if [ -z "$FRONTMATTER" ]; then
        check_fail "skills/$name: empty YAML frontmatter"
        continue
    fi

    # Check required frontmatter fields for skills
    SK_OK=true
    for field in name description; do
        if ! echo "$FRONTMATTER" | grep -qE "^${field}:"; then
            check_fail "skills/$name: frontmatter missing required field '$field'"
            SK_OK=false
        fi
    done

    if [ "$SK_OK" = true ]; then
        check_pass "skills/$name: valid skill with frontmatter"
    fi
done

echo ""

# =============================================================================
# Summary
# =============================================================================
echo "======================"
TOTAL=$((PASS + FAIL))
if [ "$FAIL" -eq 0 ]; then
    log "All checks passed: $PASS passed, 0 failed (out of $TOTAL)"
    exit 0
else
    fail "Checks completed: $PASS passed, $FAIL failed (out of $TOTAL)"
    exit 1
fi
