# Workflow Guide

Practical guide for daily pelley usage. Skills, beads, plugins, and agent dispatch -- how they fit together.

## Setup

```bash
git clone https://github.com/supertyrelle/pelley
cd pelley
./install.sh
```

This runs `npm install` automatically for plugin dependencies. Verify with:

```bash
ls ~/.config/opencode/plugins/pelley-hooks.ts
ls ~/.config/opencode/tools/skill.ts
```

Uninstall: `xargs rm -f < ~/.config/opencode/.pelley.manifest`

## Daily Workflow

### Starting a session

```bash
bd ready       # What's available to work on
bd stats       # Backlog overview
```

### Running skills

Each skill is auto-registered as a `skills_<name>` tool (e.g., `skills_gather`, `skills_blossom`). The agent discovers and calls them like any other tool. You can also type `/skill-name` as a shorthand.

### Inline vs fork skills

Skills with `context: fork` run in an isolated SDK session and return results without polluting the main context. Skills without it (inline) run in the current session and can see prior context. You don't need to think about the distinction -- just run the skill.

### Ending a session

```bash
bd sync --flush-only    # Export beads state
```

## Permissions

Permissions are configured per tool in `opencode.json`:

- **Edit and Write**: set to `allow` -- no prompts for markdown edits
- **Bash**: set to `ask` -- confirms before shell commands

## Agent Dispatch

Agent dispatch uses SDK sessions via custom tools:

- **`spawn-agent`**: spawns a single agent from `agents/<name>.md`, creates an SDK session, executes the task, collects results
- **`team-dispatch`**: orchestrates multiple agent dispatches in dependency order
- **`bd`**: wraps the `bd` CLI so agent sessions can read/update beads tasks without shell access

Session lifecycle: create -> init (with system prompt) -> chat (task message) -> collect result -> delete session.

For multi-agent work, use beads as the coordination bus: create tasks with `bd create`, dispatch with `spawn-agent`, track with `bd ready`.

## Plugin Architecture

Three plugins plus one custom tool handle lifecycle, safety, and skill registration:

### `pelley-hooks.ts` (plugin)

Lifecycle hooks and safety guards:
- **Pre-compaction snapshots**: periodic context capture to `memory/sessions/pre-compact.md`
- **Tool safety**: blocks destructive bash patterns (`git reset --hard`, `rm -rf`, `git checkout .`, `git clean -f`), warns on `git push`, prevents direct `.beads/` access

### `skill-guard.ts` (plugin)

Advisory tool constraint logging. When a skill declares `allowed-tools` in its frontmatter, the guard logs warnings if the agent calls tools outside that list. Does not block -- enforcement is prompt-based, not runtime. Fork-context skills get real isolation via separate SDK sessions.

### `telemetry.ts` (plugin)

Logs skill execution events (which skill, which project) for observability. Fires after any `skills_*` tool call completes.

### `skill.ts` (custom tool, registered as plugin)

The bridge between SKILL.md definitions and the tool system. On startup:
1. Scans `skills/` directory for all SKILL.md files
2. Parses YAML frontmatter (name, description, allowed-tools, context)
3. Registers each as a `skills_<name>` tool with the skill body as the prompt

For `context: inline` skills, executes in the current session. For `context: fork` skills, creates (or reuses from pool) an isolated SDK session.

## Capability Notes

### Full capability

All 12 composable primitives, plus:
- `/fractal` -- goal-directed exploration (inline, no dispatch needed)
- `/meeting` -- multi-agent discussion (inline role rotation)
- `/review` -- structured code review (fork, SDK session)
- `/blossom` -- spike exploration
- `/status`, `/retro`, `/handoff` -- session lifecycle
- `/consolidate`, `/evolution`, `/drift` -- maintenance skills
- `/consensus`, `/premortem`, `/spec`, `/tracer` -- fork workflows

### Sequential dispatch

- `/sprint` -- plans and sequences tasks but dispatches sequentially, not in parallel
- `/assemble` -- creates team structure; ongoing learning integration is limited
- `/team-meeting` -- collapses to single-session `/meeting`

## Extending

- **Add a skill**: Create `skills/<name>/SKILL.md` with YAML frontmatter. Rerun `./install.sh`.
- **Add an agent**: Create `agents/<name>.md` with YAML frontmatter. Rerun `./install.sh`.
- **Add a custom tool**: Create a `.ts` file in `.opencode/tools/`. Export a `tool()` definition. Available after restart.
- **Add a plugin**: Create a `.ts` file in `.opencode/plugins/`. Export a `Plugin` function. Hooks into lifecycle events.

## Further Reading

- [Full skill catalog](INDEX.md) -- 41 skills, 3 agents, decision tree, chain patterns
- [README install instructions](../README.md#install)
