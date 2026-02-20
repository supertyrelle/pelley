# Skill Authoring Rules

Rules for writing and editing skill definition files.

## File Location

Skills live in `skills/<name>/SKILL.md`. The directory name becomes the slash command name (e.g., `skills/blossom/SKILL.md` -> `/blossom`).

## Required Frontmatter

Every skill file must have YAML frontmatter with these fields:

```yaml
---
name: lowercase-with-hyphens
description: "When and why to use this skill. Include keywords for auto-discovery."
allowed-tools: Read, Grep, Glob, Bash(bd:*), Bash(git:*)
---
```

### Frontmatter Fields

- **name**: Matches the directory name, lowercase with hyphens
- **description**: Quoted string explaining when to invoke. Include keywords at the end for auto-discovery by the model
- **argument-hint**: Optional. Shows usage hint (e.g., `"<goal>"`, `"[target]"`)
- **allowed-tools**: Minimal tool list. Restrict shell commands to specific prefixes where possible
- **context**: Set `fork` for skills that run in isolation (heavy exploration). Omit for inline skills

## Required Sections

Every skill MUST include:

1. **Title line** -- `# Name: Descriptive Subtitle`
2. **Context line** -- Reference `$ARGUMENTS` for user input
3. **When to Use** -- Bullet list of concrete scenarios
4. **Phased workflow** -- Numbered phases with clear progression
5. **Guidelines** -- Behavioral constraints and quality standards

## Do This

- Start the description with an action verb ("Run...", "Capture...", "Review...")
- Include keywords at the end of the description for auto-discovery
- Restrict `allowed-tools` to the minimum needed -- read-only skills should not have Write/Edit
- Use `context: fork` for skills that do heavy exploration to avoid polluting the main context
- Reference `rules/information-architecture.md` for placement decisions when choosing between passive (rules/), discoverable (docs/), or on-demand locations
- Reference `$ARGUMENTS` to accept user input
- Include a visual workflow diagram showing phase progression (ASCII flowchart)

## Don't Do This

- Do not include Write/Edit in allowed-tools unless the skill modifies files
- Do not duplicate logic that exists in another skill -- factor shared patterns into agents instead
- Do not duplicate logic that exists in an agent -- if an agent already handles the workflow, don't recreate it as a skill
- Do not embed session-close boilerplate (bd sync, git status, git commit) -- the beads plugin already injects the session close protocol into every session
