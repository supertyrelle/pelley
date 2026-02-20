import type { ComputedRef, Ref } from 'vue'
import type { ApprovalRequestEvent } from '~~/shared/types/agent-driver'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ApprovalItem extends ApprovalRequestEvent {
  sessionId: string
  addedAt: number
}

export interface ApprovalQueueInstance {
  pending: Ref<ApprovalItem[]>
  count: ComputedRef<number>
  addApproval(sessionId: string, event: ApprovalRequestEvent): void
  resolveApproval(sessionId: string, requestId: string, approved: boolean, alwaysAllow?: boolean): void
  approveAll(): void
  rejectAll(): void
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Approvals older than this are automatically expired */
const STALE_THRESHOLD_MS = 5 * 60 * 1000 // 5 minutes

// ---------------------------------------------------------------------------
// Module-level shared state (global singleton across components)
// ---------------------------------------------------------------------------

const pending = ref<ApprovalItem[]>([]) as Ref<ApprovalItem[]>
let expiryTimer: ReturnType<typeof setInterval> | null = null

function startExpiryTimer() {
  if (expiryTimer) return
  expiryTimer = setInterval(() => {
    const now = Date.now()
    const before = pending.value.length
    pending.value = pending.value.filter(item => now - item.addedAt < STALE_THRESHOLD_MS)
    if (pending.value.length === 0 && before > 0) {
      stopExpiryTimer()
    }
  }, 30_000) // Check every 30s
}

function stopExpiryTimer() {
  if (expiryTimer) {
    clearInterval(expiryTimer)
    expiryTimer = null
  }
}

// ---------------------------------------------------------------------------
// Composable
// ---------------------------------------------------------------------------

export function useApprovalQueue(): ApprovalQueueInstance {
  const count = computed(() => pending.value.length)

  function addApproval(sessionId: string, event: ApprovalRequestEvent): void {
    // Avoid duplicates
    const exists = pending.value.some(
      item => item.sessionId === sessionId && item.requestId === event.requestId,
    )
    if (exists) return

    const item: ApprovalItem = {
      ...event,
      sessionId,
      addedAt: Date.now(),
    }

    pending.value = [...pending.value, item]
    startExpiryTimer()
  }

  function resolveApproval(
    sessionId: string,
    requestId: string,
    _approved: boolean,
    _alwaysAllow?: boolean,
  ): void {
    pending.value = pending.value.filter(
      item => !(item.sessionId === sessionId && item.requestId === requestId),
    )
    if (pending.value.length === 0) {
      stopExpiryTimer()
    }
  }

  function approveAll(): void {
    // Caller is responsible for actually sending approval responses to each session.
    // This clears the queue — the component using this composable should iterate
    // over pending items and call the session-level approval API before calling this.
    pending.value = []
    stopExpiryTimer()
  }

  function rejectAll(): void {
    // Same as approveAll — caller sends rejection responses, then clears the queue.
    pending.value = []
    stopExpiryTimer()
  }

  return {
    pending,
    count,
    addApproval,
    resolveApproval,
    approveAll,
    rejectAll,
  }
}
