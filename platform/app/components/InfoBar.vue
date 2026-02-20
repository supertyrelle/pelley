<script setup lang="ts">
// -----------------------------------------------------------------------
// Composables
// -----------------------------------------------------------------------

const { tasks, activeTasks } = useTaskManager()
const { stats, connected } = useBeadsSync()

// -----------------------------------------------------------------------
// Agent / context metrics
// -----------------------------------------------------------------------

const runningAgentCount = computed(() => activeTasks.value.length)

const sharedCount = computed(() =>
  tasks.value.filter(t => t.contextScope === 'shared' && t.status === 'running').length,
)

const isolatedCount = computed(() =>
  tasks.value.filter(t => t.contextScope === 'isolated' && t.status === 'running').length,
)

const contextLabel = computed(() => {
  const s = sharedCount.value
  const i = isolatedCount.value
  if (s === 0 && i === 0) return 'no sessions'
  if (s > 0 && i === 0) return `${s} shared`
  if (s === 0 && i > 0) return `${i} isolated`
  return `${s} shared, ${i} isolated`
})

// -----------------------------------------------------------------------
// Project name (mirrors sidebar logic)
// -----------------------------------------------------------------------

const projectName = computed(() => {
  const running = tasks.value.find(t => t.status === 'running')
  const path = running?.projectPath ?? tasks.value[0]?.projectPath ?? ''
  if (!path) return 'No Project'
  const parts = path.split('/')
  return parts[parts.length - 1] ?? path
})

// -----------------------------------------------------------------------
// Beads stats
// -----------------------------------------------------------------------

const beadsOpen = computed(() => stats.value?.open ?? 0)
const beadsInProgress = computed(() => stats.value?.inProgress ?? 0)
const beadsClosed = computed(() => stats.value?.closed ?? 0)

// -----------------------------------------------------------------------
// Clock (updated every minute)
// -----------------------------------------------------------------------

const currentTime = ref('')

function updateTime() {
  const now = new Date()
  currentTime.value = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

let clockInterval: ReturnType<typeof setInterval> | null = null

if (import.meta.client) {
  onMounted(() => {
    updateTime()
    clockInterval = setInterval(updateTime, 60_000)
  })

  onUnmounted(() => {
    if (clockInterval) clearInterval(clockInterval)
  })
}
</script>

<template>
  <footer
    class="flex h-6 flex-shrink-0 items-center justify-between border-t border-(--ui-border) bg-(--ui-bg) px-3 text-[11px] text-(--ui-text-muted)"
  >
    <!-- Left section: agents + context -->
    <div class="flex items-center gap-3">
      <UTooltip
        :text="`${runningAgentCount} agent${runningAgentCount === 1 ? '' : 's'} running, ${tasks.length} total tasks`"
        :content="{ side: 'top' }"
      >
        <span class="flex items-center gap-1">
          <UIcon name="i-lucide-bot" class="h-3 w-3" />
          <span>{{ runningAgentCount }} agent{{ runningAgentCount === 1 ? '' : 's' }}</span>
        </span>
      </UTooltip>

      <UTooltip
        :text="`Context: ${contextLabel}`"
        :content="{ side: 'top' }"
      >
        <span class="flex items-center gap-1">
          <UIcon name="i-lucide-layers" class="h-3 w-3" />
          <span v-if="sharedCount > 0 || isolatedCount > 0">
            {{ sharedCount > 0 ? `${sharedCount} shared` : `${isolatedCount} isolated` }}
          </span>
          <span v-else>isolated</span>
        </span>
      </UTooltip>
    </div>

    <!-- Center section: project name -->
    <div class="flex items-center gap-1 text-(--ui-text-toned)">
      <UIcon name="i-lucide-folder" class="h-3 w-3" />
      <span class="max-w-[200px] truncate">{{ projectName }}</span>
    </div>

    <!-- Right section: beads + connection + clock -->
    <div class="flex items-center gap-3">
      <UTooltip
        :text="`Beads: ${beadsOpen} open, ${beadsInProgress} active, ${beadsClosed} closed (${stats?.total ?? 0} total)`"
        :content="{ side: 'top' }"
      >
        <span class="flex items-center gap-1.5">
          <span class="text-blue-500 dark:text-blue-400">{{ beadsOpen }}</span>
          <span class="text-(--ui-text-dimmed)">/</span>
          <span class="text-yellow-600 dark:text-yellow-400">{{ beadsInProgress }}</span>
          <span class="text-(--ui-text-dimmed)">/</span>
          <span class="text-(--ui-text-toned)">{{ beadsClosed }}</span>
        </span>
      </UTooltip>

      <UTooltip
        :text="connected ? 'WebSocket connected' : 'WebSocket disconnected'"
        :content="{ side: 'top' }"
      >
        <span
          class="inline-block h-1.5 w-1.5 rounded-full"
          :class="connected ? 'bg-green-500' : 'bg-red-500'"
        />
      </UTooltip>

      <span class="tabular-nums">{{ currentTime }}</span>
    </div>
  </footer>
</template>
