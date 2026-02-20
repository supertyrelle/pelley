import { useBeadsClient } from '~~/server/services/beads-client'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const client = useBeadsClient()

  return client.list({
    status: query.status as string | undefined,
    type: query.type as string | undefined,
    parent: query.parent as string | undefined,
    limit: query.limit ? Number(query.limit) : undefined,
  })
})
