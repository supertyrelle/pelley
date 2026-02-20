<script setup lang="ts">
import type { AgentDiffDetail } from '~~/shared/types/agent-driver'

const props = withDefaults(defineProps<{
  filePath: string
  editType: 'create' | 'edit' | 'delete'
  before?: string
  after: string
  diff?: AgentDiffDetail
  collapsed?: boolean
}>(), {
  collapsed: true,
})

const emit = defineEmits<{
  'open-modal': [filePath: string]
  'revert': [filePath: string, before: string]
}>()

// ---------------------------------------------------------------------------
// Modal state
// ---------------------------------------------------------------------------

const modalOpen = ref(false)

function openModal() {
  modalOpen.value = true
  emit('open-modal', props.filePath)
}

function closeModal() {
  modalOpen.value = false
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && modalOpen.value) {
    closeModal()
  }
}

onMounted(() => {
  document.addEventListener('keydown', onKeydown)
})

onUnmounted(() => {
  document.removeEventListener('keydown', onKeydown)
})

type RevertStatus = 'idle' | 'pending' | 'success' | 'error'
const revertStatus = ref<RevertStatus>('idle')
const revertError = ref<string | null>(null)

const canRevert = computed(() =>
  props.before != null && props.editType !== 'create' && revertStatus.value !== 'success',
)

async function handleRevert() {
  if (!props.before) return
  revertStatus.value = 'pending'
  revertError.value = null

  try {
    await $fetch('/api/agent/revert', {
      method: 'POST',
      body: { filePath: props.filePath, before: props.before },
    })
    revertStatus.value = 'success'
    emit('revert', props.filePath, props.before)
  }
  catch (err) {
    revertStatus.value = 'error'
    revertError.value = err instanceof Error ? err.message : 'Revert failed'
  }
}

const isCollapsed = ref(props.collapsed)

function toggle() {
  isCollapsed.value = !isCollapsed.value
}

const fileName = computed(() => props.filePath.split('/').pop() ?? props.filePath)

const editBadge = computed(() => {
  switch (props.editType) {
    case 'create': return { label: 'Created', color: 'success' as const }
    case 'edit': return { label: 'Edited', color: 'info' as const }
    case 'delete': return { label: 'Deleted', color: 'error' as const }
  }
})

// Compute a simple line-by-line diff
const diffLines = computed(() => {
  if (props.editType === 'create') {
    return props.after.split('\n').map(line => ({ type: 'add' as const, content: line }))
  }
  if (props.editType === 'delete') {
    const content = props.before ?? props.after
    return content.split('\n').map(line => ({ type: 'remove' as const, content: line }))
  }

  // Edit: compute simple line diff from before/after
  if (props.before != null) {
    const beforeLines = props.before.split('\n')
    const afterLines = props.after.split('\n')
    return computeSimpleDiff(beforeLines, afterLines)
  }

  // No before content available, just show after as context
  return props.after.split('\n').map(line => ({ type: 'context' as const, content: line }))
})

function computeSimpleDiff(
  beforeLines: string[],
  afterLines: string[],
): Array<{ type: 'add' | 'remove' | 'context'; content: string }> {
  const result: Array<{ type: 'add' | 'remove' | 'context'; content: string }> = []

  // Simple LCS-based diff
  const m = beforeLines.length
  const n = afterLines.length

  // Build LCS table
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0))
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (beforeLines[i - 1] === afterLines[j - 1]) {
        dp[i]![j] = dp[i - 1]![j - 1]! + 1
      }
      else {
        dp[i]![j] = Math.max(dp[i - 1]![j]!, dp[i]![j - 1]!)
      }
    }
  }

  // Backtrack to build diff
  const lines: Array<{ type: 'add' | 'remove' | 'context'; content: string }> = []
  let i = m
  let j = n
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && beforeLines[i - 1] === afterLines[j - 1]) {
      lines.push({ type: 'context', content: beforeLines[i - 1]! })
      i--
      j--
    }
    else if (j > 0 && (i === 0 || dp[i]![j - 1]! >= dp[i - 1]![j]!)) {
      lines.push({ type: 'add', content: afterLines[j - 1]! })
      j--
    }
    else {
      lines.push({ type: 'remove', content: beforeLines[i - 1]! })
      i--
    }
  }

  lines.reverse()
  return lines
}

function getLangFromPath(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? ''
  const map: Record<string, string> = {
    ts: 'typescript',
    tsx: 'tsx',
    js: 'javascript',
    jsx: 'jsx',
    vue: 'vue',
    py: 'python',
    rs: 'rust',
    go: 'go',
    json: 'json',
    yaml: 'yaml',
    yml: 'yaml',
    md: 'markdown',
    css: 'css',
    html: 'html',
    sh: 'bash',
  }
  return map[ext] ?? 'plaintext'
}
</script>

<template>
  <div class="overflow-hidden rounded-md border border-(--ui-border)">
    <!-- Collapsed header -->
    <button
      class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-(--ui-bg-accented)"
      @click="toggle"
    >
      <UIcon
        name="i-lucide-file-text"
        class="h-4 w-4 flex-shrink-0 text-(--ui-text-muted)"
      />
      <span class="truncate font-mono text-xs text-(--ui-text-toned)">
        {{ filePath }}
      </span>
      <UBadge
        :label="editBadge.label"
        :color="editBadge.color"
        size="xs"
        variant="subtle"
      />
      <span class="flex-1" />
      <UBadge
        v-if="revertStatus === 'success'"
        label="Reverted"
        color="success"
        size="xs"
        variant="subtle"
      />
      <UBadge
        v-else-if="revertStatus === 'error'"
        :label="revertError ?? 'Revert failed'"
        color="error"
        size="xs"
        variant="subtle"
      />
      <UButton
        v-if="canRevert"
        icon="i-lucide-undo-2"
        size="xs"
        color="neutral"
        variant="ghost"
        title="Revert change"
        :loading="revertStatus === 'pending'"
        @click.stop="handleRevert"
      />
      <UButton
        icon="i-lucide-maximize-2"
        size="xs"
        color="neutral"
        variant="ghost"
        title="Open in modal"
        @click.stop="openModal()"
      />
      <UIcon
        :name="isCollapsed ? 'i-lucide-chevron-right' : 'i-lucide-chevron-down'"
        class="h-4 w-4 flex-shrink-0 text-(--ui-text-dimmed)"
      />
    </button>

    <!-- Expanded diff view -->
    <div
      v-if="!isCollapsed"
      class="max-h-[400px] overflow-auto border-t border-(--ui-border) bg-(--ui-bg)"
    >
      <pre class="p-0 font-mono text-xs leading-5"><template
  v-for="(line, idx) in diffLines"
  :key="idx"
><span
  class="block px-3"
  :class="{
    'bg-green-50 text-green-800 dark:bg-green-900/30 dark:text-green-300': line.type === 'add',
    'bg-red-50 text-red-800 dark:bg-red-900/30 dark:text-red-300': line.type === 'remove',
    'text-(--ui-text-muted)': line.type === 'context',
  }"
><span class="inline-block w-4 select-none text-(--ui-text-dimmed)">{{ line.type === 'add' ? '+' : line.type === 'remove' ? '-' : ' ' }}</span>{{ line.content }}</span></template></pre>
    </div>

    <!-- Full-screen diff modal -->
    <UModal
      v-model:open="modalOpen"
      :ui="{ width: 'sm:max-w-6xl' }"
    >
      <template #header>
        <div class="flex items-center gap-2">
          <UIcon
            name="i-lucide-file-text"
            class="h-4 w-4 flex-shrink-0 text-(--ui-text-muted)"
          />
          <span class="truncate font-mono text-sm text-(--ui-text-toned)">
            {{ filePath }}
          </span>
          <UBadge
            :label="editBadge.label"
            :color="editBadge.color"
            size="xs"
            variant="subtle"
          />
          <span class="flex-1" />
          <UButton
            icon="i-lucide-x"
            size="xs"
            color="neutral"
            variant="ghost"
            title="Close"
            @click="closeModal()"
          />
        </div>
      </template>

      <template #body>
        <div class="overflow-auto bg-(--ui-bg)">
          <pre class="p-0 font-mono text-xs leading-5"><template
  v-for="(line, idx) in diffLines"
  :key="idx"
><span
  class="block px-3"
  :class="{
    'bg-green-50 text-green-800 dark:bg-green-900/30 dark:text-green-300': line.type === 'add',
    'bg-red-50 text-red-800 dark:bg-red-900/30 dark:text-red-300': line.type === 'remove',
    'text-(--ui-text-muted)': line.type === 'context',
  }"
><span class="inline-block w-4 select-none text-(--ui-text-dimmed)">{{ line.type === 'add' ? '+' : line.type === 'remove' ? '-' : ' ' }}</span>{{ line.content }}</span></template></pre>
        </div>
      </template>
    </UModal>
  </div>
</template>
