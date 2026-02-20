import { useAgentDriverManager } from '~~/server/services/agent-driver'

export default defineEventHandler(async (event) => {
  const sessionId = getRouterParam(event, 'id')
  if (!sessionId) {
    throw createError({ statusCode: 400, statusMessage: 'Missing session id' })
  }

  const body = await readBody<{ message: string }>(event)
  if (!body?.message || typeof body.message !== 'string') {
    throw createError({ statusCode: 400, statusMessage: 'message is required' })
  }

  const manager = useAgentDriverManager()
  const session = manager.getSession(sessionId)
  if (!session) {
    throw createError({ statusCode: 404, statusMessage: `Session not found: ${sessionId}` })
  }

  // Fire and forget — events stream via SSE
  session.sendPrompt(body.message).catch((err) => {
    // Error is already emitted to session event stream by sendPrompt's catch block
    console.error(`[prompt] Error in session ${sessionId}:`, err)
  })
  setResponseStatus(event, 202)
  return { ok: true }
})
