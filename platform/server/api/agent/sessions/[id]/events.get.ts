import { useAgentDriverManager, type EventListener } from '~~/server/services/agent-driver'
import type { AgentDriverEvent } from '~~/shared/types/agent-driver'

export default defineEventHandler(async (event) => {
  const sessionId = getRouterParam(event, 'id')
  if (!sessionId) {
    throw createError({ statusCode: 400, statusMessage: 'Missing session id' })
  }

  const lastSeqParam = getQuery(event).lastSeq
  const lastSeq = lastSeqParam !== undefined ? Number(lastSeqParam) : -1

  const manager = useAgentDriverManager()
  const session = manager.getSession(sessionId)
  if (!session) {
    throw createError({ statusCode: 404, statusMessage: `Session not found: ${sessionId}` })
  }

  // Set SSE headers
  setResponseHeaders(event, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  })

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder()

      function sendEvent(data: AgentDriverEvent | { type: string }): void {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
        }
        catch {
          // Stream may be closed
        }
      }

      // Replay buffered events with seq > lastSeq
      for (const buffered of session.events) {
        if (buffered.seq > lastSeq) {
          sendEvent(buffered)
        }
      }

      // Attach live listener
      const listener: EventListener = (evt: AgentDriverEvent) => {
        sendEvent(evt)
      }
      const unsubscribe = session.onEvent(listener)

      // Keepalive ping every 30s
      const pingInterval = setInterval(() => {
        sendEvent({ type: 'ping' })
      }, 30_000)

      // Clean up when the client disconnects
      event.node.req.on('close', () => {
        clearInterval(pingInterval)
        unsubscribe()
      })
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  })
})
