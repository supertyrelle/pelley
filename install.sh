#!/usr/bin/env bash
# pelley installer
# Creates symlinks from platform config directories to this repo's files.
# Supports Claude Code (~/.claude/), OpenCode (~/.config/opencode/), and Kimi Code (~/.kimi/).
# Re-running is idempotent — existing symlinks are refreshed, regular files are backed up.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log()  { echo -e "${GREEN}[+]${NC} $1"; }
warn() { echo -e "${YELLOW}[!]${NC} $1"; }
info() { echo -e "${BLUE}[i]${NC} $1"; }

# --- Argument parsing ---
PROJECT_DIR=""
USE_HARDLINKS=false
BUILD_GIT_INTEL=false
TARGET_PLATFORM="all"

show_help() {
    cat << EOF
Usage: ./install.sh [project_dir] [--target=<platform>] [--hardlink] [--with-git-intel] [--help]

Options:
  project_dir              Install to project_dir instead of global config dirs
  --target=<platform>      Target platform: claude, opencode, kimi, or all (default: all)
  --hardlink               Use hardlinks instead of symlinks
  --with-git-intel         Build optional git-intel Rust CLI (requires cargo)
  --help, -h               Show this help message

Platforms:
  claude     Claude Code   (~/.claude/)          — settings, skills, rules, MCP servers
  opencode   OpenCode      (~/.config/opencode/) — config, agents, skills, plugins, tools, rules
  kimi       Kimi Code     (~/.kimi/)            — agents, skills, MCP servers

When --target=all (default), auto-detects installed platforms via command presence.
If none detected, falls back to opencode for backward compatibility.

Global install (no project_dir):
  Installs agents, skills, config, rules, templates, bin, MCP (varies by platform).

Project-local install (with project_dir):
  Installs agents, skills, config only (varies by platform).
EOF
    exit 0
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --help|-h)
            show_help
            ;;
        --hardlink)
            USE_HARDLINKS=true
            shift
            ;;
        --with-git-intel)
            BUILD_GIT_INTEL=true
            shift
            ;;
        --target=*)
            TARGET_PLATFORM="${1#--target=}"
            case "$TARGET_PLATFORM" in
                claude|opencode|kimi|all) ;;
                *)
                    echo "Error: Unknown target platform '$TARGET_PLATFORM'. Must be: claude, opencode, kimi, or all"
                    exit 1
                    ;;
            esac
            shift
            ;;
        -*)
            echo "Unknown option: $1"
            show_help
            ;;
        *)
            # Positional argument: project_dir
            if [ -z "$PROJECT_DIR" ]; then
                PROJECT_DIR="$1"
            else
                echo "Error: Multiple positional arguments provided"
                show_help
            fi
            shift
            ;;
    esac
done

# Validate project dir if provided
if [ -n "$PROJECT_DIR" ]; then
    if [ ! -d "$PROJECT_DIR" ]; then
        echo "Error: PROJECT_DIR '$PROJECT_DIR' does not exist or is not a directory"
        exit 1
    fi
fi

# --- Platform detection ---
PLATFORMS=()

if [ "$TARGET_PLATFORM" = "all" ]; then
    command -v claude &>/dev/null && PLATFORMS+=("claude")
    command -v opencode &>/dev/null && PLATFORMS+=("opencode")
    command -v kimi &>/dev/null && PLATFORMS+=("kimi")
    # Fallback: if nothing detected, default to opencode for backward compat
    if [ ${#PLATFORMS[@]} -eq 0 ]; then
        warn "No platform commands detected (claude, opencode, kimi). Defaulting to opencode."
        PLATFORMS=("opencode")
    fi
else
    PLATFORMS=("$TARGET_PLATFORM")
fi

# Per-platform install tracking (accumulated by link_file/link_dir via INSTALLED_FILES)
INSTALLED_FILES=()
INSTALLED_COUNT_OPENCODE=0
INSTALLED_COUNT_CLAUDE=0
INSTALLED_COUNT_KIMI=0

# --- Helpers ---

ensure_dir() {
    # mkdir -p silently no-ops on broken symlinks (the path "exists" as a dangling link),
    # then fails when creating children. Fix: remove broken symlinks first.
    local dir="$1"
    if [ -L "$dir" ] && [ ! -d "$dir" ]; then
        warn "Removing broken symlink: $dir"
        rm "$dir"
    fi
    mkdir -p "$dir"
}

check_hardlink_compat() {
    local target_dir="$1"
    local target_parent
    target_parent="$(dirname "$target_dir")"
    mkdir -p "$target_parent"

    local src_dev dst_dev
    if [ "$(uname)" = "Darwin" ]; then
        src_dev=$(stat -f %d "$SCRIPT_DIR" 2>/dev/null)
        dst_dev=$(stat -f %d "$target_parent" 2>/dev/null)
    else
        src_dev=$(stat -c %d "$SCRIPT_DIR" 2>/dev/null)
        dst_dev=$(stat -c %d "$target_parent" 2>/dev/null)
    fi

    if [ "$src_dev" != "$dst_dev" ]; then
        echo "Error: Cannot use hardlinks across filesystems. Source ($SCRIPT_DIR) and target ($target_dir) are on different devices."
        exit 1
    fi
}

link_file() {
    local src="$1"
    local dst="$2"

    # Create parent directory if needed
    ensure_dir "$(dirname "$dst")"

    if [ "$USE_HARDLINKS" = true ]; then
        # Hardlink mode
        if [ -e "$dst" ]; then
            local src_inode dst_inode
            if [ "$(uname)" = "Darwin" ]; then
                src_inode=$(stat -f %i "$src" 2>/dev/null)
                dst_inode=$(stat -f %i "$dst" 2>/dev/null)
            else
                src_inode=$(stat -c %i "$src" 2>/dev/null)
                dst_inode=$(stat -c %i "$dst" 2>/dev/null)
            fi

            if [ "$src_inode" = "$dst_inode" ]; then
                log "Already linked: $dst"
                INSTALLED_FILES+=("$dst")
                return
            else
                local backup="${dst}.bak.$(date +%Y%m%d%H%M%S)"
                mv "$dst" "$backup"
                warn "Backed up existing file: $dst -> $backup"
                ln "$src" "$dst"
                log "Hardlinked: $dst -> $src"
                INSTALLED_FILES+=("$dst")
            fi
        else
            ln "$src" "$dst"
            log "Hardlinked: $dst -> $src"
            INSTALLED_FILES+=("$dst")
        fi
    else
        # Symlink mode
        if [ -L "$dst" ]; then
            rm "$dst"
            ln -s "$src" "$dst"
            log "Updated: $dst -> $src"
            INSTALLED_FILES+=("$dst")
        elif [ -e "$dst" ]; then
            local backup="${dst}.bak.$(date +%Y%m%d%H%M%S)"
            mv "$dst" "$backup"
            warn "Backed up existing file: $dst -> $backup"
            ln -s "$src" "$dst"
            log "Linked: $dst -> $src"
            INSTALLED_FILES+=("$dst")
        else
            ln -s "$src" "$dst"
            log "Linked: $dst -> $src"
            INSTALLED_FILES+=("$dst")
        fi
    fi
}

link_dir() {
    local src="$1"
    local dst="$2"

    if [ "$USE_HARDLINKS" = true ]; then
        ensure_dir "$dst"
        local file_count=0
        for file in "$src"/*; do
            [ -f "$file" ] || continue
            local name
            name="$(basename "$file")"
            link_file "$file" "$dst/$name"
            file_count=$((file_count + 1))
        done
        if [ "$file_count" -gt 0 ]; then
            log "Hardlinked directory: $dst ($file_count files)"
            INSTALLED_FILES+=("$dst")
        fi
    else
        link_file "$src" "$dst"
    fi
}

cleanup_stale() {
    local manifest_file="$1"
    local target_dir="$2"
    local stale_count=0

    if [ -f "$manifest_file" ]; then
        while IFS= read -r entry; do
            [[ "$entry" =~ ^# ]] && continue
            [ -z "$entry" ] && continue
            if [ -L "$entry" ]; then
                local target
                target="$(readlink "$entry")"
                if [ ! -e "$target" ]; then
                    rm "$entry"
                    warn "Removed stale link: $entry -> $target"
                    stale_count=$((stale_count + 1))
                fi
            fi
        done < "$manifest_file"
    else
        # Legacy fallback: symlink-based detection (no manifest from prior install)
        for dir in "$target_dir/agents" "$target_dir/skills" "$target_dir/rules" "$target_dir/plugins" "$target_dir/tools"; do
            [ -d "$dir" ] || continue
            for link in "$dir"/*; do
                [ -L "$link" ] || continue
                local target
                target="$(readlink "$link")"
                case "$target" in
                    "$SCRIPT_DIR"/*) ;;
                    *) continue ;;
                esac
                if [ ! -e "$target" ]; then
                    rm "$link"
                    warn "Removed stale symlink: $link -> $target"
                    stale_count=$((stale_count + 1))
                fi
            done
        done
    fi

    if [ "$stale_count" -gt 0 ]; then
        log "Cleaned up $stale_count stale installation(s)"
    else
        log "No stale installations found"
    fi
}

write_manifest() {
    local manifest_file="$1"
    local target_dir="$2"

    if [ ${#INSTALLED_FILES[@]} -eq 0 ]; then
        return
    fi

    info "Writing installation manifest..."
    local link_mode="symlink"
    [ "$USE_HARDLINKS" = true ] && link_mode="hardlink"
    {
        echo "# pelley manifest - installed files"
        echo "# mode=$link_mode target=$target_dir date=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
        echo ""
        printf '%s\n' "${INSTALLED_FILES[@]}" | sort -u
    } > "$manifest_file"
    log "Manifest written: $manifest_file ($(wc -l < "$manifest_file") entries)"
}

# ============================================================================
# Platform install functions
# ============================================================================

install_opencode() {
    local target_dir
    if [ -n "$PROJECT_DIR" ]; then
        target_dir="$PROJECT_DIR/.opencode"
    else
        target_dir="$HOME/.config/opencode"
    fi
    local manifest_file="$target_dir/.pelley.manifest"

    echo ""
    info "=== OpenCode ==="
    info "Target: $target_dir"

    [ "$USE_HARDLINKS" = true ] && check_hardlink_compat "$target_dir"

    INSTALLED_FILES=()

    # Ensure target directories
    ensure_dir "$target_dir/agents"
    ensure_dir "$target_dir/skills"
    ensure_dir "$target_dir/plugins"
    ensure_dir "$target_dir/tools"
    if [ -z "$PROJECT_DIR" ]; then
        [ -d "$SCRIPT_DIR/rules" ] && ensure_dir "$target_dir/rules"
        [ -d "$SCRIPT_DIR/templates" ] && ensure_dir "$target_dir/templates"
    fi

    # Stale cleanup
    info "Checking for stale installations..."
    cleanup_stale "$manifest_file" "$target_dir"

    # Config (.opencode/opencode.json — the distributable one, NOT root opencode.json)
    local opencode_json="$SCRIPT_DIR/.opencode/opencode.json"
    if [ -f "$opencode_json" ]; then
        info "Installing opencode.json..."
        link_file "$opencode_json" "$target_dir/opencode.json"
    fi

    # Agents
    info "Installing agents..."
    for agent in "$SCRIPT_DIR"/agents/*.md; do
        [ -f "$agent" ] || continue
        link_file "$agent" "$target_dir/agents/$(basename "$agent")"
    done

    # Skills
    info "Installing skills..."
    for skill_dir in "$SCRIPT_DIR"/skills/*/; do
        [ -d "$skill_dir" ] || continue
        link_dir "$skill_dir" "$target_dir/skills/$(basename "$skill_dir")"
    done

    # Plugins
    if [ -d "$SCRIPT_DIR/.opencode/plugins" ]; then
        info "Installing plugins..."
        for plugin in "$SCRIPT_DIR"/.opencode/plugins/*.ts; do
            [ -f "$plugin" ] || continue
            link_file "$plugin" "$target_dir/plugins/$(basename "$plugin")"
        done
    fi

    # Tools
    if [ -d "$SCRIPT_DIR/.opencode/tools" ]; then
        info "Installing tools..."
        for tool in "$SCRIPT_DIR"/.opencode/tools/*.ts; do
            [ -f "$tool" ] || continue
            link_file "$tool" "$target_dir/tools/$(basename "$tool")"
        done
    fi

    # Global-only assets
    if [ -z "$PROJECT_DIR" ]; then
        [ -d "$SCRIPT_DIR/rules" ] && { info "Installing rules..."; link_dir "$SCRIPT_DIR/rules" "$target_dir/rules"; }
        [ -d "$SCRIPT_DIR/templates" ] && { info "Installing templates..."; link_dir "$SCRIPT_DIR/templates" "$target_dir/templates"; }
        if [ -d "$SCRIPT_DIR/bin" ]; then
            info "Installing bin scripts..."
            ensure_dir "$target_dir/bin"
            for script in "$SCRIPT_DIR"/bin/*.sh; do
                [ -f "$script" ] || continue
                link_file "$script" "$target_dir/bin/$(basename "$script")"
            done
        fi
    else
        info "Skipping rules, templates, bin (project-local mode)"
    fi

    # Package dependencies
    local package_json="$SCRIPT_DIR/.opencode/package.json"
    if [ -f "$package_json" ]; then
        info "Installing package.json..."
        link_file "$package_json" "$target_dir/package.json"
        if command -v npm &>/dev/null; then
            info "Running npm install in $target_dir..."
            (cd "$target_dir" && npm install --production 2>&1) && \
                log "npm dependencies installed" || \
                warn "npm install failed — plugins may not resolve imports"
        else
            warn "npm not found — run 'npm install' manually in $target_dir"
        fi
    fi

    write_manifest "$manifest_file" "$target_dir"
    INSTALLED_COUNT_OPENCODE=${#INSTALLED_FILES[@]}
}

install_claude() {
    local target_dir
    if [ -n "$PROJECT_DIR" ]; then
        target_dir="$PROJECT_DIR/.claude"
    else
        target_dir="$HOME/.claude"
    fi
    local manifest_file="$target_dir/.pelley.manifest"

    echo ""
    info "=== Claude Code ==="
    info "Target: $target_dir"

    [ "$USE_HARDLINKS" = true ] && check_hardlink_compat "$target_dir"

    INSTALLED_FILES=()

    ensure_dir "$target_dir"
    if [ -z "$PROJECT_DIR" ]; then
        [ -d "$SCRIPT_DIR/rules" ] && ensure_dir "$target_dir/rules"
    fi

    # Stale cleanup
    info "Checking for stale installations..."
    cleanup_stale "$manifest_file" "$target_dir"

    # Settings (settings.json from repo root)
    if [ -f "$SCRIPT_DIR/settings.json" ]; then
        info "Installing settings.json..."
        link_file "$SCRIPT_DIR/settings.json" "$target_dir/settings.json"
    fi

    # Skills (Claude reads SKILL.md natively)
    if [ -d "$SCRIPT_DIR/skills" ]; then
        info "Installing skills..."
        ensure_dir "$target_dir/skills"
        for skill_dir in "$SCRIPT_DIR"/skills/*/; do
            [ -d "$skill_dir" ] || continue
            link_dir "$skill_dir" "$target_dir/skills/$(basename "$skill_dir")"
        done
    fi

    # Global-only assets
    if [ -z "$PROJECT_DIR" ]; then
        [ -d "$SCRIPT_DIR/rules" ] && { info "Installing rules..."; link_dir "$SCRIPT_DIR/rules" "$target_dir/rules"; }
        if [ -d "$SCRIPT_DIR/bin" ]; then
            info "Installing bin scripts..."
            ensure_dir "$target_dir/bin"
            for script in "$SCRIPT_DIR"/bin/*.sh; do
                [ -f "$script" ] || continue
                link_file "$script" "$target_dir/bin/$(basename "$script")"
            done
        fi
        [ -d "$SCRIPT_DIR/templates" ] && { info "Installing templates..."; link_dir "$SCRIPT_DIR/templates" "$target_dir/templates"; }
    else
        info "Skipping rules, templates, bin (project-local mode)"
    fi

    # MCP servers (only for global install, only if claude command exists)
    if [ -z "$PROJECT_DIR" ] && command -v claude &>/dev/null; then
        local mcp_json="$SCRIPT_DIR/mcp-servers.json"
        if [ -f "$mcp_json" ]; then
            info "Installing MCP servers via claude CLI..."
            python3 -c "
import json, subprocess, sys

with open(sys.argv[1]) as f:
    servers = json.load(f)

for name, config in servers.items():
    full_json = json.dumps(config)
    cmd = ['claude', 'mcp', 'add-json', name, full_json, '--scope', 'user']
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
        if result.returncode == 0:
            print(f'  registered: {name}')
        else:
            stderr = result.stderr.strip()
            if 'already exists' in stderr.lower():
                print(f'  exists: {name}')
            else:
                print(f'  warning: {name} -- {stderr}', file=sys.stderr)
    except Exception as e:
        print(f'  error: {name} -- {e}', file=sys.stderr)
" "$mcp_json" 2>&1 && log "MCP servers registered" || warn "Some MCP servers may not have registered"
        fi
    elif [ -z "$PROJECT_DIR" ]; then
        info "Skipping MCP registration (claude command not found)"
    fi

    # Claude Code agents are project-local (.claude/agents/), not global
    if [ -z "$PROJECT_DIR" ]; then
        info "Skipping agents (Claude Code uses project-local .claude/agents/)"
    fi

    write_manifest "$manifest_file" "$target_dir"
    INSTALLED_COUNT_CLAUDE=${#INSTALLED_FILES[@]}
}

install_kimi() {
    local target_dir
    if [ -n "$PROJECT_DIR" ]; then
        target_dir="$PROJECT_DIR/.kimi"
    else
        target_dir="$HOME/.kimi"
    fi
    local manifest_file="$target_dir/.pelley.manifest"

    echo ""
    info "=== Kimi Code ==="
    info "Target: $target_dir"

    [ "$USE_HARDLINKS" = true ] && check_hardlink_compat "$target_dir"

    INSTALLED_FILES=()

    ensure_dir "$target_dir/agents"
    ensure_dir "$target_dir/skills"

    # Stale cleanup
    info "Checking for stale installations..."
    cleanup_stale "$manifest_file" "$target_dir"

    # Config.toml: always lives at ~/.kimi/ (Kimi reads global config only).
    # For project-local installs, we still configure the global config.
    local global_kimi_dir="$HOME/.kimi"
    local config_file="$global_kimi_dir/config.toml"
    local config_template="$SCRIPT_DIR/templates/kimi/config.toml"

    if [ -f "$config_template" ]; then
        if [ ! -f "$config_file" ]; then
            # No config exists -- install template
            ensure_dir "$global_kimi_dir"
            cp "$config_template" "$config_file"
            log "Installed config.toml to $config_file"
        elif grep -q '^default_model = ""' "$config_file" 2>/dev/null; then
            # Blank/default config (Kimi created it with empty model) -- replace with ours
            local backup="${config_file}.bak.$(date +%Y%m%d%H%M%S)"
            cp "$config_file" "$backup"
            cp "$config_template" "$config_file"
            log "Replaced blank config.toml (backup: $backup)"
        elif ! grep -q 'llama-local' "$config_file" 2>/dev/null; then
            # Config exists with a real model but no local provider -- offer to merge
            info "Existing config.toml has models configured but no local provider."
            info "To add the local Qwen model, see: $config_template"
        else
            info "Preserving existing config.toml (already has local provider)"
        fi
    fi

    # Agents (Kimi reads .md agents directly)
    info "Installing agents..."
    for agent in "$SCRIPT_DIR"/agents/*.md; do
        [ -f "$agent" ] || continue
        link_file "$agent" "$target_dir/agents/$(basename "$agent")"
    done

    # Skills
    info "Installing skills..."
    for skill_dir in "$SCRIPT_DIR"/skills/*/; do
        [ -d "$skill_dir" ] || continue
        link_dir "$skill_dir" "$target_dir/skills/$(basename "$skill_dir")"
    done

    # Global-only assets
    if [ -z "$PROJECT_DIR" ]; then
        if [ -d "$SCRIPT_DIR/rules" ]; then
            info "Installing rules..."
            ensure_dir "$target_dir/rules"
            link_dir "$SCRIPT_DIR/rules" "$target_dir/rules"
        fi
    else
        info "Skipping rules (project-local mode)"
    fi

    # MCP servers (generate mcp.json from mcp-servers.json)
    # Always generate to global ~/.kimi/mcp.json; also to project dir if project-local
    local mcp_json="$SCRIPT_DIR/mcp-servers.json"
    if [ -f "$mcp_json" ]; then
        local mcp_targets=("$global_kimi_dir/mcp.json")
        [ -n "$PROJECT_DIR" ] && mcp_targets+=("$target_dir/mcp.json")

        for mcp_target in "${mcp_targets[@]}"; do
            info "Generating mcp.json -> $mcp_target"
            python3 -c "
import json, sys

with open(sys.argv[1]) as f:
    servers = json.load(f)

kimi_servers = {}
for name, config in servers.items():
    entry = {}
    if 'command' in config:
        entry['command'] = config['command']
    if 'args' in config:
        entry['args'] = config['args']
    kimi_servers[name] = entry

with open(sys.argv[2], 'w') as f:
    json.dump({'mcpServers': kimi_servers}, f, indent=2)
    f.write('\n')

print(f'  wrote: {sys.argv[2]}')
" "$mcp_json" "$mcp_target" 2>&1 && log "Kimi MCP config generated" || warn "Failed to generate Kimi MCP config"
            INSTALLED_FILES+=("$mcp_target")
        done
    fi

    write_manifest "$manifest_file" "$target_dir"
    INSTALLED_COUNT_KIMI=${#INSTALLED_FILES[@]}
}

# ============================================================================
# Main
# ============================================================================

echo ""
echo "pelley installer"
echo "============="
echo "Source:     $SCRIPT_DIR"
echo "Platforms:  ${PLATFORMS[*]}"
if [ "$USE_HARDLINKS" = true ]; then
    echo "Mode:       hardlink"
else
    echo "Mode:       symlink"
fi
if [ -n "$PROJECT_DIR" ]; then
    echo "Scope:      project-local ($PROJECT_DIR)"
else
    echo "Scope:      global"
fi

# --- Dependency checks ---
echo ""
if ! command -v git &>/dev/null; then
    warn "REQUIRED: git is not installed. Cannot proceed."
    exit 1
fi

if ! command -v python3 &>/dev/null; then
    warn "RECOMMENDED: python3 not found. MCP server installation requires it."
fi

if ! command -v dolt &>/dev/null; then
    info "Installing dolt (database backend for beads)..."
    if command -v brew &>/dev/null; then
        brew install dolt 2>&1 && log "dolt installed via Homebrew" || warn "dolt install failed"
    else
        warn "dolt not found and Homebrew not available. Install dolt manually: https://docs.dolthub.com/introduction/installation"
    fi
fi

if ! command -v bd &>/dev/null; then
    info "Installing bd (beads issue tracker)..."
    if curl -sSL https://raw.githubusercontent.com/steveyegge/beads/main/scripts/install.sh | bash 2>&1; then
        log "bd installed"
        # Ensure bd is on PATH for the rest of this script
        export PATH="$HOME/.local/bin:$PATH"
    else
        warn "bd install failed. Session hooks will degrade gracefully."
    fi
fi

# --- Run platform installs ---
for platform in "${PLATFORMS[@]}"; do
    case "$platform" in
        opencode)  install_opencode ;;
        claude)    install_claude ;;
        kimi)      install_kimi ;;
    esac
done

# --- git-intel Rust CLI (optional, opt-in) ---
if [ "$BUILD_GIT_INTEL" = true ]; then
    echo ""
    GIT_INTEL_DIR="$SCRIPT_DIR/tools/git-intel"
    if [ -d "$GIT_INTEL_DIR" ] && [ -f "$GIT_INTEL_DIR/Cargo.toml" ]; then
        if command -v cargo &>/dev/null; then
            info "Building git-intel in $GIT_INTEL_DIR..."
            if (cd "$GIT_INTEL_DIR" && cargo build --release 2>&1); then
                log "git-intel built successfully"
                info "Binary available at: $GIT_INTEL_DIR/target/release/git-intel"
            else
                warn "git-intel build failed (see output above)"
                warn "Skills using git-intel will fall back gracefully"
            fi
        else
            warn "git-intel requires cargo (https://rustup.rs)"
            exit 1
        fi
    else
        warn "git-intel source not found at $GIT_INTEL_DIR"
    fi
fi

# --- Summary ---
echo ""
log "Installation complete!"
echo ""
info "What was installed:"
echo ""

for platform in "${PLATFORMS[@]}"; do
    case "$platform" in
        opencode)
            local_target="$HOME/.config/opencode"
            [ -n "$PROJECT_DIR" ] && local_target="$PROJECT_DIR/.opencode"
            info "OpenCode ($INSTALLED_COUNT_OPENCODE files -> $local_target):"
            echo "  Config:     opencode.json"
            echo "  Agents:     $(ls -1 "$SCRIPT_DIR"/agents/*.md 2>/dev/null | wc -l | tr -d ' ') agent definitions"
            echo "  Skills:     $(ls -d "$SCRIPT_DIR"/skills/*/ 2>/dev/null | wc -l | tr -d ' ') skills"
            echo "  Plugins:    $(ls -1 "$SCRIPT_DIR"/.opencode/plugins/*.ts 2>/dev/null | wc -l | tr -d ' ') plugin(s)"
            echo "  Tools:      $(ls -1 "$SCRIPT_DIR"/.opencode/tools/*.ts 2>/dev/null | wc -l | tr -d ' ') custom tool(s)"
            if [ -z "$PROJECT_DIR" ]; then
                [ -d "$SCRIPT_DIR/rules" ] && echo "  Rules:      $(ls -1 "$SCRIPT_DIR"/rules/*.md 2>/dev/null | wc -l | tr -d ' ') global rules"
                [ -d "$SCRIPT_DIR/templates" ] && echo "  Templates:  $(find "$SCRIPT_DIR/templates" -type f -name "*.yaml" 2>/dev/null | wc -l | tr -d ' ') team templates"
                [ -d "$SCRIPT_DIR/bin" ] && echo "  Bin:        $(ls -1 "$SCRIPT_DIR"/bin/*.sh 2>/dev/null | wc -l | tr -d ' ') scripts"
            fi
            echo "  Deps:       package.json + node_modules"
            echo "  MCP:        configured via opencode.json"
            ;;
        claude)
            local_target="$HOME/.claude"
            [ -n "$PROJECT_DIR" ] && local_target="$PROJECT_DIR/.claude"
            info "Claude Code ($INSTALLED_COUNT_CLAUDE files -> $local_target):"
            echo "  Settings:   settings.json (hooks, permissions, env)"
            echo "  Skills:     $(ls -d "$SCRIPT_DIR"/skills/*/ 2>/dev/null | wc -l | tr -d ' ') skills"
            if [ -z "$PROJECT_DIR" ]; then
                [ -d "$SCRIPT_DIR/rules" ] && echo "  Rules:      $(ls -1 "$SCRIPT_DIR"/rules/*.md 2>/dev/null | wc -l | tr -d ' ') global rules"
                [ -d "$SCRIPT_DIR/bin" ] && echo "  Bin:        $(ls -1 "$SCRIPT_DIR"/bin/*.sh 2>/dev/null | wc -l | tr -d ' ') scripts"
                [ -d "$SCRIPT_DIR/templates" ] && echo "  Templates:  $(find "$SCRIPT_DIR/templates" -type f -name "*.yaml" 2>/dev/null | wc -l | tr -d ' ') team templates"
                echo "  MCP:        registered via claude CLI"
            fi
            echo "  Agents:     project-local only (use .claude/agents/)"
            ;;
        kimi)
            local_target="$HOME/.kimi"
            [ -n "$PROJECT_DIR" ] && local_target="$PROJECT_DIR/.kimi"
            info "Kimi Code ($INSTALLED_COUNT_KIMI files -> $local_target):"
            echo "  Agents:     $(ls -1 "$SCRIPT_DIR"/agents/*.md 2>/dev/null | wc -l | tr -d ' ') agent definitions"
            echo "  Skills:     $(ls -d "$SCRIPT_DIR"/skills/*/ 2>/dev/null | wc -l | tr -d ' ') skills"
            if [ -z "$PROJECT_DIR" ]; then
                [ -d "$SCRIPT_DIR/rules" ] && echo "  Rules:      $(ls -1 "$SCRIPT_DIR"/rules/*.md 2>/dev/null | wc -l | tr -d ' ') global rules"
            fi
            echo "  MCP:        mcp.json (generated from mcp-servers.json)"
            ;;
    esac
    echo ""
done

info "To verify:"
for platform in "${PLATFORMS[@]}"; do
    case "$platform" in
        opencode)
            local_target="$HOME/.config/opencode"
            [ -n "$PROJECT_DIR" ] && local_target="$PROJECT_DIR/.opencode"
            echo "  ls -la $local_target/opencode.json"
            echo "  ls -la $local_target/agents/"
            echo "  ls -la $local_target/skills/"
            ;;
        claude)
            local_target="$HOME/.claude"
            [ -n "$PROJECT_DIR" ] && local_target="$PROJECT_DIR/.claude"
            echo "  ls -la $local_target/settings.json"
            echo "  ls -la $local_target/skills/"
            ;;
        kimi)
            local_target="$HOME/.kimi"
            [ -n "$PROJECT_DIR" ] && local_target="$PROJECT_DIR/.kimi"
            echo "  ls -la $local_target/agents/"
            echo "  ls -la $local_target/skills/"
            echo "  ls -la $local_target/mcp.json"
            ;;
    esac
done

echo ""
info "To uninstall a platform:"
for platform in "${PLATFORMS[@]}"; do
    case "$platform" in
        opencode)
            local_target="$HOME/.config/opencode"
            [ -n "$PROJECT_DIR" ] && local_target="$PROJECT_DIR/.opencode"
            echo "  opencode:  xargs rm -f < $local_target/.pelley.manifest && rm $local_target/.pelley.manifest"
            ;;
        claude)
            local_target="$HOME/.claude"
            [ -n "$PROJECT_DIR" ] && local_target="$PROJECT_DIR/.claude"
            echo "  claude:    xargs rm -f < $local_target/.pelley.manifest && rm $local_target/.pelley.manifest"
            ;;
        kimi)
            local_target="$HOME/.kimi"
            [ -n "$PROJECT_DIR" ] && local_target="$PROJECT_DIR/.kimi"
            echo "  kimi:      xargs rm -f < $local_target/.pelley.manifest && rm $local_target/.pelley.manifest"
            ;;
    esac
done
echo ""
