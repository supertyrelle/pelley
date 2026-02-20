import { useProjectManager } from '~~/server/services/project-manager'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ id?: string }>(event)

  if (!body?.id) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Missing required field: id',
    })
  }

  const manager = useProjectManager()

  try {
    manager.setActiveProject(body.id)
  }
  catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to set active project'
    throw createError({ statusCode: 404, statusMessage: message })
  }

  // Return the full project so the client can update its state without a second fetch
  const project = manager.getProject(body.id)
  return { ok: true, activeProjectId: body.id, project }
})
