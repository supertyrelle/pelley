import { useBeadsClient } from '~~/server/services/beads-client'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ flushOnly?: boolean }>(event).catch(() => ({} as { flushOnly?: boolean }))

  const client = useBeadsClient()
  await client.sync({ flushOnly: body.flushOnly })

  return { synced: true }
})
