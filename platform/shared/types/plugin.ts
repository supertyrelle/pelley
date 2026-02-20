// ---------------------------------------------------------------------------
// Plugin System Types
// ---------------------------------------------------------------------------

export interface PluginManifest {
  id: string
  name: string
  description: string
  version: string
  author?: string
  icon?: string               // Lucide icon name
  type: 'visual' | 'service'  // visual = has UI, service = background only
  modelConfig?: {
    defaultProvider?: string
    defaultModel?: string
    systemPrompt?: string
  }
  entryComponent?: string     // component name for visual plugins
}

export interface PluginContext {
  // Available to plugin server routes and components
  beads: {
    list: () => Promise<import('./bead').Bead[]>
    create: (opts: {
      title: string
      type: string
      priority?: string
      parent?: string
      description?: string
    }) => Promise<import('./bead').Bead>
    show: (id: string) => Promise<import('./bead').Bead>
  }
  models: {
    /**
     * Create an AI SDK LanguageModel for the given route config.
     * Returns LanguageModelV3 | LanguageModelV2 at runtime -- typed as unknown
     * here to keep shared types free of server-only @ai-sdk/provider imports.
     * Plugin server code can cast: `const model = ctx.models.createLanguageModel(route) as LanguageModelV3`
     */
    createLanguageModel: (route: import('./model').ModelRouteConfig) => unknown
    getDefaultRoute: () => import('./model').ModelRouteConfig
  }
  context: {
    getScope: (sessionId: string) => 'shared' | 'isolated'
    getVisibleBeads: (sessionId: string) => Promise<import('./bead').Bead[]>
  }
}

/** Internal registry entry: manifest + filesystem location + enabled state. */
export interface PluginEntry {
  manifest: PluginManifest
  layerPath: string
  enabled: boolean
}
