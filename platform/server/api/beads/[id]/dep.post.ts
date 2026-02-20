import { useBeadsClient } from '~~/server/services/beads-client'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')

  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Missing bead id' })
  }

  const body = await readBody<{ dependsOn: string }>(event)

  if (!body.dependsOn) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Missing required field: dependsOn (the ID this bead depends on)',
    })
  }

  const client = useBeadsClient()
  await client.addDep(id, body.dependsOn)

  return { added: true, from: id, dependsOn: body.dependsOn }
})
