<script setup lang="ts">
import type { KeyBinding } from '~/composables/useKeyboardShortcuts'

const colorMode = useColorMode()
const { activeTerminalPalette, terminalPaletteNames, setTerminalPalette } = useTheme()

const terminalThemeOptions = terminalPaletteNames.map(name => ({
  label: name.charAt(0).toUpperCase() + name.slice(1),
  value: name,
}))

const terminalThemeModel = computed({
  get: () => activeTerminalPalette.value,
  set: (v: string) => setTerminalPalette(v as any),
})

const themeOptions = [
  { label: 'Light', value: 'light' },
  { label: 'Dark', value: 'dark' },
  { label: 'System', value: 'system' },
]

// Keyboard shortcuts reference
const { bindings } = useKeyboardShortcuts()

const categories: { key: KeyBinding['category']; label: string }[] = [
  { key: 'panels', label: 'Panels' },
  { key: 'navigation', label: 'Navigation' },
  { key: 'general', label: 'General' },
]

function bindingsForCategory(category: KeyBinding['category']): KeyBinding[] {
  return (bindings.value ?? []).filter(b => b.category === category && b.enabled !== false)
}

function formatKeys(keys: string): string[] {
  return keys.split('+').map(s => s.trim())
}
</script>

<template>
  <div class="space-y-6">
    <!-- Theme selector -->
    <div>
      <h3 class="mb-2 text-xs font-semibold uppercase tracking-wider text-(--ui-text-muted)">
        Appearance
      </h3>
      <UCard>
        <div class="flex items-center justify-between">
          <div>
            <span class="text-sm font-medium text-(--ui-text)">Theme</span>
            <p class="text-xs text-(--ui-text-muted)">
              Choose your preferred color scheme.
            </p>
          </div>
          <USelect
            v-model="colorMode.preference"
            :items="themeOptions"
            size="sm"
            value-key="value"
            class="w-28"
          />
        </div>
        <USeparator />
        <div class="flex items-center justify-between">
          <div>
            <span class="text-sm font-medium text-(--ui-text)">Terminal Theme</span>
            <p class="text-xs text-(--ui-text-muted)">
              Terminal color palette (follows light/dark mode).
            </p>
          </div>
          <USelect
            v-model="terminalThemeModel"
            :items="terminalThemeOptions"
            size="sm"
            value-key="value"
            class="w-44"
          />
        </div>
      </UCard>
    </div>

    <!-- Keyboard shortcuts reference -->
    <div>
      <h3 class="mb-2 text-xs font-semibold uppercase tracking-wider text-(--ui-text-muted)">
        Keyboard Shortcuts
      </h3>
      <UCard>
        <div class="space-y-4">
          <div v-for="cat in categories" :key="cat.key">
            <template v-if="bindingsForCategory(cat.key).length > 0">
              <h4 class="mb-1.5 text-xs font-semibold text-(--ui-text-toned)">
                {{ cat.label }}
              </h4>
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

          <div v-if="bindings.length === 0" class="text-center">
            <p class="text-sm text-(--ui-text-muted)">
              No keyboard shortcuts registered.
            </p>
          </div>
        </div>

        <template #footer>
          <p class="text-xs text-(--ui-text-dimmed)">
            Terminal shortcuts pass through except Ctrl+Shift combos.
          </p>
        </template>
      </UCard>
    </div>
  </div>
</template>
