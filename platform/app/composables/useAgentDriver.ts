import type { Ref } from 'vue'
import type {
  AgentDriverEvent,
  ApprovalRequestEvent,
} from '~~/shared/types/agent-driver'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AgentDriverStatus = 'idle' | 'connecting' | 'connected' | 'error'
export type AgentSessionStatus = 'starting' | 'idle' | 'running' | 'waiting-approval' | 'complete' | 'error'

export interface AgentDriverInstance {
  sessionId: Ref<string | null>
  status: Ref<AgentDriverStatus>
  agentStatus: Ref<AgentSessionStatus | null>
  events: Ref<AgentDriverEvent[]>
  pendingApprovals: Ref<ApprovalRequestEvent[]>
  errorMessage: Ref<string | null>
  isThinking: Ref<boolean>
  tokensUsed: Ref<{ input: number; output: number } | null>
  tokensPerSecond: Ref<number | null>
  connect(agentId: string, options?: { modelOverride?: { provider: string; model: string }; cwd?: string }): Promise<void>
  sendPrompt(message: string): Promise<void>
  respondToApproval(requestId: string, approved: boolean, alwaysAllow?: boolean): Promise<void>
  cancel(): Promise<void>
  disconnect(): void
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const RECONNECT_DELAY_MS = 2000
const MAX_RECONNECT_ATTEMPTS = 5

// ---------------------------------------------------------------------------
// Composable
// ---------------------------------------------------------------------------

export function useAgentDriver(): AgentDriverInstance {
  const sessionId = ref<string | null>(null)
  const status = ref<AgentDriverStatus>('idle')
  const agentStatus = ref<AgentSessionStatus | null>(null)
  const events = ref<AgentDriverEvent[]>([])
  const pendingApprovals = ref<ApprovalRequestEvent[]>([])
  const errorMessage = ref<string | null>(null)
  const tokensUsed = ref<{ input: number; output: number } | null>(null)
  const tokensPerSecond = ref<number | null>(null)

  const isThinking = ref(false)

  let turnStartTime: number | null = null

  let eventSource: EventSource | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let reconnectAttempts = 0
  let intentionalClose = false

  // -- Event batching -------------------------------------------------------
  // Buffer incoming SSE events and flush once per animation frame to reduce
  // Vue reactivity overhead from 30-50 updates/sec to ~16 (display refresh).

  let eventBuffer: AgentDriverEvent[] = []
  let rafHandle: number | null = null

  function flushEventBuffer() {
    rafHandle = null
    if (eventBuffer.length === 0) return

    const batch = eventBuffer
    eventBuffer = []

    // Single reactive update for all buffered events
    events.value = [...events.value, ...batch]
  }

  function scheduleFlush() {
    if (rafHandle === null) {
      rafHandle = requestAnimationFrame(flushEventBuffer)
    }
  }

  function cancelFlush() {
    if (rafHandle !== null) {
      cancelAnimationFrame(rafHandle)
      rafHandle = null
    }
  }

  /** Process side-effects for an event (status, tokens, approvals). Cheap and synchronous. */
  function processEvent(event: AgentDriverEvent) {
    switch (event.type) {
      case 'ready':
        agentStatus.value = 'idle'
        isThinking.value = false
        break

      case 'thinking':
        agentStatus.value = 'running'
        isThinking.value = event.active !== false
        break

      case 'tool-call-start':
      case 'tool-call-result':
      case 'progress':
        agentStatus.value = 'running'
        isThinking.value = false
        break

      case 'text-delta':
        agentStatus.value = 'running'
        isThinking.value = false
        if (turnStartTime === null) {
          turnStartTime = performance.now()
        }
        break

      case 'approval-request':
        agentStatus.value = 'waiting-approval'
        pendingApprovals.value = [...pendingApprovals.value, event]
        break

      case 'approval-response':
        agentStatus.value = 'running'
        pendingApprovals.value = pendingApprovals.value.filter(
          a => a.requestId !== event.requestId,
        )
        break

      case 'user-message':
        // New turn starting — reset timing
        turnStartTime = null
        break

      case 'usage': {
        const prev = tokensUsed.value ?? { input: 0, output: 0 }
        tokensUsed.value = {
          input: prev.input + event.inputTokens,
          output: prev.output + event.outputTokens,
        }
        break
      }

      case 'complete': {
        // Don't set status to 'complete' — the subsequent 'ready' event
        // handles the transition back to 'idle' for multi-turn chat
        if (event.tokensUsed) {
          const prev = tokensUsed.value ?? { input: 0, output: 0 }
          tokensUsed.value = {
            input: prev.input + event.tokensUsed.input,
            output: prev.output + event.tokensUsed.output,
          }
        }
        if (turnStartTime !== null && tokensUsed.value) {
          const elapsedSec = (performance.now() - turnStartTime) / 1000
          tokensPerSecond.value = elapsedSec > 0
            ? tokensUsed.value.output / elapsedSec
            : null
        }
        break
      }

      case 'error':
        if (event.fatal) {
          agentStatus.value = 'error'
          errorMessage.value = event.message
        }
        break
    }
  }

  // -- SSE connection -------------------------------------------------------

  function openEventSource(url: string) {
    closeEventSource()

    const es = new EventSource(url)
    eventSource = es

    es.onopen = () => {
      status.value = 'connected'
      errorMessage.value = null
      reconnectAttempts = 0
    }

    es.onmessage = (msg) => {
      if (!msg.data) return

      let event: AgentDriverEvent
      try {
        event = JSON.parse(msg.data)
      }
      catch {
        console.error('[useAgentDriver] Failed to parse SSE data:', msg.data)
        return
      }

      // Process side-effects immediately (status, tokens) — cheap
      processEvent(event)

      // Buffer the event for batched reactive array update
      eventBuffer.push(event)

      // Flush immediately on terminal events so the UI reflects final state right away
      if (event.type === 'complete' || (event.type === 'error' && event.fatal)) {
        cancelFlush()
        flushEventBuffer()
      }
      else {
        scheduleFlush()
      }
    }

    es.onerror = () => {
      if (intentionalClose) return

      es.close()
      eventSource = null
      attemptReconnect()
    }
  }

  function closeEventSource() {
    cancelFlush()
    if (eventSource) {
      eventSource.onopen = null
      eventSource.onmessage = null
      eventSource.onerror = null
      eventSource.close()
      eventSource = null
    }
  }

  function clearReconnectTimer() {
    if (reconnectTimer !== null) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
  }

  function attemptReconnect() {
    if (intentionalClose) return
    if (!sessionId.value) return

    if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      status.value = 'error'
      errorMessage.value = 'Lost connection to agent session after max retries'
      return
    }

    status.value = 'connecting'
    reconnectAttempts++
    clearReconnectTimer()

    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      if (sessionId.value) {
        const lastSeq = events.value.length > 0
          ? events.value[events.value.length - 1].seq
          : -1
        const url = `/api/agent/sessions/${sessionId.value}/events?lastSeq=${lastSeq}`
        openEventSource(url)
      }
    }, RECONNECT_DELAY_MS)
  }

  // -- Public methods -------------------------------------------------------

  async function connect(agentId: string, options?: { modelOverride?: { provider: string; model: string }; cwd?: string }): Promise<void> {
    intentionalClose = false
    reconnectAttempts = 0
    clearReconnectTimer()

    // Reset state
    events.value = []
    pendingApprovals.value = []
    errorMessage.value = null
    tokensUsed.value = null
    tokensPerSecond.value = null
    isThinking.value = false
    turnStartTime = null
    agentStatus.value = 'starting'
    status.value = 'connecting'

    try {
      // Create the session via REST
      const body: Record<string, unknown> = { agentId }
      if (options?.modelOverride) body.modelOverride = options.modelOverride
      if (options?.cwd) body.cwd = options.cwd

      const response = await $fetch<{ id: string }>('/api/agent/sessions', {
        method: 'POST',
        body,
      })

      sessionId.value = response.id

      // Open SSE stream for events
      openEventSource(`/api/agent/sessions/${response.id}/events`)
    }
    catch (err) {
      status.value = 'error'
      agentStatus.value = 'error'
      errorMessage.value = err instanceof Error ? err.message : 'Failed to create agent session'
    }
  }

  async function sendPrompt(message: string): Promise<void> {
    if (!sessionId.value) {
      throw new Error('No active session — call connect() first')
    }

    await $fetch(`/api/agent/sessions/${sessionId.value}/prompt`, {
      method: 'POST',
      body: { message },
    })
  }

  async function respondToApproval(requestId: string, approved: boolean, alwaysAllow?: boolean): Promise<void> {
    if (!sessionId.value) {
      throw new Error('No active session — call connect() first')
    }

    await $fetch(`/api/agent/sessions/${sessionId.value}/approval`, {
      method: 'POST',
      body: { requestId, approved, alwaysAllow },
    })
  }

  async function cancel(): Promise<void> {
    if (!sessionId.value) return

    try {
      await $fetch(`/api/agent/sessions/${sessionId.value}/cancel`, {
        method: 'POST',
      })
    }
    catch {
      // Best-effort cancel — session may already be complete
    }
  }

  function disconnect() {
    intentionalClose = true
    clearReconnectTimer()
    cancelFlush()
    // Flush any remaining buffered events before tearing down
    flushEventBuffer()
    closeEventSource()
    status.value = 'idle'
    sessionId.value = null
    agentStatus.value = null
  }

  // -- Lifecycle ------------------------------------------------------------

  if (import.meta.client) {
    onUnmounted(() => {
      disconnect()
    })
  }

  return {
    sessionId,
    status,
    agentStatus,
    events,
    pendingApprovals,
    errorMessage,
    isThinking,
    tokensUsed,
    tokensPerSecond,
    connect,
    sendPrompt,
    respondToApproval,
    cancel,
    disconnect,
  }
}
