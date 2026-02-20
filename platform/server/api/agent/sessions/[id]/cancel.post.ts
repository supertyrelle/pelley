import { useAgentDriverManager } from '~~/server/services/agent-driver'

export default defineEventHandler(async (event) => {
  const sessionId = getRouterParam(event, 'id')
  if (!sessionId) {
    throw createError({ statusCode: 400, statusMessage: 'Missing session id' })
  }

  const manager = useAgentDriverManager()
  const session = manager.getSession(sessionId)
  if (!session) {
    throw createError({ statusCode: 404, statusMessage: `Session not found: ${sessionId}` })
  }

  session.cancel()
  return { ok: true }
})
