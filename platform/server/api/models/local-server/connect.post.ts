import { useModelRegistry } from '~~/server/services/model-registry'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ url?: string }>(event)

  if (!body.url || typeof body.url !== 'string') {
    throw createError({ statusCode: 400, message: 'Missing required field: url' })
  }

  const registry = useModelRegistry()

  try {
    const state = await registry.connectLocalServer(body.url)
    return state
  } catch (err) {
    throw createError({
      statusCode: 502,
      message: `Failed to connect: ${err instanceof Error ? err.message : 'unknown error'}`,
    })
  }
})
