import { gitDiffService } from '~~/server/services/git-diff'

export default defineEventHandler(async (event) => {
  const query = getQuery<{
    projectPath?: string
    baseBranch?: string
  }>(event)

  if (!query?.projectPath || typeof query.projectPath !== 'string') {
    throw createError({ statusCode: 400, statusMessage: 'projectPath query parameter is required' })
  }

  try {
    return await gitDiffService.getChangedFiles(
      query.projectPath,
      typeof query.baseBranch === 'string' ? query.baseBranch : undefined,
    )
  }
  catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to get changed files'

    if (message.includes('Not a git repository')) {
      throw createError({ statusCode: 400, statusMessage: message })
    }

    throw createError({ statusCode: 500, statusMessage: message })
  }
})
