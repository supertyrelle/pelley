import type { ModelRouteConfig } from '~~/shared/types/model'
import { useModelRegistry } from '~~/server/services/model-registry'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ sessionId?: string; route?: ModelRouteConfig }>(event)

  if (!body.sessionId) {
    throw createError({ statusCode: 400, message: 'Missing required field: sessionId' })
  }

  if (!body.route || !body.route.provider || !body.route.model) {
    throw createError({ statusCode: 400, message: 'Missing required field: route (with provider and model)' })
  }

  const registry = useModelRegistry()

  // Validate the provider exists
  const provider = registry.getProvider(body.route.provider)
  if (!provider) {
    throw createError({ statusCode: 400, message: `Unknown provider: ${body.route.provider}` })
  }

  registry.setRouteForInstance(body.sessionId, body.route)

  return { sessionId: body.sessionId, route: body.route }
})
