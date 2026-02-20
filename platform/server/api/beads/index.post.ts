import { useBeadsClient } from '~~/server/services/beads-client'
import { useBeadsWatcher } from '~~/server/services/beads-watcher'

export default defineEventHandler(async (event) => {
  const body = await readBody<{
    title: string
    type: string
    priority?: string
    parent?: string
    description?: string
  }>(event)

  if (!body.title || !body.type) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Missing required fields: title, type',
    })
  }

  const client = useBeadsClient()
  const bead = await client.create(body)

  // Emit real-time event for WebSocket subscribers
  const watcher = useBeadsWatcher()
  watcher.emit({
    type: 'bead:created',
    bead,
    timestamp: Date.now(),
  })

  // Also refresh stats since counts changed
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

  return bead
})
