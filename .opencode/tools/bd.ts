import { tool } from "@opencode-ai/plugin"
import { execFile } from "child_process"
import { promisify } from "util"

const exec = promisify(execFile)

export default tool({
  description: "Run a beads (bd) CLI command for task management — status updates, queries, and coordination.",
  args: {
    command: tool.schema.string().describe("bd subcommand (e.g. update, show, ready, list, close)"),
    args: tool.schema.string().array().optional().describe("Additional arguments for the command"),
  },
  async execute(args) {
    const { stdout } = await exec("bd", [args.command, ...(args.args ?? [])])
    return stdout.trim()
  },
})
