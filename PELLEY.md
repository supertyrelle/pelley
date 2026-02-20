# PELLEY.md

> Canonical project instructions for pelley -- the universal agentic coding harness.
> Platform-specific files (CLAUDE.md, .opencode/opencode.md, KIMI.md) are derived from this file.
> Edit here, then update the platform files to match.

Portable workflow definitions (agents, skills, hooks, rules) maintained in a single git repo and installed to any supported platform via `install.sh`.

## Supported Platforms

| Platform | Instructions file | Install target |
|----------|------------------|----------------|
| Claude Code | CLAUDE.md | ~/.claude/ |
| OpenCode | .opencode/opencode.md | ~/.config/opencode/ |
| Kimi Code | KIMI.md (copied to AGENTS.md) | ~/.kimi/ |

## Getting Started on Each Platform

### Claude Code

```bash
./install.sh --target=claude   # symlinks skills + rules to ~/.claude/
cd your-project
claude                         # start a session
```

```
you> /blossom audit the payment module for retry gaps
  -> spawns spike agents via Task tool, reads source files, produces epic + tasks

you> /gather authentication patterns in this codebase
you> /distill
you> /rank by security risk
  -> each skill reads the previous output from conversation context
```

Claude Code reads `CLAUDE.md` for project instructions, `~/.claude/settings.json` for hooks, and `~/.claude/skills/` for skill definitions. MCP servers are registered via `claude mcp add`.

### OpenCode

```bash
./install.sh --target=opencode  # symlinks to ~/.config/opencode/
cd your-project
opencode                        # start a session
```

```
you> /blossom map the event sourcing pipeline for consistency issues
  -> dispatches spike agents via SDK sessions, traces call chains

you> /meeting should we use REST or GraphQL for the new public API?
  -> assembles panelists with opposing views, you steer the dialogue

you> /assemble
you> /sprint
  -> creates a persistent learning team, dispatches work with reflection loop
```

OpenCode reads `.opencode/opencode.md` for project instructions, `.opencode/opencode.json` for config and MCP, and TypeScript plugins in `.opencode/plugins/` for lifecycle hooks.

### Kimi Code

```bash
./install.sh --target=kimi     # symlinks to ~/.kimi/, generates mcp.json
cd your-project
kimi                           # start a session
```

```
you> /fractal understand the caching layer -- what invalidation strategies exist?
  -> recursive depth-first exploration with dead-end pruning

you> /decompose migrate the database from Postgres to CockroachDB
you> /plan
you> /spec
  -> break down, sequence dependencies, then produce a specification document
```

Kimi Code reads `AGENTS.md` for project instructions, `~/.kimi/config.toml` for model/provider settings, and `~/.kimi/mcp.json` for MCP servers.

### Same skills, every platform

All 41 skills work identically. The same `/blossom` command, the same `/gather -> /distill -> /rank` pipeline, the same `/meeting` dialogue -- regardless of which CLI you open. See [docs/platform-guide.md](docs/platform-guide.md) for detailed differences in plumbing.

---

## Operating Mode: Orchestrator

**Posture depends on project type:**
- **Content-only projects** (no `package.json`, `Cargo.toml`, `go.mod`, `pyproject.toml`, or `Makefile` at root): prefer direct implementation over subagent dispatch for simple edits.
- **Code projects**: orchestrator-only. Dispatch all implementation to subagents and manage the beads backlog.

This repo itself (pelley) is content-only -- direct edits to `.md` and `.json` files are preferred over spawning agents for trivial changes.

### Orchestrator Responsibilities

1. **Backlog Management**: Use `bd` commands to triage, prioritize, and track issues
2. **Task Dispatch**: Delegate implementation work to appropriate subagents
3. **Coordination**: Manage dependencies between tasks, unblock work, review agent outputs
4. **Session Management**: Run `bd sync --flush-only` before completing sessions

### Dispatching Strategy

**Default: serialize.** Dispatch one task at a time, review output, then dispatch next. This avoids API throttling and lets each task benefit from the last one's findings.

**When teams are enabled: parallelize.** Use agent teams for independent tasks (e.g., blossom spikes, parallel audits). Teams run in separate contexts so throttling and context bloat don't apply.

---

## Quick Reference

```bash
# Install (global)
./install.sh

# Install to a specific project
./install.sh /path/to/project

# Install with hardlinks instead of symlinks
./install.sh --hardlink

# Uninstall (uses manifest written during install)
xargs rm -f < <target>/.pelley.manifest

# Beads
bd stats                        # Backlog overview
bd ready                        # Available work
bd create --title="..." --type=task
bd create --type=epic --title="..."  # Create epic
bd create --type=task --parent=<epic-id> --title="..."  # Child of epic
bd children <epic-id>           # List children
bd epic status                  # Epic completion progress
bd epic close-eligible          # Auto-close finished epics
bd swarm validate <epic-id>     # Validate epic DAG
bd dep cycles                   # Detect dependency cycles
bd sync --flush-only            # Save state before session end
```

## Skill Quick Reference

| I want to... | Use |
|---|---|
| Explore something unknown | /blossom or /fractal |
| Research + prioritize | /gather -> /distill -> /rank |
| Compare approaches | /diff-ideas or /consensus |
| Plan before building | /decompose -> /plan -> /spec |
| Test an implementation | /test-strategy |
| Review code | /review |
| Track definition changes | /evolution or /drift |
| Run a session | /status -> ... -> /retro -> /handoff |
| Manage a team | /assemble -> /standup -> /sprint |
| Discuss with panels | /meeting |
| Plan a goal with your team | /team-meeting |

All 41 skills: see [docs/INDEX.md](docs/INDEX.md). Composable primitives follow [pipe format](rules/pipe-format.md).

## Project Structure

```
pelley/
├── agents/                      # Agent definitions (shared across platforms)
│   ├── agent-generator.md       # Generates project-specific agents
│   ├── project-bootstrapper.md  # Bootstraps projects with full setup
│   └── code-reviewer.md         # Read-only code review agent
├── bin/
│   └── git-pulse.sh             # Shared entry point for git session metrics
├── skills/                      # Skill definitions
│   ├── blossom/SKILL.md         # Spike-driven exploration (context: fork)
│   ├── fractal/SKILL.md         # Goal-directed recursive exploration (inline)
│   ├── meeting/SKILL.md         # Interactive multi-agent dialogue (inline)
│   ├── assemble/SKILL.md        # Persistent learning team creation (inline)
│   ├── standup/SKILL.md         # Team status sync with learning health (inline)
│   ├── sprint/SKILL.md          # Sprint planning + dispatch with learning loop (inline)
│   ├── consolidate/SKILL.md     # Backlog review (context: fork)
│   ├── session-health/SKILL.md  # Session diagnostic (inline, auto-discoverable)
│   ├── handoff/SKILL.md         # Session transition (inline)
│   ├── review/SKILL.md          # Code review (context: fork)
│   ├── retro/SKILL.md           # Session retrospective (inline)
│   └── <12 composable primitives>  # gather, distill, rank, etc. (inline)
├── docs/                        # Documentation (cookbook, recipes, team guide, INDEX)
│   └── INDEX.md                 # Skill & agent navigator (decision tree, categories)
├── demos/                       # Demo projects for primitive walkthroughs
├── rules/                       # Global rules
│   ├── team-protocol.md         # Team manifest, spawn protocol, reflection schema
│   ├── pipe-format.md           # Composable primitive output contract
│   ├── information-architecture.md  # IA principles for knowledge organization
│   └── memory-layout.md         # Path registry for persistent state
├── templates/                   # Team templates
│   └── teams/                   # Starter team.yaml files for common project types
├── tools/
│   └── git-intel/               # Rust CLI for git metrics (metrics, churn, lifecycle, patterns)
├── install.sh                   # Symlink installer (idempotent, multi-platform)
├── mcp-servers.json             # MCP server definitions (platform-neutral reference)
├── PELLEY.md                    # This file (canonical shared instructions)
├── CLAUDE.md                    # Claude Code platform instructions
├── KIMI.md                      # Kimi Code platform instructions
├── .opencode/                   # OpenCode platform config
│   ├── opencode.json            # Config (model, MCP, permissions, plugins)
│   ├── opencode.md              # OpenCode platform instructions
│   ├── plugins/                 # Lifecycle hook plugins (TypeScript)
│   └── tools/                   # Custom tool definitions (TypeScript)
├── .claude/                     # Claude Code project-local config
│   └── settings.json            # Project-specific hooks + permissions
├── settings.json                # Claude Code global hooks + env
└── .beads/                      # Task management state
```

## Architecture

- **No source code, no build system, no tests.** This is a content-only repo of Markdown definitions, JSON config, and platform-specific plugins.
- `install.sh` is idempotent. It backs up existing regular files before symlinking.
- MCP servers are defined in `mcp-servers.json` (platform-neutral reference) and configured per-platform during install.

## Key Patterns

- All artifact files are Markdown with YAML frontmatter (agents, skills)
- Agent frontmatter fields: `name`, `description`, `tools`, `model`
- Skill frontmatter fields: `name`, `description`, `allowed-tools`, `context`
- Hooks/plugins fail gracefully with fallbacks for optional tools (like `bd`)
- Epic hierarchy via `--parent`: `bd create --parent=<epic-id>` (not `bd dep add`). Use `bd dep add` only for cross-task ordering
- Confidence levels for spike findings: CONFIRMED > LIKELY > POSSIBLE
- If `memory/project/domain.md` exists, it contains project-specific terminology; consult it when a term is ambiguous

## Platform Differences

| Feature | Claude Code | OpenCode | Kimi Code |
|---------|------------|----------|-----------|
| Instructions file | CLAUDE.md | .opencode/opencode.md | KIMI.md -> AGENTS.md |
| Fork mechanism | Task tool | SDK sessions | Task tool |
| Hooks | settings.json | plugins/*.ts | config.toml |
| MCP config | claude mcp add / mcp-servers.json | opencode.json mcp section | ~/.kimi/mcp.json |
| Custom tools | Not native (use MCP) | .opencode/tools/*.ts | Not native (use MCP) |
| Plugins | Not native (use hooks) | .opencode/plugins/*.ts | Not native |
| Install target | ~/.claude/ | ~/.config/opencode/ | ~/.kimi/ |

## Model Selection

### Quick Reference

| | Claude Code | OpenCode | Kimi Code |
|---|---|---|---|
| Config file | `settings.json` | `.opencode/opencode.json` | `config.toml` |
| Model field | env var / `--model` flag | `model`, `small_model` | `default_model` |
| Provider format | N/A (env vars) | `provider/model` | TOML provider + model sections |
| Custom provider | `ANTHROPIC_BASE_URL` env var | `providers` key in JSON | `[providers.name]` TOML block |
| Ollama support | `ANTHROPIC_BASE_URL=http://localhost:11434` | `ollama/model-name` | `[providers.ollama]` block |
| Local server | Same as Ollama (env vars) | `openai-compatible/model` + providers block | `[providers.llama-local]` block |

### Per-CLI Details

**Claude Code** -- Model via `--model` flag or `ANTHROPIC_MODEL` env var. Aliases: `opus`, `sonnet`, `haiku`. For non-Anthropic backends:

```bash
ANTHROPIC_BASE_URL=http://localhost:11434 ANTHROPIC_AUTH_TOKEN=ollama ANTHROPIC_API_KEY="" claude --model qwen3-coder
```

Presets in `settings.json` under `_model_config`.

**OpenCode** -- Model via `model` and `small_model` fields in `.opencode/opencode.json`. Format: `provider/model-name`. Presets in `_model_presets` key. Custom endpoints via `providers` key.

**Kimi Code** -- Model via `default_model` in `config.toml`. Providers declared as `[providers.name]` TOML blocks. Models as `[models.name]` blocks referencing a provider. Two templates: local-first (`templates/kimi/config.toml`) and cloud-first (`templates/kimi/kimi/config.toml`).

### Platform UI

The platform web UI at `http://localhost:3000` provides model management: pull Ollama models, connect local servers, configure per-session routing. CLI equivalent: `platform/bin/models.sh`.

### Local Server Compatibility

When running llama-server (llama.cpp) as a local model backend, some flags affect compatibility with the platform:

| Flag | Impact | Recommendation |
|------|--------|----------------|
| `--reasoning-format deepseek` | Emits `<think>...</think>` tokens. The platform's Oracle chat strips these automatically, but Kimi Code and other CLIs show them as raw text. | Omit unless you need reasoning traces in direct CLI use. |
| `--presence-penalty 1.5` | Server-level penalty conflicts with per-request parameters sent by CLIs. | Set per-request instead (via CLI config), not at the server level. |
| `--jinja` | Required for models with Jinja chat templates (e.g., Qwen3.5). Some templates reject system-only messages. | Keep enabled; the platform handles probe errors gracefully. |
| `--ctx-size` | Context window size. Kimi Code reports this to the user. | Match the model's training context (e.g., 131072 for Qwen3.5). |

**Recommended base command:**

```bash
llama-server -hf <model> -ngl 99 --ctx-size 131072 -n 32768 --host 0.0.0.0 --port 8080 --jinja -fa on --cache-type-k q8_0 --cache-type-v q8_0
```

Omit `--reasoning-format deepseek`, `--presence-penalty`, and `--temp`/`--top-p`/`--top-k` at the server level — let each CLI control sampling parameters.

## Do Not Modify

- `.beads/` internals (use `bd` commands only)
- Symlink targets while symlinks are active (edit source files in this repo instead)
