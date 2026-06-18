import { app } from 'electron'
import { join } from 'path'
import { PostgresAdapter } from './postgresAdapter'
import { getDatabaseType, getPostgresConnectionString, type DatabaseAdapter } from './adapter'
import { applySchema } from './schema'

const DB_FILE_NAME = 'inventory.sqlite'

export function dbPath(): string {
  return join(app.getPath('userData'), DB_FILE_NAME)
}

let adapter: DatabaseAdapter | null = null

export async function initDb(): Promise<DatabaseAdapter> {
  if (adapter) return adapter

  const dbType = getDatabaseType()
  if (dbType !== 'postgres') {
    throw new Error('Only DATABASE_TYPE=postgres is supported. Set POSTGRES_CONNECTION_STRING in .env')
  }

  const pg = new PostgresAdapter(getPostgresConnectionString())
  await runPostgresMigrations(pg)
  adapter = pg
  return pg
}

export function getDb(): DatabaseAdapter {
  if (!adapter) throw new Error('Database not initialized — call initDb() first')
  return adapter
}

async function runPostgresMigrations(pg: PostgresAdapter): Promise<void> {
  // Schema DDL lives in schema.ts (no Electron dependency) so the integration
  // tests can apply the identical schema to a disposable database.
  await applySchema(pg)

  const applied = new Set(
    (await pg.query('SELECT version FROM schema_migrations'))
      .rows
      .map((row) => Number(row.version))
  )

  if (!applied.has(1)) {
    await pg.query(
      'INSERT INTO schema_migrations (version, name) VALUES (?, ?)',
      [1, 'initial schema']
    )
  }
}

export async function closeDb(): Promise<void> {
  if (adapter) {
    await adapter.close()
    adapter = null
  }
}
