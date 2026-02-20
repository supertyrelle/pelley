// ---------------------------------------------------------------------------
// Model Registry Types
// ---------------------------------------------------------------------------

export interface ModelProvider {
  id: string // 'openai', 'anthropic', 'google', 'ollama', 'kimi', 'mistral', 'groq'
  name: string // Display name
  type: 'cloud' | 'local' // Cloud API vs local (Ollama)
  apiKeyEnvVar?: string // e.g., 'OPENAI_API_KEY'
  defaultBaseUrl?: string // e.g., 'http://localhost:11434' for Ollama
  models: ModelDefinition[] // Available models
  isAvailable: boolean // Whether API key is set or service is reachable
}

export interface ModelDefinition {
  id: string // e.g., 'gpt-4o', 'claude-sonnet-4-20250514', 'llama3.2'
  name: string // Display name
  provider: string // Parent provider ID
  contextWindow?: number
  supportsTools?: boolean
  supportsStreaming?: boolean
}

export interface ModelRouteConfig {
  provider: string
  model: string
  apiBaseUrl?: string
  apiKeyEnvVar?: string
}

export interface PullProgress {
  status: string
  digest?: string
  total?: number
  completed?: number
}

/** Shape returned by Ollama GET /api/tags */
export interface OllamaTagsResponse {
  models: OllamaModelInfo[]
}

export interface OllamaModelInfo {
  name: string
  model: string
  modified_at: string
  size: number
  digest: string
  details: {
    parent_model?: string
    format?: string
    family?: string
    families?: string[]
    parameter_size?: string
    quantization_level?: string
  }
}
