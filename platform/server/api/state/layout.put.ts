import { eq } from 'drizzle-orm'
import { getDb, schema } from '../../db'

export default defineEventHandler(async (event) => {
  const body = await readBody(event)

  if (!body?.panels || !Array.isArray(body.panels)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'panels must be an array',
    })
  }

  const db = getDb()
  const now = Date.now()

  const existing = db
    .select({ id: schema.layoutState.id })
    .from(schema.layoutState)
    .where(eq(schema.layoutState.id, 'current'))
    .get()

  if (existing) {
    db.update(schema.layoutState)
      .set({
        panels: JSON.stringify(body.panels),
        updatedAt: now,
      })
      .where(eq(schema.layoutState.id, 'current'))
      .run()
  } else {
    db.insert(schema.layoutState)
      .values({
        id: 'current',
        panels: JSON.stringify(body.panels),
        updatedAt: now,
      })
      .run()
  }

  return { ok: true, updatedAt: now }
})
