import { useBeadsClient } from '~~/server/services/beads-client'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')

  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Missing bead id' })
  }

  const client = useBeadsClient()
  return client.children(id)
})
