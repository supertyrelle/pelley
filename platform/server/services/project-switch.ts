import { useProjectManager } from './project-manager'
import type { ProjectEvent } from './project-manager'

/**
 * Coordinates side-effects when the active project changes.
 *
 * Subscribes to ProjectManager's `project:activated` event.
 *
 * Important: The DB and ModelRegistry are global singletons that stay alive
 * across project switches. They hold the project registry, provider connections,
 * and API keys — all global state. Only the working directory for agent spawning
 * and beads commands changes per project (handled by useProjectRoot / resolveProjectRoot).
 */
function handleProjectSwitch(event: ProjectEvent): void {
  if (event.type !== 'project:activated' || !event.project) return

  console.log(`[project-switch] Switched to project "${event.project.name}" at ${event.project.path}`)

  // The BeadsClient already resolves project root dynamically per call.
  // The terminal handler reads the active project for CWD on each new connection.
  // No singleton resets needed — DB and model config are global.
}

/**
 * Initialize the project-switch coordinator.
 * Call once on server startup to wire up the event subscription.
 *
 * Returns the unsubscribe function (useful for testing or shutdown).
 */
export function initProjectSwitch(): () => void {
  const pm = useProjectManager()
  return pm.on(handleProjectSwitch)
}
