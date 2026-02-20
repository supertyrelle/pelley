import type { CompleteEvent } from '~~/shared/types/agent-driver'
import { useAgentDriverManager } from '~~/server/services/agent-driver'

export default defineEventHandler(async () => {
  const manager = useAgentDriverManager()
  const infos = manager.listSessions()

  return infos.map((info) => {
    const session = manager.getSession(info.id)
    const events = session?.events ?? []
    const lastEvent = events.length > 0 ? events[events.length - 1] : undefined

    // Sum tokens from all complete events in the session
    let tokensUsed: number | undefined
    for (const evt of events) {
      if (evt.type === 'complete' && (evt as CompleteEvent).tokensUsed) {
        const t = (evt as CompleteEvent).tokensUsed!
        tokensUsed = (tokensUsed ?? 0) + t.input + t.output
      }
    }

    return {
      id: info.id,
      agentId: info.agentId,
      agentName: session?.agentConfig.name ?? info.agentId,
      status: info.status,
      createdAt: info.createdAt,
      lastEventType: lastEvent?.type,
      tokensUsed,
    }
  })
})
