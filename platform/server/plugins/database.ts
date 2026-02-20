import { runMigrations } from '../db'

export default defineNitroPlugin(() => {
  console.log('[db] Running database migrations...')
  try {
    runMigrations()
    console.log('[db] Migrations complete.')
  } catch (err) {
    console.error('[db] Migration failed:', err)
    throw err
  }
})
