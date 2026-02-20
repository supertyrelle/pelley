import { useProjectManager } from '~~/server/services/project-manager'

export default defineEventHandler((event) => {
  const id = getRouterParam(event, 'id')

  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Missing project id' })
  }

  const manager = useProjectManager()

  try {
    manager.removeProject(id)
  }
  catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to remove project'
    throw createError({ statusCode: 404, statusMessage: message })
  }

  return { removed: true, id }
})
