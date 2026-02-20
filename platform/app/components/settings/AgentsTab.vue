<script setup lang="ts">
import type { AgentConfig } from '~~/shared/types/agent'
import { INSTANCE_CAPABILITIES } from '~~/shared/types/agent'
import type { LaunchOptions } from '~~/shared/types/agent'
import type { ModelProvider } from '~~/shared/types/model'

// Fetch agents and detection results
const { data: agents, refresh: refreshAgents } = await useFetch<AgentConfig[]>('/api/agents')
const { data: detectedAgents } = await useFetch<AgentConfig[]>('/api/agents/detect')
const { data: providers } = await useFetch<ModelProvider[]>('/api/models/providers')

// Launch defaults per agent
const launchDefaults = ref<Record<string, LaunchOptions>>({})

function agentHasLaunchOptions(agent: AgentConfig): boolean {
  const caps = INSTANCE_CAPABILITIES[agent.instanceType]
  return caps.sessionContinue || caps.permissionSkip
}

async function loadLaunchDefaults() {
  const allAgents = agents.value ?? []
  for (const agent of allAgents) {
    if (!agentHasLaunchOptions(agent)) continue
    try {
      const res = await $fetch<{ value: LaunchOptions | null }>(`/api/settings/agent-launch-defaults:${agent.id}`)
      if (res.value) {
        launchDefaults.value[agent.id] = res.value
      }
    } catch {
      // 404 or error — no defaults stored yet
    }
  }
}

async function toggleLaunchDefault(agentId: string, key: keyof LaunchOptions, value: boolean) {
  const current = launchDefaults.value[agentId] ?? {}
  const updated = { ...current, [key]: value }
  launchDefaults.value[agentId] = updated
  await $fetch(`/api/settings/agent-launch-defaults:${agentId}`, {
    method: 'PUT',
    body: { value: updated },
  })
}

onMounted(() => {
  watch(() => agents.value, () => loadLaunchDefaults(), { immediate: true })
})

// Track which agents are detected (by id)
const detectedIds = computed(() => {
  return new Set((detectedAgents.value ?? []).map(a => a.id))
})

// Separate built-in vs custom agents
const builtinAgents = computed(() => {
  return (agents.value ?? []).filter(a => a.instanceType !== 'custom')
})

const customAgents = computed(() => {
  return (agents.value ?? []).filter(a => a.instanceType === 'custom')
})

// Form state for adding/editing custom agents
const showForm = ref(false)
const editingId = ref<string | null>(null)

const formState = reactive({
  name: '',
  command: '',
  args: '',
  instanceType: 'custom' as AgentConfig['instanceType'],
  useModelConfig: false,
  provider: '',
  model: '',
})

const instanceTypeOptions = [
  { label: 'Custom', value: 'custom' },
  { label: 'Claude Code', value: 'claude-code' },
  { label: 'OpenCode', value: 'opencode' },
  { label: 'Kimi Code', value: 'kimi-code' },
  { label: 'llmcp', value: 'llmcp' },
]

// Available providers for the model config dropdown
const providerOptions = computed(() => {
  return (providers.value ?? []).map(p => ({
    label: p.name,
    value: p.id,
  }))
})

// Models for the selected provider
const modelOptions = computed(() => {
  if (!formState.provider) return []
  const provider = (providers.value ?? []).find(p => p.id === formState.provider)
  if (!provider) return []
  return provider.models.map(m => ({
    label: m.name,
    value: m.id,
  }))
})

function resetForm() {
  formState.name = ''
  formState.command = ''
  formState.args = ''
  formState.instanceType = 'custom'
  formState.useModelConfig = false
  formState.provider = ''
  formState.model = ''
  editingId.value = null
}

function openAddForm() {
  resetForm()
  showForm.value = true
}

function openEditForm(agent: AgentConfig) {
  editingId.value = agent.id
  formState.name = agent.name
  formState.command = agent.command
  formState.args = agent.args.join(', ')
  formState.instanceType = agent.instanceType
  formState.useModelConfig = !!agent.modelConfig
  formState.provider = agent.modelConfig?.provider ?? ''
  formState.model = agent.modelConfig?.model ?? ''
  showForm.value = true
}

function cancelForm() {
  showForm.value = false
  resetForm()
}

async function saveAgent() {
  const id = editingId.value ?? formState.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

  const config: AgentConfig = {
    id,
    name: formState.name,
    command: formState.command,
    args: formState.args ? formState.args.split(',').map(s => s.trim()).filter(Boolean) : [],
    instanceType: formState.instanceType,
  }

  if (formState.useModelConfig && formState.provider && formState.model) {
    const provider = (providers.value ?? []).find(p => p.id === formState.provider)
    config.modelConfig = {
      provider: formState.provider,
      model: formState.model,
      apiKeyEnvVar: provider?.apiKeyEnvVar,
      apiBaseUrl: provider?.defaultBaseUrl,
    }
  }

  await $fetch('/api/agents', {
    method: 'POST',
    body: config,
  })

  showForm.value = false
  resetForm()
  await refreshAgents()
}

async function deleteAgent(id: string) {
  await $fetch(`/api/agents/${id}` as string, { method: 'DELETE' })
  await refreshAgents()
}
</script>

<template>
  <div class="space-y-4">
    <!-- Built-in agents -->
    <div>
      <h3 class="mb-2 text-xs font-semibold uppercase tracking-wider text-(--ui-text-muted)">
        Built-in Agents
      </h3>
      <div class="space-y-2">
        <UCard v-for="agent in builtinAgents" :key="agent.id" class="opacity-90">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2">
              <span class="text-sm font-medium text-(--ui-text)">
                {{ agent.name }}
              </span>
              <UBadge
                :label="agent.instanceType"
                color="neutral"
                size="xs"
                variant="subtle"
              />
            </div>
            <div class="flex items-center gap-1.5">
              <span
                class="h-2 w-2 rounded-full"
                :class="detectedIds.has(agent.id) ? 'bg-green-500' : 'bg-gray-400'"
              />
              <span class="text-xs text-(--ui-text-muted)">
                {{ detectedIds.has(agent.id) ? 'Detected' : 'Not found' }}
              </span>
            </div>
          </div>
          <p class="mt-1 text-xs font-mono text-(--ui-text-dimmed)">
            {{ agent.command }} {{ agent.args.join(' ') }}
          </p>
          <!-- Launch defaults -->
          <div v-if="agentHasLaunchOptions(agent)" class="mt-2 flex items-center gap-4">
            <span class="text-xs font-medium text-(--ui-text-muted)">Launch defaults</span>
            <div v-if="INSTANCE_CAPABILITIES[agent.instanceType].sessionContinue" class="flex items-center gap-1.5">
              <USwitch
                :model-value="launchDefaults[agent.id]?.sessionContinue ?? false"
                size="xs"
                @update:model-value="(v: boolean) => toggleLaunchDefault(agent.id, 'sessionContinue', v)"
              />
              <UTooltip text="Resume the last conversation when starting a new terminal">
                <span class="text-xs text-(--ui-text-toned)">Continue session</span>
              </UTooltip>
            </div>
            <div v-if="INSTANCE_CAPABILITIES[agent.instanceType].permissionSkip" class="flex items-center gap-1.5">
              <USwitch
                :model-value="launchDefaults[agent.id]?.permissionSkip ?? false"
                size="xs"
                @update:model-value="(v: boolean) => toggleLaunchDefault(agent.id, 'permissionSkip', v)"
              />
              <UTooltip text="Auto-approve all tool calls (dangerous)">
                <span class="text-xs text-orange-500">Skip permissions</span>
              </UTooltip>
            </div>
          </div>
        </UCard>
      </div>
    </div>

    <!-- Custom agents -->
    <div>
      <div class="mb-2 flex items-center justify-between">
        <h3 class="text-xs font-semibold uppercase tracking-wider text-(--ui-text-muted)">
          Custom Agents
        </h3>
        <UButton
          icon="i-lucide-plus"
          size="xs"
          color="primary"
          variant="soft"
          label="Add Agent"
          @click="openAddForm"
        />
      </div>

      <div v-if="customAgents.length === 0 && !showForm" class="rounded-md border border-dashed border-(--ui-border-accented) p-4 text-center">
        <p class="text-sm text-(--ui-text-muted)">
          No custom agents configured.
        </p>
      </div>

      <div class="space-y-2">
        <UCard v-for="agent in customAgents" :key="agent.id">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2">
              <span class="text-sm font-medium text-(--ui-text)">
                {{ agent.name }}
              </span>
              <UBadge
                :label="agent.instanceType"
                color="neutral"
                size="xs"
                variant="subtle"
              />
              <UBadge
                v-if="agent.modelConfig"
                :label="`${agent.modelConfig.provider}/${agent.modelConfig.model}`"
                color="info"
                size="xs"
                variant="subtle"
              />
            </div>
            <div class="flex items-center gap-1">
              <UButton
                icon="i-lucide-pencil"
                size="xs"
                color="neutral"
                variant="ghost"
                @click="openEditForm(agent)"
              />
              <UButton
                icon="i-lucide-trash-2"
                size="xs"
                color="error"
                variant="ghost"
                @click="deleteAgent(agent.id)"
              />
            </div>
          </div>
          <p class="mt-1 text-xs font-mono text-(--ui-text-dimmed)">
            {{ agent.command }} {{ agent.args.join(' ') }}
          </p>
          <!-- Launch defaults -->
          <div v-if="agentHasLaunchOptions(agent)" class="mt-2 flex items-center gap-4">
            <span class="text-xs font-medium text-(--ui-text-muted)">Launch defaults</span>
            <div v-if="INSTANCE_CAPABILITIES[agent.instanceType].sessionContinue" class="flex items-center gap-1.5">
              <USwitch
                :model-value="launchDefaults[agent.id]?.sessionContinue ?? false"
                size="xs"
                @update:model-value="(v: boolean) => toggleLaunchDefault(agent.id, 'sessionContinue', v)"
              />
              <UTooltip text="Resume the last conversation when starting a new terminal">
                <span class="text-xs text-(--ui-text-toned)">Continue session</span>
              </UTooltip>
            </div>
            <div v-if="INSTANCE_CAPABILITIES[agent.instanceType].permissionSkip" class="flex items-center gap-1.5">
              <USwitch
                :model-value="launchDefaults[agent.id]?.permissionSkip ?? false"
                size="xs"
                @update:model-value="(v: boolean) => toggleLaunchDefault(agent.id, 'permissionSkip', v)"
              />
              <UTooltip text="Auto-approve all tool calls (dangerous)">
                <span class="text-xs text-orange-500">Skip permissions</span>
              </UTooltip>
            </div>
          </div>
        </UCard>
      </div>
    </div>

    <!-- Add/Edit form -->
    <UCard v-if="showForm">
      <template #header>
        <div class="flex items-center justify-between">
          <span class="text-sm font-semibold text-(--ui-text)">
            {{ editingId ? 'Edit Agent' : 'Add Custom Agent' }}
          </span>
          <UButton
            icon="i-lucide-x"
            size="xs"
            color="neutral"
            variant="ghost"
            @click="cancelForm"
          />
        </div>
      </template>

      <div class="space-y-3">
        <div>
          <label class="mb-1 block text-xs font-medium text-(--ui-text-muted)">
            Name
          </label>
          <UInput
            v-model="formState.name"
            size="sm"
            placeholder="My Agent"
          />
        </div>

        <div>
          <label class="mb-1 block text-xs font-medium text-(--ui-text-muted)">
            Command
          </label>
          <UInput
            v-model="formState.command"
            size="sm"
            placeholder="e.g. my-cli"
            class="font-mono"
          />
        </div>

        <div>
          <label class="mb-1 block text-xs font-medium text-(--ui-text-muted)">
            Arguments (comma-separated)
          </label>
          <UInput
            v-model="formState.args"
            size="sm"
            placeholder="e.g. serve, --port, 8080"
            class="font-mono"
          />
        </div>

        <div>
          <label class="mb-1 block text-xs font-medium text-(--ui-text-muted)">
            Instance Type
          </label>
          <USelect
            v-model="formState.instanceType"
            :items="instanceTypeOptions"
            size="sm"
            value-key="value"
          />
        </div>

        <!-- Model config toggle -->
        <div class="flex items-center gap-2">
          <USwitch
            v-model="formState.useModelConfig"
            size="sm"
          />
          <span class="text-xs text-(--ui-text-toned)">
            Configure model routing
          </span>
        </div>

        <!-- Model config fields -->
        <div v-if="formState.useModelConfig" class="space-y-3 rounded-md border border-(--ui-border) p-3">
          <div>
            <label class="mb-1 block text-xs font-medium text-(--ui-text-muted)">
              Provider
            </label>
            <USelect
              v-model="formState.provider"
              :items="providerOptions"
              size="sm"
              placeholder="Select provider"
              value-key="value"
            />
          </div>

          <div>
            <label class="mb-1 block text-xs font-medium text-(--ui-text-muted)">
              Model
            </label>
            <USelect
              v-model="formState.model"
              :items="modelOptions"
              size="sm"
              placeholder="Select model"
              value-key="value"
              :disabled="!formState.provider"
            />
          </div>
        </div>
      </div>

      <template #footer>
        <div class="flex justify-end gap-2">
          <UButton
            label="Cancel"
            size="sm"
            color="neutral"
            variant="outline"
            @click="cancelForm"
          />
          <UButton
            :label="editingId ? 'Update' : 'Create'"
            size="sm"
            color="primary"
            :disabled="!formState.name || !formState.command"
            @click="saveAgent"
          />
        </div>
      </template>
    </UCard>
  </div>
</template>
