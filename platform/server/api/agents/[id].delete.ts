import { useAgentRegistry } from '~~/server/services/agent-registry'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')

  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Missing agent id' })
  }

  const registry = useAgentRegistry()
  await registry.init()

  const removed = await registry.remove(id)
  if (!removed) {
    throw createError({
      statusCode: 404,
      statusMessage: `Agent '${id}' not found or is a built-in agent`,
    })
  }

  return { removed: true, id }
})
