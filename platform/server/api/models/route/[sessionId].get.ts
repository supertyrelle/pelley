import { useModelRegistry } from '~~/server/services/model-registry'

export default defineEventHandler(async (event) => {
  const sessionId = getRouterParam(event, 'sessionId')

  if (!sessionId) {
    throw createError({ statusCode: 400, statusMessage: 'Missing sessionId' })
  }

  const registry = useModelRegistry()
  const route = registry.getRouteForInstance(sessionId)

  if (!route) {
    // No explicit route set -- return the default
    return { sessionId, route: registry.getDefaultRoute(), isDefault: true }
  }

  return { sessionId, route, isDefault: false }
})
