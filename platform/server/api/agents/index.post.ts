import type { AgentConfig } from '~~/shared/types/agent'
import { useAgentRegistry } from '~~/server/services/agent-registry'

export default defineEventHandler(async (event) => {
  const body = await readBody<AgentConfig>(event)

  if (!body.id || !body.name || !body.command || !body.instanceType) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Missing required fields: id, name, command, instanceType',
    })
  }

  const config: AgentConfig = {
    id: body.id,
    name: body.name,
    command: body.command,
    args: body.args ?? [],
    resumeArgs: body.resumeArgs,
    instanceType: body.instanceType,
    modelConfig: body.modelConfig,
  }

  const registry = useAgentRegistry()
  await registry.init()
  await registry.register(config)

  return config
})
