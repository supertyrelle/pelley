<script setup lang="ts">
import type { AgentDriverEvent } from '~~/shared/types/agent-driver'

const props = defineProps<{
  events: AgentDriverEvent[]
  activeIndex?: number
}>()

const emit = defineEmits<{
  'scroll-to': [eventIndex: number]
}>()

// ---------------------------------------------------------------------------
// Significant steps derived from events
// ---------------------------------------------------------------------------

interface TimelineStep {
  /** Index into the original events array */
  eventIndex: number
  kind: 'thinking' | 'tool-call' | 'approval' | 'file-change' | 'error' | 'complete'
  label: string
  detail: string
}

const steps = computed<TimelineStep[]>(() => {
  const result: TimelineStep[] = []

  for (let i = 0; i < props.events.length; i++) {
    const evt = props.events[i]!
    switch (evt.type) {
      case 'thinking':
        result.push({
          eventIndex: i,
          kind: 'thinking',
          label: 'Thinking',
          detail: evt.phase ?? 'Reasoning',
        })
        break

      case 'tool-call-start':
        result.push({
          eventIndex: i,
          kind: 'tool-call',
          label: evt.toolName,
          detail: `Tool: ${evt.toolName}`,
        })
        break

      case 'approval-request':
        result.push({
          eventIndex: i,
          kind: 'approval',
          label: 'Approval',
          detail: `${evt.toolName}: ${evt.action}`,
        })
        break

      case 'file-change':
        result.push({
          eventIndex: i,
          kind: 'file-change',
          label: evt.filePath.split('/').pop() ?? evt.filePath,
          detail: `${evt.editType}: ${evt.filePath}`,
        })
        break

      case 'error':
        result.push({
          eventIndex: i,
          kind: 'error',
          label: 'Error',
          detail: evt.message,
        })
        break

      case 'complete':
        result.push({
          eventIndex: i,
          kind: 'complete',
          label: 'Done',
          detail: evt.summary ?? 'Complete',
        })
        break
    }
  }

  return result
})

// ---------------------------------------------------------------------------
// Styling helpers
// ---------------------------------------------------------------------------

function dotColor(kind: TimelineStep['kind']): string {
  switch (kind) {
    case 'thinking': return 'bg-blue-500'
    case 'tool-call': return 'bg-purple-500'
    case 'approval': return 'bg-amber-500'
    case 'file-change': return 'bg-green-500'
    case 'error': return 'bg-red-500'
    case 'complete': return 'bg-green-500'
  }
}

function dotIcon(kind: TimelineStep['kind']): string {
  switch (kind) {
    case 'thinking': return 'i-lucide-brain'
    case 'tool-call': return 'i-lucide-wrench'
    case 'approval': return 'i-lucide-shield-check'
    case 'file-change': return 'i-lucide-file-edit'
    case 'error': return 'i-lucide-alert-circle'
    case 'complete': return 'i-lucide-check-circle'
  }
}

function isActive(step: TimelineStep): boolean {
  return props.activeIndex != null && step.eventIndex === props.activeIndex
}

// ---------------------------------------------------------------------------
// Horizontal scroll container
// ---------------------------------------------------------------------------

const scrollRef = ref<HTMLElement | null>(null)

// Auto-scroll to the active step when it changes
watch(() => props.activeIndex, () => {
  if (scrollRef.value && props.activeIndex != null) {
    const activeEl = scrollRef.value.querySelector('[data-active="true"]')
    if (activeEl) {
      activeEl.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' })
    }
  }
})
</script>

<template>
  <div
    v-if="steps.length > 0"
    ref="scrollRef"
    class="flex items-center gap-0 overflow-x-auto px-2 py-1.5 scrollbar-thin"
  >
    <template v-for="(step, idx) in steps" :key="step.eventIndex">
      <!-- Connecting line (between dots, not before first) -->
      <div
        v-if="idx > 0"
        class="h-px w-4 flex-shrink-0 bg-(--ui-border)"
      />

      <!-- Step dot -->
      <UTooltip :text="step.detail">
        <button
          class="relative flex flex-shrink-0 items-center justify-center rounded-full transition-all"
          :class="[
            isActive(step) ? 'h-7 w-7' : 'h-5 w-5',
            dotColor(step.kind),
            isActive(step) ? 'ring-2 ring-offset-1 ring-offset-(--ui-bg) ring-current' : '',
          ]"
          :data-active="isActive(step)"
          :title="step.label"
          @click="emit('scroll-to', step.eventIndex)"
        >
          <UIcon
            :name="dotIcon(step.kind)"
            class="text-white"
            :class="isActive(step) ? 'h-3.5 w-3.5' : 'h-2.5 w-2.5'"
          />

          <!-- Pulse animation for active step -->
          <span
            v-if="isActive(step)"
            class="absolute inset-0 animate-ping rounded-full opacity-30"
            :class="dotColor(step.kind)"
          />
        </button>
      </UTooltip>
    </template>
  </div>
</template>

<style scoped>
.scrollbar-thin {
  scrollbar-width: thin;
}
.scrollbar-thin::-webkit-scrollbar {
  height: 4px;
}
.scrollbar-thin::-webkit-scrollbar-track {
  background: transparent;
}
.scrollbar-thin::-webkit-scrollbar-thumb {
  background: var(--ui-border);
  border-radius: 2px;
}
</style>
