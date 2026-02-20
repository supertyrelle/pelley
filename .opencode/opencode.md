# opencode.md

<!-- Derived from PELLEY.md -- edit PELLEY.md for shared content, this file for OpenCode specifics -->

Portable workflow definitions (agents, skills, plugins, commands) maintained in a single git repo and installed to `~/.config/opencode/` via symlinks.

## Operating Mode: Orchestrator

**Posture depends on project type:**
- **Content-only projects** (no `package.json`, `Cargo.toml`, `go.mod`, `pyproject.toml`, or `Makefile` at root): prefer direct implementation over subagent dispatch for simple edits.
- **Code projects**: orchestrator-only. Dispatch all implementation to subagents and manage the beads backlog.

This repo itself (pelley) is content-only -- direct edits to `.md` and `.json` files are preferred over spawning agents for trivial changes.

### Orchestrator Responsibilities

1. **Backlog Management**: Use `bd` commands to triage, prioritize, and track issues
2. **Task Dispatch**: Delegate implementation work to appropriate subagents via spawn-agent SDK sessions
3. **Coordination**: Manage dependencies between tasks, unblock work, review agent outputs
4. **Session Management**: Run `bd sync --flush-only` before completing sessions

### Dispatching Strategy

**Default: serialize.** Dispatch one task at a time, review output, then dispatch next. This avoids API throttling and lets each task benefit from the last one's findings.

**When teams are enabled: parallelize.** Use beads-based coordination for independent tasks (e.g., blossom spikes, parallel audits). Teams run in separate SDK sessions so throttling and context bloat don't apply.

---

## Quick Reference

```bash
# Install (global symlinks to ~/.config/opencode/)
./install.sh

# Install to a specific project
./install.sh /path/to/project

# Uninstall (uses manifest written during install)
xargs rm -f < ~/.config/opencode/.pelley.manifest

# Beads
bd stats                        # Backlog overview
bd ready                        # Available work
bd create --title="..." --type=task
bd create --type=epic --title="..."  # Create epic
bd create --type=task --parent=<epic-id> --title="..."  # Child of epic
bd children <epic-id>           # List children
bd epic status                  # Epic completion progress
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

## OpenCode Platform Details

- **Fork mechanism**: Skills with `context: fork` spawn separate **SDK sessions**. Behavior is equivalent to native fork but implementation differs.
- **Hooks**: Lifecycle hooks are defined as TypeScript plugins in `.opencode/plugins/`. Supports SessionStart, PreCompact, PreToolUse, PostToolUse events.
- **MCP servers**: Configured in `.opencode/opencode.json` under the `mcp` section.
- **Custom tools**: TypeScript tool definitions in `.opencode/tools/`. Extend the agent's capabilities with project-specific tools.
- **Skills as commands**: Skill definitions in `skills/<name>/SKILL.md` are auto-registered as slash commands by the skill-guard plugin. No separate command files needed.
- **Agent frontmatter**: `name`, `description`, `tools`, `model` (model is advisory for human readers)
- **Skill frontmatter**: `name`, `description`, `allowed-tools`, `context`

### Known Limitations

- **allowed-tools is advisory.** Skill frontmatter `allowed-tools` is prompt text only -- enforcement uses the skill-guard plugin for logging. Fork skills get real isolation via SDK sessions.
- **Agent teams use beads-based coordination.** Multi-agent teams coordinate through beads task state and spawn-agent dispatch.
- **PreCompact uses periodic snapshots.** Instead of a synchronous pre-compaction hook, context snapshots are captured at regular intervals to `memory/sessions/pre-compact.md`.

## Project Structure

```
pelley/
├── agents/                      # Agent definitions
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
├── tools/
│   └── git-intel/               # Rust CLI for git metrics (metrics, churn, lifecycle, patterns)
├── .opencode/                   # OpenCode platform config
│   ├── opencode.json            # Config (model, MCP, permissions, plugins)
│   ├── opencode.md              # This file (root context)
│   ├── plugins/                 # Lifecycle hook plugins (TypeScript)
│   │   ├── pelley-hooks.ts       # SessionStart, PreCompact, destructive-command guards
│   │   └── telemetry.ts         # Skill usage telemetry
│   └── tools/                   # Custom tool definitions (TypeScript)
│       ├── bd.ts                # Beads CLI wrapper
│       ├── skill.ts             # Skill invocation tool
│       ├── spawn-agent.ts       # SDK session agent dispatch
│       └── team-dispatch.ts     # Parallel team dispatch
├── install.sh                   # Symlink installer (idempotent)
└── .beads/                      # Task management state
```

## Architecture

- **No source code, no build system, no tests.** This is a content-only repo of Markdown definitions, JSON config, and TypeScript plugins.
- Plugins in `.opencode/plugins/` handle SessionStart, PreCompact, PreToolUse, and PostToolUse events.
- MCP servers are configured in `.opencode/opencode.json` under the mcp section.
- `install.sh` is idempotent. It backs up existing regular files before symlinking.

## Key Patterns

- All artifact files are Markdown with YAML frontmatter (agents, skills)
- Agent frontmatter fields: `name`, `description`, `tools`, `model` (model is advisory for human readers)
- Skill frontmatter fields: `name`, `description`, `allowed-tools`, `context`
- Plugins fail gracefully for optional tools (like `bd`)
- Epic hierarchy via `--parent`: `bd create --parent=<epic-id>` (not `bd dep add`). Use `bd dep add` only for cross-task ordering
- Confidence levels for spike findings: CONFIRMED > LIKELY > POSSIBLE
- If `memory/project/domain.md` exists, it contains project-specific terminology; consult it when a term is ambiguous

## Do Not Modify

- `.beads/` internals (use `bd` commands only)
- Symlink targets while symlinks are active (edit source files in this repo instead)
