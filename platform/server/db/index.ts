import { drizzle } from 'drizzle-orm/better-sqlite3'
import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import * as schema from './schema'

export { schema }
export type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'

const DB_PATH = resolve('.data/pelley.db')
const MIGRATIONS_PATH = resolve('server/db/migrations')

let _db: ReturnType<typeof createDatabase> | null = null

function createDatabase() {
  // Ensure parent directory exists
  mkdirSync(dirname(DB_PATH), { recursive: true })

  const sqlite = new Database(DB_PATH)

  // Enable WAL mode for better concurrent read performance
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')

  return drizzle({ client: sqlite, schema })
}

export function getDb() {
  if (!_db) {
    _db = createDatabase()
  }
  return _db
}

export function runMigrations() {
  const db = getDb()
  migrate(db, { migrationsFolder: MIGRATIONS_PATH })
}
