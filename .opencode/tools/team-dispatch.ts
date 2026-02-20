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

async function runAgent(
  assignment: { agent: string; task: string; taskId?: string },
  directory: string,
) {
  const agent = await parseAgent(assignment.agent, directory)
  const systemPrompt = `${agent.body}\n\nYou are the ${agent.name} agent. ${agent.description}`

  if (assignment.taskId) {
    await bd("update", assignment.taskId, "--status=in_progress")
  }

  const session = await client.session.create()
  try {
    await client.session.init(session.id, {
      prompt: systemPrompt,
    })

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 600_000)
    let response
    try {
      response = await client.session.chat(
        session.id,
        {
          parts: [
            {
              type: "text",
              text: `Task: ${assignment.task}`,
            },
          ],
        },
        { timeout: 300_000, signal: controller.signal },
      )
    } finally {
      clearTimeout(timeout)
    }

    const output = response.parts
      .filter((p: { type: string }) => p.type === "text")
      .map((p: { text: string }) => p.text)
      .join("\n")

    if (assignment.taskId) {
      await bd("comment", assignment.taskId, `--body=${output.slice(0, 2000)}`)
      await bd("close", assignment.taskId)
    }

    return { agent: assignment.agent, status: "ok" as const, output }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (assignment.taskId) {
      await bd("comment", assignment.taskId, `--body=Agent error: ${message}`)
    }
    return {
      agent: assignment.agent,
      status: "error" as const,
      output: message,
    }
  } finally {
    await client.session.delete(session.id)
  }
}

export default tool({
  description:
    "Dispatch tasks to multiple agents in parallel. Each agent runs in its own SDK session. Results are collected and returned together.",
  args: {
    assignments: tool.schema
      .object({
        agent: tool.schema.string(),
        task: tool.schema.string(),
        taskId: tool.schema.string().optional(),
      })
      .array()
      .describe(
        "Array of { agent, task, taskId? } assignments to run concurrently",
      ),
  },
  async execute(args, context) {
    const results = await Promise.allSettled(
      args.assignments.map((a) => runAgent(a, context.directory)),
    )

    return results
      .map((r, i) => {
        const name = args.assignments[i].agent
        if (r.status === "fulfilled") {
          const tag = r.value.status === "ok" ? "" : " [ERROR]"
          return `## ${name}${tag}\n\n${r.value.output}`
        }
        return `## ${name} [FAILED]\n\n${r.reason}`
      })
      .join("\n\n---\n\n")
  },
})
