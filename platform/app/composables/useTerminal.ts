import type { Ref } from 'vue'
import type { LaunchOptions } from '~~/shared/types/agent'

export type TerminalStatus = 'connecting' | 'connected' | 'reconnecting' | 'disconnected' | 'error'

export interface TerminalInstance {
  sessionId: Ref<string | null>
  status: Ref<TerminalStatus>
  errorMessage: Ref<string | null>
  hasConnectedOnce: Ref<boolean>
  sessionExpired: Ref<boolean>
  lastOutputAt: Ref<number>
  isIdle: Ref<boolean>
  reconnectAttempt: Ref<number>
  reconnectMax: number
  connect(agentId: string, options?: { cols?: number, rows?: number, cwd?: string, launchOptions?: LaunchOptions }): void
  connectWithResume(agentId: string, options?: { cols?: number, rows?: number, cwd?: string, launchOptions?: LaunchOptions }): void
  reconnect(sessionId: string): void
  disconnect(): void
  write(data: string): void
  resize(cols: number, rows: number): void
  onData(handler: (data: string) => void): () => void
  onExit(handler: (code: number, signal?: number) => void): () => void
}

const MAX_RECONNECT_ATTEMPTS = 10
const RECONNECT_BASE_DELAY_MS = 1000
const RECONNECT_MAX_DELAY_MS = 15000
const RECONNECT_JITTER_MS = 1000

function buildWsUrl(params: Record<string, string>): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  const qs = new URLSearchParams(params).toString()
  return `${protocol}//${window.location.host}/terminal?${qs}`
}

export function useTerminal(): TerminalInstance {
  const sessionId = ref<string | null>(null)
  const status = ref<TerminalStatus>('disconnected')
  const errorMessage = ref<string | null>(null)
  const hasConnectedOnce = ref(false)
  const sessionExpired = ref(false)
  const lastOutputAt = ref(0)

  // Reactive clock for idle detection -- ticks every 3s while connected
  const now = ref(Date.now())
  let idleTimer: ReturnType<typeof setInterval> | null = null

  const IDLE_THRESHOLD_MS = 10_000

  const isIdle = computed(() =>
    status.value === 'connected'
    && lastOutputAt.value > 0
    && (now.value - lastOutputAt.value > IDLE_THRESHOLD_MS),
  )

  const reconnectAttempt = ref(0)

  let ws: WebSocket | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let intentionalClose = false

  // Flow control: track bytes received and send batched drain acknowledgments
  const DRAIN_INTERVAL_MS = 100
  let drainAccumulator = 0
  let drainTimer: ReturnType<typeof setTimeout> | null = null

  function flushDrain() {
    if (drainAccumulator > 0 && ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'drain', bytes: drainAccumulator }))
      drainAccumulator = 0
    }
    drainTimer = null
  }

  function trackDrainBytes(byteCount: number) {
    drainAccumulator += byteCount
    if (drainTimer === null) {
      drainTimer = setTimeout(flushDrain, DRAIN_INTERVAL_MS)
    }
  }

  // Last known connection params for auto-reconnect
  let lastAgentId: string | null = null
  let lastOptions: { cols?: number, rows?: number, cwd?: string, launchOptions?: LaunchOptions } = {}

  const dataHandlers = new Set<(data: string) => void>()
  const exitHandlers = new Set<(code: number, signal?: number) => void>()

  function clearReconnectTimer() {
    if (reconnectTimer !== null) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
  }

  function teardownWs() {
    // Flush any pending drain bytes before closing
    if (drainTimer !== null) {
      clearTimeout(drainTimer)
      drainTimer = null
    }
    flushDrain()
    drainAccumulator = 0

    if (ws) {
      ws.onopen = null
      ws.onmessage = null
      ws.onclose = null
      ws.onerror = null
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close()
      }
      ws = null
    }
  }

  function openWebSocket(url: string) {
    teardownWs()
    status.value = 'connecting'

    const socket = new WebSocket(url)
    ws = socket

    socket.onopen = () => {
      status.value = 'connected'
      errorMessage.value = null
      sessionExpired.value = false
      hasConnectedOnce.value = true
      reconnectAttempt.value = 0
    }

    socket.onmessage = (event) => {
      const raw = typeof event.data === 'string' ? event.data : ''
      if (!raw) return

      // Try to parse as a JSON control message
      if (raw.startsWith('{')) {
        try {
          const msg = JSON.parse(raw)
          if (msg && typeof msg === 'object') {
            if (msg.type === 'session' && typeof msg.sessionId === 'string') {
              sessionId.value = msg.sessionId
              return
            }
            if (msg.type === 'exit') {
              const code = typeof msg.code === 'number' ? msg.code : 1
              const signal = typeof msg.signal === 'number' ? msg.signal : undefined
              for (const handler of exitHandlers) {
                try { handler(code, signal) } catch { /* swallow */ }
              }
              return
            }
            if (msg.type === 'ping') {
              if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'pong' }))
              }
              return
            }
            if (msg.type === 'error') {
              console.error('[useTerminal] Server error:', msg.message)
              errorMessage.value = typeof msg.message === 'string' ? msg.message : 'Unknown error'
              status.value = 'error'
              return
            }
          }
        }
        catch {
          // Not valid JSON -- fall through to data handlers
        }
      }

      // Terminal output data
      for (const handler of dataHandlers) {
        try { handler(raw) } catch { /* swallow */ }
      }
      lastOutputAt.value = Date.now()

      // Flow control: report consumed bytes back to server
      trackDrainBytes(new TextEncoder().encode(raw).length)
    }

    socket.onclose = (event) => {
      if (intentionalClose) {
        status.value = 'disconnected'
        return
      }

      // Permanent close codes -- stop reconnecting
      if (event.code === 4004) {
        // Session not found (server restarted)
        sessionExpired.value = true
        sessionId.value = null
        status.value = 'disconnected'
        return
      }
      if (event.code >= 4000 && event.code <= 4002) {
        // 4000: missing agentId, 4001: unknown agent, 4002: spawn failed
        errorMessage.value = event.reason || 'Connection rejected by server'
        status.value = 'error'
        return
      }

      status.value = 'disconnected'
      attemptReconnect()
    }

    socket.onerror = () => {
      // onclose will fire after onerror, so we don't set status here
    }
  }

  function attemptReconnect() {
    if (intentionalClose) return
    if (reconnectAttempt.value >= MAX_RECONNECT_ATTEMPTS) {
      status.value = 'error'
      return
    }

    status.value = 'reconnecting'
    reconnectAttempt.value++
    const exponentialDelay = RECONNECT_BASE_DELAY_MS * Math.pow(2, reconnectAttempt.value - 1)
    const jitter = Math.random() * RECONNECT_JITTER_MS
    const delay = Math.min(exponentialDelay + jitter, RECONNECT_MAX_DELAY_MS)
    clearReconnectTimer()

    reconnectTimer = setTimeout(() => {
      reconnectTimer = null

      // Prefer reconnect by sessionId if we have one
      if (sessionId.value) {
        const url = buildWsUrl({ reconnect: sessionId.value })
        openWebSocket(url)
      }
      else if (lastAgentId) {
        // Fall back to new connection
        const params: Record<string, string> = { agentId: lastAgentId }
        if (lastOptions.cols) params.cols = String(lastOptions.cols)
        if (lastOptions.rows) params.rows = String(lastOptions.rows)
        if (lastOptions.cwd) params.cwd = lastOptions.cwd
        if (lastOptions.launchOptions?.sessionContinue) params.sessionContinue = 'true'
        if (lastOptions.launchOptions?.permissionSkip) params.permissionSkip = 'true'
        if (lastOptions.launchOptions?.modelOverride) {
          params.modelProvider = lastOptions.launchOptions.modelOverride.provider
          params.modelName = lastOptions.launchOptions.modelOverride.model
        }
        openWebSocket(buildWsUrl(params))
      }
    }, delay)
  }

  function connect(agentId: string, options?: { cols?: number, rows?: number, cwd?: string, launchOptions?: LaunchOptions }) {
    intentionalClose = false
    reconnectAttempt.value = 0
    clearReconnectTimer()

    lastAgentId = agentId
    lastOptions = options ?? {}
    sessionExpired.value = false
    errorMessage.value = null

    // Set connecting BEFORE openWebSocket so status is 'connecting' when
    // connectedAgentId is set in TerminalView (prevents overlay flash)
    status.value = 'connecting'

    const params: Record<string, string> = { agentId }
    if (options?.cols) params.cols = String(options.cols)
    if (options?.rows) params.rows = String(options.rows)
    if (options?.cwd) params.cwd = options.cwd
    if (options?.launchOptions?.sessionContinue) params.sessionContinue = 'true'
    if (options?.launchOptions?.permissionSkip) params.permissionSkip = 'true'
    if (options?.launchOptions?.modelOverride) {
      params.modelProvider = options.launchOptions.modelOverride.provider
      params.modelName = options.launchOptions.modelOverride.model
    }

    openWebSocket(buildWsUrl(params))
  }

  function reconnect(sid: string) {
    intentionalClose = false
    reconnectAttempt.value = 0
    clearReconnectTimer()

    sessionId.value = sid
    openWebSocket(buildWsUrl({ reconnect: sid }))
  }

  function connectWithResume(agentId: string, options?: { cols?: number, rows?: number, cwd?: string, launchOptions?: LaunchOptions }) {
    intentionalClose = false
    reconnectAttempt.value = 0
    clearReconnectTimer()

    lastAgentId = agentId
    lastOptions = options ?? {}
    sessionExpired.value = false
    errorMessage.value = null
    status.value = 'connecting'

    const params: Record<string, string> = { resume: agentId }
    if (options?.cols) params.cols = String(options.cols)
    if (options?.rows) params.rows = String(options.rows)
    if (options?.cwd) params.cwd = options.cwd
    if (options?.launchOptions?.sessionContinue) params.sessionContinue = 'true'
    if (options?.launchOptions?.permissionSkip) params.permissionSkip = 'true'
    if (options?.launchOptions?.modelOverride) {
      params.modelProvider = options.launchOptions.modelOverride.provider
      params.modelName = options.launchOptions.modelOverride.model
    }

    openWebSocket(buildWsUrl(params))
  }

  function disconnect() {
    intentionalClose = true
    clearReconnectTimer()
    teardownWs()
    status.value = 'disconnected'
  }

  function write(data: string) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(data)
    }
  }

  function resize(cols: number, rows: number) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'resize', cols, rows }))
    }
  }

  function onData(handler: (data: string) => void): () => void {
    dataHandlers.add(handler)
    return () => { dataHandlers.delete(handler) }
  }

  function onExit(handler: (code: number, signal?: number) => void): () => void {
    exitHandlers.add(handler)
    return () => { exitHandlers.delete(handler) }
  }

  // Start/stop idle timer based on connection status
  if (import.meta.client) {
    function startIdleTimer() {
      if (idleTimer) return
      now.value = Date.now()
      idleTimer = setInterval(() => { now.value = Date.now() }, 3000)
    }

    function stopIdleTimer() {
      if (idleTimer) {
        clearInterval(idleTimer)
        idleTimer = null
      }
    }

    watch(status, (s) => {
      if (s === 'connected') {
        startIdleTimer()
      }
      else {
        stopIdleTimer()
      }
    })

    // Cleanup on component unmount
    onUnmounted(() => {
      stopIdleTimer()
      disconnect()
      dataHandlers.clear()
      exitHandlers.clear()
    })
  }

  return {
    sessionId,
    status,
    errorMessage,
    hasConnectedOnce,
    sessionExpired,
    lastOutputAt,
    isIdle,
    reconnectAttempt,
    reconnectMax: MAX_RECONNECT_ATTEMPTS,
    connect,
    connectWithResume,
    reconnect,
    disconnect,
    write,
    resize,
    onData,
    onExit,
  }
}
