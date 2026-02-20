import { useContextManager } from '~~/server/services/context-manager'

export default defineEventHandler(async (event) => {
  const sessionId = getRouterParam(event, 'sessionId')

  if (!sessionId) {
    throw createError({ statusCode: 400, statusMessage: 'Missing sessionId' })
  }

  const ctx = useContextManager()
  const scope = ctx.getScope(sessionId)

  // Fetch visible bead IDs for the response
  let visibleBeadIds: string[] = []
  try {
    const beads = await ctx.getVisibleBeads(sessionId)
    visibleBeadIds = beads.map((b) => b.id)
  }
  catch {
    // bd may not be available -- return empty list rather than failing
  }

  return {
    sessionId,
    scope,
    visibleBeadIds,
  }
})
