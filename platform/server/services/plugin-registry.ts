import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import type {
  PluginManifest,
  PluginContext,
  PluginEntry,
} from '~~/shared/types/plugin'
import { useBeadsClient } from './beads-client'
import { useModelRegistry } from './model-registry'
import { useContextManager } from './context-manager'

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

const DATA_DIR = join(process.cwd(), '.data')
const ENABLED_FILE = join(DATA_DIR, 'plugins-enabled.json')

async function ensureDataDir(): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true })
}

async function loadEnabledState(): Promise<Record<string, boolean>> {
  try {
    const raw = await fs.readFile(ENABLED_FILE, 'utf-8')
    return JSON.parse(raw) as Record<string, boolean>
  }
  catch {
    return {}
  }
}

async function saveEnabledState(state: Record<string, boolean>): Promise<void> {
  await ensureDataDir()
  await fs.writeFile(ENABLED_FILE, JSON.stringify(state, null, 2), 'utf-8')
}

// ---------------------------------------------------------------------------
// PluginRegistry
// ---------------------------------------------------------------------------

export class PluginRegistry {
  private plugins = new Map<string, PluginEntry>()
  private initialized = false

  // -----------------------------------------------------------------------
  // Registration
  // -----------------------------------------------------------------------

  /** Register a plugin from its manifest and filesystem path. */
  register(manifest: PluginManifest, layerPath: string): void {
    const existing = this.plugins.get(manifest.id)
    this.plugins.set(manifest.id, {
      manifest,
      layerPath,
      enabled: existing?.enabled ?? true, // default to enabled for new plugins
    })
  }

  /** Unregister a plugin by ID. */
  unregister(id: string): void {
    this.plugins.delete(id)
  }

  // -----------------------------------------------------------------------
  // Queries
  // -----------------------------------------------------------------------

  /** Get a plugin manifest by ID, or undefined if not registered. */
  get(id: string): PluginManifest | undefined {
    return this.plugins.get(id)?.manifest
  }

  /** Get the full entry (manifest + path + enabled state) for a plugin. */
  getEntry(id: string): PluginEntry | undefined {
    return this.plugins.get(id)
  }

  /** List all registered plugin manifests. */
  list(): PluginManifest[] {
    return Array.from(this.plugins.values()).map(e => e.manifest)
  }

  /** List all registered entries (includes enabled state). */
  listEntries(): PluginEntry[] {
    return Array.from(this.plugins.values())
  }

  /** Check whether a plugin is enabled. Unregistered plugins return false. */
  isEnabled(id: string): boolean {
    return this.plugins.get(id)?.enabled ?? false
  }

  // -----------------------------------------------------------------------
  // Enable / disable
  // -----------------------------------------------------------------------

  /** Enable a plugin. Persists to disk. Returns false if plugin not found. */
  async enable(id: string): Promise<boolean> {
    const entry = this.plugins.get(id)
    if (!entry) return false
    entry.enabled = true
    await this.persistEnabledState()
    return true
  }

  /** Disable a plugin. Persists to disk. Returns false if plugin not found. */
  async disable(id: string): Promise<boolean> {
    const entry = this.plugins.get(id)
    if (!entry) return false
    entry.enabled = false
    await this.persistEnabledState()
    return true
  }

  // -----------------------------------------------------------------------
  // Plugin context (shared API surface)
  // -----------------------------------------------------------------------

  /** Create the shared PluginContext object that plugins can use. */
  getPluginContext(): PluginContext {
    const beadsClient = useBeadsClient()
    const modelRegistry = useModelRegistry()
    const contextManager = useContextManager()

    return {
      beads: {
        list: () => beadsClient.list(),
        create: (opts) => beadsClient.create(opts),
        show: (id) => beadsClient.show(id),
      },
      models: {
        createLanguageModel: (route) => modelRegistry.createLanguageModel(route),
        getDefaultRoute: () => modelRegistry.getDefaultRoute(),
      },
      context: {
        getScope: (sessionId) => contextManager.getScope(sessionId),
        getVisibleBeads: (sessionId) => contextManager.getVisibleBeads(sessionId),
      },
    }
  }

  // -----------------------------------------------------------------------
  // Scanning
  // -----------------------------------------------------------------------

  /**
   * Scan the plugins/ directory for plugin.json manifests.
   * Each subdirectory of pluginsDir is expected to contain a plugin.json file.
   */
  async scanPlugins(pluginsDir: string): Promise<void> {
    try {
      const entries = await fs.readdir(pluginsDir, { withFileTypes: true })

      for (const entry of entries) {
        if (!entry.isDirectory()) continue

        const pluginDir = join(pluginsDir, entry.name)
        const manifestPath = join(pluginDir, 'plugin.json')

        try {
          const raw = await fs.readFile(manifestPath, 'utf-8')
          const manifest = JSON.parse(raw) as PluginManifest

          // Validate required fields
          if (!manifest.id || !manifest.name || !manifest.version || !manifest.type) {
            console.warn(`[plugins] Skipping ${entry.name}: missing required manifest fields`)
            continue
          }

          this.register(manifest, pluginDir)
          console.log(`[plugins] Registered plugin: ${manifest.name} (${manifest.id})`)
        }
        catch {
          // No plugin.json or invalid JSON -- skip silently
        }
      }
    }
    catch {
      // plugins/ directory doesn't exist -- that's fine
    }
  }

  /**
   * Initialize: scan plugins directory and restore enabled/disabled state.
   * Safe to call multiple times; only runs once.
   */
  async init(pluginsDir: string): Promise<void> {
    if (this.initialized) return

    await this.scanPlugins(pluginsDir)

    // Restore persisted enabled state
    const enabledState = await loadEnabledState()
    for (const [id, enabled] of Object.entries(enabledState)) {
      const entry = this.plugins.get(id)
      if (entry) {
        entry.enabled = enabled
      }
    }

    this.initialized = true
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  private async persistEnabledState(): Promise<void> {
    const state: Record<string, boolean> = {}
    for (const [id, entry] of this.plugins) {
      state[id] = entry.enabled
    }
    await saveEnabledState(state)
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let _instance: PluginRegistry | undefined

export function usePluginRegistry(): PluginRegistry {
  if (!_instance) {
    _instance = new PluginRegistry()
  }
  return _instance
}
