import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { AgentConfig } from '~~/shared/types/agent'
import { useModelRegistry } from './model-registry'

const execFileAsync = promisify(execFile)

// -------------------------------------------------------------------
// Built-in agent definitions
// -------------------------------------------------------------------

const BUILTINS: AgentConfig[] = [
  {
    id: 'claude-code',
    name: 'Claude Code',
    command: 'claude',
    args: [],
    resumeArgs: ['--resume'],
    instanceType: 'claude-code',
  },
  {
    id: 'opencode',
    name: 'OpenCode',
    command: 'opencode',
    args: [],
    instanceType: 'opencode',
  },
  {
    id: 'kimi-code',
    name: 'Kimi Code',
    command: 'kimi',
    args: [],
    instanceType: 'kimi-code',
  },
  {
    id: 'llmcp',
    name: 'llmcp',
    command: 'llmcp',
    args: ['serve'],
    instanceType: 'llmcp',
  },
]

// -------------------------------------------------------------------
// Provider -> env var mapping
// -------------------------------------------------------------------

/** Maps (provider, instanceType) to the env var name for the API base URL. */
function baseUrlEnvVar(provider: string, instanceType: AgentConfig['instanceType']): string | undefined {
  // Ollama / local-server: OpenAI-compatible, per-instance env var
  // Claude Code uses ANTHROPIC_BASE_URL (llama-server supports Anthropic Messages API)
  // Other CLIs use OPENAI_API_BASE
  if (provider === 'ollama' || provider === 'local-server') {
    switch (instanceType) {
      case 'claude-code':
        return 'ANTHROPIC_BASE_URL'
      case 'opencode':
        // OpenCode handles its own base URL via provider config in opencode.json
        return undefined
      case 'kimi-code':
        // Kimi Code sets its base URL via TOML config, not env var
        return undefined
      case 'llmcp':
        return 'OPENAI_API_BASE'
      default:
        return 'OPENAI_API_BASE'
    }
  }

  // Generic provider -> env var conventions
  const map: Record<string, string> = {
    anthropic: 'ANTHROPIC_BASE_URL',
    openai: 'OPENAI_API_BASE',
    'openai-compatible': 'OPENAI_API_BASE',
    google: 'GOOGLE_API_BASE',
    mistral: 'MISTRAL_API_BASE',
  }

  return map[provider]
}

/**
 * Return CLI flags to select the model for the given agent instance type.
 * Claude Code and OpenCode support --model; Kimi Code uses config.toml
 * (handled separately by prepareKimiConfig).
 */
export function modelFlags(config: AgentConfig): string[] {
  const mc = config.modelConfig
  if (!mc) return []

  switch (config.instanceType) {
    case 'claude-code':
      // claude --model <model-name>
      return ['--model', mc.model]

    case 'opencode':
      // opencode --model provider/model
      return ['--model', `${mc.provider}/${mc.model}`]

    case 'kimi-code':
      // Kimi reads from config.toml -- model flag handled by prepareKimiConfig
      return []

    default:
      return []
  }
}

/**
 * Build the environment variables needed to launch an agent PTY session.
 * The returned record is merged into the PTY's `env` at spawn time.
 */
export function buildEnvForAgent(config: AgentConfig): Record<string, string> {
  const env: Record<string, string> = {}
  const mc = config.modelConfig
  if (!mc) return env

  // Pass the API key through from the host environment
  if (mc.apiKeyEnvVar && process.env[mc.apiKeyEnvVar]) {
    env[mc.apiKeyEnvVar] = process.env[mc.apiKeyEnvVar]!
  }

  // Set the base URL env var for the provider
  if (mc.apiBaseUrl) {
    const varName = baseUrlEnvVar(mc.provider, config.instanceType)
    if (varName) {
      // Claude Code's ANTHROPIC_BASE_URL should NOT have /v1 — the SDK appends /v1/messages
      const url = (varName === 'ANTHROPIC_BASE_URL' && mc.apiBaseUrl.endsWith('/v1'))
        ? mc.apiBaseUrl.slice(0, -3)
        : mc.apiBaseUrl
      env[varName] = url
    }
  }
  // Ollama without an explicit apiBaseUrl -- use the default Ollama endpoint
  else if (mc.provider === 'ollama') {
    const varName = baseUrlEnvVar(mc.provider, config.instanceType)
    if (varName) {
      // Claude Code: no /v1 suffix (SDK appends /v1/messages). Others: need /v1
      env[varName] = varName === 'ANTHROPIC_BASE_URL'
        ? 'http://localhost:11434'
        : 'http://localhost:11434/v1'
    }
  }
  // Local server without an explicit apiBaseUrl -- resolve from model registry
  else if (mc.provider === 'local-server') {
    const registry = useModelRegistry()
    const server = registry.getLocalServer()
    if (server?.url) {
      const varName = baseUrlEnvVar(mc.provider, config.instanceType)
      if (varName) {
        // Claude Code: strip /v1 (SDK appends /v1/messages). Others: ensure /v1
        if (varName === 'ANTHROPIC_BASE_URL') {
          const url = server.url.endsWith('/v1') ? server.url.slice(0, -3) : server.url
          env[varName] = url
        }
        else {
          const url = server.url.endsWith('/v1') ? server.url : `${server.url}/v1`
          env[varName] = url
        }
      }
    }
  }

  // Claude Code requires auth env vars even for local servers
  if (config.instanceType === 'claude-code' && (mc.provider === 'ollama' || mc.provider === 'local-server')) {
    if (!env.ANTHROPIC_AUTH_TOKEN) env.ANTHROPIC_AUTH_TOKEN = 'local'
    if (!env.ANTHROPIC_API_KEY) env.ANTHROPIC_API_KEY = 'not-needed'
  }

  return env
}

// -------------------------------------------------------------------
// OpenCode opencode.json pre-spawn hook
// -------------------------------------------------------------------

/**
 * Ensure the selected model's provider and model are defined in OpenCode's config
 * before spawning. Reads ~/.config/opencode/opencode.json, adds a provider entry
 * under the `provider` key (singular) with the correct AI SDK format, and writes back.
 */
export async function prepareOpenCodeConfig(modelConfig: { provider: string; model: string; apiBaseUrl?: string; contextWindow?: number }): Promise<void> {
  const homedir = process.env.HOME ?? process.env.USERPROFILE ?? ''
  const configPath = join(homedir, '.config', 'opencode', 'opencode.json')

  let content: string
  try {
    content = await fs.readFile(configPath, 'utf-8')
  }
  catch {
    return // No opencode.json — user hasn't installed OpenCode
  }

  let config: Record<string, unknown>
  try {
    config = JSON.parse(content)
  }
  catch {
    return // Malformed JSON
  }

  const { provider, model, apiBaseUrl } = modelConfig

  // Only need to add providers for local endpoints
  if (provider !== 'ollama' && provider !== 'local-server') return

  // Resolve the base URL (OpenCode needs /v1 suffix for OpenAI-compatible)
  let baseUrl: string | undefined = apiBaseUrl
  if (!baseUrl) {
    if (provider === 'ollama') {
      baseUrl = useModelRegistry().getOllamaBaseUrl() + '/v1'
    }
    else if (provider === 'local-server') {
      const server = useModelRegistry().getLocalServer()
      if (server?.url) {
        baseUrl = server.url.endsWith('/v1') ? server.url : `${server.url}/v1`
      }
    }
  }
  if (!baseUrl) return

  // Remove the old invalid "providers" (plural) key if it exists
  if ('providers' in config) {
    delete config.providers
  }

  // OpenCode uses "provider" (singular) with AI SDK npm package format
  const provId = provider === 'local-server' ? 'local-server' : 'ollama'

  // Ensure provider section exists
  if (!config.provider || typeof config.provider !== 'object') {
    config.provider = {}
  }
  const providerSection = config.provider as Record<string, unknown>

  // Build model entry for this specific model
  const ctxSize = modelConfig.contextWindow ?? 32768
  const modelEntry: Record<string, unknown> = {
    name: model,
    limit: {
      context: ctxSize,
      output: Math.min(ctxSize, 65536),
    },
  }

  // Build provider entry
  const providerEntry: Record<string, unknown> = {
    npm: '@ai-sdk/openai-compatible',
    name: provider === 'local-server' ? 'Local Server' : 'Ollama',
    options: {
      baseURL: baseUrl,
    },
    models: {
      [model]: modelEntry,
    },
  }

  // Merge models if provider already exists
  const existing = providerSection[provId] as Record<string, unknown> | undefined
  if (existing?.models && typeof existing.models === 'object') {
    const existingModels = existing.models as Record<string, unknown>
    providerEntry.models = { ...existingModels, [model]: modelEntry }
  }

  providerSection[provId] = providerEntry
  await fs.writeFile(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8')
}

// -------------------------------------------------------------------
// Kimi Code config.toml pre-spawn hook
// -------------------------------------------------------------------

/** Default API base URLs for cloud providers (without trailing /v1 unless that's the canonical form). */
const CLOUD_BASE_URLS: Record<string, string> = {
  anthropic: 'https://api.anthropic.com/v1',
  openai: 'https://api.openai.com/v1',
  google: 'https://generativelanguage.googleapis.com/v1beta',
  kimi: 'https://api.moonshot.cn/v1',
  mistral: 'https://api.mistral.ai/v1',
  groq: 'https://api.groq.com/openai/v1',
}

/** Map platform provider IDs to Kimi config.toml provider types. */
const KIMI_PROVIDER_TYPE_MAP: Record<string, string> = {
  ollama: 'openai_legacy',
  'local-server': 'openai_legacy',
  openai: 'openai_responses',
  anthropic: 'anthropic',
  google: 'google_genai',
  kimi: 'kimi',
  mistral: 'openai_legacy',
  groq: 'openai_legacy',
}

/** Sanitize a model name for use as a TOML key (replace dots, colons, slashes with hyphens). */
function sanitizeModelId(model: string): string {
  return model.replace(/[.:/]/g, '-')
}

/** Map platform provider ID to the provider name used in Kimi config.toml. */
function kimiProviderId(provider: string): string {
  if (provider === 'local-server') return 'pelley-local'
  return provider
}

/**
 * Ensure the selected model's provider and model entries exist in ~/.kimi/config.toml
 * before spawning a Kimi Code PTY. Reads the existing config, patches in the
 * provider/model blocks if missing, sets default_model, and writes back.
 */
export async function prepareKimiConfig(modelConfig: { provider: string; model: string; apiBaseUrl?: string; apiKeyEnvVar?: string; contextWindow?: number }): Promise<void> {
  const homedir = process.env.HOME ?? process.env.USERPROFILE ?? ''
  const configPath = join(homedir, '.kimi', 'config.toml')

  // Read existing config -- if it doesn't exist, user hasn't installed Kimi
  let content: string
  try {
    content = await fs.readFile(configPath, 'utf-8')
  }
  catch {
    return
  }

  const { provider, model, apiBaseUrl, apiKeyEnvVar } = modelConfig

  // Resolve the base URL for this provider
  let baseUrl: string | undefined = apiBaseUrl
  if (!baseUrl) {
    if (provider === 'ollama') {
      baseUrl = useModelRegistry().getOllamaBaseUrl() + '/v1'
    }
    else if (provider === 'local-server') {
      const server = useModelRegistry().getLocalServer()
      if (server?.url) {
        baseUrl = server.url.endsWith('/v1') ? server.url : `${server.url}/v1`
      }
    }
    else {
      baseUrl = CLOUD_BASE_URLS[provider]
    }
  }

  if (!baseUrl) return

  const kimiType = KIMI_PROVIDER_TYPE_MAP[provider]
  if (!kimiType) return

  const provId = kimiProviderId(provider)
  const sanitizedModel = sanitizeModelId(model)
  let modified = false

  // Check if provider block exists
  const providerRegex = new RegExp(`^\\[providers\\.${provId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\]`, 'm')
  if (!providerRegex.test(content)) {
    // Resolve API key
    let apiKey = 'no-key-needed'
    if (provider !== 'ollama' && provider !== 'local-server') {
      if (apiKeyEnvVar && process.env[apiKeyEnvVar]) {
        apiKey = process.env[apiKeyEnvVar]!
      }
      else {
        apiKey = 'set-via-env'
      }
    }

    content += `\n# --- Added by Pelley platform ---\n[providers.${provId}]\ntype = "${kimiType}"\nbase_url = "${baseUrl}"\napi_key = "${apiKey}"\n`
    modified = true
  }

  // Check if model block exists
  const ctxSize = modelConfig.contextWindow ?? 32768
  const modelRegex = new RegExp(`^\\[models\\.${sanitizedModel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\]`, 'm')
  if (!modelRegex.test(content)) {
    content += `\n# --- Added by Pelley platform ---\n[models.${sanitizedModel}]\nprovider = "${provId}"\nmodel = "${model}"\nmax_context_size = ${ctxSize}\n`
    modified = true
  }
  else if (modelConfig.contextWindow) {
    // Update max_context_size on existing model block if it differs
    const ctxRegex = new RegExp(`(\\[models\\.${sanitizedModel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\][^\\[]*?)max_context_size\\s*=\\s*\\d+`, 'm')
    const ctxMatch = content.match(ctxRegex)
    if (ctxMatch && !ctxMatch[0].endsWith(`= ${ctxSize}`)) {
      content = content.replace(ctxRegex, `$1max_context_size = ${ctxSize}`)
      modified = true
    }
  }

  // Update default_model
  const defaultModelRegex = /^default_model\s*=\s*"[^"]*"/m
  if (defaultModelRegex.test(content)) {
    const newDefault = `default_model = "${sanitizedModel}"`
    if (!content.match(new RegExp(`^default_model\\s*=\\s*"${sanitizedModel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`, 'm'))) {
      content = content.replace(defaultModelRegex, newDefault)
      modified = true
    }
  }

  if (modified) {
    await fs.writeFile(configPath, content, 'utf-8')
  }
}

// -------------------------------------------------------------------
// Persistence helpers
// -------------------------------------------------------------------

const DATA_DIR = join(process.cwd(), '.data')
const AGENTS_FILE = join(DATA_DIR, 'agents.json')

async function ensureDataDir(): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true })
}

async function loadCustomAgents(): Promise<AgentConfig[]> {
  try {
    const raw = await fs.readFile(AGENTS_FILE, 'utf-8')
    return JSON.parse(raw) as AgentConfig[]
  }
  catch {
    return []
  }
}

async function saveCustomAgents(agents: AgentConfig[]): Promise<void> {
  await ensureDataDir()
  await fs.writeFile(AGENTS_FILE, JSON.stringify(agents, null, 2), 'utf-8')
}

// -------------------------------------------------------------------
// AgentRegistry
// -------------------------------------------------------------------

export class AgentRegistry {
  private builtins: Map<string, AgentConfig> = new Map()
  private custom: Map<string, AgentConfig> = new Map()
  private initialized = false

  constructor() {
    for (const agent of BUILTINS) {
      this.builtins.set(agent.id, agent)
    }
  }

  /** Load persisted custom agents from disk. Safe to call multiple times. */
  async init(): Promise<void> {
    if (this.initialized) return
    const persisted = await loadCustomAgents()
    for (const agent of persisted) {
      this.custom.set(agent.id, agent)
    }
    this.initialized = true
  }

  /** Register (or update) a custom agent definition. Persists to disk. */
  async register(config: AgentConfig): Promise<void> {
    this.custom.set(config.id, config)
    await this.persist()
  }

  /** Get an agent by id. Custom agents shadow built-ins with the same id. */
  get(id: string): AgentConfig | undefined {
    return this.custom.get(id) ?? this.builtins.get(id)
  }

  /** List all agents (custom shadow built-ins). */
  list(): AgentConfig[] {
    const merged = new Map<string, AgentConfig>()
    for (const [id, agent] of this.builtins) {
      merged.set(id, agent)
    }
    for (const [id, agent] of this.custom) {
      merged.set(id, agent)
    }
    return Array.from(merged.values())
  }

  /** Remove a custom agent definition. Returns false if the id was not a custom agent. */
  async remove(id: string): Promise<boolean> {
    const deleted = this.custom.delete(id)
    if (deleted) {
      await this.persist()
    }
    return deleted
  }

  /** Return only the hardcoded built-in definitions. */
  getBuiltins(): AgentConfig[] {
    return Array.from(this.builtins.values())
  }

  /**
   * Scan PATH for known CLI binaries and return the built-in configs
   * whose commands are actually installed.
   */
  async detect(): Promise<AgentConfig[]> {
    const results: AgentConfig[] = []

    const checks = Array.from(this.builtins.values()).map(async (agent) => {
      const found = await commandExists(agent.command)
      if (found) results.push(agent)
    })

    await Promise.all(checks)
    return results
  }

  private async persist(): Promise<void> {
    await saveCustomAgents(Array.from(this.custom.values()))
  }
}

// -------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------

async function commandExists(cmd: string): Promise<boolean> {
  try {
    await execFileAsync('which', [cmd])
    return true
  }
  catch {
    return false
  }
}

// -------------------------------------------------------------------
// Singleton
// -------------------------------------------------------------------

let _instance: AgentRegistry | undefined

export function useAgentRegistry(): AgentRegistry {
  if (!_instance) {
    _instance = new AgentRegistry()
  }
  return _instance
}
