import { useModelRegistry } from '~~/server/services/model-registry'

export default defineEventHandler(async () => {
  const registry = useModelRegistry()
  const running = await registry.isOllamaRunning()

  return { running }
})
