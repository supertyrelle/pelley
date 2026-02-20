import type { Plugin } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin"
import { setClient, client } from "./client"
import { readFile, readdir } from "fs/promises"
import { parse as parseYaml } from "yaml"
import { pushSkill, popSkill } from "../lib-skill-guard"

async function parseSkill(name: string, directory: string) {
  const raw = await readFile(`${directory}/skills/${name}/SKILL.md`, "utf-8")
  const [, frontmatter, ...rest] = raw.split("---")
  const meta = parseYaml(frontmatter)
  return { ...meta, body: rest.join("---").trim() }
}

// Session pool for fork-context skills — reuse sessions via revert
const sessionPool: Map<string, string> = new Map()

async function getOrCreateSession(skillName: string): Promise<string> {
  const existing = sessionPool.get(skillName)
  if (existing) return existing
  const session = await client.session.create()
  sessionPool.set(skillName, session.id)
  return session.id
}

const SkillsPlugin: Plugin = async (ctx) => {
  // Initialize the shared client from plugin context so tools don't need
  // to import @opencode-ai/sdk directly (its exports map is broken in v1.2.9).
  setClient(ctx.client)

  let skillDirs: string[]
  try {
    skillDirs = await readdir(`${ctx.directory}/skills`)
  } catch {
    skillDirs = []
  }

  const tools: Record<string, ReturnType<typeof tool>> = {}

  for (const name of skillDirs) {
    // Capture name in closure
    const skillName = name

    // Parse frontmatter at registration time so description is available for tool discovery
    let skillMeta: Record<string, unknown>
    try {
      skillMeta = await parseSkill(skillName, ctx.directory)
    } catch {
      // Skip skills that fail to parse
      continue
    }

    const description =
      (skillMeta.description as string) ??
      `Run the "${skillName}" skill from skills/${skillName}/SKILL.md`

    const argHint = skillMeta["argument-hint"] as string | undefined
    const argDescription = argHint
      ? `Arguments to pass to the skill (hint: ${argHint})`
      : "Arguments to inject into the skill prompt"

    tools[`skills_${skillName}`] = tool({
      description,
      args: {
        arguments: tool.schema
          .string()
          .optional()
          .describe(argDescription),
      },
      async execute(args, toolCtx) {
        const skill = await parseSkill(skillName, toolCtx.directory)
        const prompt = skill.body.replaceAll(
          "$ARGUMENTS",
          args.arguments ?? "",
        )

        pushSkill(skillName, skill["allowed-tools"] ?? [])
        try {
          if (skill.context === "fork") {
            const sessionId = await getOrCreateSession(skillName)
            try {
              const response = await client.session.chat(
                sessionId,
                {
                  parts: [{ type: "text", text: prompt }],
                },
                { timeout: 300_000 },
              )
              const output = response.parts
                .filter((p: { type: string }) => p.type === "text")
                .map((p: { text: string }) => p.text)
                .join("\n")
              // Revert session for reuse instead of deleting
              try {
                await client.session.revert(sessionId, {
                  messageID: response.id,
                })
              } catch {
                // Revert failed — drop from pool so next call creates fresh
                sessionPool.delete(skillName)
              }
              return output
            } catch (err) {
              // On error, remove from pool
              sessionPool.delete(skillName)
              throw err
            }
          }

          // Inline mode: inject prompt via noReply
          await client.session.prompt({
            path: { id: toolCtx.sessionID },
            body: {
              noReply: true,
              parts: [{ type: "text", text: prompt }],
            },
          })
          return `Skill "${skillName}" loaded into context.`
        } finally {
          popSkill()
        }
      },
    })
  }

  return { tool: tools }
}

export default SkillsPlugin
