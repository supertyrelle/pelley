import { useModelRegistry } from '~~/server/services/model-registry'

export default defineEventHandler(async () => {
  const registry = useModelRegistry()
  const providers = await registry.getAvailableProviders()

  // Return all providers, but mark which ones are available
  const all = registry.getProviders().map((p) => ({
    ...p,
    isAvailable: providers.some((a) => a.id === p.id),
  }))

  return all
})
