import { useAgentRegistry } from '~~/server/services/agent-registry'

export default defineEventHandler(async () => {
  const registry = useAgentRegistry()
  await registry.init()
  return registry.detect()
})
