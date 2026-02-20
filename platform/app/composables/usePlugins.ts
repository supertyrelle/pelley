import type { PluginManifest } from '~~/shared/types/plugin'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PluginListItem extends PluginManifest {
  enabled: boolean
}

// ---------------------------------------------------------------------------
// Composable
// ---------------------------------------------------------------------------

/**
 * Client-side composable for querying and managing plugins.
 *
 * Usage:
 * ```ts
 * const { plugins, refresh, getPlugin, isEnabled } = usePlugins()
 * ```
 */
export function usePlugins() {
  const plugins = useState<PluginListItem[]>('plugins-list', () => [])
  const loading = ref(false)
  const error = ref<string | null>(null)

  // -----------------------------------------------------------------------
  // Fetch
  // -----------------------------------------------------------------------

  async function refresh(): Promise<void> {
    loading.value = true
    error.value = null

    try {
      const data = await $fetch<PluginListItem[]>('/api/plugins')
      plugins.value = data
    }
    catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to load plugins'
      error.value = message
      console.error('[usePlugins] Refresh failed:', message)
    }
    finally {
      loading.value = false
    }
  }

  // -----------------------------------------------------------------------
  // Queries
  // -----------------------------------------------------------------------

  function getPlugin(id: string): PluginListItem | undefined {
    return plugins.value.find(p => p.id === id)
  }

  function isEnabled(id: string): boolean {
    return plugins.value.find(p => p.id === id)?.enabled ?? false
  }

  /** Return only visual plugins that are enabled. */
  function getVisualPlugins(): PluginListItem[] {
    return plugins.value.filter(p => p.type === 'visual' && p.enabled)
  }

  // -----------------------------------------------------------------------
  // Actions
  // -----------------------------------------------------------------------

  async function enablePlugin(id: string): Promise<void> {
    try {
      await $fetch(`/api/plugins/${id}/enable`, { method: 'POST' })
      await refresh()
    }
    catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to enable plugin'
      error.value = message
      throw err
    }
  }

  async function disablePlugin(id: string): Promise<void> {
    try {
      await $fetch(`/api/plugins/${id}/disable`, { method: 'POST' })
      await refresh()
    }
    catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to disable plugin'
      error.value = message
      throw err
    }
  }

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  // Fetch on first use (client-side only)
  if (import.meta.client) {
    onMounted(() => {
      if (plugins.value.length === 0) {
        refresh()
      }
    })
  }

  return {
    plugins: readonly(plugins),
    loading: readonly(loading),
    error: readonly(error),
    refresh,
    getPlugin,
    isEnabled,
    getVisualPlugins,
    enablePlugin,
    disablePlugin,
  }
}
