import { useModelRegistry } from '~~/server/services/model-registry'

export default defineEventHandler(() => {
  const registry = useModelRegistry()
  const state = registry.getLocalServer()
  return state ?? { url: null, models: [], running: false }
})
