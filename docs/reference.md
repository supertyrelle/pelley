# Reference

Detailed reference material for the Pelley toolkit. For a quick overview, see the [README](../README.md). For skill and agent details, see the [INDEX](INDEX.md).

## Plugins and Safety

The `pelley-hooks.ts` plugin (`.opencode/plugins/pelley-hooks.ts`) provides safety guards that run automatically.

| Event | When | What |
|-------|------|------|
| `tool.execute.before` (bash) | Before destructive commands | Blocks `git reset --hard`, `git checkout .`, `git clean -f`, `rm -rf` |
| `tool.execute.before` (bash) | Before `git push` | Warns if beads changes are uncommitted |
| `tool.execute.before` (bash) | Before `.beads/` access | Blocks direct .beads/ access (use `bd` CLI instead) |
| `experimental.session.compacting` | Before context compaction | Injects in-progress tasks, recent commits, and working tree state into compacted context |
| `session.idle` | Session idle (60s cooldown) | Snapshots state to `memory/sessions/pre-compact.md` |

Additional plugins:
- `skill-guard.ts` — Skill execution guardrails
- `telemetry.ts` — Session telemetry

All plugins fail gracefully with error logging, so projects without beads installed still work fine.

## MCP Servers

Four Model Context Protocol servers provide extended capabilities.

| Server | What |
|--------|------|
| `playwright` | Browser automation for testing and scraping |
| `sequential-thinking` | Structured multi-step reasoning |
| `context7` | Up-to-date library documentation lookup |
| `memory` | Persistent knowledge graph across sessions |

MCP servers are defined in `.opencode/opencode.json`. Add or remove entries there and rerun `./install.sh`.

## Project Structure

```
pelley/
  .opencode/
    plugins/
      pelley-hooks.ts            # Safety guards: destructive cmd blocking, beads sync, pre-compaction snapshots
      skill-guard.ts          # Skill execution guardrails
      telemetry.ts            # Session telemetry
    tools/
      skill.ts                # Skill invocation tool
      spawn-agent.ts          # Single agent dispatch via SDK sessions
      team-dispatch.ts        # Multi-agent dispatch in dependency order
      bd.ts                   # Beads CLI bridge for agent sessions
      client.ts               # SDK session client
    opencode.json             # OpenCode config: model, MCP servers, plugins, permissions
    opencode.md               # Context file for working on this repo itself
  agents/
    agent-generator.md        # Generates project-specific agents from codebase analysis
    project-bootstrapper.md   # Full project setup with Beads
    code-reviewer.md          # Read-only code review across 4 quality dimensions
  bin/
    git-pulse.sh              # Shared entry point for git session metrics
    session-start.sh          # Session initialization script
  skills/
    blossom/SKILL.md          # /blossom -- spike-driven exploration (fork)
    fractal/SKILL.md          # /fractal -- goal-directed recursive exploration (inline)
    meeting/SKILL.md          # /meeting -- interactive multi-agent dialogue (inline)
    assemble/SKILL.md         # /assemble -- persistent team creation (inline)
    standup/SKILL.md          # /standup -- team status sync (inline)
    sprint/SKILL.md           # /sprint -- sprint planning + dispatch (inline)
    consensus/SKILL.md        # /consensus -- multi-perspective design synthesis (fork)
    spec/SKILL.md             # /spec -- structured specification (fork)
    premortem/SKILL.md        # /premortem -- risk-first failure analysis (fork)
    tracer/SKILL.md           # /tracer -- iterative end-to-end implementation (fork)
    consolidate/SKILL.md      # /consolidate -- backlog review (fork)
    review/SKILL.md           # /review -- code review (fork)
    session-health/SKILL.md   # /session-health -- session diagnostic (inline)
    handoff/SKILL.md          # /handoff -- session transition (inline)
    retro/SKILL.md            # /retro -- session retrospective (inline)
    gather/SKILL.md           # /gather -- collect structured findings (inline)
    distill/SKILL.md          # /distill -- condense to essentials (inline)
    rank/SKILL.md             # /rank -- score and order items (inline)
    filter/SKILL.md           # /filter -- binary keep/drop (inline)
    assess/SKILL.md           # /assess -- categorical rubric evaluation (inline)
    decompose/SKILL.md        # /decompose -- break into sub-parts (inline)
    diff-ideas/SKILL.md       # /diff-ideas -- side-by-side tradeoffs (inline)
    sketch/SKILL.md           # /sketch -- code skeleton with TODOs (inline)
    verify/SKILL.md           # /verify -- fact-check claims (inline)
    critique/SKILL.md         # /critique -- surface weaknesses (inline)
    plan/SKILL.md             # /plan -- ordered action plan (inline)
    merge/SKILL.md            # /merge -- combine pipe outputs (inline)
  docs/
    primitives-cookbook.md     # Annotated walkthroughs of primitive chains
    primitives-recipes.md     # Common chain patterns
    team-system-guide.md      # Standalone adopter guide for team system
    demos/                    # Demo walkthroughs (build-a-feature, OSS audit)
  demos/
    todo-app/                 # Intentionally buggy Express app for demo walkthroughs
  rules/
    team-protocol.md          # Team manifest format, spawn protocol, reflection schema (global)
    pipe-format.md            # Composable primitive output contract (global)
  tools/
    git-intel/                # Rust CLI for git metrics (metrics, churn, lifecycle, patterns)
  install.sh                  # Symlink installer (idempotent, non-destructive)
```

## Design Philosophy

Three principles shaped these workflows:

**1. Plugins are for guarantees, instructions are for guidance.** Plugins fire automatically -- use them for things that must never be forgotten (syncing state, safety guards). opencode.md instructions are for things that should usually happen but require judgment. Skills are for on-demand workflows you invoke when you need them.

**2. Verify, don't speculate.** Every spike agent in `/blossom` is instructed to read the actual implementation, trace call chains, check callers and tests, and state a confidence level. CONFIRMED means the agent read the code and verified the issue. LIKELY means strong evidence but incomplete trace. POSSIBLE means it needs a deeper spike. This distinction matters -- it's the difference between a backlog of real work and a backlog of guesses.

**3. Serialize by default, parallelize with teams.** For sequential work, the orchestrator dispatches one agent at a time, reviews its output, and learns from it before dispatching the next. For independent work (blossom spikes, parallel audits), agent teams run in separate contexts where throttling and context bloat don't apply.
