import { useModelRegistry } from '~~/server/services/model-registry'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ url?: string }>(event)

  if (!body.url || typeof body.url !== 'string') {
    throw createError({ statusCode: 400, message: 'Missing required field: url' })
  }

  const registry = useModelRegistry()
  registry.setOllamaBaseUrl(body.url)

  return { url: registry.getOllamaBaseUrl() }
})
