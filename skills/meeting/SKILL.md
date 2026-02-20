---
name: meeting
description: "Run an interactive group discussion to flesh out requirements, explore ideas, or get diverse perspectives on a topic. Use when you want to brainstorm with multiple viewpoints, clarify requirements through dialogue, or pressure-test an idea before committing. Keywords: discuss, brainstorm, requirements, team, dialogue, perspectives, workshop."
argument-hint: "<topic or question>"
allowed-tools: Read, Grep, Glob, Bash(bd:*), Bash(git:*)
---

# Meeting: Interactive Multi-Perspective Dialogue

You are facilitating a **Meeting** -- an interactive group discussion with a panel of perspectives. The single agent adopts each panelist role in turn, generating genuine tension between opposed viewpoints while the user drives the agenda.

**Topic:** $ARGUMENTS

## When to Use

- When you want to brainstorm with multiple perspectives on a design problem
- When clarifying requirements through dialogue before committing to an approach
- When pressure-testing an idea by having different roles challenge it
- When exploring trade-offs through interactive discussion rather than parallel reports
- When the user wants to steer the conversation and ask follow-ups in real time

## Phase 1: Assemble the Panel

### 1a. Choose Roles

Based on the topic, select **2 roles** that provide the most opposed perspectives. Two panelists with genuine tension produce better dialogue than 3-4 with diluted positions. The user can request additional panelists mid-meeting if needed.

**Role templates** (pick or adapt):

| Role | Perspective | Good for |
|------|------------|----------|
| Architect | System design, patterns, tradeoffs | Technical design discussions |
| Skeptic | Risk, edge cases, what could go wrong | Pressure-testing ideas |
| User Advocate | UX, developer experience, simplicity | Feature design |
| Domain Expert | Deep knowledge of the specific area | Domain-specific questions |
| Pragmatist | What's achievable, incremental path | Scoping and prioritization |
| Historian | Precedent, what's been tried before | Avoiding past mistakes |
| Innovator | Novel approaches, challenge assumptions | Breaking out of ruts |

Select the two roles whose perspectives would produce the most productive disagreement on this specific topic. Never select two roles that optimize for the same underlying value.

### 1b. Define Panelist Personas

For each role, write a rich characterization (2-3 sentences describing what this role cares about and how they think). These personas guide your responses when speaking as each panelist.

### 1c. Opening Round

Present both panelists and the opening question. For each panelist, write their initial perspective (2-4 paragraphs of concrete, specific analysis, staying fully in character). Present all perspectives together.

---

## Phase 2: Facilitation Cycle

After Phase 1 opening responses, run this cycle. Maintain an **exchange counter** (starts at 0, resets at each checkpoint). The depth limit defaults to 3.

**Step 1. Read and extract.** For each panelist's position, identify the key claim. Does it introduce tension -- a disagreement, counterargument, or novel angle -- that the other panelist has not yet addressed?

**Step 2. Develop tension or skip.**
- **Tension exists ->** Summarize the tension in 1-2 sentences. When generating one panelist's response to another's argument, describe the analytical frame rather than naming the source role (e.g., "From a systems-design perspective, the argument is that X..." rather than "The Architect argues X..."). This strips identity persistence and authority signals while preserving the analytical context. Generate the challenged panelist's response (2-4 paragraphs, in character). Increment exchange counter. If the response introduces new tension, return to Step 1.
- **No tension ->** Proceed to Step 3.

If the exchange counter has reached the depth limit, skip development regardless and proceed to Step 3.

**Step 3. Checkpoint with user.** Synthesize the thread in 2-3 sentences: what was discussed, where panelists agreed, what tension remains. Then ask:

> **Continue** this thread, **pivot** to a new question, or **conclude** the meeting?

- *Continue* -> Reset exchange counter. Formulate a follow-up question informed by the discussion so far. Generate each panelist's response. Return to Step 1.
- *Pivot* -> Reset exchange counter. Ask the user for the new topic (or propose one from unresolved tensions). Generate each panelist's response. Return to Step 1.
- *Conclude* -> Proceed to Phase 3.
- *Freeform direction* -> If the user gives a specific direction that doesn't match these options (e.g., "Ask the Architect about X"), treat it as a targeted follow-up. Generate that panelist's response, then return to Step 1.

### Keeping It Productive

- If a response comes out generic or vague, revise it: "Be more specific. What exactly would you change/build/avoid?"
- If the discussion goes circular, summarize what's settled and redirect to what's unresolved

---

## Phase 3: Synthesize and Close

When the user says to wrap up (or after 4-5 rounds if the conversation naturally winds down):

### 3a. Meeting Summary

```markdown
## Meeting Summary: [topic]

### Consensus Points
[What the panel agreed on]

### Open Tensions
[Disagreements that weren't resolved]

### Decisions Made
[Any concrete decisions the user expressed during the meeting]

### Action Items
[Concrete next steps, if any emerged]

**Sharpening gate** -- every action item must pass three tests:

1. **Name the specific code/file/workflow** where the problem/opportunity exists
2. **State what concretely should change** (a function to add, a check to insert, a pattern to adopt)
3. **Make it assignable** -- could an agent implement this in one session without design decisions?

Example:
- No: "Investigate the auth refactor further"
- Yes: "Spike JWT vs session cookies in src/auth/provider.ts, produce decision doc with latency + security tradeoffs"

Drop items that can't be sharpened, or convert to investigation beads with explicit research questions.

### Key Insight
[The single most valuable thing that emerged from the discussion]
```

### 3b. Optional: Create Beads

If sharpened action items emerged, offer to create beads:

```bash
bd create --title="[action item]" --type=task --priority=[0-4] \
  --description="From meeting on [topic]. Context: [relevant discussion point]"
```

Use the sharpened form as the title. The 3-test pattern ensures beads are immediately dispatchable.

---

## Guidelines

1. **User drives the agenda.** The facilitator presents options and the user chooses direction. Never auto-advance without user input.
2. **Creative tension is the goal.** Roles that agree on everything produce no value. Pick roles that naturally challenge each other.
3. **Short turns.** Panelist responses should be 2-4 paragraphs, not essays. This is dialogue, not reporting.
4. **Summarize often.** After each round, distill what was said so the user can steer.
5. **2 panelists by default.** Pick the two most opposed perspectives for the topic. The user can request more mid-meeting -- add new personas as needed. More than 4 creates noise.
6. **Meetings are cheap.** If the first panel doesn't have the right perspectives, close it and start a new one with different roles.
7. **Anonymize sources, preserve lenses.** When generating one role's response to another's argument, describe the analytical frame ("from a structural-analysis perspective") rather than the source role ("the Architect argues"). This prevents authority bias and identity persistence while preserving the epistemic context that makes engagement meaningful.

## See also

- `/rank` -- rank options or action items produced by the meeting when prioritization is needed
- `/diff-ideas` -- structured alternative when comparing exactly two approaches; avoids the full panel setup
- `/consensus` -- similar multi-perspective pattern but perspectives are generated independently rather than conversing
- `/spec` -- formalize decisions reached in a meeting into a structured specification document
