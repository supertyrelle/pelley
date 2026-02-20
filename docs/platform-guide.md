# Platform Guide

> Reference for using pelley across Claude Code, OpenCode, and Kimi Code.

Pelley is a universal agentic coding harness. It maintains a single set of skills, agents, rules, and workflows that install to any supported platform. This guide documents what is identical, what is adapted, and what is unavailable on each platform.

---

## Feature Matrix

| Feature | Claude Code | OpenCode | Kimi Code |
|---------|------------|----------|-----------|
| Skills (SKILL.md) | Native | Native | Native |
| Agents (.md) | `.claude/agents/` (project-local) | `~/.config/opencode/agents/` (global) | `~/.kimi/agents/` (global) |
| Rules (.md) | `~/.claude/rules/` | `~/.config/opencode/rules/` | `~/.kimi/rules/` |
| MCP servers | `claude mcp add` (CLI) | `opencode.json` mcp section | `~/.kimi/mcp.json` |
| Hooks | `settings.json` | TypeScript plugins | `config.toml` (limited) |
| Fork mechanism | Task tool | SDK sessions | Task tool |
| Custom tools | MCP only | `.opencode/tools/*.ts` | MCP only |
| Plugins | Not native | `.opencode/plugins/*.ts` | Not native |
| Project instructions | `CLAUDE.md` | `.opencode/opencode.md` | `AGENTS.md` |
| Config format | JSON (`settings.json`) | JSON (`opencode.json`) | TOML (`config.toml`) |

---

## Config Paths

### Global install

| Item | Claude Code | OpenCode | Kimi Code |
|------|------------|----------|-----------|
| Global config dir | `~/.claude/` | `~/.config/opencode/` | `~/.kimi/` |
| Settings file | `~/.claude/settings.json` | `opencode.json` (project root) | `~/.kimi/config.toml` |
| MCP runtime | `~/.claude.json` | `opencode.json` mcp section | `~/.kimi/mcp.json` |
| Skills | `~/.claude/skills/` | `~/.config/opencode/skills/` | `~/.kimi/skills/` |
| Agents | (project-local only) | `~/.config/opencode/agents/` | `~/.kimi/agents/` |
| Rules | `~/.claude/rules/` | `~/.config/opencode/rules/` | `~/.kimi/rules/` |
| Templates | `~/.claude/templates/` | `~/.config/opencode/templates/` | (not installed) |
| Manifest | `~/.claude/.pelley.manifest` | `~/.config/opencode/.pelley.manifest` | `~/.kimi/.pelley.manifest` |

### Project-local install

| Item | Claude Code | OpenCode | Kimi Code |
|------|------------|----------|-----------|
| Project config dir | `.claude/` | `.opencode/` | `.kimi/` |
| Instructions file | `CLAUDE.md` | `.opencode/opencode.md` | `AGENTS.md` |
| Manifest | `.claude/.pelley.manifest` | `.opencode/.pelley.manifest` | `.kimi/.pelley.manifest` |

**Key difference**: Claude Code agents are always project-local (`.claude/agents/`). OpenCode and Kimi install agents globally. This means Claude Code agents are per-project while OpenCode/Kimi agents are shared across all projects.

---

## Skills

Skills are pelley's core portability win. **SKILL.md files are 100% portable across all three platforms.** Same file, zero changes.

Each platform discovers skills from its own skills directory:
- Claude Code: `~/.claude/skills/<name>/SKILL.md`
- OpenCode: `~/.config/opencode/skills/<name>/SKILL.md`
- Kimi Code: `~/.kimi/skills/<name>/SKILL.md`

The installer symlinks (or hardlinks) the same source files to all targets. Skill frontmatter is identical across platforms:

```yaml
---
name: skill-name
description: "When and why to use this skill"
allowed-tools: Read, Grep, Glob, Bash(git:*)
context: fork  # optional: runs in isolated subagent
---
```

### What is the same everywhere

- Skill discovery via `/<name>` slash commands
- Frontmatter format (`name`, `description`, `allowed-tools`, `context`)
- `$ARGUMENTS` for user input
- Pipe format output for composable primitives
- All 41 skills work identically

### What differs

- `allowed-tools` enforcement: Claude Code uses `settings.json` permissions; OpenCode uses the skill-guard plugin for logging; Kimi Code treats it as advisory prompt text only.
- `context: fork` implementation: see [Fork Mechanism](#fork-mechanism-context-fork) below.

---

## Agents

Agent definitions are Markdown files with YAML frontmatter. The format is nearly identical but has small differences.

### Frontmatter

| Field | Claude Code | OpenCode | Kimi Code |
|-------|------------|----------|-----------|
| `name` | Required | Required | Required |
| `description` | Required | Required | Required |
| `tools` | Record or list | Record `{ Read: true }` | Record or list |
| `model` | `opus`/`sonnet`/`haiku` | Advisory for humans | Advisory for humans |
| `permissionMode` | Supported | Not applicable | Not applicable |

OpenCode requires the `tools` field to be a YAML record mapping tool names to booleans (`{ Read: true, Grep: true }`), not a comma-separated string. Claude Code and Kimi Code are more flexible.

### Installation paths

| Platform | Agent location | Scope |
|----------|---------------|-------|
| Claude Code | `.claude/agents/` (per project) | Project-local |
| OpenCode | `~/.config/opencode/agents/` | Global |
| Kimi Code | `~/.kimi/agents/` | Global |

Claude Code does not install agents globally. The pelley installer skips agent installation for Claude Code and instead notes that agents should be placed in each project's `.claude/agents/` directory.

### Agent definition in config

OpenCode additionally supports agent definitions directly in `opencode.json`:

```json
{
  "agent": {
    "code-reviewer": {
      "description": "Read-only code review agent",
      "model": "anthropic/claude-sonnet-4-5",
      "tools": { "write": false, "edit": false }
    }
  }
}
```

This is complementary to `.md` agent files, not a replacement.

---

## MCP Servers

Pelley maintains a single `mcp-servers.json` at the repo root as the platform-neutral reference. Each platform consumes it differently.

### Claude Code

MCP servers are registered via the `claude` CLI during install:

```bash
claude mcp add-json <name> '<config>' --scope user
```

Runtime config lives in `~/.claude.json` (not symlinked, managed by the CLI).

### OpenCode

MCP servers are configured in the `mcp` section of `opencode.json`:

```json
{
  "mcp": {
    "memory": {
      "type": "local",
      "command": ["npx", "-y", "@modelcontextprotocol/server-memory"],
      "enabled": true
    }
  }
}
```

The installer symlinks `opencode.json` from the repo to the target.

### Kimi Code

MCP servers are configured in `~/.kimi/mcp.json`. The installer generates this file from `mcp-servers.json`:

```json
{
  "mcpServers": {
    "memory": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-memory"]
    }
  }
}
```

Note the wrapper key `mcpServers` and the different shape (separate `command` and `args` fields instead of an array).

### Default MCP servers

All platforms get the same four servers:

| Server | Purpose |
|--------|---------|
| `playwright` | Browser automation for testing and scraping |
| `sequential-thinking` | Structured multi-step reasoning |
| `context7` | Up-to-date library documentation lookup |
| `memory` | Persistent knowledge graph across sessions |

---

## Hooks & Lifecycle Events

Pelley's hooks perform the same functions on each platform but through different mechanisms.

### Hook events

| Event | Claude Code | OpenCode | Kimi Code |
|-------|------------|----------|-----------|
| SessionStart | `settings.json` hook | `pelley-hooks.ts` plugin | Not supported |
| PreCompact | `settings.json` hook | `pelley-hooks.ts` plugin (periodic snapshots) | Not supported |
| PreToolUse | `settings.json` hook | `pelley-hooks.ts` plugin | Not supported |
| PostToolUse | `settings.json` hook | `telemetry.ts` plugin | Not supported |
| UserPromptSubmit | `settings.json` hook | (not available) | Not supported |
| SessionEnd | `settings.json` hook | (manual `bd sync`) | Not supported |

### Claude Code hooks

Hooks are shell commands defined in `settings.json` under the `hooks` key. Each hook has a `matcher` (which tool or event to match) and a `command` (shell command to run). Example:

```json
{
  "hooks": {
    "SessionStart": [{
      "matcher": "",
      "hooks": [{ "type": "command", "command": "bd stats 2>/dev/null || true" }]
    }]
  }
}
```

### OpenCode hooks

Hooks are TypeScript plugins in `.opencode/plugins/`. They export functions matching lifecycle events:

- `pelley-hooks.ts` handles SessionStart (git status, beads stats), PreCompact (context snapshots), and PreToolUse (destructive command guards).
- `telemetry.ts` handles PostToolUse for skill usage tracking.

### Kimi Code hooks

Kimi Code does not have a native hook/plugin system. Lifecycle events are handled manually:
- Session management relies on manual `bd` commands.
- No automatic SessionStart, PreCompact, or SessionEnd behavior.
- Destructive command guards are not enforced automatically.

This is the biggest functional gap between platforms. Pelley degrades gracefully -- all hooks use `|| true` or equivalent fallback patterns so the absence of hooks does not break workflows.

---

## Project Instructions

Each platform reads a different file for project-level instructions.

| Platform | File | Notes |
|----------|------|-------|
| Claude Code | `CLAUDE.md` | Read automatically from project root |
| OpenCode | `.opencode/opencode.md` | Referenced via `instructions` in `opencode.json` |
| Kimi Code | `AGENTS.md` | Read automatically from project root |

Pelley maintains a canonical `PELLEY.md` at the repo root. The platform-specific files (`CLAUDE.md`, `.opencode/opencode.md`, `KIMI.md`) are derived from it. When installing to a Kimi Code project, `install.sh` copies `KIMI.md` to `AGENTS.md` in the target.

**Editing convention**: Edit `PELLEY.md` for shared content. Edit platform-specific files only for platform-specific details. Each derived file includes a comment noting this:

```markdown
<!-- Derived from PELLEY.md -- edit PELLEY.md for shared content, this file for platform specifics -->
```

---

## Fork Mechanism (context: fork)

Skills with `context: fork` in their frontmatter run in an isolated subagent to avoid polluting the main conversation context. The isolation mechanism differs by platform.

### Claude Code

Uses the **Task tool** to spawn an isolated subagent. The Task tool creates a separate conversation with its own context window. The parent receives the result when the subagent completes.

### OpenCode

Uses **SDK sessions** via `spawn-agent`. The `spawn-agent` tool (defined in `.opencode/tools/spawn-agent.ts`) creates a separate SDK session that reads the agent definition from `agents/<name>.md` and executes independently.

### Kimi Code

Uses the **Task tool**, same as Claude Code. Behavior is equivalent.

### How skills handle this

Skill SKILL.md files use platform-neutral language like "spawn a subagent" or "dispatch to an isolated context." The platform handles the implementation detail. Skill authors do not need to write platform-specific fork logic.

---

## Install & Uninstall

### Prerequisites

- `git` (required)
- `python3` (recommended -- needed for MCP server registration)
- `bd` / beads (recommended -- hooks degrade gracefully without it)
- `cargo` (optional -- only if building `git-intel`)

### Install

```bash
# Auto-detect installed platforms and install to all of them
./install.sh

# Target a specific platform
./install.sh --target=claude
./install.sh --target=opencode
./install.sh --target=kimi

# Install to a specific project (project-local scope)
./install.sh /path/to/project
./install.sh --target=claude /path/to/project

# Use hardlinks instead of symlinks
./install.sh --hardlink

# Build optional git-intel Rust CLI
./install.sh --with-git-intel
```

When `--target=all` (the default), the installer auto-detects which platforms are available by checking for `claude`, `opencode`, and `kimi` commands on `$PATH`. If none are detected, it falls back to OpenCode for backward compatibility.

### What gets installed per platform

| Asset | Claude Code | OpenCode | Kimi Code |
|-------|------------|----------|-----------|
| Settings/config | `settings.json` | `opencode.json` | (preserves existing `config.toml`) |
| Agents | (skipped -- project-local) | Global `agents/*.md` | Global `agents/*.md` |
| Skills | `skills/*/` | `skills/*/` | `skills/*/` |
| Plugins | (none) | `plugins/*.ts` | (none) |
| Custom tools | (none) | `tools/*.ts` | (none) |
| Rules | `rules/*.md` | `rules/*.md` | `rules/*.md` |
| Templates | `templates/` | `templates/` | (not installed) |
| Bin scripts | `bin/*.sh` | `bin/*.sh` | (not installed) |
| MCP | Registered via CLI | Via `opencode.json` | Generated `mcp.json` |
| npm deps | (none) | `package.json` + install | (none) |

### Uninstall

Each install writes a manifest file listing every installed file. Uninstall by removing those files:

```bash
# Claude Code
xargs rm -f < ~/.claude/.pelley.manifest && rm ~/.claude/.pelley.manifest

# OpenCode
xargs rm -f < ~/.config/opencode/.pelley.manifest && rm ~/.config/opencode/.pelley.manifest

# Kimi Code
xargs rm -f < ~/.kimi/.pelley.manifest && rm ~/.kimi/.pelley.manifest
```

For project-local installs, replace the global path with the project path (e.g., `.claude/.pelley.manifest`).

---

## Common Gotchas

### 1. Agent scope differs between platforms

Claude Code agents are **project-local** (`.claude/agents/`). OpenCode and Kimi agents are **global** (`~/.config/opencode/agents/`, `~/.kimi/agents/`). If you add an agent to pelley and run `install.sh`, it will appear globally on OpenCode/Kimi but not on Claude Code. For Claude Code, copy or symlink agents into each project's `.claude/agents/` directory.

### 2. Hooks do not exist on Kimi Code

Kimi Code has no native hook or plugin system. SessionStart, PreCompact, destructive command guards, telemetry, and SessionEnd snapshots all require manual equivalents. Run `bd stats` at the start of a session and `bd sync --flush-only` before ending.

### 3. OpenCode agent tools field must be a record

OpenCode's config schema requires the agent `tools` field to be a YAML record (`{ Read: true, Grep: true }`), not a comma-separated string. If you see agent loading errors on OpenCode, check this field first.

### 4. allowed-tools is advisory everywhere except Claude Code

Only Claude Code has an enforcement mechanism for `allowed-tools` via `settings.json` permissions. OpenCode logs violations via the skill-guard plugin but does not block them. Kimi Code treats `allowed-tools` as prompt text with no enforcement at all. Fork skills get real isolation on all platforms through the fork mechanism.

### 5. MCP config shapes differ

Each platform uses a different JSON structure for MCP server definitions. The installer handles the translation from `mcp-servers.json`, but if you add an MCP server manually, use the correct format for your platform. See [MCP Servers](#mcp-servers) above for the per-platform format.

### 6. Project instructions file name varies

A project targeting all three platforms needs three instruction files: `CLAUDE.md`, `.opencode/opencode.md`, and `AGENTS.md`. The `project-bootstrapper` agent handles this when setting up new projects. For the pelley repo itself, `PELLEY.md` is the canonical source and the three platform files are derived from it.

### 7. PreCompact works differently on OpenCode

Claude Code triggers `PreCompact` synchronously before context compaction. OpenCode uses periodic snapshots instead (the `pelley-hooks.ts` plugin captures context at regular intervals to `memory/sessions/pre-compact.md`). The practical effect is similar but the timing is less precise on OpenCode.

### 8. Symlinks vs hardlinks across filesystems

The default install mode uses symlinks. If the source repo and target directory are on different filesystems and you use `--hardlink`, the install will fail. Stick with symlinks (the default) when source and target are on different volumes.

### 9. OpenCode needs npm for plugins

OpenCode plugins and custom tools are TypeScript files that may import npm packages. The installer runs `npm install` in the target directory if `package.json` is present. If `npm` is not available, plugins may fail to resolve their imports.

### 10. Kimi Code AGENTS.md is a copy, not a symlink

When installing to a Kimi Code project, `install.sh` copies `KIMI.md` to `AGENTS.md` (since Kimi reads `AGENTS.md` for instructions). This means changes to `KIMI.md` require re-running the installer to propagate.
