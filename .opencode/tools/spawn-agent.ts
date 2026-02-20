import { tool } from "@opencode-ai/plugin"
import { client } from "./client"
import { readFile } from "fs/promises"
import { parse as parseYaml } from "yaml"
import { execFile } from "child_process"
import { promisify } from "util"

const exec = promisify(execFile)

async function parseAgent(name: string, directory: string) {
  const raw = await readFile(`${directory}/agents/${name}.md`, "utf-8")
  const [, frontmatter, ...rest] = raw.split("---")
  const meta = parseYaml(frontmatter)
  return { ...meta, body: rest.join("---").trim() }
}

async function bd(...args: string[]) {
  const { stdout } = await exec("bd", args)
  return stdout.trim()
}

export default tool({
  description:
    "Spawn an agent by reading its .md definition, creating an SDK session with its system prompt, executing a task, and recording the result in beads.",
  args: {
    agent: tool.schema
      .string()
      .describe("Agent name matching agents/<name>.md"),
    task: tool.schema.string().describe("Task description to assign"),
    taskId: tool.schema
      .string()
      .optional()
      .describe("Beads task ID to update with progress and results"),
  },
  async execute(args, context) {
    const agent = await parseAgent(args.agent, context.directory)
    const systemPrompt = `${agent.body}\n\nYou are the ${agent.name} agent. ${agent.description}`

    if (args.taskId) {
      await bd("update", args.taskId, "--status=in_progress")
    }

    const session = await client.session.create()
    try {
      await client.session.init(session.id, {
        prompt: systemPrompt,
      })

      const response = await client.session.chat(
        session.id,
        {
          parts: [
            {
              type: "text",
              text: `Task: ${args.task}`,
            },
          ],
        },
        { timeout: 300_000 },
      )

      const output = response.parts
        .filter((p: { type: string }) => p.type === "text")
        .map((p: { text: string }) => p.text)
        .join("\n")

      if (args.taskId) {
        await bd("comment", args.taskId, `--body=${output.slice(0, 2000)}`)
        await bd("close", args.taskId)
      }

      return output
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (args.taskId) {
        await bd("comment", args.taskId, `--body=Agent error: ${message}`)
      }
      throw err
    } finally {
      await client.session.delete(session.id)
    }
  },
})
