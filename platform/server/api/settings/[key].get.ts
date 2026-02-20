import { eq } from 'drizzle-orm'
import { getDb, schema } from '../../db'

export default defineEventHandler(async (event) => {
  const key = getRouterParam(event, 'key')

  if (!key) {
    throw createError({
      statusCode: 400,
      statusMessage: 'key is required',
    })
  }

  const db = getDb()
  const row = db
    .select()
    .from(schema.settings)
    .where(eq(schema.settings.key, key))
    .get()

  if (!row) {
    return { key, value: null }
  }

  return {
    key: row.key,
    value: JSON.parse(row.value),
    updatedAt: row.updatedAt,
  }
})
