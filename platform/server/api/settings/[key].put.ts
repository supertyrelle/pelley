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

  const body = await readBody(event)

  if (body?.value === undefined) {
    throw createError({
      statusCode: 400,
      statusMessage: 'value is required',
    })
  }

  const db = getDb()
  const now = Date.now()

  const existing = db
    .select({ key: schema.settings.key })
    .from(schema.settings)
    .where(eq(schema.settings.key, key))
    .get()

  if (existing) {
    db.update(schema.settings)
      .set({
        value: JSON.stringify(body.value),
        updatedAt: now,
      })
      .where(eq(schema.settings.key, key))
      .run()
  } else {
    db.insert(schema.settings)
      .values({
        key,
        value: JSON.stringify(body.value),
        updatedAt: now,
      })
      .run()
  }

  return { ok: true, key, updatedAt: now }
})
