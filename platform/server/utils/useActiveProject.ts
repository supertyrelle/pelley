import type { H3Event } from 'h3'
import { getHeader } from 'h3'
import { useProjectManager } from '~~/server/services/project-manager'

export interface ActiveProject {
  id: string
  name: string
  path: string
}

const CONTEXT_KEY = '_activeProject'
const HEADER_NAME = 'x-project-id'

/**
 * Resolve the active project for the current request.
 *
 * Resolution order:
 *   1. Per-request cache (avoid repeated DB hits within the same request)
 *   2. `X-Project-Id` header (explicit per-request override from the client)
 *   3. `activeProjectId` setting in the DB (global default via ProjectManager)
 *
 * Returns null when no project is configured — callers should fall back
 * to CWD-based behavior for backward compatibility.
 */
export function useActiveProject(event: H3Event): ActiveProject | null {
  // 1. Return cached result if already resolved for this request
  if (CONTEXT_KEY in event.context) {
    return event.context[CONTEXT_KEY] as ActiveProject | null
  }

  const manager = useProjectManager()
  let project: ActiveProject | null = null

  // 2. Check for explicit header override
  const headerProjectId = getHeader(event, HEADER_NAME)
  if (headerProjectId) {
    const found = manager.getProject(headerProjectId)
    if (found) {
      project = { id: found.id, name: found.name, path: found.path }
    }
    // If header specifies an unknown ID, fall through to the global default
    // rather than failing — keeps things resilient.
  }

  // 3. Fall back to the global active project setting
  if (!project) {
    const active = manager.getActiveProject()
    if (active) {
      project = { id: active.id, name: active.name, path: active.path }
    }
  }

  // Cache on the event context so subsequent calls in the same request are free
  event.context[CONTEXT_KEY] = project

  return project
}
