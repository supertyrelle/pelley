import { useProjectManager } from '~~/server/services/project-manager'

export default defineEventHandler((event) => {
  const id = getRouterParam(event, 'id')

  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Missing project id' })
  }

  const manager = useProjectManager()
  const project = manager.getProject(id)

  if (!project) {
    throw createError({ statusCode: 404, statusMessage: `Project '${id}' not found` })
  }

  return project
})
