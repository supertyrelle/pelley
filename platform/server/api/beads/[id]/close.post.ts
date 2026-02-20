import { useBeadsClient } from '~~/server/services/beads-client'
import { useBeadsWatcher } from '~~/server/services/beads-watcher'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')

  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Missing bead id' })
  }

  const body = await readBody<{ reason?: string }>(event).catch(() => ({} as { reason?: string }))

  // Fetch the bead before closing so we can include it in the event
  const client = useBeadsClient()
  let bead
  try {
    bead = await client.show(id)
  }
  catch {
    // If we can't fetch it first, proceed with close anyway
  }

  await client.close(id, body.reason)

  // Emit real-time event for WebSocket subscribers
  const watcher = useBeadsWatcher()
  if (bead) {
    bead.status = 'closed'
    watcher.emit({
      type: 'bead:closed',
      bead,
      timestamp: Date.now(),
    })
  }

  // Refresh stats since counts changed
  try {
    const stats = await client.stats()
    watcher.emit({
      type: 'bead:stats-changed',
      stats,
      timestamp: Date.now(),
    })
  }
  catch {
    // Stats refresh is best-effort
  }

  return { closed: true, id }
})
