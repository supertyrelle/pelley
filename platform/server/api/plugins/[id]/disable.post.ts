import { usePluginRegistry } from '~~/server/services/plugin-registry'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')

  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Missing plugin id' })
  }

  const registry = usePluginRegistry()
  const success = await registry.disable(id)

  if (!success) {
    throw createError({ statusCode: 404, statusMessage: `Plugin '${id}' not found` })
  }

  return { id, enabled: false }
})
