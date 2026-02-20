import { usePluginRegistry } from '~~/server/services/plugin-registry'

export default defineEventHandler((event) => {
  const id = getRouterParam(event, 'id')

  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Missing plugin id' })
  }

  const registry = usePluginRegistry()
  const entry = registry.getEntry(id)

  if (!entry) {
    throw createError({ statusCode: 404, statusMessage: `Plugin '${id}' not found` })
  }

  return {
    ...entry.manifest,
    enabled: entry.enabled,
    layerPath: entry.layerPath,
  }
})
