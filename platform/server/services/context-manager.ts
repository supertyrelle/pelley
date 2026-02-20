import type { Bead } from '~~/shared/types/bead'
import type { ContextEvent } from '~~/shared/types/context'
import { useBeadsClient } from './beads-client'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ContextScope = 'shared' | 'isolated'

type EventHandler = (event: ContextEvent) => void

// ---------------------------------------------------------------------------
// ContextManager
// ---------------------------------------------------------------------------

export class ContextManager {
  /** Per-session context scope. Defaults to 'isolated' when absent. */
  private scopes = new Map<string, ContextScope>()

  /** Which session created which bead. */
  private beadOwnership = new Map<string, string>()

  /** Event listeners keyed by event type. */
  private listeners = new Map<ContextEvent['type'], Set<EventHandler>>()

  // -----------------------------------------------------------------------
  // Scope management
  // -----------------------------------------------------------------------

  /** Set the context scope for a session. Emits 'scope-changed'. */
  setScope(sessionId: string, scope: ContextScope): void {
    const previous = this.scopes.get(sessionId) ?? 'isolated'
    this.scopes.set(sessionId, scope)

    if (previous !== scope) {
      this.emit({
        type: 'scope-changed',
        sessionId,
        data: { previous, current: scope },
      })
    }
  }

  /** Get the context scope for a session. Defaults to 'isolated'. */
  getScope(sessionId: string): ContextScope {
    return this.scopes.get(sessionId) ?? 'isolated'
  }

  /** Return IDs of all sessions currently in shared scope. */
  getSharedSessions(): string[] {
    const result: string[] = []
    for (const [id, scope] of this.scopes) {
      if (scope === 'shared') {
        result.push(id)
      }
    }
    return result
  }

  /** Clean up state when a session ends. Emits 'session-left'. */
  removeSession(sessionId: string): void {
    const hadScope = this.scopes.has(sessionId)
    this.scopes.delete(sessionId)

    // Remove bead ownership entries for this session
    for (const [beadId, owner] of this.beadOwnership) {
      if (owner === sessionId) {
        this.beadOwnership.delete(beadId)
      }
    }

    if (hadScope) {
      this.emit({ type: 'session-left', sessionId })
    }
  }

  // -----------------------------------------------------------------------
  // Bead visibility
  // -----------------------------------------------------------------------

  /**
   * Return beads visible to a session based on its scope.
   *
   * - **shared**: all beads from the bd backlog (shared pool).
   * - **isolated**: only beads registered to this session via registerBead().
   */
  async getVisibleBeads(sessionId: string): Promise<Bead[]> {
    const scope = this.getScope(sessionId)
    const client = useBeadsClient()

    if (scope === 'shared') {
      // Shared sessions see the full backlog
      return client.list()
    }

    // Isolated sessions see only beads they own
    const ownedBeadIds = this.getOwnedBeadIds(sessionId)
    if (ownedBeadIds.length === 0) {
      return []
    }

    // Fetch each owned bead individually. The bd CLI doesn't support
    // batch-by-id filtering, so we fetch all and filter in memory.
    const allBeads = await client.list()
    const ownedSet = new Set(ownedBeadIds)
    return allBeads.filter((bead) => ownedSet.has(bead.id))
  }

  /** Record that a bead was created by a specific session. Emits 'bead-created'. */
  registerBead(beadId: string, sessionId: string): void {
    this.beadOwnership.set(beadId, sessionId)
    this.emit({
      type: 'bead-created',
      sessionId,
      data: { beadId },
    })
  }

  /** Return the session ID that created a bead, or undefined. */
  getBeadOwner(beadId: string): string | undefined {
    return this.beadOwnership.get(beadId)
  }

  // -----------------------------------------------------------------------
  // Event system
  // -----------------------------------------------------------------------

  /** Subscribe to a specific event type. Returns an unsubscribe function. */
  on(eventType: ContextEvent['type'], handler: EventHandler): () => void {
    let handlers = this.listeners.get(eventType)
    if (!handlers) {
      handlers = new Set()
      this.listeners.set(eventType, handlers)
    }
    handlers.add(handler)

    return () => {
      handlers!.delete(handler)
      if (handlers!.size === 0) {
        this.listeners.delete(eventType)
      }
    }
  }

  /** Emit an event to all registered handlers. */
  emit(event: ContextEvent): void {
    const handlers = this.listeners.get(event.type)
    if (!handlers) return

    for (const handler of handlers) {
      try {
        handler(event)
      }
      catch {
        // Listener threw -- don't let it break other listeners
      }
    }
  }

  // -----------------------------------------------------------------------
  // Internal helpers
  // -----------------------------------------------------------------------

  /** Return all bead IDs owned by a session. */
  private getOwnedBeadIds(sessionId: string): string[] {
    const result: string[] = []
    for (const [beadId, owner] of this.beadOwnership) {
      if (owner === sessionId) {
        result.push(beadId)
      }
    }
    return result
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let _instance: ContextManager | undefined

export function useContextManager(): ContextManager {
  if (!_instance) {
    _instance = new ContextManager()
  }
  return _instance
}
