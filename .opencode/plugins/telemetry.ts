import type { Plugin } from "@opencode-ai/plugin"

export const telemetry: Plugin = async ({ project, client }) => {
  return {
    "tool.execute.after": async (input) => {
      if (!input.tool.startsWith("skills_") && input.tool !== "skill") return
      await client.app.log({
        body: {
          service: "pelley-telemetry",
          level: "info",
          message: `Skill executed: ${input.tool}`,
          extra: {
            skill: input.tool.startsWith("skills_")
              ? input.tool.replace("skills_", "")
              : (input.args?.name ?? "unknown"),
            project: project?.name ?? "unknown",
          },
        },
      })
    },
  }
}

export default telemetry
