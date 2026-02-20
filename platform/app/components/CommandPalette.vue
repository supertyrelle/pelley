<script setup lang="ts">
import type { KeyBinding } from '~/composables/useKeyboardShortcuts'

const open = defineModel<boolean>('open', { default: false })

const { getAll } = useKeyboardShortcuts()

const query = ref('')
const selectedIndex = ref(0)
const inputRef = ref<HTMLInputElement | null>(null)

const categories: { key: KeyBinding['category']; label: string }[] = [
  { key: 'general', label: 'General' },
  { key: 'panels', label: 'Panels' },
  { key: 'navigation', label: 'Navigation' },
]

const filteredBindings = computed(() => {
  const all = getAll().filter(b => b.enabled !== false)
  if (!query.value.trim()) return all
  const q = query.value.toLowerCase()
  return all.filter(b =>
    b.description.toLowerCase().includes(q)
    || b.keys.toLowerCase().includes(q)
    || b.category.toLowerCase().includes(q),
  )
})

const groupedBindings = computed(() => {
  return categories
    .map(cat => ({
      ...cat,
      bindings: filteredBindings.value.filter(b => b.category === cat.key),
    }))
    .filter(group => group.bindings.length > 0)
})

const flatList = computed(() => {
  return groupedBindings.value.flatMap(g => g.bindings)
})

function formatKeys(keys: string): string[] {
  return keys.split('+').map(s => s.trim())
}

function close() {
  open.value = false
  query.value = ''
  selectedIndex.value = 0
}

function executeCommand(binding: KeyBinding) {
  close()
  nextTick(() => {
    binding.action()
  })
}

function onKeyDown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    e.preventDefault()
    e.stopPropagation()
    close()
    return
  }

  if (e.key === 'ArrowDown') {
    e.preventDefault()
    selectedIndex.value = Math.min(selectedIndex.value + 1, flatList.value.length - 1)
    return
  }

  if (e.key === 'ArrowUp') {
    e.preventDefault()
    selectedIndex.value = Math.max(selectedIndex.value - 1, 0)
    return
  }

  if (e.key === 'Enter') {
    e.preventDefault()
    const binding = flatList.value[selectedIndex.value]
    if (binding) executeCommand(binding)
  }
}

watch(query, () => {
  selectedIndex.value = 0
})

watch(open, (isOpen) => {
  if (isOpen) {
    query.value = ''
    selectedIndex.value = 0
    nextTick(() => {
      inputRef.value?.focus()
    })
  }
})
</script>

<template>
  <Teleport to="body">
    <Transition
      enter-active-class="transition-opacity duration-150"
      leave-active-class="transition-opacity duration-150"
      enter-from-class="opacity-0"
      leave-to-class="opacity-0"
    >
      <div
        v-if="open"
        class="fixed inset-0 z-50"
        @keydown="onKeyDown"
      >
        <!-- Backdrop -->
        <div class="fixed inset-0 bg-black/50 backdrop-blur-sm" @click="close" />

        <!-- Palette -->
        <div class="relative mx-auto mt-20 max-w-lg rounded-lg border border-(--ui-border) bg-(--ui-bg-elevated) shadow-2xl">
          <!-- Search input -->
          <div class="border-b border-(--ui-border) p-2">
            <div class="flex items-center gap-2 px-2">
              <UIcon name="i-lucide-search" class="size-4 shrink-0 text-(--ui-text-dimmed)" />
              <input
                ref="inputRef"
                v-model="query"
                type="text"
                placeholder="Type a command..."
                class="w-full bg-transparent text-sm text-(--ui-text) placeholder-(--ui-text-dimmed) outline-none"
              >
            </div>
          </div>

          <!-- Command list -->
          <div class="max-h-80 overflow-y-auto p-1">
            <template v-if="flatList.length > 0">
              <template v-for="group in groupedBindings" :key="group.key">
                <div class="px-2 pb-1 pt-2">
                  <span class="text-xs font-semibold uppercase tracking-wider text-(--ui-text-muted)">
                    {{ group.label }}
                  </span>
                </div>
                <button
                  v-for="(binding, i) in group.bindings"
                  :key="binding.id"
                  class="flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm transition-colors"
                  :class="[
                    flatList.indexOf(binding) === selectedIndex
                      ? 'bg-blue-50 text-blue-900 dark:bg-blue-900/30 dark:text-blue-100'
                      : 'text-(--ui-text-toned) hover:bg-(--ui-bg-muted)',
                  ]"
                  @click="executeCommand(binding)"
                  @mouseenter="selectedIndex = flatList.indexOf(binding)"
                >
                  <span>{{ binding.description }}</span>
                  <div class="flex items-center gap-1">
                    <kbd
                      v-for="(part, j) in formatKeys(binding.keys)"
                      :key="j"
                      class="inline-flex min-w-[1.5rem] items-center justify-center rounded border border-(--ui-border-accented) bg-(--ui-bg-muted) px-1.5 py-0.5 text-xs font-mono font-medium text-(--ui-text-toned)"
                    >
                      {{ part }}
                    </kbd>
                  </div>
                </button>
              </template>
            </template>

            <div v-else class="px-3 py-6 text-center text-sm text-(--ui-text-dimmed)">
              No commands found
            </div>
          </div>

          <!-- Footer -->
          <div class="flex items-center justify-between border-t border-(--ui-border) px-3 py-1.5">
            <div class="flex items-center gap-3 text-xs text-(--ui-text-dimmed)">
              <span class="flex items-center gap-1">
                <kbd class="rounded border border-(--ui-border-accented) px-1 text-xs">↑↓</kbd>
                navigate
              </span>
              <span class="flex items-center gap-1">
                <kbd class="rounded border border-(--ui-border-accented) px-1 text-xs">↵</kbd>
                run
              </span>
              <span class="flex items-center gap-1">
                <kbd class="rounded border border-(--ui-border-accented) px-1 text-xs">esc</kbd>
                close
              </span>
            </div>
            <span class="text-xs text-(--ui-text-dimmed)">
              {{ flatList.length }} command{{ flatList.length === 1 ? '' : 's' }}
            </span>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
