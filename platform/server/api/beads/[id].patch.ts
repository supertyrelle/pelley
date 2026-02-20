import type { BeadUpdate } from '~~/shared/types/bead'
import { useBeadsClient } from '~~/server/services/beads-client'
import { useBeadsWatcher } from '~~/server/services/beads-watcher'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')

  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Missing bead id' })
  }

  const body = await readBody<Partial<BeadUpdate>>(event)

  if (!body || Object.keys(body).length === 0) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Request body must contain at least one field to update',
    })
  }

  const client = useBeadsClient()
  await client.update(id, body)

  // Return the updated bead
  const bead = await client.show(id)

  // Emit real-time event for WebSocket subscribers
  const watcher = useBeadsWatcher()
  watcher.emit({
    type: 'bead:updated',
    bead,
    timestamp: Date.now(),
  })

  // Refresh stats if status changed (affects counts)
  if (body.status) {
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
  }

  return bead
})
