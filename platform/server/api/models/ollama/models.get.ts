import { useModelRegistry } from '~~/server/services/model-registry'

export default defineEventHandler(async () => {
  const registry = useModelRegistry()
  const models = await registry.discoverOllamaModels()

  return models
})
