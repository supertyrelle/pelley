import { useModelRegistry } from '~~/server/services/model-registry'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const providerId = query.provider as string | undefined

  const registry = useModelRegistry()

  // If asking for Ollama models, discover them dynamically first
  if (!providerId || providerId === 'ollama') {
    await registry.discoverOllamaModels()
  }

  return registry.listModels(providerId)
})
