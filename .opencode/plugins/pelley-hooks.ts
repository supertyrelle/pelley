import type { Plugin } from "@opencode-ai/plugin"
import { writeFile, mkdir } from "fs/promises"
import { join } from "path"
import { existsSync } from "fs"
import { skillStack } from "../lib-skill-guard"

const DESTRUCTIVE_PATTERNS = [
  /git\s+reset\s+--hard/,
  /git\s+checkout\s+\./,
  /git\s+clean\s+-f/,
  /rm\s+-rf/,
]

const BEADS_DIRECT_ACCESS = /\.beads\//
const PUSH_PATTERN = /git\s+push/

async function buildSnapshot(
  $: any,
  directory: string,
): Promise<{ tasks: string; log: string; status: string }> {
  const [tasksResult, logResult, statusResult] = await Promise.all([
    $`bd list --status=in_progress 2>/dev/null || echo "No in-progress tasks"`.text(),
    $`git -C ${directory} log --oneline -5 2>/dev/null || echo "No recent commits"`.text(),
    $`git -C ${directory} status --short 2>/dev/null || echo "Clean"`.text(),
  ])
  return {
    tasks: tasksResult.trim(),
    log: logResult.trim(),
    status: statusResult.trim(),
  }
}

function formatCompactionContext(data: {
  tasks: string
  log: string
  status: string
}): string {
  return [
    "## Pre-Compaction Context (auto-injected by pelley-hooks)",
    "",
    "### In-Progress Tasks",
    "```",
    data.tasks,
    "```",
    "",
    "### Recent Commits",
    "```",
    data.log,
    "```",
    "",
    "### Working Tree",
    "```",
    data.status,
    "```",
  ].join("\n")
}

function formatIdleSnapshot(data: {
  tasks: string
  log: string
  status: string
}): string {
  return [
    "# Pre-Compact Snapshot",
    "",
    `**Timestamp**: ${new Date().toISOString()}`,
    "",
    "## In-Progress Tasks",
    "```",
    data.tasks,
    "```",
    "",
    "## Recent Commits",
    "```",
    data.log,
    "```",
    "",
    "## Working Tree",
    "```",
    data.status,
    "```",
  ].join("\n")
}

let lastSnapshotTime = 0
const SNAPSHOT_COOLDOWN_MS = 60_000

export const pelleyHooks: Plugin = async ({ $, directory, client }) => {
  return {
    "tool.execute.before": async (input, output) => {
      // Skill guard: advisory tool restriction logging
      if (skillStack.length > 0) {
        const current = skillStack[skillStack.length - 1]
        if (
          current.allowedTools.length > 0 &&
          !current.allowedTools.includes(input.tool)
        ) {
          await client.app.log({
            body: {
              service: "skill-guard",
              level: "warn",
              message: `Skill "${current.name}" advises against tool "${input.tool}". Allowed: ${current.allowedTools.join(", ")}`,
            },
          })
        }
      }

      if (input.tool !== "bash") return

      const cmd = String(output.args?.command ?? "")

      // Block destructive commands
      for (const pattern of DESTRUCTIVE_PATTERNS) {
        if (pattern.test(cmd)) {
          throw new Error(
            `Blocked destructive command: ${cmd}\n` +
              "Use explicit user confirmation before running destructive operations.",
          )
        }
      }

      // Block direct .beads/ access (use bd CLI instead)
      if (BEADS_DIRECT_ACCESS.test(cmd)) {
        throw new Error(
          `Direct .beads/ access blocked: ${cmd}\n` +
            "Access .beads/ only through the bd CLI.",
        )
      }

      // Warn on git push if beads state may be uncommitted
      if (PUSH_PATTERN.test(cmd) && existsSync(join(directory, ".beads"))) {
        try {
          const status =
            await $`bd sync --status 2>/dev/null || echo ""`.text()
          if (status.trim()) {
            throw new Error(
              "Run `bd sync --flush-only` before pushing to ensure beads state is saved.\n" +
                `Beads status: ${status.trim()}`,
            )
          }
        } catch (err) {
          if (err instanceof Error && err.message.startsWith("Run `bd sync")) {
            throw err
          }
          await client.app.log({
            body: {
              service: "pelley-hooks",
              level: "warn",
              message: "Failed to check beads sync status before push",
              extra: { error: String(err) },
            },
          })
        }
      }
    },

    // Pre-compaction: inject context so compacted sessions retain task state
    "experimental.session.compacting": async (_input, output) => {
      try {
        const data = await buildSnapshot($, directory)
        const context = formatCompactionContext(data)

        if (
          output &&
          typeof output === "object" &&
          "context" in output &&
          output.context &&
          typeof (output as any).context.push === "function"
        ) {
          ;(output as { context: { push: (s: string) => void } }).context.push(
            context,
          )
        } else {
          await client.app.log({
            body: {
              service: "pelley-hooks",
              level: "warn",
              message:
                "Compaction output missing expected context.push() method",
              extra: { outputKeys: output ? Object.keys(output) : [] },
            },
          })
        }
      } catch (err) {
        await client.app.log({
          body: {
            service: "pelley-hooks",
            level: "warn",
            message: "Failed to inject pre-compaction context",
            extra: { error: String(err) },
          },
        })
      }
    },

    // Session idle: snapshot state to memory/sessions/
    "session.idle": async () => {
      const now = Date.now()
      if (now - lastSnapshotTime < SNAPSHOT_COOLDOWN_MS) return
      lastSnapshotTime = now

      try {
        const sessionsDir = join(directory, "memory/sessions")
        await mkdir(sessionsDir, { recursive: true })

        const snapshotPath = join(sessionsDir, "pre-compact.md")
        const data = await buildSnapshot($, directory)
        const snapshot = formatIdleSnapshot(data)

        await writeFile(snapshotPath, snapshot, "utf-8")
      } catch (err) {
        await client.app.log({
          body: {
            service: "pelley-hooks",
            level: "warn",
            message: "Failed to write idle snapshot",
            extra: { error: String(err) },
          },
        })
      }
    },
  }
}

export default pelleyHooks
