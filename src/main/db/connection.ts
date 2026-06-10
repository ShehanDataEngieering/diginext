import { app } from 'electron'
import { join } from 'path'
import { PostgresAdapter } from './postgresAdapter'
import { getDatabaseType, getPostgresConnectionString, type DatabaseAdapter } from './adapter'

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
  await pg.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    INTEGER PRIMARY KEY,
      name       TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT NOW()
    )
  `)

  await pg.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id                SERIAL PRIMARY KEY,
      name              TEXT NOT NULL UNIQUE,
      location          TEXT,
      updated_by        TEXT,
      last_updated_date TEXT,
      status            TEXT NOT NULL DEFAULT 'active'
                          CHECK (status IN ('active', 'completed'))
    )
  `)

  await pg.exec(`
    CREATE TABLE IF NOT EXISTS items (
      id            SERIAL PRIMARY KEY,
      category      TEXT NOT NULL,
      name          TEXT NOT NULL,
      initial_stock INTEGER NOT NULL DEFAULT 0,
      UNIQUE (category, name)
    )
  `)

  await pg.exec(`
    CREATE TABLE IF NOT EXISTS item_units (
      id                  SERIAL PRIMARY KEY,
      item_id             INTEGER NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
      serial_id           TEXT,
      assigned_project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
      audit_date          TEXT,
      remarks             TEXT,
      status              TEXT NOT NULL DEFAULT 'Available'
                            CHECK (status IN ('In Use', 'Available', 'Retired-Damaged')),
      photo_evidence_ref  TEXT
    )
  `)

  await pg.exec(`
    CREATE TABLE IF NOT EXISTS transfers (
      id              SERIAL PRIMARY KEY,
      date            TEXT NOT NULL,
      item_id         INTEGER NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
      serial_id       TEXT,
      qty             INTEGER NOT NULL DEFAULT 1,
      from_project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
      to_project_id   INTEGER REFERENCES projects(id) ON DELETE SET NULL,
      transferred_by  TEXT,
      authorized_by   TEXT,
      notes           TEXT,
      status          TEXT NOT NULL DEFAULT 'Recorded'
    )
  `)

  await pg.exec(`
    CREATE TABLE IF NOT EXISTS handovers (
      id             SERIAL PRIMARY KEY,
      project_id     INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      handover_date  TEXT NOT NULL,
      handed_over_by TEXT,
      received_by    TEXT,
      notes          TEXT,
      signature_ref  TEXT
    )
  `)

  await pg.exec(`CREATE INDEX IF NOT EXISTS idx_item_units_item_id ON item_units(item_id)`)
  await pg.exec(`CREATE INDEX IF NOT EXISTS idx_item_units_project_id ON item_units(assigned_project_id)`)
  await pg.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_item_units_serial_id ON item_units(serial_id) WHERE serial_id IS NOT NULL`)
  await pg.exec(`CREATE INDEX IF NOT EXISTS idx_transfers_item_id ON transfers(item_id)`)
  await pg.exec(`CREATE INDEX IF NOT EXISTS idx_transfers_from_project ON transfers(from_project_id)`)
  await pg.exec(`CREATE INDEX IF NOT EXISTS idx_transfers_to_project ON transfers(to_project_id)`)
  await pg.exec(`CREATE INDEX IF NOT EXISTS idx_handovers_project_id ON handovers(project_id)`)

  const applied = new Set(
    (await pg.query('SELECT version FROM schema_migrations'))
      .rows
      .map((row) => row.version as number)
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
