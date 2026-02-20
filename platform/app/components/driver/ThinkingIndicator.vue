<script setup lang="ts">
const props = defineProps<{
  active: boolean
  phase?: string
  startedAt?: number
  reasoning?: string
}>()

// ---------------------------------------------------------------------------
// Elapsed time counter
// ---------------------------------------------------------------------------

const elapsed = ref(0)
let timer: ReturnType<typeof setInterval> | null = null

function startTimer() {
  stopTimer()
  updateElapsed()
  timer = setInterval(updateElapsed, 1000)
}

function stopTimer() {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}

function updateElapsed() {
  if (props.startedAt) {
    elapsed.value = Math.floor((Date.now() - props.startedAt) / 1000)
  }
}

watch(() => props.active, (active) => {
  if (active && props.startedAt) {
    startTimer()
  } else {
    stopTimer()
  }
}, { immediate: true })

watch(() => props.startedAt, (ts) => {
  if (ts && props.active) {
    startTimer()
  }
})

onUnmounted(stopTimer)

// ---------------------------------------------------------------------------
// Reasoning expand/collapse
// ---------------------------------------------------------------------------

const reasoningExpanded = ref(false)

const reasoningPreview = computed(() => {
  if (!props.reasoning || props.reasoning.length <= 80) return props.reasoning ?? ''
  return '\u2026' + props.reasoning.slice(-80)
})

const ARC_CAP = 30 // seconds
const ARC_RADIUS = 6
const ARC_CIRCUMFERENCE = 2 * Math.PI * ARC_RADIUS

const arcDashoffset = computed(() => {
  const progress = Math.min(elapsed.value / ARC_CAP, 1)
  return ARC_CIRCUMFERENCE * (1 - progress)
})

const formattedElapsed = computed(() => {
  const s = elapsed.value
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  const rem = s % 60
  return `${m}m ${rem}s`
})
</script>

<template>
  <div class="flex flex-col gap-1">
    <div class="flex items-center gap-2 text-sm">
      <!-- Progress arc (active) -->
      <svg
        v-if="active"
        width="16"
        height="16"
        viewBox="0 0 16 16"
        class="flex-shrink-0"
      >
        <!-- Track -->
        <circle
          cx="8" cy="8" :r="6"
          fill="none"
          stroke="var(--ui-text-dimmed)"
          stroke-width="1.5"
          opacity="0.4"
        />
        <!-- Fill arc -->
        <circle
          cx="8" cy="8" :r="6"
          fill="none"
          stroke="var(--ui-text-dimmed)"
          stroke-width="1.5"
          opacity="0.6"
          stroke-linecap="round"
          :stroke-dasharray="ARC_CIRCUMFERENCE"
          :stroke-dashoffset="arcDashoffset"
          class="arc-fill"
        />
      </svg>
      <!-- Static dots (inactive) -->
      <span v-else class="flex items-center gap-0.5">
        <span class="h-1.5 w-1.5 rounded-full bg-(--ui-text-dimmed)" />
        <span class="h-1.5 w-1.5 rounded-full bg-(--ui-text-dimmed)" />
        <span class="h-1.5 w-1.5 rounded-full bg-(--ui-text-dimmed)" />
      </span>

      <!-- Label -->
      <span class="text-(--ui-text-dimmed)">
        {{ active ? 'thinking' : 'thought' }}&hellip;
      </span>
      <span v-if="startedAt" class="text-[10px] tabular-nums text-(--ui-text-dimmed)" :class="{ 'opacity-50': !active }">
        {{ formattedElapsed }}
      </span>

      <!-- Phase -->
      <span v-if="phase" class="text-(--ui-text-muted)">
        &middot; {{ phase }}
      </span>

      <!-- Reasoning toggle -->
      <button
        v-if="reasoning"
        class="ml-1 flex items-center text-(--ui-text-dimmed) hover:text-(--ui-text-muted)"
        @click="reasoningExpanded = !reasoningExpanded"
      >
        <UIcon
          :name="reasoningExpanded ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
          class="h-3.5 w-3.5"
        />
      </button>
    </div>

    <!-- Reasoning preview (collapsed, active, has content) -->
    <Transition name="reasoning-preview">
      <p
        v-if="reasoning && !reasoningExpanded && active"
        class="ml-6 truncate font-mono text-[11px] leading-snug text-(--ui-text-dimmed) opacity-60"
      >
        {{ reasoningPreview }}
      </p>
    </Transition>

    <!-- Reasoning content (expanded) -->
    <div
      v-if="reasoning && reasoningExpanded"
      class="ml-6 max-h-48 overflow-y-auto rounded bg-(--ui-bg-muted) px-3 py-2 font-mono text-xs leading-relaxed text-(--ui-text-muted)"
    >
      {{ reasoning }}<span v-if="active" class="streaming-cursor" />
    </div>
  </div>
</template>

<style scoped>
/* Progress arc: start from 12 o'clock, smooth fill */
.arc-fill {
  transform: rotate(-90deg);
  transform-origin: center;
  transition: stroke-dashoffset 1s linear;
}

/* Reasoning preview fade transition */
.reasoning-preview-enter-active,
.reasoning-preview-leave-active {
  transition: opacity 0.3s ease;
}

.reasoning-preview-enter-from,
.reasoning-preview-leave-to {
  opacity: 0;
}

/* Streaming cursor (matches MarkdownRenderer convention) */
.streaming-cursor {
  display: inline-block;
  width: 2px;
  height: 1em;
  margin-left: 1px;
  vertical-align: text-bottom;
  background-color: var(--ui-text-muted);
  animation: cursor-blink 1s step-end infinite;
}

@keyframes cursor-blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0; }
}
</style>
