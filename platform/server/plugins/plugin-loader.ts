import { join } from 'node:path'
import { usePluginRegistry } from '../services/plugin-registry'

export default defineNitroPlugin(async () => {
  const pluginsDir = join(process.cwd(), 'plugins')
  const registry = usePluginRegistry()

  console.log('[plugins] Scanning for plugins...')

  try {
    await registry.init(pluginsDir)
    const plugins = registry.list()
    console.log(`[plugins] Loaded ${plugins.length} plugin(s).`)
  }
  catch (err) {
    console.error('[plugins] Failed to load plugins:', err)
    // Non-fatal -- the platform works without plugins
  }
})
