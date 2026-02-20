import { worktreeManager } from '~~/server/services/worktree-manager'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ projectPath?: string; taskSlug?: string }>(event)

  if (!body?.projectPath || typeof body.projectPath !== 'string') {
    throw createError({ statusCode: 400, statusMessage: 'projectPath is required' })
  }
  if (!body?.taskSlug || typeof body.taskSlug !== 'string') {
    throw createError({ statusCode: 400, statusMessage: 'taskSlug is required' })
  }

  try {
    const info = await worktreeManager.createWorktree(body.projectPath, body.taskSlug)
    setResponseStatus(event, 201)
    return info
  }
  catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to create worktree'

    if (message.includes('Not a git repository')) {
      throw createError({ statusCode: 400, statusMessage: message })
    }
    if (message.includes('already exists')) {
      throw createError({ statusCode: 409, statusMessage: message })
    }
    if (message.includes('Invalid task slug')) {
      throw createError({ statusCode: 400, statusMessage: message })
    }

    throw createError({ statusCode: 500, statusMessage: message })
  }
})
