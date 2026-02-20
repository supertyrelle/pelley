import { createOpenAI } from '@ai-sdk/openai'
import { createAnthropic } from '@ai-sdk/anthropic'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createOllama } from 'ollama-ai-provider'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import type { LanguageModelV3, LanguageModelV2 } from '@ai-sdk/provider'
import type {
  ModelProvider,
  ModelDefinition,
  ModelRouteConfig,
  PullProgress,
  OllamaTagsResponse,
} from '~~/shared/types/model'

// ---------------------------------------------------------------------------
// Persisted config schema
// ---------------------------------------------------------------------------

interface PersistedModelConfig {
  ollamaBaseUrl?: string
  localServer?: {
    url: string
  }
  defaultProvider?: string
  instanceRoutes?: Record<string, { provider: string; model: string }>
}

// ---------------------------------------------------------------------------
// Built-in provider definitions
// ---------------------------------------------------------------------------

const DEFAULT_OLLAMA_BASE_URL = 'http://localhost:11434'
let ollamaBaseUrl = DEFAULT_OLLAMA_BASE_URL

// ---------------------------------------------------------------------------
// Local server (OpenAI-compatible) state
// ---------------------------------------------------------------------------

interface LocalServerState {
  url: string
  models: ModelDefinition[]
  running: boolean
}

let localServer: LocalServerState | null = null

function builtinProviders(): ModelProvider[] {
  return [
    {
      id: 'openai',
      name: 'OpenAI',
      type: 'cloud',
      apiKeyEnvVar: 'OPENAI_API_KEY',
      models: [
        { id: 'gpt-4o', name: 'GPT-4o', provider: 'openai', contextWindow: 128_000, supportsTools: true, supportsStreaming: true },
        { id: 'gpt-4o-mini', name: 'GPT-4o Mini', provider: 'openai', contextWindow: 128_000, supportsTools: true, supportsStreaming: true },
        { id: 'gpt-4.1', name: 'GPT-4.1', provider: 'openai', contextWindow: 1_047_576, supportsTools: true, supportsStreaming: true },
        { id: 'gpt-4.1-mini', name: 'GPT-4.1 Mini', provider: 'openai', contextWindow: 1_047_576, supportsTools: true, supportsStreaming: true },
        { id: 'gpt-4.1-nano', name: 'GPT-4.1 Nano', provider: 'openai', contextWindow: 1_047_576, supportsTools: true, supportsStreaming: true },
        { id: 'o3', name: 'o3', provider: 'openai', contextWindow: 200_000, supportsTools: true, supportsStreaming: true },
        { id: 'o4-mini', name: 'o4-mini', provider: 'openai', contextWindow: 200_000, supportsTools: true, supportsStreaming: true },
      ],
      isAvailable: false,
    },
    {
      id: 'anthropic',
      name: 'Anthropic',
      type: 'cloud',
      apiKeyEnvVar: 'ANTHROPIC_API_KEY',
      models: [
        { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4', provider: 'anthropic', contextWindow: 200_000, supportsTools: true, supportsStreaming: true },
        { id: 'claude-opus-4-20250514', name: 'Claude Opus 4', provider: 'anthropic', contextWindow: 200_000, supportsTools: true, supportsStreaming: true },
        { id: 'claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku', provider: 'anthropic', contextWindow: 200_000, supportsTools: true, supportsStreaming: true },
      ],
      isAvailable: false,
    },
    {
      id: 'google',
      name: 'Google',
      type: 'cloud',
      apiKeyEnvVar: 'GOOGLE_GENERATIVE_AI_API_KEY',
      models: [
        { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', provider: 'google', contextWindow: 1_048_576, supportsTools: true, supportsStreaming: true },
        { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', provider: 'google', contextWindow: 1_048_576, supportsTools: true, supportsStreaming: true },
        { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash', provider: 'google', contextWindow: 1_048_576, supportsTools: true, supportsStreaming: true },
      ],
      isAvailable: false,
    },
    {
      id: 'ollama',
      name: 'Ollama',
      type: 'local',
      defaultBaseUrl: DEFAULT_OLLAMA_BASE_URL,
      models: [], // populated dynamically via discoverOllamaModels()
      isAvailable: false,
    },
    {
      id: 'kimi',
      name: 'Kimi (Moonshot)',
      type: 'cloud',
      apiKeyEnvVar: 'MOONSHOT_API_KEY',
      defaultBaseUrl: 'https://api.moonshot.cn/v1',
      models: [
        { id: 'moonshot-v1-8k', name: 'Moonshot v1 8K', provider: 'kimi', contextWindow: 8_000, supportsTools: true, supportsStreaming: true },
        { id: 'moonshot-v1-32k', name: 'Moonshot v1 32K', provider: 'kimi', contextWindow: 32_000, supportsTools: true, supportsStreaming: true },
        { id: 'moonshot-v1-128k', name: 'Moonshot v1 128K', provider: 'kimi', contextWindow: 128_000, supportsTools: true, supportsStreaming: true },
      ],
      isAvailable: false,
    },
    {
      id: 'mistral',
      name: 'Mistral',
      type: 'cloud',
      apiKeyEnvVar: 'MISTRAL_API_KEY',
      defaultBaseUrl: 'https://api.mistral.ai/v1',
      models: [
        { id: 'mistral-large-latest', name: 'Mistral Large', provider: 'mistral', contextWindow: 128_000, supportsTools: true, supportsStreaming: true },
        { id: 'mistral-medium-latest', name: 'Mistral Medium', provider: 'mistral', contextWindow: 128_000, supportsTools: true, supportsStreaming: true },
        { id: 'mistral-small-latest', name: 'Mistral Small', provider: 'mistral', contextWindow: 128_000, supportsTools: true, supportsStreaming: true },
        { id: 'codestral-latest', name: 'Codestral', provider: 'mistral', contextWindow: 256_000, supportsTools: true, supportsStreaming: true },
      ],
      isAvailable: false,
    },
    {
      id: 'groq',
      name: 'Groq',
      type: 'cloud',
      apiKeyEnvVar: 'GROQ_API_KEY',
      defaultBaseUrl: 'https://api.groq.com/openai/v1',
      models: [
        { id: 'llama-3.3-70b-versatile', name: 'Llama 3.3 70B', provider: 'groq', contextWindow: 128_000, supportsTools: true, supportsStreaming: true },
        { id: 'llama-3.1-8b-instant', name: 'Llama 3.1 8B', provider: 'groq', contextWindow: 128_000, supportsTools: true, supportsStreaming: true },
        { id: 'mixtral-8x7b-32768', name: 'Mixtral 8x7B', provider: 'groq', contextWindow: 32_768, supportsTools: true, supportsStreaming: true },
      ],
      isAvailable: false,
    },
  ]
}

// ---------------------------------------------------------------------------
// ModelRegistry
// ---------------------------------------------------------------------------

export class ModelRegistry {
  private providers: Map<string, ModelProvider> = new Map()
  private instanceRoutes: Map<string, ModelRouteConfig> = new Map()
  private configPath: string
  private autoReconnectAttempted: boolean = false

  constructor() {
    // Model config is global — provider connections, API keys, and server URLs
    // are shared across all projects. Only agent CWD changes per project.
    this.configPath = join(process.cwd(), '.data', 'models.json')

    for (const provider of builtinProviders()) {
      this.providers.set(provider.id, provider)
    }

    this.loadConfig()
  }

  // -------------------------------------------------------------------------
  // Config persistence
  // -------------------------------------------------------------------------

  /**
   * Load persisted config from disk and apply to in-memory state.
   * Gracefully handles missing file or malformed JSON (uses defaults).
   */
  private loadConfig(): void {
    try {
      if (!existsSync(this.configPath)) return

      const raw = readFileSync(this.configPath, 'utf-8')
      const config: PersistedModelConfig = JSON.parse(raw)

      if (config.ollamaBaseUrl && typeof config.ollamaBaseUrl === 'string') {
        ollamaBaseUrl = config.ollamaBaseUrl
      }

      if (config.localServer?.url && typeof config.localServer.url === 'string') {
        // Restore the local server URL but mark as not running --
        // actual connectivity will be verified on first use or explicit connect
        localServer = { url: config.localServer.url, models: [], running: false }
        this.providers.set('local-server', {
          id: 'local-server',
          name: 'Local Server',
          type: 'local',
          defaultBaseUrl: config.localServer.url,
          models: [],
          isAvailable: false,
        })
      }

      if (config.instanceRoutes && typeof config.instanceRoutes === 'object') {
        for (const [sessionId, route] of Object.entries(config.instanceRoutes)) {
          if (route.provider && route.model) {
            this.instanceRoutes.set(sessionId, {
              provider: route.provider,
              model: route.model,
            })
          }
        }
      }
    }
    catch {
      // Config missing or corrupt -- proceed with defaults
    }
  }

  /**
   * Write current persisted state to disk.
   * Creates the .data/ directory if it doesn't exist.
   */
  private saveConfig(): void {
    try {
      const config: PersistedModelConfig = {
        ollamaBaseUrl: ollamaBaseUrl !== DEFAULT_OLLAMA_BASE_URL ? ollamaBaseUrl : undefined,
        localServer: localServer ? { url: localServer.url } : undefined,
        instanceRoutes: this.instanceRoutes.size > 0
          ? Object.fromEntries(
              Array.from(this.instanceRoutes.entries()).map(([id, route]) => [
                id,
                { provider: route.provider, model: route.model },
              ]),
            )
          : undefined,
      }

      // Strip undefined keys for a clean JSON file
      const cleaned = JSON.parse(JSON.stringify(config))

      const dir = dirname(this.configPath)
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true })
      }

      writeFileSync(this.configPath, JSON.stringify(cleaned, null, 2) + '\n', 'utf-8')
    }
    catch {
      // Non-fatal -- persistence failure should not break runtime behavior
      console.warn('[ModelRegistry] Failed to save config to', this.configPath)
    }
  }

  // -------------------------------------------------------------------------
  // Provider queries
  // -------------------------------------------------------------------------

  /** Return all registered providers (availability not checked). */
  getProviders(): ModelProvider[] {
    return Array.from(this.providers.values())
  }

  /** Return a single provider by ID. */
  getProvider(id: string): ModelProvider | undefined {
    return this.providers.get(id)
  }

  /**
   * Return providers that are currently available.
   * Cloud providers are available when their API key env var is set.
   * Local providers (Ollama) are available when the service is reachable.
   */
  async getAvailableProviders(): Promise<ModelProvider[]> {
    // Lazy auto-reconnect: if a local server was persisted but not yet running,
    // attempt to reconnect once on first access so the UI shows models immediately.
    if (localServer && !localServer.running && !this.autoReconnectAttempted) {
      this.autoReconnectAttempted = true
      try {
        await this.connectLocalServer(localServer.url)
      }
      catch {
        // Server unreachable -- leave it as not running
      }
    }

    const results: ModelProvider[] = []

    for (const provider of this.providers.values()) {
      const available = await this.checkAvailability(provider)
      // Update cached availability
      provider.isAvailable = available
      if (available) {
        results.push(provider)
      }
    }

    return results
  }

  /** List all known model definitions, optionally filtered by provider. */
  listModels(providerId?: string): ModelDefinition[] {
    if (providerId) {
      const provider = this.providers.get(providerId)
      return provider ? [...provider.models] : []
    }

    const all: ModelDefinition[] = []
    for (const provider of this.providers.values()) {
      all.push(...provider.models)
    }
    return all
  }

  // -------------------------------------------------------------------------
  // Ollama integration
  // -------------------------------------------------------------------------

  /** Get the current Ollama base URL. */
  getOllamaBaseUrl(): string {
    return ollamaBaseUrl
  }

  /** Update the Ollama base URL used for all subsequent requests. */
  setOllamaBaseUrl(url: string): void {
    ollamaBaseUrl = url.replace(/\/+$/, '') // strip trailing slashes
    this.saveConfig()
  }

  /** Check if Ollama is running by hitting the health endpoint. */
  async isOllamaRunning(): Promise<boolean> {
    try {
      const response = await fetch(`${ollamaBaseUrl}/api/tags`, {
        signal: AbortSignal.timeout(3_000),
      })
      return response.ok
    }
    catch {
      return false
    }
  }

  /**
   * Discover locally pulled Ollama models by querying GET /api/tags.
   * Also updates the Ollama provider's model list in-place.
   */
  async discoverOllamaModels(): Promise<ModelDefinition[]> {
    try {
      const response = await fetch(`${ollamaBaseUrl}/api/tags`, {
        signal: AbortSignal.timeout(5_000),
      })

      if (!response.ok) {
        return []
      }

      const data = (await response.json()) as OllamaTagsResponse

      // Fetch context window per model via /api/show (best-effort, parallel)
      const contextSizes = new Map<string, number>()
      try {
        await Promise.all(data.models.map(async (m) => {
          try {
            const showResp = await fetch(`${ollamaBaseUrl}/api/show`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ name: m.name }),
              signal: AbortSignal.timeout(3_000),
            })
            if (showResp.ok) {
              const info = await showResp.json() as { model_info?: Record<string, unknown> }
              const ctxLen = info.model_info?.['general.context_length']
              if (typeof ctxLen === 'number') {
                contextSizes.set(m.name, ctxLen)
              }
            }
          }
          catch {
            // Skip individual model failures
          }
        }))
      }
      catch {
        // Non-fatal -- proceed without context sizes
      }

      const models: ModelDefinition[] = data.models.map((m) => ({
        id: m.name,
        name: m.name,
        provider: 'ollama',
        contextWindow: contextSizes.get(m.name),
        supportsTools: true,
        supportsStreaming: true,
      }))

      // Update the Ollama provider's model list
      const ollamaProvider = this.providers.get('ollama')
      if (ollamaProvider) {
        ollamaProvider.models = models
        ollamaProvider.isAvailable = true
      }

      return models
    }
    catch {
      return []
    }
  }

  /**
   * Pull an Ollama model, yielding progress events as they stream in.
   * The caller should iterate the returned async generator.
   */
  async *pullOllamaModel(modelName: string): AsyncGenerator<PullProgress> {
    const response = await fetch(`${ollamaBaseUrl}/api/pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: modelName, stream: true }),
    })

    if (!response.ok) {
      const text = await response.text()
      throw new Error(`Ollama pull failed (${response.status}): ${text}`)
    }

    if (!response.body) {
      throw new Error('Ollama pull returned no body')
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })

        // Ollama streams newline-delimited JSON
        const lines = buffer.split('\n')
        // Keep the last (possibly incomplete) line in the buffer
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed) continue
          try {
            const progress = JSON.parse(trimmed) as PullProgress
            yield progress
          }
          catch {
            // skip malformed lines
          }
        }
      }

      // Process any remaining buffer content
      if (buffer.trim()) {
        try {
          const progress = JSON.parse(buffer.trim()) as PullProgress
          yield progress
        }
        catch {
          // skip malformed trailing data
        }
      }
    }
    finally {
      reader.releaseLock()
    }
  }

  // -------------------------------------------------------------------------
  // Local server (OpenAI-compatible: llama-server, vLLM, LM Studio, etc.)
  // -------------------------------------------------------------------------

  /** Get the current local server state (null if not configured). */
  getLocalServer(): LocalServerState | null {
    return localServer
  }

  /**
   * Connect to a local OpenAI-compatible server by URL.
   * Auto-detects available models via GET /models.
   */
  async connectLocalServer(url: string): Promise<LocalServerState> {
    const baseUrl = url.replace(/\/+$/, '')

    // Probe /v1/models (or /models if URL already ends with /v1)
    const modelsUrl = baseUrl.endsWith('/v1')
      ? `${baseUrl}/models`
      : `${baseUrl}/v1/models`

    const response = await fetch(modelsUrl, {
      signal: AbortSignal.timeout(5_000),
    })

    if (!response.ok) {
      throw new Error(`Server responded with ${response.status}`)
    }

    const data = (await response.json()) as { data?: Array<{ id: string }> }

    // Try to fetch the server's actual context size via /props (llama-server)
    let serverContextSize: number | undefined
    try {
      const propsUrl = baseUrl.endsWith('/v1')
        ? `${baseUrl.replace(/\/v1$/, '')}/props`
        : `${baseUrl}/props`
      const propsResp = await fetch(propsUrl, { signal: AbortSignal.timeout(3_000) })
      if (propsResp.ok) {
        const props = await propsResp.json() as { default_generation_settings?: { n_ctx?: number } }
        serverContextSize = props.default_generation_settings?.n_ctx
      }
    }
    catch {
      // /props not available -- not all servers expose it
    }

    const models: ModelDefinition[] = (data.data ?? []).map((m) => ({
      id: m.id,
      name: m.id,
      provider: 'local-server',
      contextWindow: serverContextSize,
      supportsTools: true,
      supportsStreaming: true,
    }))

    localServer = { url: baseUrl, models, running: true }

    // Register/update the provider in the providers map
    this.providers.set('local-server', {
      id: 'local-server',
      name: 'Local Server',
      type: 'local',
      defaultBaseUrl: baseUrl,
      models,
      isAvailable: true,
    })

    this.saveConfig()
    return localServer
  }

  /** Disconnect and remove the local server provider. */
  disconnectLocalServer(): void {
    localServer = null
    this.providers.delete('local-server')
    this.saveConfig()
  }

  /** Look up the context window for a given provider + model ID. */
  getContextWindow(providerId: string, modelId: string): number | undefined {
    const provider = this.providers.get(providerId)
    if (!provider) return undefined
    const model = provider.models.find(m => m.id === modelId)
    return model?.contextWindow
  }

  // -------------------------------------------------------------------------
  // AI SDK factory
  // -------------------------------------------------------------------------

  /**
   * Create the appropriate AI SDK LanguageModel instance for the given route.
   * Returns LanguageModelV3 for most providers, LanguageModelV2 for ollama
   * (the ollama-ai-provider ships with its own @ai-sdk/provider version;
   * at runtime the ai package handles the version bridge).
   */
  createLanguageModel(route: ModelRouteConfig): LanguageModelV3 | LanguageModelV2 {
    const apiKey = route.apiKeyEnvVar ? process.env[route.apiKeyEnvVar] : undefined

    switch (route.provider) {
      case 'openai': {
        const provider = createOpenAI({
          apiKey,
          ...(route.apiBaseUrl ? { baseURL: route.apiBaseUrl } : {}),
        })
        return provider(route.model)
      }

      case 'anthropic': {
        const provider = createAnthropic({
          apiKey,
          ...(route.apiBaseUrl ? { baseURL: route.apiBaseUrl } : {}),
        })
        return provider(route.model)
      }

      case 'google': {
        const provider = createGoogleGenerativeAI({
          apiKey,
          ...(route.apiBaseUrl ? { baseURL: route.apiBaseUrl } : {}),
        })
        return provider(route.model)
      }

      case 'ollama': {
        // ollama-ai-provider bundles its own @ai-sdk/provider with V1 types.
        // The ai package bridges V1 -> V2/V3 at runtime, so the cast is safe.
        const provider = createOllama({
          baseURL: route.apiBaseUrl ?? `${ollamaBaseUrl}/api`,
        })
        return provider(route.model) as unknown as LanguageModelV2
      }

      case 'local-server': {
        const serverUrl = route.apiBaseUrl ?? localServer?.url ?? 'http://localhost:8080'
        const baseURL = serverUrl.endsWith('/v1') ? serverUrl : `${serverUrl}/v1`
        const provider = createOpenAI({
          apiKey: 'no-key', // local servers typically don't require auth
          baseURL,
        })
        return provider(route.model)
      }

      case 'kimi': {
        // Kimi is OpenAI-compatible via api.moonshot.cn
        const provider = createOpenAI({
          apiKey,
          baseURL: route.apiBaseUrl ?? 'https://api.moonshot.cn/v1',
        })
        return provider(route.model)
      }

      case 'mistral': {
        // Mistral is OpenAI-compatible
        const provider = createOpenAI({
          apiKey,
          baseURL: route.apiBaseUrl ?? 'https://api.mistral.ai/v1',
        })
        return provider(route.model)
      }

      case 'groq': {
        // Groq is OpenAI-compatible
        const provider = createOpenAI({
          apiKey,
          baseURL: route.apiBaseUrl ?? 'https://api.groq.com/openai/v1',
        })
        return provider(route.model)
      }

      default:
        throw new Error(`Unknown provider: ${route.provider}`)
    }
  }

  // -------------------------------------------------------------------------
  // Per-instance routing
  // -------------------------------------------------------------------------

  /** Get the model route assigned to a specific session. */
  getRouteForInstance(sessionId: string): ModelRouteConfig | undefined {
    return this.instanceRoutes.get(sessionId)
  }

  /** Set (or update) the model route for a specific session. */
  setRouteForInstance(sessionId: string, route: ModelRouteConfig): void {
    this.instanceRoutes.set(sessionId, route)
    this.saveConfig()
  }

  /** Remove the model route for a session (e.g., on session close). */
  clearRouteForInstance(sessionId: string): void {
    this.instanceRoutes.delete(sessionId)
  }

  /**
   * Return the default route: the first available cloud provider, falling
   * back to Ollama if no cloud keys are set.
   */
  getDefaultRoute(): ModelRouteConfig {
    // Prefer cloud providers in order: anthropic, openai, google, kimi, mistral, groq
    const preferenceOrder = ['anthropic', 'openai', 'google', 'kimi', 'mistral', 'groq', 'ollama']

    for (const providerId of preferenceOrder) {
      const provider = this.providers.get(providerId)
      if (!provider || provider.models.length === 0) continue

      if (provider.type === 'cloud' && provider.apiKeyEnvVar && process.env[provider.apiKeyEnvVar]) {
        const firstModel = provider.models[0]
        if (!firstModel) continue
        return {
          provider: provider.id,
          model: firstModel.id,
          apiKeyEnvVar: provider.apiKeyEnvVar,
        }
      }

      if (provider.type === 'local') {
        return {
          provider: provider.id,
          model: provider.models[0]?.id ?? 'llama3.2',
          apiBaseUrl: provider.defaultBaseUrl,
        }
      }
    }

    // Ultimate fallback -- will fail at call time if nothing is configured
    return { provider: 'openai', model: 'gpt-4o', apiKeyEnvVar: 'OPENAI_API_KEY' }
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  private async checkAvailability(provider: ModelProvider): Promise<boolean> {
    if (provider.type === 'cloud') {
      return !!(provider.apiKeyEnvVar && process.env[provider.apiKeyEnvVar])
    }

    if (provider.id === 'ollama') {
      return this.isOllamaRunning()
    }

    if (provider.id === 'local-server') {
      return localServer?.running ?? false
    }

    return false
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let _instance: ModelRegistry | undefined

export function useModelRegistry(): ModelRegistry {
  if (!_instance) {
    _instance = new ModelRegistry()
  }
  return _instance
}

