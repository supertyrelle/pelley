import { worktreeManager } from '~~/server/services/worktree-manager'

export default defineEventHandler(async (event) => {
  const query = getQuery<{ projectPath?: string }>(event)

  if (!query?.projectPath || typeof query.projectPath !== 'string') {
    throw createError({ statusCode: 400, statusMessage: 'projectPath query parameter is required' })
  }

  try {
    return await worktreeManager.listWorktrees(query.projectPath)
  }
  catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to list worktrees'

    if (message.includes('Not a git repository')) {
      throw createError({ statusCode: 400, statusMessage: message })
    }

    throw createError({ statusCode: 500, statusMessage: message })
  }
})
