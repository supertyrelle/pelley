import { usePluginRegistry } from '~~/server/services/plugin-registry'

export default defineEventHandler(() => {
  const registry = usePluginRegistry()

  return registry.listEntries().map(entry => ({
    ...entry.manifest,
    enabled: entry.enabled,
  }))
})
