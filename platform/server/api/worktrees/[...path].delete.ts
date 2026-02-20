import { worktreeManager } from '~~/server/services/worktree-manager'

export default defineEventHandler(async (event) => {
  const pathSegment = getRouterParam(event, 'path')

  if (!pathSegment) {
    throw createError({ statusCode: 400, statusMessage: 'Worktree path is required' })
  }

  // The catch-all param arrives URL-encoded; the path is absolute (starts with /)
  const worktreePath = `/${pathSegment}`

  try {
    await worktreeManager.removeWorktree(worktreePath)
    setResponseStatus(event, 204)
    return null
  }
  catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to remove worktree'

    if (message.includes('not a working tree') || message.includes('is not a valid')) {
      throw createError({ statusCode: 404, statusMessage: message })
    }

    throw createError({ statusCode: 500, statusMessage: message })
  }
})
