import { useProjectManager } from '~~/server/services/project-manager'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const cwd = typeof query.cwd === 'string' ? query.cwd : undefined

  const manager = useProjectManager()
  return await manager.detectProject(cwd)
})
