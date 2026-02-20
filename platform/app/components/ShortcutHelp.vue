<script setup lang="ts">
import type { KeyBinding } from '~/composables/useKeyboardShortcuts'

const props = defineProps<{
  open: boolean
  bindings: KeyBinding[]
}>()

const emit = defineEmits<{
  'close': []
}>()

const categories: { key: KeyBinding['category']; label: string }[] = [
  { key: 'panels', label: 'Panels' },
  { key: 'navigation', label: 'Navigation' },
  { key: 'general', label: 'General' },
]

function bindingsForCategory(category: KeyBinding['category']): KeyBinding[] {
  return props.bindings.filter(b => b.category === category && b.enabled !== false)
}

function formatKeys(keys: string): string[] {
  return keys.split('+').map(s => s.trim())
}

function onOverlayClick(e: MouseEvent) {
  if ((e.target as HTMLElement).classList.contains('shortcut-overlay')) {
    emit('close')
  }
}

function onKeyDown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    emit('close')
  }
}

watchEffect(() => {
  if (import.meta.server) return
  if (props.open) {
    document.addEventListener('keydown', onKeyDown, true)
  } else {
    document.removeEventListener('keydown', onKeyDown, true)
  }
})

onUnmounted(() => {
  if (import.meta.server) return
  document.removeEventListener('keydown', onKeyDown, true)
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
        class="shortcut-overlay fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
        @click="onOverlayClick"
      >
        <UCard class="w-full max-w-lg">
          <template #header>
            <div class="flex items-center justify-between">
              <h2 class="text-lg font-semibold text-(--ui-text)">
                Keyboard Shortcuts
              </h2>
              <UButton
                icon="i-lucide-x"
                size="xs"
                color="neutral"
                variant="ghost"
                @click="emit('close')"
              />
            </div>
          </template>

          <div class="space-y-6">
            <div v-for="cat in categories" :key="cat.key">
              <template v-if="bindingsForCategory(cat.key).length > 0">
                <h3 class="mb-2 text-xs font-semibold uppercase tracking-wider text-(--ui-text-muted)">
                  {{ cat.label }}
                </h3>
                <div class="space-y-1">
                  <div
                    v-for="binding in bindingsForCategory(cat.key)"
                    :key="binding.id"
                    class="flex items-center justify-between rounded-md px-2 py-1.5 hover:bg-(--ui-bg-muted)"
                  >
                    <span class="text-sm text-(--ui-text-toned)">
                      {{ binding.description }}
                    </span>
                    <div class="flex items-center gap-1">
                      <kbd
                        v-for="(part, i) in formatKeys(binding.keys)"
                        :key="i"
                        class="inline-flex min-w-[1.5rem] items-center justify-center rounded border border-(--ui-border-accented) bg-(--ui-bg-muted) px-1.5 py-0.5 text-xs font-mono font-medium text-(--ui-text-toned)"
                      >
                        {{ part }}
                      </kbd>
                    </div>
                  </div>
                </div>
              </template>
            </div>
          </div>

          <!-- Terminal-native shortcuts (static) -->
          <div class="mt-6 border-t border-(--ui-border) pt-4">
            <h3 class="mb-2 text-xs font-semibold uppercase tracking-wider text-(--ui-text-muted)">
              Terminal
            </h3>
            <p class="mb-2 text-xs text-(--ui-text-dimmed)">
              These shortcuts are handled directly by the terminal application when a terminal is focused.
            </p>
            <div class="space-y-1">
              <div
                v-for="ts in [
                  { keys: 'Ctrl+O', description: 'Toggle thinking (Claude Code)' },
                  { keys: 'Ctrl+C', description: 'Cancel / interrupt' },
                  { keys: 'Ctrl+D', description: 'End of input' },
                  { keys: 'Ctrl+L', description: 'Clear terminal' },
                  { keys: 'Ctrl+R', description: 'Reverse search (shell)' },
                ]"
                :key="ts.keys"
                class="flex items-center justify-between rounded-md px-2 py-1.5"
              >
                <span class="text-sm text-(--ui-text-muted)">
                  {{ ts.description }}
                </span>
                <div class="flex items-center gap-1">
                  <kbd
                    v-for="(part, i) in formatKeys(ts.keys)"
                    :key="i"
                    class="inline-flex min-w-[1.5rem] items-center justify-center rounded border border-(--ui-border-accented) bg-(--ui-bg-muted) px-1.5 py-0.5 text-xs font-mono font-medium text-(--ui-text-toned)"
                  >
                    {{ part }}
                  </kbd>
                </div>
              </div>
            </div>
          </div>

          <template #footer>
            <p class="text-center text-xs text-(--ui-text-dimmed)">
              Terminal shortcuts pass through except Ctrl+Shift combos
            </p>
          </template>
        </UCard>
      </div>
    </Transition>
  </Teleport>
</template>
