import { useProjectManager } from '~~/server/services/project-manager'

export default defineEventHandler(() => {
  const manager = useProjectManager()
  return manager.getActiveProject()
})
