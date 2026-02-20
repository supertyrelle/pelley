// Active skill context — set by the skill tool via global state.
// When a skill is executing inline, its allowed-tools constraint
// is advisory: the guard logs a warning but does not block.
// For fork-context skills, enforcement happens via session isolation.
//
// NOTE: The "tool.execute.before" hook for skill guard logging has been
// merged into pelley-hooks.ts to avoid opencode v1.2.9's plugin hook
// merging bug (fn is not a function when multiple plugins define the
// same hook key). This file now only exports the shared skill stack
// and push/pop utilities used by skill.ts.

interface SkillFrame {
  name: string
  allowedTools: string[]
}

// Shared global so the skill custom tool can push/pop frames
const g = globalThis as typeof globalThis & {
  __pelleySkillStack?: SkillFrame[]
}
if (!g.__pelleySkillStack) {
  g.__pelleySkillStack = []
}

export const skillStack = g.__pelleySkillStack

/**
 * Normalize Claude Code tool names to OpenCode tool names.
 * Claude Code syntax: Read, Grep, Glob, Bash(bd:*), WebSearch
 * OpenCode syntax:    read, grep, glob, bash, websearch
 */
function normalizeToolNames(tools: string | string[] | undefined): string[] {
  if (!tools) return []
  // Handle comma-separated string from YAML frontmatter
  const list = typeof tools === "string" ? tools.split(",").map((s) => s.trim()) : tools
  const seen = new Set<string>()
  for (const raw of list) {
    // Strip parenthetical suffixes: "Bash(bd:*)" -> "Bash"
    const base = raw.replace(/\(.*\)$/, "").trim()
    if (base) seen.add(base.toLowerCase())
  }
  return Array.from(seen)
}

export function pushSkill(name: string, allowedTools: string | string[] | undefined) {
  skillStack.push({ name, allowedTools: normalizeToolNames(allowedTools) })
}

export function popSkill() {
  return skillStack.pop()
}
