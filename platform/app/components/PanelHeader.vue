<script setup lang="ts">
import type { PanelState, TerminalConnectionStatus } from '~/composables/useTilingLayout'

const props = withDefaults(defineProps<{
  panel: PanelState
  panelType?: 'terminal' | 'driver' | 'plugin'
}>(), {
  panelType: 'terminal',
})

// Read driver state shared via useState (AgentConversation is a sibling, not ancestor)
const injectedAgentStatus = useState<string | null>(`driver-status-${props.panel.id}`, () => null)
const injectedTokensUsed = useState<{ input: number; output: number } | null>(`driver-tokens-${props.panel.id}`, () => null)
const injectedPendingApprovals = useState<number>(`driver-approvals-${props.panel.id}`, () => 0)
const injectedTokensPerSecond = useState<number | null>(`driver-tps-${props.panel.id}`, () => null)
const injectedIsThinking = useState<boolean>(`driver-thinking-${props.panel.id}`, () => false)

const emit = defineEmits<{
  'close': []
  'activate': []
}>()

const { getTerminalStatus, terminalStatuses, getTerminalActivity, terminalActivities } = useTilingLayout()

const terminalStatus = computed<TerminalConnectionStatus>(() => {
  // Access terminalStatuses.value to ensure reactivity triggers
  const _statuses = terminalStatuses.value
  return getTerminalStatus(props.panel.id)
})

const isTerminalIdle = computed(() => {
  // Access terminalActivities.value to ensure reactivity triggers
  const _activities = terminalActivities.value
  return getTerminalActivity(props.panel.id)
})

const statusColor = computed(() => {
  if (props.panelType === 'driver') {
    switch (injectedAgentStatus.value) {
      case 'running': return injectedIsThinking.value ? 'bg-gray-400 animate-pulse' : 'bg-green-500'
      case 'idle': return 'bg-emerald-400'
      case 'starting': return 'bg-yellow-500 animate-pulse'
      case 'waiting-approval': return 'bg-amber-500 animate-pulse'
      case 'complete': return 'bg-blue-500'
      case 'error': return 'bg-red-500'
      default: return 'bg-gray-400'
    }
  }
  switch (terminalStatus.value) {
    case 'connected': return 'bg-green-500'
    case 'connecting': return 'bg-yellow-500 animate-pulse'
    case 'error': return 'bg-red-500'
    case 'disconnected':
    default: return 'bg-gray-400'
  }
})

const displayName = computed(() => {
  return props.panel.agentName ?? props.panel.agentId ?? 'Empty Panel'
})

const driverStatusLabel = computed(() => {
  switch (injectedAgentStatus.value) {
    case 'idle': return 'Ready'
    case 'running': return injectedIsThinking.value ? 'Thinking' : 'Generating'
    case 'starting': return 'Starting'
    case 'waiting-approval': return 'Awaiting Approval'
    case 'complete': return 'Complete'
    case 'error': return 'Error'
    default: return null
  }
})

const driverStatusBadgeColor = computed(() => {
  switch (injectedAgentStatus.value) {
    case 'idle': return 'success' as const
    case 'running': return (injectedIsThinking.value ? 'neutral' : 'success') as const
    case 'starting': return 'warning' as const
    case 'waiting-approval': return 'warning' as const
    case 'complete': return 'info' as const
    case 'error': return 'error' as const
    default: return 'neutral' as const
  }
})

const isStreaming = computed(() => injectedAgentStatus.value === 'running')

function formatTokens(count: number): string {
  if (count >= 1000) return `${(count / 1000).toFixed(1)}k`
  return String(count)
}

function formatTokPerSec(tps: number): string {
  return tps >= 100 ? Math.round(tps).toString() : tps.toFixed(1)
}
</script>

<template>
  <div
    class="flex h-10 flex-shrink-0 cursor-pointer items-center justify-between border-b border-(--ui-border) bg-(--ui-bg-muted) px-3"
    @click="emit('activate')"
  >
    <div class="flex items-center gap-2 overflow-hidden">
      <span
        class="h-2 w-2 flex-shrink-0 rounded-full"
        :class="statusColor"
        :title="panelType === 'driver' ? (driverStatusLabel ?? 'Idle') : terminalStatus"
      />
      <span class="truncate text-sm font-medium text-(--ui-text-toned)">
        {{ displayName }}
      </span>

      <!-- Terminal-specific metadata -->
      <template v-if="panelType === 'terminal'">
        <span
          v-if="terminalStatus === 'connected' && isTerminalIdle"
          class="flex-shrink-0 text-xs text-(--ui-text-dimmed)"
        >
          waiting&hellip;
        </span>
        <span
          v-else-if="terminalStatus === 'connected' && !isTerminalIdle"
          class="activity-dots flex-shrink-0 text-xs text-green-500"
          aria-label="Receiving output"
        >
          &bull;&bull;&bull;
        </span>
      </template>

      <!-- Driver-specific metadata -->
      <template v-else-if="panelType === 'driver'">
        <UBadge
          v-if="driverStatusLabel"
          :label="driverStatusLabel"
          :color="driverStatusBadgeColor"
          size="xs"
          variant="subtle"
        />
        <span
          v-if="injectedTokensUsed"
          class="flex items-center gap-1 flex-shrink-0 text-xs text-(--ui-text-dimmed)"
          :title="`Input: ${injectedTokensUsed.input} / Output: ${injectedTokensUsed.output}`"
        >
          {{ formatTokens(injectedTokensUsed.input + injectedTokensUsed.output) }} tokens
          <template v-if="injectedTokensPerSecond != null">
            <span class="text-(--ui-border)">&middot;</span>
            <span
              class="inline-flex items-center gap-0.5 tabular-nums"
              :class="isStreaming ? 'text-green-500' : 'text-(--ui-text-dimmed)'"
            >
              <UIcon v-if="isStreaming" name="i-lucide-zap" class="h-3 w-3" />
              {{ formatTokPerSec(injectedTokensPerSecond) }} tok/s
            </span>
          </template>
        </span>
        <UBadge
          v-if="injectedPendingApprovals && injectedPendingApprovals > 0"
          :label="`${injectedPendingApprovals} pending`"
          color="warning"
          size="xs"
          variant="solid"
        />
      </template>
    </div>

    <UButton
      icon="i-lucide-x"
      size="xs"
      color="neutral"
      variant="ghost"
      class="flex-shrink-0"
      @click.stop="emit('close')"
    />
  </div>
</template>

<style scoped>
.activity-dots {
  animation: pulse-dots 1.5s ease-in-out infinite;
}

@keyframes pulse-dots {
  0%, 100% { opacity: 0.4; }
  50% { opacity: 1; }
}
</style>
