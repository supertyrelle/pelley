import { useAgentRegistry } from '~~/server/services/agent-registry'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')

  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Missing agent id' })
  }

  const registry = useAgentRegistry()
  await registry.init()

  const agent = registry.get(id)
  if (!agent) {
    throw createError({ statusCode: 404, statusMessage: `Agent '${id}' not found` })
  }

  return agent
})
