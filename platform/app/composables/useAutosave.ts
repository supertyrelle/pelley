import type { PanelState } from './useTilingLayout'

const DEBOUNCE_MS = 500

export function useAutosave(panels: Readonly<Ref<PanelState[]>>) {
  const saving = ref(false)
  const lastSavedAt = ref<number | null>(null)
  const error = ref<string | null>(null)

  let debounceTimer: ReturnType<typeof setTimeout> | null = null

  async function saveLayout(panelData: PanelState[]) {
    saving.value = true
    error.value = null
    try {
      const res = await $fetch('/api/state/layout', {
        method: 'PUT',
        body: { panels: panelData },
      }) as { updatedAt: number }
      lastSavedAt.value = res.updatedAt
    } catch (err: unknown) {
      error.value = err instanceof Error ? err.message : 'Failed to save layout'
      console.error('[autosave] Layout save failed:', err)
    } finally {
      saving.value = false
    }
  }

  function debouncedSave(panelData: PanelState[]) {
    if (debounceTimer) {
      clearTimeout(debounceTimer)
    }
    debounceTimer = setTimeout(() => {
      saveLayout(panelData)
    }, DEBOUNCE_MS)
  }

  // Watch for panel changes and autosave
  watch(
    panels,
    (newPanels) => {
      if (newPanels.length > 0) {
        debouncedSave([...newPanels])
      }
    },
    { deep: true },
  )

  // Load saved layout on mount
  async function loadLayout(): Promise<PanelState[] | null> {
    try {
      const res = await $fetch('/api/state/layout') as { panels: unknown; updatedAt?: number }
      if (res.panels && Array.isArray(res.panels) && res.panels.length > 0) {
        lastSavedAt.value = res.updatedAt ?? null
        return res.panels as PanelState[]
      }
    } catch (err) {
      console.error('[autosave] Layout load failed:', err)
    }
    return null
  }

  // Cleanup on unmount
  onUnmounted(() => {
    if (debounceTimer) {
      clearTimeout(debounceTimer)
    }
  })

  return {
    saving: readonly(saving),
    lastSavedAt: readonly(lastSavedAt),
    error: readonly(error),
    loadLayout,
    saveNow: () => saveLayout([...panels.value]),
  }
}
