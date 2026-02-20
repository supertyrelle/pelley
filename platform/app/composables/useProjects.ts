import type { Project } from '~~/shared/types/project'

/**
 * Client-side composable for managing projects.
 *
 * Provides reactive state, CRUD methods, and a `projectFetch` wrapper
 * that automatically attaches the `X-Project-Id` header to every request
 * so the server resolves the correct active project context.
 *
 * Usage:
 * ```ts
 * const { projects, activeProject, addProject, removeProject, switchProject, projectFetch } = useProjects()
 *
 * // Use projectFetch instead of $fetch to include the project header:
 * const data = await projectFetch('/api/some-endpoint')
 * ```
 */
export function useProjects() {
  const projects = useState<Project[]>('projects-list', () => [])
  const activeProject = useState<Project | null>('active-project', () => null)
  const loading = ref(false)
  const error = ref<string | null>(null)

  // -----------------------------------------------------------------------
  // Project-aware fetch
  // -----------------------------------------------------------------------

  /**
   * A $fetch wrapper that automatically attaches `X-Project-Id` to every
   * outgoing request when an active project is set.
   *
   * Accepts the same arguments as Nuxt's `$fetch`. Any headers you pass
   * explicitly are preserved — `X-Project-Id` is merged in.
   */
  function projectFetch<T = unknown>(
    url: string,
    opts?: Parameters<typeof $fetch>[1],
  ): Promise<T> {
    const projectId = activeProject.value?.id
    const headers: Record<string, string> = {
      ...(opts?.headers as Record<string, string> ?? {}),
      ...(projectId ? { 'x-project-id': projectId } : {}),
    }

    return $fetch<T>(url, { ...opts, headers })
  }

  // -----------------------------------------------------------------------
  // Fetch
  // -----------------------------------------------------------------------

  async function refresh(): Promise<void> {
    loading.value = true
    error.value = null

    try {
      const [projectList, active] = await Promise.all([
        $fetch<Project[]>('/api/projects'),
        $fetch<Project | null>('/api/projects/active'),
      ])

      projects.value = projectList
      activeProject.value = active
    }
    catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to load projects'
      error.value = message
      console.error('[useProjects] Refresh failed:', message)
    }
    finally {
      loading.value = false
    }
  }

  // -----------------------------------------------------------------------
  // Actions
  // -----------------------------------------------------------------------

  async function addProject(name: string, path: string): Promise<Project> {
    try {
      const project = await $fetch<Project>('/api/projects', {
        method: 'POST',
        body: { name, path },
      })

      // Append to local state
      projects.value = [...projects.value, project]

      // If this is the first project, auto-activate it
      if (projects.value.length === 1) {
        await switchProject(project.id)
      }

      return project
    }
    catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to add project'
      error.value = message
      throw err
    }
  }

  async function removeProject(id: string): Promise<void> {
    try {
      await $fetch(`/api/projects/${id}` as string, { method: 'DELETE' })

      // Remove from local state
      projects.value = projects.value.filter(p => p.id !== id)

      // If removed project was active, clear active
      if (activeProject.value?.id === id) {
        activeProject.value = null
      }
    }
    catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to remove project'
      error.value = message
      throw err
    }
  }

  async function switchProject(id: string): Promise<void> {
    try {
      const result = await $fetch<{ ok: boolean, activeProjectId: string, project: Project | null }>('/api/projects/active', {
        method: 'PUT',
        body: { id },
      })

      // Update local state from the response (avoids a second fetch)
      activeProject.value = result.project ?? projects.value.find(p => p.id === id) ?? null
    }
    catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to switch project'
      error.value = message
      throw err
    }
  }

  // -----------------------------------------------------------------------
  // Detection
  // -----------------------------------------------------------------------

  /** Detect a project from CWD and auto-activate if no active project is set. */
  async function autoDetect(): Promise<void> {
    if (activeProject.value) return

    try {
      const detected = await $fetch<Project | null>('/api/projects/detect')
      if (detected) {
        activeProject.value = detected
      }
    }
    catch {
      // Detection is best-effort, don't surface errors
    }
  }

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  // Fetch on first use (client-side only)
  if (import.meta.client) {
    onMounted(async () => {
      await refresh()
      await autoDetect()
    })
  }

  return {
    projects: readonly(projects),
    activeProject: readonly(activeProject),
    loading: readonly(loading),
    error: readonly(error),
    addProject,
    removeProject,
    switchProject,
    projectFetch,
    refresh,
  }
}
