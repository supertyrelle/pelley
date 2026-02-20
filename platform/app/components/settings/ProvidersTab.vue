<script setup lang="ts">
import type { ModelProvider, ModelDefinition, PullProgress } from '~~/shared/types/model'

// Fetch all providers (includes availability status)
const { data: providers, refresh: refreshProviders } = await useFetch<ModelProvider[]>('/api/models/providers')

// Ollama-specific state
const ollamaBaseUrl = ref('http://localhost:11434')
const ollamaModels = ref<ModelDefinition[]>([])
const ollamaRunning = ref(false)
const pullModelName = ref('')
const pullProgress = ref<PullProgress | null>(null)
const isPulling = ref(false)

// Local server (OpenAI-compatible: llama-server, vLLM, LM Studio, etc.)
const localServerUrl = ref('')
const localServerModels = ref<ModelDefinition[]>([])
const localServerConnected = ref(false)
const isConnecting = ref(false)
const connectError = ref('')

async function connectLocalServer() {
  if (!localServerUrl.value.trim() || isConnecting.value) return

  isConnecting.value = true
  connectError.value = ''

  try {
    const state = await $fetch<{ url: string; models: ModelDefinition[]; running: boolean }>('/api/models/local-server/connect', {
      method: 'POST',
      body: { url: localServerUrl.value.trim() },
    })
    localServerModels.value = state.models
    localServerConnected.value = state.running
    await refreshProviders()
  } catch (err: any) {
    connectError.value = err?.data?.message ?? err?.message ?? 'Connection failed'
    localServerConnected.value = false
    localServerModels.value = []
  } finally {
    isConnecting.value = false
  }
}

async function disconnectLocalServer() {
  await $fetch('/api/models/local-server/disconnect', { method: 'POST' })
  localServerConnected.value = false
  localServerModels.value = []
  connectError.value = ''
  await refreshProviders()
}

// Track which provider's API key field is visible (show/hide toggle)
const visibleKeys = ref<Set<string>>(new Set())

function toggleKeyVisibility(providerId: string) {
  if (visibleKeys.value.has(providerId)) {
    visibleKeys.value.delete(providerId)
  } else {
    visibleKeys.value.add(providerId)
  }
  // Trigger reactivity
  visibleKeys.value = new Set(visibleKeys.value)
}

// Load Ollama status and models on mount
async function refreshOllama() {
  try {
    const status = await $fetch<{ running: boolean }>('/api/models/ollama/status')
    ollamaRunning.value = status.running
    if (status.running) {
      ollamaModels.value = await $fetch<ModelDefinition[]>('/api/models/ollama/models')
    }
  } catch {
    ollamaRunning.value = false
  }
}

// Save Ollama base URL to server when user changes it
let urlSaveTimeout: ReturnType<typeof setTimeout> | undefined
watch(ollamaBaseUrl, (newUrl) => {
  clearTimeout(urlSaveTimeout)
  urlSaveTimeout = setTimeout(async () => {
    try {
      await $fetch('/api/models/ollama/base-url', {
        method: 'PUT',
        body: { url: newUrl },
      })
      await refreshOllama()
    } catch {
      // silently fail — user will see connection status
    }
  }, 500)
})

onMounted(async () => {
  // Load the server's current Ollama base URL
  try {
    const { url } = await $fetch<{ url: string }>('/api/models/ollama/base-url')
    ollamaBaseUrl.value = url
  } catch {
    // keep default
  }
  refreshOllama()

  // Load existing local server state
  try {
    const state = await $fetch<{ url: string | null; models: ModelDefinition[]; running: boolean }>('/api/models/local-server/status')
    if (state.url) {
      localServerUrl.value = state.url
      localServerModels.value = state.models
      localServerConnected.value = state.running
    }
  } catch {
    // no local server configured
  }
})

// Pull an Ollama model with streaming progress
async function pullOllamaModel() {
  if (!pullModelName.value.trim() || isPulling.value) return

  isPulling.value = true
  pullProgress.value = { status: 'starting pull...' }

  try {
    const response = await fetch('/api/models/ollama/pull', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: pullModelName.value.trim() }),
    })

    if (!response.ok) {
      pullProgress.value = { status: `error: ${response.statusText}` }
      isPulling.value = false
      return
    }

    const reader = response.body?.getReader()
    if (!reader) {
      pullProgress.value = { status: 'error: no response body' }
      isPulling.value = false
      return
    }

    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) continue
        try {
          pullProgress.value = JSON.parse(trimmed) as PullProgress
        } catch {
          // skip malformed
        }
      }
    }

    // Process remaining buffer
    if (buffer.trim()) {
      try {
        pullProgress.value = JSON.parse(buffer.trim()) as PullProgress
      } catch {
        // skip
      }
    }

    // Refresh models list after pull
    pullModelName.value = ''
    await refreshOllama()
    await refreshProviders()
  } catch (err) {
    pullProgress.value = { status: `error: ${err instanceof Error ? err.message : 'pull failed'}` }
  } finally {
    isPulling.value = false
  }
}

// Compute pull progress percentage
const pullPercent = computed(() => {
  if (!pullProgress.value?.total || !pullProgress.value?.completed) return 0
  return Math.round((pullProgress.value.completed / pullProgress.value.total) * 100)
})

function providerStatusLabel(provider: ModelProvider): string {
  if (provider.type === 'local') {
    return provider.isAvailable ? 'Running' : 'Not running'
  }
  return provider.isAvailable ? 'Connected' : 'Not configured'
}
</script>

<template>
  <div class="space-y-4">
    <!-- Local Server quick-connect -->
    <UCard>
      <template #header>
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2">
            <span class="text-sm font-semibold text-(--ui-text)">
              Local Server
            </span>
            <UBadge
              label="Local"
              color="success"
              size="xs"
              variant="subtle"
            />
          </div>
          <div class="flex items-center gap-1.5">
            <span
              class="h-2 w-2 rounded-full"
              :class="localServerConnected ? 'bg-green-500' : 'bg-red-400'"
            />
            <span class="text-xs text-(--ui-text-muted)">
              {{ localServerConnected ? 'Connected' : 'Not connected' }}
            </span>
          </div>
        </div>
      </template>

      <div class="space-y-3">
        <div>
          <label class="mb-1 block text-xs font-medium text-(--ui-text-muted)">
            Server URL
          </label>
          <div class="flex items-center gap-2">
            <UInput
              v-model="localServerUrl"
              size="sm"
              placeholder="http://10.0.0.194:8080/v1"
              class="flex-1 font-mono"
              :disabled="isConnecting"
              @keydown.enter="connectLocalServer"
            />
            <UButton
              v-if="!localServerConnected"
              label="Connect"
              size="sm"
              color="primary"
              :loading="isConnecting"
              :disabled="!localServerUrl.trim()"
              @click="connectLocalServer"
            />
            <UButton
              v-else
              label="Disconnect"
              size="sm"
              color="neutral"
              variant="outline"
              @click="disconnectLocalServer"
            />
          </div>
          <p class="mt-1 text-xs text-(--ui-text-dimmed)">
            Any OpenAI-compatible server (llama-server, vLLM, LM Studio, Ollama /v1).
          </p>
        </div>

        <!-- Error message -->
        <p v-if="connectError" class="text-xs text-red-500">
          {{ connectError }}
        </p>

        <!-- Detected models -->
        <div v-if="localServerConnected && localServerModels.length > 0">
          <label class="mb-1 block text-xs font-medium text-(--ui-text-muted)">
            Models ({{ localServerModels.length }})
          </label>
          <div class="flex flex-wrap gap-1">
            <UBadge
              v-for="model in localServerModels"
              :key="model.id"
              :label="model.name"
              color="neutral"
              size="xs"
              variant="subtle"
            />
          </div>
        </div>
      </div>
    </UCard>

    <div v-for="provider in providers?.filter(p => p.id !== 'local-server')" :key="provider.id">
      <UCard>
        <template #header>
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2">
              <span class="text-sm font-semibold text-(--ui-text)">
                {{ provider.name }}
              </span>
              <UBadge
                :label="provider.type === 'cloud' ? 'Cloud' : 'Local'"
                :color="provider.type === 'cloud' ? 'info' : 'success'"
                size="xs"
                variant="subtle"
              />
            </div>
            <div class="flex items-center gap-1.5">
              <span
                class="h-2 w-2 rounded-full"
                :class="provider.isAvailable ? 'bg-green-500' : 'bg-red-400'"
              />
              <span class="text-xs text-(--ui-text-muted)">
                {{ providerStatusLabel(provider) }}
              </span>
            </div>
          </div>
        </template>

        <!-- Cloud provider: API key env var display -->
        <div v-if="provider.type === 'cloud' && provider.apiKeyEnvVar" class="space-y-3">
          <div>
            <label class="mb-1 block text-xs font-medium text-(--ui-text-muted)">
              Environment Variable
            </label>
            <div class="flex items-center gap-2">
              <UInput
                :model-value="provider.apiKeyEnvVar"
                readonly
                size="sm"
                class="flex-1 font-mono"
                :ui="{ base: 'cursor-default' }"
              />
              <UBadge
                :label="provider.isAvailable ? 'Set' : 'Not set'"
                :color="provider.isAvailable ? 'success' : 'warning'"
                size="xs"
                variant="subtle"
              />
            </div>
            <p class="mt-1 text-xs text-(--ui-text-dimmed)">
              Set this environment variable in your shell to enable {{ provider.name }}.
            </p>
          </div>

          <!-- Model list -->
          <div v-if="provider.models.length > 0">
            <label class="mb-1 block text-xs font-medium text-(--ui-text-muted)">
              Models ({{ provider.models.length }})
            </label>
            <div class="flex flex-wrap gap-1">
              <UBadge
                v-for="model in provider.models"
                :key="model.id"
                :label="model.name"
                color="neutral"
                size="xs"
                variant="subtle"
              />
            </div>
          </div>
        </div>

        <!-- Ollama: local provider -->
        <div v-if="provider.id === 'ollama'" class="space-y-3">
          <div>
            <label class="mb-1 block text-xs font-medium text-(--ui-text-muted)">
              Base URL
            </label>
            <UInput
              v-model="ollamaBaseUrl"
              size="sm"
              placeholder="http://localhost:11434"
              class="font-mono"
            />
          </div>

          <!-- Pulled models -->
          <div>
            <div class="mb-1 flex items-center justify-between">
              <label class="text-xs font-medium text-(--ui-text-muted)">
                Pulled Models ({{ ollamaModels.length }})
              </label>
              <UButton
                icon="i-lucide-refresh-cw"
                size="xs"
                color="neutral"
                variant="ghost"
                label="Refresh"
                :disabled="!ollamaRunning"
                @click="refreshOllama"
              />
            </div>
            <div v-if="ollamaModels.length > 0" class="flex flex-wrap gap-1">
              <UBadge
                v-for="model in ollamaModels"
                :key="model.id"
                :label="model.name"
                color="neutral"
                size="xs"
                variant="subtle"
              />
            </div>
            <p v-else class="text-xs text-(--ui-text-dimmed)">
              {{ ollamaRunning ? 'No models pulled yet.' : 'Ollama is not running.' }}
            </p>
          </div>

          <!-- Pull new model -->
          <div v-if="ollamaRunning">
            <label class="mb-1 block text-xs font-medium text-(--ui-text-muted)">
              Pull Model
            </label>
            <div class="flex items-center gap-2">
              <UInput
                v-model="pullModelName"
                size="sm"
                placeholder="e.g. llama3.2"
                class="flex-1"
                :disabled="isPulling"
                @keydown.enter="pullOllamaModel"
              />
              <UButton
                label="Pull"
                size="sm"
                color="primary"
                :loading="isPulling"
                :disabled="!pullModelName.trim()"
                @click="pullOllamaModel"
              />
            </div>

            <!-- Pull progress -->
            <div v-if="pullProgress" class="mt-2">
              <div class="flex items-center justify-between text-xs text-(--ui-text-muted)">
                <span>{{ pullProgress.status }}</span>
                <span v-if="pullProgress.total">{{ pullPercent }}%</span>
              </div>
              <div v-if="pullProgress.total" class="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-(--ui-bg-accented)">
                <div
                  class="h-full rounded-full bg-primary-500 transition-all duration-300"
                  :style="{ width: `${pullPercent}%` }"
                />
              </div>
            </div>
          </div>
        </div>
      </UCard>
    </div>
  </div>
</template>
