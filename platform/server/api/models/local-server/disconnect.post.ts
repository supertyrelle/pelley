import { useModelRegistry } from '~~/server/services/model-registry'

export default defineEventHandler(() => {
  const registry = useModelRegistry()
  registry.disconnectLocalServer()
  return { ok: true }
})
