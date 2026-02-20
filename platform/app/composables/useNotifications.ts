export interface AppNotification {
  id: string
  type: 'info' | 'success' | 'warning' | 'error'
  title: string
  message?: string
  duration?: number // ms, default 5000. 0 = persistent
  timestamp: number
}

const MAX_VISIBLE = 5

// Shared state across all consumers
const notifications = ref<AppNotification[]>([])
const timers = new Map<string, ReturnType<typeof setTimeout>>()

function generateId(): string {
  return `notif-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export function useNotifications() {
  function dismiss(id: string) {
    const timer = timers.get(id)
    if (timer) {
      clearTimeout(timer)
      timers.delete(id)
    }
    notifications.value = notifications.value.filter(n => n.id !== id)
  }

  function notify(opts: Omit<AppNotification, 'id' | 'timestamp'>): string {
    const id = generateId()
    const duration = opts.duration ?? 5000

    const notification: AppNotification = {
      ...opts,
      id,
      duration,
      timestamp: Date.now(),
    }

    notifications.value.push(notification)

    // Enforce max visible -- dismiss oldest first
    while (notifications.value.length > MAX_VISIBLE) {
      const oldest = notifications.value[0]
      if (oldest) dismiss(oldest.id)
    }

    // Auto-dismiss after duration (unless persistent)
    if (duration > 0) {
      timers.set(id, setTimeout(() => dismiss(id), duration))
    }

    return id
  }

  function clearAll() {
    for (const [id, timer] of timers) {
      clearTimeout(timer)
      timers.delete(id)
    }
    notifications.value = []
  }

  return {
    notifications: readonly(notifications),
    notify,
    dismiss,
    clearAll,
  }
}
