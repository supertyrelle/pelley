export interface ContextState {
  sessionId: string
  scope: 'shared' | 'isolated'
  visibleBeadIds: string[]
}

export interface ContextEvent {
  type: 'scope-changed' | 'session-joined' | 'session-left' | 'bead-created' | 'bead-updated'
  sessionId: string
  data?: unknown
}
