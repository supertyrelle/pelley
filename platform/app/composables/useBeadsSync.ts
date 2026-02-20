import type { BeadEvent, BeadStats } from '~~/shared/types/bead'

// -------------------------------------------------------------------
// Reconnect configuration
// -------------------------------------------------------------------

const INITIAL_RECONNECT_MS = 1_000
const MAX_RECONNECT_MS = 30_000
const MAX_RECENT_EVENTS = 50

// -------------------------------------------------------------------
// Composable
// -------------------------------------------------------------------

/**
 * Reactive WebSocket composable for real-time bead sync.
 *
 * Connects to the `/beads-sync` WebSocket endpoint, maintains reactive
 * state for stats and recent events, and auto-reconnects with
 * exponential backoff on disconnect.
 *
 * Usage:
 * ```ts
 * const { stats, recentEvents, connected, onBeadEvent } = useBeadsSync()
 * ```
 */
export function useBeadsSync() {
  const stats = ref<BeadStats | null>(null)
  const recentEvents = ref<BeadEvent[]>([])
  const connected = ref(false)

  const eventHandlers = new Set<(event: BeadEvent) => void>()

  let ws: WebSocket | null = null
  let reconnectMs = INITIAL_RECONNECT_MS
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let stopped = false

  // ---------------------------------------------------------------
  // WebSocket URL
  // ---------------------------------------------------------------

  function getWsUrl(): string {
    if (import.meta.server) return ''
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    return `${protocol}//${window.location.host}/beads-sync`
  }

  // ---------------------------------------------------------------
  // Connection management
  // ---------------------------------------------------------------

  function connect(): void {
    if (import.meta.server || stopped) return

    const url = getWsUrl()
    if (!url) return

    try {
      ws = new WebSocket(url)
    }
    catch {
      scheduleReconnect()
      return
    }

    ws.onopen = () => {
      connected.value = true
      reconnectMs = INITIAL_RECONNECT_MS
    }

    ws.onmessage = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data as string)

        // Handle pong responses (keep-alive)
        if (data.type === 'pong') return

        const beadEvent = data as BeadEvent

        // Update reactive stats
        if (beadEvent.stats) {
          stats.value = beadEvent.stats
        }

        // Push to recent events ring buffer
        recentEvents.value = [
          beadEvent,
          ...recentEvents.value,
        ].slice(0, MAX_RECENT_EVENTS)

        // Notify subscribers
        for (const handler of eventHandlers) {
          try {
            handler(beadEvent)
          }
          catch (err) {
            console.error('[useBeadsSync] Event handler error:', err)
          }
        }
      }
      catch {
        // Ignore malformed messages
      }
    }

    ws.onclose = () => {
      connected.value = false
      ws = null
      if (!stopped) {
        scheduleReconnect()
      }
    }

    ws.onerror = () => {
      // onclose will fire after onerror, which handles reconnect
    }
  }

  function scheduleReconnect(): void {
    if (stopped || reconnectTimer) return
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      reconnectMs = Math.min(reconnectMs * 2, MAX_RECONNECT_MS)
      connect()
    }, reconnectMs)
  }

  function disconnect(): void {
    stopped = true
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
    if (ws) {
      ws.onclose = null // prevent reconnect on intentional close
      ws.close()
      ws = null
    }
    connected.value = false
  }

  // ---------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------

  /**
   * Subscribe to bead events. Returns an unsubscribe function.
   */
  function onBeadEvent(handler: (event: BeadEvent) => void): () => void {
    eventHandlers.add(handler)
    return () => {
      eventHandlers.delete(handler)
    }
  }

  // ---------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------

  // Only connect on client-side
  if (import.meta.client) {
    onMounted(() => {
      connect()
    })

    onUnmounted(() => {
      disconnect()
      eventHandlers.clear()
    })
  }

  return {
    stats: readonly(stats),
    recentEvents: readonly(recentEvents),
    connected: readonly(connected),
    onBeadEvent,
  }
}
