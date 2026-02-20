# Fan-Out/Fan-In Protocol

Standard pattern for dispatching multiple agents and collecting their results. Used by blossom, fractal, spec, consensus, premortem, meeting, and standup.

## The Pattern

```
1. Frame: Define what each agent investigates (roles, areas, perspectives)
2. Dispatch: Launch agents via spawn-agent
3. Collect: Retrieve results as agents complete
4. Synthesize: Combine results into a unified output
```

## Dispatch

Launch agents using the `spawn-agent` tool, which reads agent definitions from `agents/*.md` and creates SDK sessions:

```
spawn-agent <agent-name> --task "<task description>"
```

For parallel dispatch, spawn multiple agents and track them via beads:

```
bd create --title="<task>" --type=task
spawn-agent <agent-name> --task "<task description>"
```

- **Concurrency**: Launch up to 4 agents at once. More risks API throttling.
- **Tracking**: Use `bd ready` and `bd show <id>` to monitor agent progress.

## Agent Instructions

Every dispatched agent prompt MUST include:

1. **Role/area**: What the agent is responsible for
2. **Goal context**: Why this investigation matters (from the parent skill's goal)
3. **Report format**: Exact structure for the agent's output
4. **Constraints**: Word limits, scope boundaries, what NOT to do

Keep agent prompts self-contained. Agents cannot read the skill file or access the parent's context -- everything they need must be in the prompt.

## Collecting Results

Results come back via bead task completion. Process each result as it arrives rather than waiting for all to complete -- this allows early termination.

Use `bd show <id>` to check individual task status and retrieve agent output.

## Key Constraints

- **Subagents cannot invoke skills.** The Skill tool is not available to subagents. All workflow logic must be embedded in the agent's prompt.
- **Subagents cannot see each other.** Dispatched agents are isolated. They cannot read each other's results.
- **Coordination via beads.** Use `bd create` to define tasks, `spawn-agent` to dispatch, and `bd ready`/`bd show` to track progress and collect results.

## Agent Preamble

Standard investigation instructions for dispatched agents. Include these in agent prompts when applicable:

**Investigation protocol:**

1. Read the actual codebase areas identified in your scope -- use Glob, Grep, and Read to find and examine relevant files
2. Do not speculate or guess about what exists -- verify by reading the actual implementation
3. Be concrete and specific -- cite file paths (with line numbers when relevant), function names, and actual code patterns
4. When you find something, verify it by reading surrounding code:
   - Check callers/consumers to understand usage
   - Check if tests cover it
   - Check configuration, wiring, or integration points
5. Ground every statement in actual code -- if you cannot verify something by reading files, say "could not verify" rather than guessing
6. Never flag something as uncertain if you can verify it by reading one more file

**Report requirements:**

- Every claim about existing code must reference a specific file path
- Distinguish between CONFIRMED findings (verified by reading code), LIKELY findings (strong evidence but incomplete verification), and POSSIBLE findings (suspicious patterns needing deeper investigation)
- When reporting what does NOT exist, state what you searched for and how you verified the absence
