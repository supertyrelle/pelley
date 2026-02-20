import type { H3Event } from 'h3'
import { useActiveProject } from './useActiveProject'

/**
 * Resolve the filesystem root for the active project.
 *
 * Returns the project's registered path if a project is active,
 * otherwise falls back to `process.cwd()` for backward compatibility
 * (single-project / no-project-registered mode).
 *
 * Use this wherever you need to resolve paths relative to the project root:
 * DB location, beads directory, model config, git operations, etc.
 */
export function useProjectRoot(event: H3Event): string {
  const project = useActiveProject(event)
  return project?.path ?? process.cwd()
}
