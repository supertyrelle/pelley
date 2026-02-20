<script setup lang="ts">
// ---------------------------------------------------------------------------
// Props & Emits
// ---------------------------------------------------------------------------

const props = withDefaults(defineProps<{
  disabled?: boolean
  placeholder?: string
  agentStatus?: string
  isThinking?: boolean
}>(), {
  disabled: false,
  placeholder: 'Send a message...',
  agentStatus: undefined,
  isThinking: false,
})

const emit = defineEmits<{
  send: [message: string]
}>()

// ---------------------------------------------------------------------------
// Input state
// ---------------------------------------------------------------------------

const input = ref('')
const textareaRef = ref<{ textarea: HTMLTextAreaElement } | null>(null)

const isBusy = computed(() => {
  return props.agentStatus === 'starting' || props.agentStatus === 'running'
})

const canSend = computed(() => {
  return input.value.trim().length > 0 && !isBusy.value && !props.disabled
})

const charCount = computed(() => input.value.length)

// ---------------------------------------------------------------------------
// Status indicator text
// ---------------------------------------------------------------------------

const statusText = computed<string | null>(() => {
  switch (props.agentStatus) {
    case 'starting': return 'Agent is starting...'
    case 'running': return props.isThinking ? 'Reasoning...' : 'Generating response...'
    case 'waiting-approval': return 'Waiting for approval...'
    case 'error': return 'Agent encountered an error'
    case 'complete': return 'Agent completed'
    default: return null
  }
})

const statusIcon = computed<string>(() => {
  switch (props.agentStatus) {
    case 'starting': return 'i-lucide-loader-2'
    case 'running': return props.isThinking ? 'i-lucide-brain' : 'i-lucide-loader-2'
    case 'waiting-approval': return 'i-lucide-shield-question'
    case 'error': return 'i-lucide-alert-triangle'
    case 'complete': return 'i-lucide-check-circle'
    default: return ''
  }
})

const statusSpin = computed(() => {
  return props.agentStatus === 'starting' || (props.agentStatus === 'running' && !props.isThinking)
})

const statusPulse = computed(() => {
  return props.agentStatus === 'running' && props.isThinking
})

// ---------------------------------------------------------------------------
// Autocomplete state
// ---------------------------------------------------------------------------

type AutocompleteMode = 'slash' | 'mention' | null

const autocompleteMode = ref<AutocompleteMode>(null)
const autocompleteQuery = ref('')
const autocompleteItems = ref<Array<{ label: string; value: string }>>([])
const autocompleteVisible = ref(false)
const selectedAutocompleteIndex = ref(0)

// Stubbed slash commands
const slashCommands = [
  'blossom', 'fractal', 'gather', 'distill', 'rank',
  'review', 'status', 'retro', 'handoff', 'plan',
  'decompose', 'spec', 'meeting', 'sprint', 'standup',
]

// Agent names fetched for @-mention
const agentNames = ref<string[]>([])

async function fetchAgentNames() {
  try {
    const agents = await $fetch<Array<{ id: string; name: string }>>('/api/agents')
    agentNames.value = agents.map(a => a.name ?? a.id)
  }
  catch {
    agentNames.value = []
  }
}

if (import.meta.client) {
  onMounted(fetchAgentNames)
}

// ---------------------------------------------------------------------------
// Autocomplete detection
// ---------------------------------------------------------------------------

function detectAutocomplete() {
  const value = input.value
  const textarea = textareaRef.value?.textarea
  if (!textarea) {
    closeAutocomplete()
    return
  }

  const cursorPos = textarea.selectionStart
  const textBeforeCursor = value.slice(0, cursorPos)

  // Check for slash command: `/` at start of line or after whitespace
  const slashMatch = textBeforeCursor.match(/(?:^|\s)\/([\w-]*)$/)
  if (slashMatch) {
    autocompleteMode.value = 'slash'
    autocompleteQuery.value = slashMatch[1]
    const filtered = slashCommands
      .filter(cmd => cmd.startsWith(autocompleteQuery.value))
      .map(cmd => ({ label: `/${cmd}`, value: `/${cmd}` }))
    autocompleteItems.value = filtered
    autocompleteVisible.value = filtered.length > 0
    selectedAutocompleteIndex.value = 0
    return
  }

  // Check for @-mention: `@` after whitespace or at start
  const mentionMatch = textBeforeCursor.match(/(?:^|\s)@([\w-]*)$/)
  if (mentionMatch) {
    autocompleteMode.value = 'mention'
    autocompleteQuery.value = mentionMatch[1]
    const filtered = agentNames.value
      .filter(name => name.toLowerCase().startsWith(autocompleteQuery.value.toLowerCase()))
      .map(name => ({ label: `@${name}`, value: `@${name}` }))
    autocompleteItems.value = filtered
    autocompleteVisible.value = filtered.length > 0
    selectedAutocompleteIndex.value = 0
    return
  }

  closeAutocomplete()
}

function closeAutocomplete() {
  autocompleteVisible.value = false
  autocompleteMode.value = null
  autocompleteItems.value = []
  autocompleteQuery.value = ''
}

function acceptAutocomplete(item: { label: string; value: string }) {
  const textarea = textareaRef.value?.textarea
  if (!textarea) return

  const cursorPos = textarea.selectionStart
  const textBeforeCursor = input.value.slice(0, cursorPos)
  const textAfterCursor = input.value.slice(cursorPos)

  // Find the trigger position to replace from
  let triggerStart = cursorPos
  if (autocompleteMode.value === 'slash') {
    const match = textBeforeCursor.match(/(?:^|\s)(\/[\w-]*)$/)
    if (match) triggerStart = cursorPos - match[1].length
  }
  else if (autocompleteMode.value === 'mention') {
    const match = textBeforeCursor.match(/(?:^|\s)(@[\w-]*)$/)
    if (match) triggerStart = cursorPos - match[1].length
  }

  const before = input.value.slice(0, triggerStart)
  input.value = before + item.value + ' ' + textAfterCursor.trimStart()

  closeAutocomplete()

  // Restore focus
  nextTick(() => {
    const newPos = before.length + item.value.length + 1
    textarea.focus()
    textarea.setSelectionRange(newPos, newPos)
  })
}

// ---------------------------------------------------------------------------
// Keyboard handling
// ---------------------------------------------------------------------------

function handleKeydown(e: KeyboardEvent) {
  // Autocomplete navigation
  if (autocompleteVisible.value) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      selectedAutocompleteIndex.value = Math.min(
        selectedAutocompleteIndex.value + 1,
        autocompleteItems.value.length - 1,
      )
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      selectedAutocompleteIndex.value = Math.max(selectedAutocompleteIndex.value - 1, 0)
      return
    }
    if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
      if (autocompleteItems.value.length > 0) {
        e.preventDefault()
        acceptAutocomplete(autocompleteItems.value[selectedAutocompleteIndex.value]!)
        return
      }
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      closeAutocomplete()
      return
    }
  }

  // Submit on Enter (Shift+Enter for newline)
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    handleSubmit()
  }
}

function handleInput() {
  detectAutocomplete()
}

function handleSubmit() {
  const text = input.value.trim()
  if (!text || !canSend.value) return
  input.value = ''
  closeAutocomplete()
  emit('send', text)
}
</script>

<template>
  <div class="border-t border-(--ui-border)">
    <!-- Status indicator -->
    <Transition name="slide-fade">
      <div
        v-if="statusText"
        class="flex items-center gap-2 border-b border-(--ui-border) px-3 py-1.5"
      >
        <UIcon
          :name="statusIcon"
          class="h-3.5 w-3.5 text-(--ui-text-dimmed)"
          :class="{ 'animate-spin': statusSpin, 'animate-pulse': statusPulse }"
        />
        <span class="text-xs text-(--ui-text-muted)">{{ statusText }}</span>
      </div>
    </Transition>

    <!-- Input area -->
    <div class="relative p-3">
      <!-- Autocomplete dropdown -->
      <Transition name="fade">
        <div
          v-if="autocompleteVisible && autocompleteItems.length > 0"
          class="absolute bottom-full left-3 right-3 z-20 mb-1 max-h-48 overflow-y-auto rounded-lg border border-(--ui-border) bg-(--ui-bg) shadow-lg"
        >
          <button
            v-for="(item, idx) in autocompleteItems"
            :key="item.value"
            class="flex w-full items-center px-3 py-1.5 text-left text-sm transition-colors"
            :class="idx === selectedAutocompleteIndex
              ? 'bg-(--ui-bg-accented) text-(--ui-text)'
              : 'text-(--ui-text-muted) hover:bg-(--ui-bg-muted)'"
            @mousedown.prevent="acceptAutocomplete(item)"
            @mouseenter="selectedAutocompleteIndex = idx"
          >
            <span>{{ item.label }}</span>
          </button>
        </div>
      </Transition>

      <!-- Textarea + send button -->
      <div class="flex items-end gap-2">
        <UTextarea
          ref="textareaRef"
          v-model="input"
          :rows="1"
          :placeholder="placeholder"
          size="sm"
          autoresize
          class="flex-1"
          :disabled="disabled"
          @keydown="handleKeydown"
          @input="handleInput"
        />
        <UButton
          icon="i-lucide-send"
          size="sm"
          color="neutral"
          variant="soft"
          :disabled="!canSend"
          @click="handleSubmit"
        />
      </div>

      <!-- Character count -->
      <div
        v-if="charCount > 0"
        class="mt-1 text-right text-[10px] text-(--ui-text-dimmed)"
      >
        {{ charCount.toLocaleString() }}
      </div>
    </div>
  </div>
</template>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.15s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

.slide-fade-enter-active,
.slide-fade-leave-active {
  transition: all 0.2s ease;
}

.slide-fade-enter-from,
.slide-fade-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
</style>
