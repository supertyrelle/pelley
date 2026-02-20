import { useBeadsClient } from './beads-client'
import type { Bead, BeadEvent, BeadEventType, BeadStats } from '~~/shared/types/bead'

// -------------------------------------------------------------------
// Configuration
// -------------------------------------------------------------------

const DEFAULT_POLL_INTERVAL_MS = 5_000
const MIN_POLL_INTERVAL_MS = 1_000

// -------------------------------------------------------------------
// Event emitter (minimal, typed)
// -------------------------------------------------------------------

type BeadEventHandler = (event: BeadEvent) => void

// -------------------------------------------------------------------
// BeadsWatcher
// -------------------------------------------------------------------

/**
 * Polls `bd` for bead state changes and emits typed events.
 *
 * Uses polling (`bd list --json` + `bd status --json`) rather than file
 * watching because polling is more reliable across platforms and does
 * not depend on `.beads/` internal file layout.
 */
export class BeadsWatcher {
  private handlers: Set<BeadEventHandler> = new Set()
  private pollTimer: ReturnType<typeof setInterval> | null = null
  private pollIntervalMs: number
  private cachedBeads: Map<string, Bead> = new Map()
  private cachedStats: BeadStats | null = null
  private running = false

  constructor(pollIntervalMs?: number) {
    this.pollIntervalMs = Math.max(
      pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
      MIN_POLL_INTERVAL_MS,
    )
  }

  // -----------------------------------------------------------------
  // Subscription
  // -----------------------------------------------------------------

  on(handler: BeadEventHandler): () => void {
    this.handlers.add(handler)
    this.ensureRunning()
    return () => {
      this.handlers.delete(handler)
      if (this.handlers.size === 0) {
        this.stop()
      }
    }
  }

  /** Number of active subscribers. */
  get subscriberCount(): number {
    return this.handlers.size
  }

  // -----------------------------------------------------------------
  // Emit
  // -----------------------------------------------------------------

  /** Broadcast an event to all subscribers. */
  emit(event: BeadEvent): void {
    for (const handler of this.handlers) {
      try {
        handler(event)
      }
      catch (err) {
        console.error('[beads-watcher] Handler error:', err)
      }
    }
  }

  // -----------------------------------------------------------------
  // Polling lifecycle
  // -----------------------------------------------------------------

  /** Start polling if not already running and there are subscribers. */
  private ensureRunning(): void {
    if (this.running) return
    this.running = true
    // Run an initial poll immediately, then schedule recurring polls
    this.poll().catch((err) => {
      console.error('[beads-watcher] Initial poll failed:', err)
    })
    this.pollTimer = setInterval(() => {
      this.poll().catch((err) => {
        console.error('[beads-watcher] Poll failed:', err)
      })
    }, this.pollIntervalMs)
  }

  /** Stop polling (called when last subscriber unsubscribes). */
  stop(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer)
      this.pollTimer = null
    }
    this.running = false
  }

  /** Single poll cycle: fetch current state, diff, emit events. */
  private async poll(): Promise<void> {
    const client = useBeadsClient()

    if (!(await client.isAvailable())) return

    try {
      const [beads, stats] = await Promise.all([
        client.list(),
        client.stats(),
      ])

      this.diffBeads(beads)
      this.diffStats(stats)
    }
    catch (err) {
      // Swallow poll errors -- the watcher should be resilient
      console.error('[beads-watcher] Poll error:', err)
    }
  }

  // -----------------------------------------------------------------
  // Diffing
  // -----------------------------------------------------------------

  private diffBeads(current: Bead[]): void {
    const currentMap = new Map(current.map(b => [b.id, b]))

    // Detect new and updated beads
    for (const bead of current) {
      const prev = this.cachedBeads.get(bead.id)

      if (!prev) {
        this.emit({
          type: 'bead:created',
          bead,
          timestamp: Date.now(),
        })
      }
      else if (beadChanged(prev, bead)) {
        // Detect close transitions specifically
        const eventType: BeadEventType =
          prev.status !== 'closed' && bead.status === 'closed'
            ? 'bead:closed'
            : 'bead:updated'

        this.emit({
          type: eventType,
          bead,
          timestamp: Date.now(),
        })
      }
    }

    // We intentionally do not emit events for beads that disappear from
    // the list -- beads are not deleted in bd, only closed.

    this.cachedBeads = currentMap
  }

  private diffStats(current: BeadStats): void {
    if (this.cachedStats && !statsEqual(this.cachedStats, current)) {
      this.emit({
        type: 'bead:stats-changed',
        stats: current,
        timestamp: Date.now(),
      })
    }

    this.cachedStats = current
  }

  /** Return the last polled stats (for initial state on connect). */
  get currentStats(): BeadStats | null {
    return this.cachedStats
  }
}

// -------------------------------------------------------------------
// Comparison helpers
// -------------------------------------------------------------------

function beadChanged(a: Bead, b: Bead): boolean {
  // Fast path: updatedAt changed
  if (a.updatedAt !== b.updatedAt) return true

  // Fallback: compare key fields
  return (
    a.status !== b.status
    || a.title !== b.title
    || a.priority !== b.priority
    || a.assignee !== b.assignee
    || a.description !== b.description
  )
}

function statsEqual(a: BeadStats, b: BeadStats): boolean {
  return (
    a.total === b.total
    && a.open === b.open
    && a.closed === b.closed
    && a.inProgress === b.inProgress
    && a.blocked === b.blocked
    && a.deferred === b.deferred
    && a.ready === b.ready
  )
}

// -------------------------------------------------------------------
// Singleton
// -------------------------------------------------------------------

let _instance: BeadsWatcher | undefined

export function useBeadsWatcher(pollIntervalMs?: number): BeadsWatcher {
  if (!_instance) {
    _instance = new BeadsWatcher(pollIntervalMs)
  }
  return _instance
}
