<script setup lang="ts">
// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

const props = defineProps<{
  callId: string
  toolName: string
  input: Record<string, unknown>
  output?: string
  status: 'pending' | 'running' | 'complete' | 'error'
  duration?: number
  error?: string
}>()

// ---------------------------------------------------------------------------
// Local state
// ---------------------------------------------------------------------------

const expanded = ref(false)
const outputExpanded = ref(false)

// ---------------------------------------------------------------------------
// Computed
// ---------------------------------------------------------------------------

const formattedDuration = computed(() => {
  if (props.duration == null) return null
  if (props.duration < 1000) return `${props.duration}ms`
  return `${(props.duration / 1000).toFixed(1)}s`
})

const statusColor = computed(() => {
  switch (props.status) {
    case 'pending': return 'neutral' as const
    case 'running': return 'info' as const
    case 'complete': return 'success' as const
    case 'error': return 'error' as const
  }
})

const statusLabel = computed(() => {
  switch (props.status) {
    case 'pending': return 'pending'
    case 'running': return 'running'
    case 'complete': return 'complete'
    case 'error': return 'error'
  }
})

const statusIcon = computed(() => {
  switch (props.status) {
    case 'pending': return 'i-lucide-clock'
    case 'running': return 'i-lucide-loader-2'
    case 'complete': return 'i-lucide-check'
    case 'error': return 'i-lucide-alert-triangle'
  }
})

const toolIcon = computed(() => {
  const name = props.toolName.toLowerCase()
  if (name.includes('read') || name.includes('file')) return 'i-lucide-file-text'
  if (name.includes('write') || name.includes('edit')) return 'i-lucide-pencil'
  if (name.includes('bash') || name.includes('shell') || name.includes('exec')) return 'i-lucide-terminal'
  if (name.includes('grep') || name.includes('search')) return 'i-lucide-search'
  if (name.includes('glob') || name.includes('list')) return 'i-lucide-folder-search'
  return 'i-lucide-wrench'
})

const formattedInput = computed(() => {
  try {
    return JSON.stringify(props.input, null, 2)
  }
  catch {
    return String(props.input)
  }
})

const OUTPUT_TRUNCATE_LENGTH = 500

const truncatedOutput = computed(() => {
  if (!props.output) return null
  if (props.output.length <= OUTPUT_TRUNCATE_LENGTH || outputExpanded.value) {
    return props.output
  }
  return props.output.slice(0, OUTPUT_TRUNCATE_LENGTH)
})

const outputIsTruncated = computed(() => {
  if (!props.output) return false
  return props.output.length > OUTPUT_TRUNCATE_LENGTH && !outputExpanded.value
})
</script>

<template>
  <div class="rounded-lg border border-(--ui-border) bg-(--ui-bg-elevated)">
    <!-- Collapsed header (always visible) -->
    <button
      class="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-(--ui-bg-accented)"
      :class="{ 'rounded-lg': !expanded, 'rounded-t-lg': expanded }"
      @click="expanded = !expanded"
    >
      <!-- Tool icon -->
      <UIcon :name="toolIcon" class="h-3.5 w-3.5 flex-shrink-0 text-(--ui-text-dimmed)" />

      <!-- Tool name -->
      <span class="text-xs font-medium text-(--ui-text-toned) font-mono">
        {{ toolName }}
      </span>

      <!-- Status badge -->
      <UBadge
        :label="statusLabel"
        :icon="statusIcon"
        :color="statusColor"
        size="xs"
        variant="subtle"
        :class="{ 'animate-pulse': status === 'running' }"
      />

      <!-- Duration -->
      <span
        v-if="formattedDuration"
        class="text-xs tabular-nums text-(--ui-text-dimmed)"
      >
        {{ formattedDuration }}
      </span>

      <!-- Expand chevron (right-aligned) -->
      <UIcon
        name="i-lucide-chevron-down"
        class="ml-auto h-3.5 w-3.5 text-(--ui-text-dimmed) transition-transform"
        :class="{ 'rotate-180': expanded }"
      />
    </button>

    <!-- Expanded content -->
    <div
      v-if="expanded"
      class="border-t border-(--ui-border)"
    >
      <!-- Input params -->
      <div class="px-3 py-2">
        <span class="text-xs font-medium text-(--ui-text-dimmed)">Input</span>
        <pre class="mt-1 overflow-auto rounded-md bg-(--ui-bg-accented) p-2 text-xs leading-relaxed text-(--ui-text-toned) font-mono">{{ formattedInput }}</pre>
      </div>

      <!-- Output -->
      <div
        v-if="truncatedOutput != null"
        class="border-t border-(--ui-border) px-3 py-2"
      >
        <span class="text-xs font-medium text-(--ui-text-dimmed)">Output</span>
        <pre class="mt-1 overflow-auto rounded-md bg-(--ui-bg-accented) p-2 text-xs leading-relaxed text-(--ui-text-toned) font-mono whitespace-pre-wrap break-words">{{ truncatedOutput }}</pre>
        <button
          v-if="outputIsTruncated"
          class="mt-1 text-xs text-(--ui-text-muted) underline hover:text-(--ui-text)"
          @click.stop="outputExpanded = true"
        >
          Show full output ({{ output!.length }} chars)
        </button>
      </div>

      <!-- Error -->
      <div
        v-if="error"
        class="border-t border-(--ui-border) px-3 py-2"
      >
        <span class="text-xs font-medium text-red-500">Error</span>
        <pre class="mt-1 overflow-auto rounded-md bg-red-50 p-2 text-xs leading-relaxed text-red-700 font-mono whitespace-pre-wrap break-words dark:bg-red-900/20 dark:text-red-400">{{ error }}</pre>
      </div>
    </div>
  </div>
</template>
