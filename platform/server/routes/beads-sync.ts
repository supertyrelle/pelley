import type { Peer } from 'crossws'
import { useBeadsWatcher } from '~~/server/services/beads-watcher'
import type { BeadEvent } from '~~/shared/types/bead'

/**
 * WebSocket endpoint for real-time bead sync.
 *
 * Clients connect to `/_ws/beads-sync` (Nitro prefixes server/routes
 * files at the root, so the file path becomes the route path).
 *
 * Protocol:
 *   - On open: server sends current stats as a `bead:stats-changed` event
 *   - Server pushes `BeadEvent` messages as JSON whenever beads change
 *   - Client can send `{ type: "ping" }` to keep the connection alive
 *   - Server responds with `{ type: "pong", timestamp }` to pings
 */
export default defineWebSocketHandler({
  open(peer: Peer) {
    const watcher = useBeadsWatcher()

    // Track cleanup function on peer context so we can unsubscribe on close
    const unsubscribe = watcher.on((event: BeadEvent) => {
      try {
        peer.send(JSON.stringify(event))
      }
      catch {
        // Peer may have disconnected between event and send
      }
    })

    peer.context.unsubscribe = unsubscribe

    // Send current stats as initial state
    const stats = watcher.currentStats
    if (stats) {
      const initialEvent: BeadEvent = {
        type: 'bead:stats-changed',
        stats,
        timestamp: Date.now(),
      }
      peer.send(JSON.stringify(initialEvent))
    }
  },

  message(peer: Peer, message) {
    try {
      const data = JSON.parse(message.text())
      if (data.type === 'ping') {
        peer.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }))
      }
    }
    catch {
      // Ignore malformed messages
    }
  },

  close(peer: Peer) {
    const unsubscribe = peer.context.unsubscribe as (() => void) | undefined
    if (unsubscribe) {
      unsubscribe()
    }
  },

  error(peer: Peer, error) {
    console.error('[beads-sync] WebSocket error:', error)
    const unsubscribe = peer.context.unsubscribe as (() => void) | undefined
    if (unsubscribe) {
      unsubscribe()
    }
  },
})
