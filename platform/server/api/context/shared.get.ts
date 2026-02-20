import { useContextManager } from '~~/server/services/context-manager'

export default defineEventHandler(() => {
  const ctx = useContextManager()
  const sessions = ctx.getSharedSessions()

  return {
    sessions,
    count: sessions.length,
  }
})
