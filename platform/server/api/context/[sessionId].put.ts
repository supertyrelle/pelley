import { useContextManager } from '~~/server/services/context-manager'

export default defineEventHandler(async (event) => {
  const sessionId = getRouterParam(event, 'sessionId')

  if (!sessionId) {
    throw createError({ statusCode: 400, statusMessage: 'Missing sessionId' })
  }

  const body = await readBody<{ scope?: string }>(event)

  if (!body?.scope || (body.scope !== 'shared' && body.scope !== 'isolated')) {
    throw createError({
      statusCode: 400,
      statusMessage: "Body must contain scope: 'shared' | 'isolated'",
    })
  }

  const ctx = useContextManager()
  ctx.setScope(sessionId, body.scope)

  return {
    sessionId,
    scope: body.scope,
  }
})
