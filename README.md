# pelley

**A universal agentic coding harness for Claude Code, OpenCode, and Kimi Code.** Clone once, install to any platform, use across every project.

*Pelley holds things together. Here, it binds composed skill outputs -- each skill's result feeds the next through conversation context, like Unix pipes for knowledge work.*

## Supported Platforms

| Platform | Status | Install target |
|----------|--------|----------------|
| **Claude Code** | Full support | `~/.claude/` |
| **OpenCode** | Full support | `~/.config/opencode/` |
| **Kimi Code** | Early support | `~/.kimi/` |

All 41 skills, 3 agents, and all rules work identically across platforms. Platform differences are limited to hooks, MCP wiring, and fork mechanisms -- `install.sh` handles these automatically.

## What It Looks Like

### Map an unfamiliar codebase

```
/blossom audit the event sourcing pipeline for consistency gaps
```

Blossom spawns parallel spike agents that read actual source files, trace call chains, and tag findings with confidence levels. Output is a prioritized task backlog, not a summary.

```
Seeding epic: "Event sourcing pipeline audit"
Dispatching 4 spikes: command-handlers, projections, event-store, saga-orchestration

Spike results:
1. CONFIRMED -- ProjectionRebuilder skips tombstoned events (projections/rebuild.ts:47)
2. CONFIRMED -- No idempotency check on CommandBus.dispatch (handlers/bus.ts:112)
3. LIKELY    -- Saga timeout defaults to 0, may cause silent drops (sagas/orchestrator.ts:88)
4. POSSIBLE  -- Event schema v2 migration has unused backward-compat shim

Created 6 tasks under epic BL-42, dependency graph attached
```

### Hash out a design decision

```
/meeting should we use event sourcing or CQRS-lite for the new billing module?
```

Assembles 2 panelists with genuinely opposed perspectives and a facilitator. You steer the conversation, ask follow-ups, cut threads that aren't productive. Output is a decision record, not a compromise.

### Research, distill, and prioritize

```
/gather authentication patterns in this codebase
/distill
/rank by security risk
```

Each skill's output feeds the next through conversation context. No file passing, no explicit piping -- context is the pipe.

## Install

```bash
git clone https://github.com/supertyrelle/pelley
cd pelley
./install.sh                    # Auto-detect and install for all found platforms
./install.sh --target=claude    # Claude Code only
./install.sh --target=opencode  # OpenCode only
./install.sh --target=kimi      # Kimi Code only
```

Zero dependencies. The installer symlinks skills, agents, and rules into the platform's config directory. Rerun after pulling updates -- it's idempotent, existing files are backed up.

```bash
./install.sh /path/to/project    # Project-local install (skills + agents only)
./install.sh --hardlink           # Hardlinks instead of symlinks
./install.sh --with-git-intel     # Build optional Rust CLI for git analysis
```

### Uninstall

Each install writes a manifest. Remove everything with:

```bash
xargs rm -f < ~/.claude/.pelley.manifest         # Claude Code
xargs rm -f < ~/.config/opencode/.pelley.manifest # OpenCode
xargs rm -f < ~/.kimi/.pelley.manifest            # Kimi Code
```

## Getting Started

**New project:** Run the `project-bootstrapper` agent to set up project instructions, plugins, and rules. Then run `agent-generator` to create project-specific agents. Start exploring with `/blossom`.

**Existing project:** Use `/blossom <what you want to explore>` to map the territory. Use `/consolidate` when the backlog grows noisy. Use `/session-health` for a context quality gut-check.

**New machine:** Clone, install, go. Your entire workflow travels with you.

## Your First Session

### 1. Orient

```
/status
```

Shows your backlog, recent activity, team state, and last session summary. Start here every time.

### 2. Research something

```
/gather authentication patterns in this codebase
```

Produces a structured list of findings with sources and confidence levels. This output stays in context for the next step.

### 3. Refine what you found

```
/distill
/rank by security risk
```

`/distill` reads the gather output above and condenses it. `/rank` reads the distilled output and scores each item. Each step's output feeds the next -- no file passing needed.

### 4. Explore a larger goal

```
/blossom audit the payment module for error handling gaps
```

Spawns parallel spike agents that read actual source files. Produces an epic with prioritized tasks in your backlog. Use this when the problem is too big for a single gather/distill chain.

### 5. Build from what you found

Pick a task from the blossom output, then:

```
/tracer implement retry logic for failed payment webhooks
```

Tracer works iteratively -- it builds the thinnest working path first, verifies it, then expands. Each iteration produces running code, not plans.

### Chaining skills

Skills compose through conversation context. Run them sequentially and each reads the previous output automatically:

```
/gather -> /distill -> /rank          Research, condense, prioritize
/decompose -> /plan -> /sketch        Break down, sequence, prototype
/blossom -> pick tasks -> /tracer     Explore, then build
```

See [Common Chains](#common-chains) for more patterns.

## Skills (41)

### Composable Primitives

Stateless skills that chain through conversation context. Output of any feeds the next.

| Skill | Purpose |
|-------|---------|
| `/gather` | Collect findings with sources and confidence levels |
| `/distill` | Reduce to essentials |
| `/rank` | Score and order by criteria |
| `/filter` | Binary keep/drop |
| `/assess` | Categorize by rubric (critical/warning/ok) |
| `/verify` | Check claims against evidence |
| `/critique` | Adversarial review -- what's wrong, missing, risky |
| `/diff-ideas` | Side-by-side tradeoff analysis |
| `/decompose` | Break into bounded sub-parts |
| `/plan` | Dependency-aware execution sequence |
| `/sketch` | Code skeleton with TODOs |
| `/merge` | Combine multiple outputs into one |

### Workflows

Orchestrated multi-step workflows with side effects.

| Skill | Purpose |
|-------|---------|
| `/blossom` | Spike-driven exploration -- produces epic + prioritized tasks |
| `/fractal` | Goal-directed recursive exploration with dead-end pruning |
| `/meeting` | Live multi-agent discussion with opposed perspectives |
| `/team-meeting` | Goal-oriented team planning -- decomposes goal into sprint-ready tasks |
| `/consensus` | Three independent proposals, synthesized |
| `/tracer` | Iterative implementation -- thinnest working path first |
| `/review` | Structured code review across 5 dimensions |
| `/sprint` | Dispatch work to agents with a learning loop |
| `/spec` | Progressive specification document |
| `/premortem` | Failure analysis before building |
| `/bootstrap` | Full project setup: infrastructure + agents |
| `/bug` | File a structured bug report to beads backlog |
| `/consolidate` | Backlog dedup, stale detection, and cleanup |
| `/test-strategy` | Structured testing workflow with red-green gates |
| `/domain` | Capture or query project-specific terminology |
| `/active-learn` | Adversarial training loop for agent improvement |
| `/diagnose-agent` | Profile agent strengths and weaknesses |
| `/challenge-gen` | Generate targeted training challenges |
| `/challenge-run` | Execute challenges and evaluate agent performance |

### Session & Team

| Skill | Purpose |
|-------|---------|
| `/status` | Unified dashboard: backlog, activity, team, last session |
| `/advise` | Proactive recommendations from git state, history, and signals |
| `/assemble` | Create a persistent learning team |
| `/standup` | Sync status, surface blockers |
| `/retro` | Session retrospective with persistent learnings |
| `/handoff` | Session transition capture |
| `/session-health` | Context load and drift diagnostic |
| `/evolution` | Track how a definition changed over time |
| `/drift` | Detect convergence/divergence across definitions |
| `/discover` | Recommend skills or pipelines for a goal |

[Full catalog with decision tree and chain patterns](docs/INDEX.md)

## Common Chains

```
/gather -> /distill -> /rank           Research -> condense -> prioritize
/decompose -> /rank -> /plan           Break down -> prioritize -> sequence
/gather -> /critique -> /rank          Research -> stress-test -> prioritize
/assemble -> /standup -> /sprint       Form team -> sync -> dispatch
/blossom -> pick tasks -> /tracer      Explore -> build
/meeting -> /fractal -> /spec          Discuss -> deep-dive -> specify
```

## How It Actually Works

**Skills are LLM-driven, not deterministic.** The same input may produce different findings across runs. Confidence levels (CONFIRMED, LIKELY, POSSIBLE) help you calibrate trust. Output quality scales directly with input specificity -- a precise goal with file paths produces better results than a vague one.

**Fork-context skills spawn subagents.** `/blossom`, `/consensus`, and `/premortem` each dispatch agents that read source files independently. On large codebases, expect meaningful API usage. Inline skills (primitives, `/meeting`, `/status`) are lightweight.

**Everything works without extras.** No beads, no git-intel, no MCP servers required. You just get fewer features. Plugins degrade gracefully.

## Platform Differences

Skill definitions, agent definitions, and rules are 100% portable. The differences are in platform plumbing:

| Feature | Claude Code | OpenCode | Kimi Code |
|---------|------------|----------|-----------|
| Fork mechanism | Task tool | SDK sessions | Task tool |
| Hooks | settings.json | plugins/*.ts | config.toml (limited) |
| MCP config | claude mcp add | opencode.json | ~/.kimi/mcp.json |
| Custom tools | MCP servers | .opencode/tools/*.ts | MCP servers |

See [docs/platform-guide.md](docs/platform-guide.md) for detailed platform differences and migration notes.

## Extending

**Add a skill:** Create `skills/<name>/SKILL.md` with YAML frontmatter. Rerun `./install.sh`.

**Add an agent:** Create `agents/<name>.md` with YAML frontmatter. Rerun `./install.sh`.

**Platform-specific extensions:** OpenCode supports plugins and custom tools natively. Claude Code and Kimi Code use MCP servers for equivalent functionality.

## Learn More

- [Full skill & agent catalog](docs/INDEX.md) -- 41 skills, 3 agents, decision tree, chain patterns
- [Platform guide](docs/platform-guide.md) -- detailed platform differences and migration notes
- [Technical reference](docs/reference.md) -- plugins, MCP servers, project structure, design philosophy
- [Composable primitive patterns](docs/primitives-cookbook.md) -- annotated walkthroughs
- [Team system guide](docs/team-system-guide.md) -- persistent learning teams
- [Workflow guide](docs/opencode-guide.md) -- daily usage and workflow patterns

## License

[MIT](LICENSE)
