import { useProjectManager } from '~~/server/services/project-manager'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ name?: string, path?: string }>(event)

  if (!body?.name || !body?.path) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Missing required fields: name, path',
    })
  }

  const manager = useProjectManager()

  try {
    return await manager.createProject(body.name, body.path)
  }
  catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to create project'

    // Distinguish validation errors from server errors
    const isValidation = message.includes('does not exist')
      || message.includes('Not a git repository')
      || message.includes('already registered')

    throw createError({
      statusCode: isValidation ? 400 : 500,
      statusMessage: message,
    })
  }
})
