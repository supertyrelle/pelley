import { useAgentDriverManager } from '~~/server/services/agent-driver'

export default defineEventHandler(async (event) => {
  const sessionId = getRouterParam(event, 'id')
  if (!sessionId) {
    throw createError({ statusCode: 400, statusMessage: 'Missing session id' })
  }

  const body = await readBody<{
    requestId: string
    approved: boolean
    alwaysAllow?: boolean
  }>(event)

  if (!body?.requestId || typeof body.requestId !== 'string') {
    throw createError({ statusCode: 400, statusMessage: 'requestId is required' })
  }
  if (typeof body.approved !== 'boolean') {
    throw createError({ statusCode: 400, statusMessage: 'approved (boolean) is required' })
  }

  const manager = useAgentDriverManager()
  const session = manager.getSession(sessionId)
  if (!session) {
    throw createError({ statusCode: 404, statusMessage: `Session not found: ${sessionId}` })
  }

  try {
    session.respondToApproval(body.requestId, body.approved, body.alwaysAllow)
    return { ok: true }
  }
  catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to respond to approval'
    throw createError({ statusCode: 400, statusMessage: message })
  }
})
