<script setup lang="ts">
import type { LaunchOptions } from '~~/shared/types/agent'
import type { PanelType } from '~/composables/useTilingLayout'

const { panels, addPanel, removePanel, setActivePanel, resetWidths, updatePanel, maxPanels } = useTilingLayout()
const { register, getAll, bindings } = useKeyboardShortcuts()
const { activeProject } = useProjects()

const canAddPanel = computed(() => panels.value.length < maxPanels)
const showShortcutHelp = ref(false)
const showCommandPalette = ref(false)
const showSettings = ref(false)
const showProjectPicker = ref(false)

const sidebarCollapsed = useState('sidebar-collapsed', () => false)

// Show project picker when no active project is set
watch(activeProject, (project) => {
  if (!project) {
    showProjectPicker.value = true
  }
}, { immediate: true })

function getActivePanel() {
  return panels.value.find(p => p.isActive)
}

function focusPanelByIndex(index: number) {
  const panel = panels.value[index]
  if (panel) setActivePanel(panel.id)
}

function focusAdjacentPanel(direction: -1 | 1) {
  const activeIdx = panels.value.findIndex(p => p.isActive)
  if (activeIdx === -1) return
  const nextIdx = activeIdx + direction
  if (nextIdx >= 0 && nextIdx < panels.value.length) {
    setActivePanel(panels.value[nextIdx]!.id)
  }
}

// Register default shortcuts
register({ id: 'toggle-sidebar', keys: 'Ctrl+Shift+B', description: 'Toggle sidebar', category: 'general', action: () => { sidebarCollapsed.value = !sidebarCollapsed.value } })
register({ id: 'add-panel', keys: 'Ctrl+Shift+T', description: 'Add new panel', category: 'panels', action: () => { if (canAddPanel.value) addPanel() } })
register({ id: 'close-panel', keys: 'Ctrl+Shift+W', description: 'Close active panel', category: 'panels', action: () => { const p = getActivePanel(); if (p) removePanel(p.id) } })
register({ id: 'focus-panel-1', keys: 'Ctrl+1', description: 'Focus panel 1', category: 'panels', action: () => focusPanelByIndex(0) })
register({ id: 'focus-panel-2', keys: 'Ctrl+2', description: 'Focus panel 2', category: 'panels', action: () => focusPanelByIndex(1) })
register({ id: 'focus-panel-3', keys: 'Ctrl+3', description: 'Focus panel 3', category: 'panels', action: () => focusPanelByIndex(2) })
register({ id: 'focus-panel-4', keys: 'Ctrl+4', description: 'Focus panel 4', category: 'panels', action: () => focusPanelByIndex(3) })
register({ id: 'focus-panel-5', keys: 'Ctrl+5', description: 'Focus panel 5', category: 'panels', action: () => focusPanelByIndex(4) })
register({ id: 'focus-panel-6', keys: 'Ctrl+6', description: 'Focus panel 6', category: 'panels', action: () => focusPanelByIndex(5) })
register({ id: 'focus-prev', keys: 'Ctrl+Shift+Left', description: 'Focus previous panel', category: 'navigation', action: () => focusAdjacentPanel(-1) })
register({ id: 'focus-next', keys: 'Ctrl+Shift+Right', description: 'Focus next panel', category: 'navigation', action: () => focusAdjacentPanel(1) })
register({ id: 'reset-widths', keys: 'Ctrl+Shift+=', description: 'Reset panels to equal width', category: 'panels', action: () => resetWidths() })
register({ id: 'toggle-help', keys: 'Ctrl+Shift+?', description: 'Toggle keyboard shortcuts', category: 'general', action: () => { showShortcutHelp.value = !showShortcutHelp.value } })
register({ id: 'command-palette', keys: 'Ctrl+Shift+P', description: 'Open command palette', category: 'general', action: () => { showCommandPalette.value = !showCommandPalette.value } })
register({ id: 'new-bead', keys: 'Ctrl+Shift+N', description: 'Create new bead', category: 'general', action: () => { /* will be wired later */ } })
</script>

<template>
  <AppLayout>
    <div class="flex h-full flex-col">
      <!-- Top bar -->
      <header class="flex h-12 flex-shrink-0 items-center justify-between border-b border-(--ui-border) bg-(--ui-bg-elevated) px-4">
        <button
          class="flex items-center gap-2 rounded px-2 py-1 transition-colors hover:bg-(--ui-bg-accented)"
          @click="showProjectPicker = true"
        >
          <UIcon name="i-lucide-folder" class="h-4 w-4 text-(--ui-text-muted)" />
          <span class="text-sm font-semibold text-(--ui-text-toned)">
            {{ activeProject?.name ?? 'No Project' }}
          </span>
          <UIcon name="i-lucide-chevron-down" class="h-3 w-3 text-(--ui-text-dimmed)" />
        </button>

        <div class="flex items-center gap-1">
          <UButton
            icon="i-lucide-plus"
            size="xs"
            color="neutral"
            variant="ghost"
            label="Add Panel"
            :disabled="!canAddPanel"
            @click="addPanel()"
          />

          <SettingsModal v-model:open="showSettings" />
        </div>
      </header>

      <!-- Empty state -->
      <div
        v-if="panels.length === 0"
        class="flex flex-1 items-center justify-center bg-(--ui-bg) p-6"
      >
        <div class="flex flex-col items-center gap-4">
          <UIcon name="i-lucide-terminal-square" class="h-10 w-10 text-(--ui-text-dimmed)" />
          <div class="text-center">
            <p class="text-sm font-medium text-(--ui-text-muted)">No terminals open</p>
            <p class="mt-1 text-xs text-(--ui-text-dimmed)">Press Ctrl+Shift+T or click Add Panel to get started</p>
          </div>
          <UButton
            size="sm"
            color="neutral"
            variant="soft"
            icon="i-lucide-plus"
            label="Add Panel"
            @click="addPanel()"
          />
        </div>
      </div>

      <!-- Tiling area -->
      <TilingLayout v-else class="flex-1">
        <template #default="{ panel }">
          <AgentConversation
            v-if="panel.panelType === 'driver' && panel.agentId"
            :agent-id="panel.agentId"
            :panel-id="panel.id"
            :model-override="panel.launchOptions?.modelOverride"
            :cwd="activeProject?.path"
          />
          <TerminalView
            v-else-if="panel.agentId"
            :panel-id="panel.id"
            :agent-id="panel.agentId"
            :session-id="panel.sessionId"
            :launch-options="panel.launchOptions"
          />
          <AgentPicker
            v-else
            @select="(agentId: string, options: LaunchOptions, panelType: PanelType, agentName: string) => updatePanel(panel.id, { agentId, agentName, launchOptions: options, panelType })"
          />
        </template>
      </TilingLayout>

      <ShortcutHelp
        :open="showShortcutHelp"
        :bindings="getAll()"
        @close="showShortcutHelp = false"
      />

      <CommandPalette v-model:open="showCommandPalette" />

      <ProjectPicker v-model:open="showProjectPicker" />
    </div>
  </AppLayout>
</template>
