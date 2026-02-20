import type { Task, CreateTaskOptions, TaskStatus } from '~~/shared/types/task'

/**
 * Client-side composable for managing tasks.
 *
 * Provides reactive state and methods for creating, starting, stopping,
 * and closing tasks via the REST API.
 *
 * Usage:
 * ```ts
 * const { tasks, activeTasks, createTask, startTask, stopTask, closeTask, refresh } = useTaskManager()
 * ```
 */
export function useTaskManager() {
  const tasks = ref<Task[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)

  // -----------------------------------------------------------------------
  // Computed
  // -----------------------------------------------------------------------

  const activeTasks = computed(() =>
    tasks.value.filter(t => t.status === 'running'),
  )

  const pendingTasks = computed(() =>
    tasks.value.filter(t => t.status === 'pending'),
  )

  // -----------------------------------------------------------------------
  // API methods
  // -----------------------------------------------------------------------

  async function refresh(filters?: { projectPath?: string, status?: TaskStatus }): Promise<void> {
    loading.value = true
    error.value = null

    try {
      const query = new URLSearchParams()
      if (filters?.projectPath) query.set('projectPath', filters.projectPath)
      if (filters?.status) query.set('status', filters.status)

      const qs = query.toString()
      const url = qs ? `/api/tasks?${qs}` : '/api/tasks'

      tasks.value = await $fetch<Task[]>(url)
    }
    catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to fetch tasks'
      console.error('[useTaskManager] refresh failed:', err)
    }
    finally {
      loading.value = false
    }
  }

  async function createTask(options: CreateTaskOptions): Promise<Task> {
    const task = await $fetch<Task>('/api/tasks', {
      method: 'POST',
      body: options,
    })
    // Prepend to local state
    tasks.value = [task, ...tasks.value]
    return task
  }

  async function startTask(id: string): Promise<Task> {
    const updated = await $fetch<Task>(`/api/tasks/${id}/start`, {
      method: 'POST',
    })
    // Update local state
    tasks.value = tasks.value.map(t => t.id === id ? updated : t)
    return updated
  }

  async function stopTask(id: string): Promise<void> {
    await $fetch(`/api/tasks/${id}/stop`, {
      method: 'POST',
    })
    // Update local state
    tasks.value = tasks.value.map(t =>
      t.id === id ? { ...t, status: 'failed' as const, updatedAt: Date.now() } : t,
    )
  }

  async function closeTask(id: string): Promise<void> {
    await $fetch(`/api/tasks/${id}/close`, {
      method: 'POST',
    })
    // Update local state
    tasks.value = tasks.value.map(t =>
      t.id === id ? { ...t, status: 'completed' as const, updatedAt: Date.now() } : t,
    )
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
    tasks: readonly(tasks),
    activeTasks,
    pendingTasks,
    loading: readonly(loading),
    error: readonly(error),
    createTask,
    startTask,
    stopTask,
    closeTask,
    refresh,
  }
}
