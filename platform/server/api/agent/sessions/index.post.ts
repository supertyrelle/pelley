import { useAgentDriverManager } from '~~/server/services/agent-driver'

export default defineEventHandler(async (event) => {
  const body = await readBody<{
    agentId: string
    modelOverride?: { provider: string; model: string }
    cwd?: string
  }>(event)

  if (!body?.agentId || typeof body.agentId !== 'string') {
    throw createError({ statusCode: 400, statusMessage: 'agentId is required' })
  }

  const manager = useAgentDriverManager()

  try {
    const session = await manager.createSession(body.agentId, {
      modelOverride: body.modelOverride,
      cwd: body.cwd,
    })

    setResponseStatus(event, 201)
    return { id: session.id }
  }
  catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to create session'
    throw createError({ statusCode: 400, statusMessage: message })
  }
})
