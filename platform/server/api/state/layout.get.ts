import { eq } from 'drizzle-orm'
import { getDb, schema } from '../../db'

export default defineEventHandler(async () => {
  const db = getDb()
  const row = db
    .select()
    .from(schema.layoutState)
    .where(eq(schema.layoutState.id, 'current'))
    .get()

  if (!row) {
    return { panels: null }
  }

  return {
    panels: JSON.parse(row.panels),
    updatedAt: row.updatedAt,
  }
})
