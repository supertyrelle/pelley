<script setup lang="ts">
import type { AgentConfig, LaunchOptions } from '~~/shared/types/agent'
import { INSTANCE_CAPABILITIES } from '~~/shared/types/agent'
import type { ModelProvider } from '~~/shared/types/model'

import type { PanelType } from '~/composables/useTilingLayout'

const emit = defineEmits<{
  'select': [agentId: string, options: LaunchOptions, panelType: PanelType, agentName: string]
}>()

const { data: agents, status } = useFetch<AgentConfig[]>('/api/agents')
const { data: providers } = useFetch<ModelProvider[]>('/api/models/providers')

const instanceIcons: Record<string, string> = {
  'claude-code': 'i-lucide-terminal',
  'opencode': 'i-lucide-code',
  'kimi-code': 'i-lucide-sparkles',
  'llmcp': 'i-lucide-network',
  'custom': 'i-lucide-bot',
}

function getIcon(agent: AgentConfig): string {
  return instanceIcons[agent.instanceType] ?? instanceIcons.custom!
}

// Two-step flow state
const selectedAgent = ref<AgentConfig | null>(null)
const sessionContinue = ref(false)
const permissionSkip = ref(false)
const selectedProvider = ref<string>('')
const selectedModel = ref<string>('')
const launchMode = ref<PanelType>('terminal')

// Model selector computeds
const availableProviders = computed(() => {
  const all = providers.value ?? []
  return all
    .filter(p => p.isAvailable || p.models.length > 0 || p.id === 'ollama' || p.id === 'local-server')
    .map(p => ({ label: p.isAvailable ? p.name : `${p.name} (not connected)`, value: p.id }))
})

const providerModels = computed(() => {
  if (!selectedProvider.value) return []
  const provider = (providers.value ?? []).find(p => p.id === selectedProvider.value)
  if (!provider) return []
  return provider.models.map(m => ({ label: m.name, value: m.id }))
})

let skipProviderWatch = false

watch(selectedProvider, () => {
  if (skipProviderWatch) {
    skipProviderWatch = false
    return
  }
  selectedModel.value = ''
})

function selectAgent(agent: AgentConfig) {
  selectedAgent.value = agent
  sessionContinue.value = false
  permissionSkip.value = false
  launchMode.value = 'terminal'

  // Pre-populate model selector from agent's modelConfig
  if (agent.modelConfig) {
    skipProviderWatch = true
    selectedProvider.value = agent.modelConfig.provider
    selectedModel.value = agent.modelConfig.model
  } else {
    selectedProvider.value = ''
    selectedModel.value = ''
  }
}

function launch() {
  if (!selectedAgent.value) return
  emit('select', selectedAgent.value.id, {
    sessionContinue: sessionContinue.value || undefined,
    permissionSkip: permissionSkip.value || undefined,
    modelOverride: selectedProvider.value && selectedModel.value
      ? { provider: selectedProvider.value, model: selectedModel.value }
      : undefined,
  }, launchMode.value, selectedAgent.value.name)
}

function backToList() {
  selectedAgent.value = null
}

const selectedCaps = computed(() => {
  if (!selectedAgent.value) return null
  return INSTANCE_CAPABILITIES[selectedAgent.value.instanceType]
})
</script>

<template>
  <div class="flex h-full items-center justify-center bg-(--ui-bg) p-6">
    <div class="w-full max-w-sm">
      <!-- Step 2: Launch options -->
      <template v-if="selectedAgent">
        <button
          class="mb-4 flex items-center gap-1 text-xs text-(--ui-text-muted) transition-colors hover:text-(--ui-text)"
          @click="backToList"
        >
          <UIcon name="i-lucide-arrow-left" class="h-3.5 w-3.5" />
          Back
        </button>

        <div class="mb-4 flex items-center gap-3 rounded-lg border border-(--ui-border) bg-(--ui-bg-elevated) px-4 py-3">
          <UIcon
            :name="getIcon(selectedAgent)"
            class="h-5 w-5 flex-shrink-0 text-(--ui-text-muted)"
          />
          <div class="text-sm font-medium text-(--ui-text)">
            {{ selectedAgent.name }}
          </div>
        </div>

        <div class="mb-4 flex flex-col gap-3">
          <label
            v-if="selectedCaps?.sessionContinue"
            class="flex items-center justify-between rounded-lg border border-(--ui-border) bg-(--ui-bg-elevated) px-4 py-3"
          >
            <div>
              <div class="text-sm text-(--ui-text)">Continue session</div>
              <div class="text-xs text-(--ui-text-muted)">Resume the previous conversation</div>
            </div>
            <USwitch v-model="sessionContinue" size="sm" />
          </label>

          <label
            v-if="selectedCaps?.permissionSkip"
            class="flex items-center justify-between rounded-lg border border-(--ui-border) bg-(--ui-bg-elevated) px-4 py-3"
          >
            <div>
              <div class="text-sm text-(--ui-text)">Skip permissions</div>
              <div class="text-xs text-(--ui-text-muted)">Run without approval prompts</div>
            </div>
            <USwitch v-model="permissionSkip" size="sm" />
          </label>

          <!-- Model override selector -->
          <div class="flex flex-col gap-2 rounded-lg border border-(--ui-border) bg-(--ui-bg-elevated) px-4 py-3">
            <div class="text-sm text-(--ui-text)">Model</div>
            <div class="text-xs text-(--ui-text-muted)">Override the default model for this session</div>
            <div class="flex gap-2 mt-1">
              <USelect
                v-model="selectedProvider"
                :items="availableProviders"
                placeholder="Provider"
                class="flex-1"
                size="xs"
                value-key="value"
              />
              <USelect
                v-if="providerModels.length > 0"
                v-model="selectedModel"
                :items="providerModels"
                placeholder="Model"
                class="flex-1"
                size="xs"
                value-key="value"
                :disabled="!selectedProvider"
              />
              <UInput
                v-else
                v-model="selectedModel"
                placeholder="Model name"
                class="flex-1"
                size="xs"
                :disabled="!selectedProvider"
              />
            </div>
          </div>
        </div>

        <!-- Launch mode selector -->
        <div class="mb-4 flex flex-col gap-2 rounded-lg border border-(--ui-border) bg-(--ui-bg-elevated) px-4 py-3">
          <div class="text-sm text-(--ui-text)">Launch mode</div>
          <div class="flex gap-1 rounded-md bg-(--ui-bg) p-0.5">
            <button
              class="flex-1 rounded px-3 py-1.5 text-xs font-medium transition-colors"
              :class="launchMode === 'terminal'
                ? 'bg-(--ui-bg-elevated) text-(--ui-text) shadow-sm'
                : 'text-(--ui-text-muted) hover:text-(--ui-text)'"
              @click="launchMode = 'terminal'"
            >
              <UIcon name="i-lucide-terminal" class="mr-1 h-3.5 w-3.5 align-text-bottom" />
              Terminal
            </button>
            <button
              class="flex-1 rounded px-3 py-1.5 text-xs font-medium transition-colors"
              :class="launchMode === 'driver'
                ? 'bg-(--ui-bg-elevated) text-(--ui-text) shadow-sm'
                : 'text-(--ui-text-muted) hover:text-(--ui-text)'"
              @click="launchMode = 'driver'"
            >
              <UIcon name="i-lucide-message-square" class="mr-1 h-3.5 w-3.5 align-text-bottom" />
              Chat
            </button>
          </div>
        </div>

        <UButton
          block
          size="sm"
          color="neutral"
          variant="soft"
          label="Launch"
          @click="launch"
        />
      </template>

      <!-- Step 1: Agent list -->
      <template v-else>
        <h3 class="mb-4 text-center text-sm font-semibold text-(--ui-text-toned)">
          Select an Agent
        </h3>

        <!-- Loading state -->
        <div
          v-if="status === 'pending'"
          class="flex justify-center py-6"
        >
          <div class="h-5 w-5 animate-spin rounded-full border-2 border-(--ui-border-accented) border-t-transparent" />
        </div>

        <!-- Error state -->
        <div
          v-else-if="status === 'error'"
          class="py-6 text-center text-sm text-red-500"
        >
          Failed to load agents
        </div>

        <!-- Agent list -->
        <div
          v-else-if="agents && agents.length > 0"
          class="flex flex-col gap-2"
        >
          <button
            v-for="agent in agents"
            :key="agent.id"
            class="flex items-center gap-3 rounded-lg border border-(--ui-border) bg-(--ui-bg-elevated) px-4 py-3 text-left transition-colors hover:border-(--ui-border-accented) hover:bg-(--ui-bg-muted)"
            @click="selectAgent(agent)"
          >
            <UIcon
              :name="getIcon(agent)"
              class="h-5 w-5 flex-shrink-0 text-(--ui-text-muted)"
            />
            <div class="min-w-0 flex-1">
              <div class="truncate text-sm font-medium text-(--ui-text)">
                {{ agent.name }}
              </div>
              <div class="truncate text-xs text-(--ui-text-muted)">
                {{ agent.command }} {{ agent.args.join(' ') }}
              </div>
            </div>
            <UIcon
              name="i-lucide-chevron-right"
              class="h-4 w-4 flex-shrink-0 text-(--ui-text-dimmed)"
            />
          </button>
        </div>

        <!-- Empty state -->
        <div
          v-else
          class="py-6 text-center text-sm text-(--ui-text-muted)"
        >
          No agents configured. Add one in Settings.
        </div>
      </template>
    </div>
  </div>
</template>
