# KIMI.md

<!-- Derived from PELLEY.md -- edit PELLEY.md for shared content, this file for Kimi Code specifics -->
<!-- install.sh copies this to AGENTS.md in the target project for Kimi Code to discover -->

Portable workflow definitions (agents, skills, rules) maintained in a single git repo and installed to `~/.kimi/` via symlinks.

## Operating Mode: Orchestrator

**Posture depends on project type:**
- **Content-only projects** (no `package.json`, `Cargo.toml`, `go.mod`, `pyproject.toml`, or `Makefile` at root): prefer direct implementation over subagent dispatch for simple edits.
- **Code projects**: orchestrator-only. Dispatch all implementation to subagents and manage the beads backlog.

This repo itself (pelley) is content-only -- direct edits to `.md` and `.json` files are preferred over spawning agents for trivial changes.

### Orchestrator Responsibilities

1. **Backlog Management**: Use `bd` commands to triage, prioritize, and track issues
2. **Task Dispatch**: Delegate implementation work to appropriate subagents via the Task tool
3. **Coordination**: Manage dependencies between tasks, unblock work, review agent outputs
4. **Session Management**: Run `bd sync --flush-only` before completing sessions

### Dispatching Strategy

**Default: serialize.** Dispatch one task at a time, review output, then dispatch next. This avoids API throttling and lets each task benefit from the last one's findings.

**When teams are enabled: parallelize.** Use agent teams for independent tasks (e.g., blossom spikes, parallel audits). Teams run in separate contexts so throttling and context bloat don't apply.

---

## Quick Reference

```bash
# Install (global symlinks to ~/.kimi/)
./install.sh

# Install to a specific project
./install.sh /path/to/project

# Uninstall (uses manifest written during install)
xargs rm -f < ~/.kimi/.pelley.manifest

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

## Kimi Code Platform Details

- **Fork mechanism**: Skills with `context: fork` use the **Task tool** to spawn isolated subagents.
- **Hooks**: Kimi Code uses `config.toml` for configuration. Native lifecycle hooks are not supported; use MCP servers for automation.
- **MCP servers**: Configured in `~/.kimi/mcp.json`. Reference definitions live in `mcp-servers.json` at the repo root.
- **Custom tools**: Not natively supported. Use MCP servers for tool extensions.
- **Instructions file**: Kimi Code reads `AGENTS.md` for project instructions. `install.sh` copies `KIMI.md` to `AGENTS.md` in the target.
- **Agent frontmatter**: `name`, `description`, `tools`, `model`
- **Skill frontmatter**: `name`, `description`, `allowed-tools`, `context`

### Known Limitations

- **No native plugin system.** Lifecycle hooks (SessionStart, PreCompact, etc.) are not available. Session management relies on manual `bd` commands.
- **allowed-tools is advisory.** Skill frontmatter `allowed-tools` is prompt text only -- no enforcement mechanism.
- **Agent teams use Task tool dispatch.** Multi-agent teams coordinate through beads task state and Task tool subagent dispatch.

## Project Structure

```
pelley/
├── agents/                      # Agent definitions (symlinked to ~/.kimi/agents/)
│   ├── agent-generator.md       # Generates project-specific agents
│   ├── project-bootstrapper.md  # Bootstraps projects with full setup
│   └── code-reviewer.md         # Read-only code review agent
├── bin/
│   └── git-pulse.sh             # Shared entry point for git session metrics
├── skills/                      # Skill definitions (symlinked to ~/.kimi/skills/)
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
├── rules/                       # Global rules (symlinked to ~/.kimi/rules/)
│   ├── team-protocol.md         # Team manifest, spawn protocol, reflection schema
│   ├── pipe-format.md           # Composable primitive output contract
│   ├── information-architecture.md  # IA principles for knowledge organization
│   └── memory-layout.md         # Path registry for persistent state
├── templates/                   # Team templates (symlinked to ~/.kimi/templates/)
│   └── teams/                   # Starter team.yaml files for common project types
├── tools/
│   └── git-intel/               # Rust CLI for git metrics (metrics, churn, lifecycle, patterns)
├── KIMI.md                     # This file (Kimi Code instructions source)
├── mcp-servers.json            # MCP server definitions (reference for ~/.kimi/mcp.json)
├── install.sh                  # Symlink installer (idempotent)
└── .beads/                     # Task management state
```

## Architecture

- **No source code, no build system, no tests.** This is a content-only repo of Markdown definitions and JSON config.
- MCP servers are configured in `~/.kimi/mcp.json`. The repo's `mcp-servers.json` serves as the reference definition.
- `install.sh` is idempotent. It backs up existing regular files before symlinking.

## Key Patterns

- All artifact files are Markdown with YAML frontmatter (agents, skills)
- Agent frontmatter fields: `name`, `description`, `tools`, `model`
- Skill frontmatter fields: `name`, `description`, `allowed-tools`, `context`
- Epic hierarchy via `--parent`: `bd create --parent=<epic-id>` (not `bd dep add`). Use `bd dep add` only for cross-task ordering
- Confidence levels for spike findings: CONFIRMED > LIKELY > POSSIBLE
- If `memory/project/domain.md` exists, it contains project-specific terminology; consult it when a term is ambiguous

## Do Not Modify

- `.beads/` internals (use `bd` commands only)
- Symlink targets while symlinks are active (edit source files in this repo instead)
