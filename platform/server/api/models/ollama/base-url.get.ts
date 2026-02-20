import { useModelRegistry } from '~~/server/services/model-registry'

export default defineEventHandler(() => {
  const registry = useModelRegistry()
  return { url: registry.getOllamaBaseUrl() }
})
