import type { Peer } from 'crossws'
import type { ContextEvent } from '~~/shared/types/context'
import { useContextManager } from '~~/server/services/context-manager'

// ---------------------------------------------------------------------------
// Track connected WebSocket peers so we can broadcast context changes
// ---------------------------------------------------------------------------

const peers = new Set<Peer>()

/** Broadcast a context event to all connected peers as JSON. */
function broadcast(event: ContextEvent): void {
  const payload = JSON.stringify(event)
  for (const peer of peers) {
    try {
      peer.send(payload)
    }
    catch {
      // Peer may have disconnected -- remove it
      peers.delete(peer)
    }
  }
}

// ---------------------------------------------------------------------------
// Wire up ContextManager events -> WebSocket broadcast
// ---------------------------------------------------------------------------

let wired = false

function ensureWired(): void {
  if (wired) return
  wired = true

  const ctx = useContextManager()
  const eventTypes: ContextEvent['type'][] = [
    'scope-changed',
    'session-joined',
    'session-left',
    'bead-created',
    'bead-updated',
  ]

  for (const eventType of eventTypes) {
    ctx.on(eventType, (event) => {
      broadcast(event)
    })
  }
}

// ---------------------------------------------------------------------------
// WebSocket handler
// ---------------------------------------------------------------------------

export default defineWebSocketHandler({
  open(peer) {
    ensureWired()
    peers.add(peer)
  },

  close(peer) {
    peers.delete(peer)
  },

  error(peer) {
    peers.delete(peer)
  },
})
