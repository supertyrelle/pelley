import { useBeadsClient } from '~~/server/services/beads-client'

export default defineEventHandler(async () => {
  const client = useBeadsClient()
  return client.ready()
})
