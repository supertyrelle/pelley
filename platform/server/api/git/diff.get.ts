import { gitDiffService } from '~~/server/services/git-diff'

export default defineEventHandler(async (event) => {
  const query = getQuery<{
    projectPath?: string
    branch?: string
    staged?: string
  }>(event)

  if (!query?.projectPath || typeof query.projectPath !== 'string') {
    throw createError({ statusCode: 400, statusMessage: 'projectPath query parameter is required' })
  }

  try {
    return await gitDiffService.getDiff(query.projectPath, {
      branch: typeof query.branch === 'string' ? query.branch : undefined,
      staged: query.staged === 'true',
    })
  }
  catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to get diff'

    if (message.includes('Not a git repository')) {
      throw createError({ statusCode: 400, statusMessage: message })
    }

    throw createError({ statusCode: 500, statusMessage: message })
  }
})
