import type { Bead, BeadUpdate } from '~~/shared/types/bead'

/**
 * Client-side composable for managing beads (backlog items).
 *
 * Provides reactive state and methods for creating, updating, closing,
 * and querying beads via the REST API.
 *
 * Usage:
 * ```ts
 * const { beads, openBeads, epicBeads, readyBeads, createBead, updateBead, closeBead, refresh } = useBeads()
 * ```
 */
export function useBeads() {
  const beads = ref<Bead[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)

  // -----------------------------------------------------------------------
  // Computed
  // -----------------------------------------------------------------------

  const openBeads = computed(() =>
    beads.value.filter(b => b.status === 'open'),
  )

  const epicBeads = computed(() =>
    beads.value.filter(b => b.type === 'epic'),
  )

  const readyBeads = computed(() =>
    beads.value.filter(b =>
      b.status === 'open'
      && (!b.blockedBy || b.blockedBy.length === 0),
    ),
  )

  // -----------------------------------------------------------------------
  // API methods
  // -----------------------------------------------------------------------

  async function refresh(): Promise<void> {
    loading.value = true
    error.value = null

    try {
      beads.value = await $fetch<Bead[]>('/api/beads')
    }
    catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to fetch beads'
      console.error('[useBeads] refresh failed:', err)
    }
    finally {
      loading.value = false
    }
  }

  async function getBead(id: string): Promise<Bead> {
    return await $fetch<Bead>(`/api/beads/${id}`)
  }

  async function createBead(options: {
    title: string
    type?: string
    priority?: number
    parent?: string
    description?: string
  }): Promise<Bead> {
    const bead = await $fetch<Bead>('/api/beads', {
      method: 'POST',
      body: options,
    })
    // Prepend to local state
    beads.value = [bead, ...beads.value]
    return bead
  }

  async function updateBead(id: string, updates: BeadUpdate): Promise<Bead> {
    const updated = await $fetch<Bead>(`/api/beads/${id}`, {
      method: 'PATCH',
      body: updates,
    })
    // Update local state
    beads.value = beads.value.map(b => b.id === id ? updated : b)
    return updated
  }

  async function closeBead(id: string): Promise<void> {
    await $fetch(`/api/beads/${id}/close`, {
      method: 'POST',
    })
    // Update local state
    beads.value = beads.value.map(b =>
      b.id === id ? { ...b, status: 'closed' as const, updatedAt: new Date().toISOString() } : b,
    )
  }

  async function getChildren(id: string): Promise<Bead[]> {
    return await $fetch<Bead[]>(`/api/beads/${id}/children`)
  }

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  // Auto-fetch on mount (client only)
  if (import.meta.client) {
    onMounted(() => {
      refresh()
    })
  }

  return {
    beads: readonly(beads),
    loading: readonly(loading),
    error: readonly(error),
    openBeads,
    epicBeads,
    readyBeads,
    refresh,
    getBead,
    createBead,
    updateBead,
    closeBead,
    getChildren,
  }
}
