import Database from 'better-sqlite3-multiple-ciphers'
import { Pool } from 'pg'
import { config } from 'dotenv'
import { readFileSync, existsSync } from 'fs'

config()

const POSTGRES_CONNECTION_STRING = process.env.POSTGRES_CONNECTION_STRING || ''
const SQLITE_DB_PATH = process.env.SQLITE_DB_PATH || ''
const SQLITE_KEY_PATH = process.env.SQLITE_KEY_PATH || ''

async function main(): Promise<void> {
  if (!POSTGRES_CONNECTION_STRING) {
    console.error('POSTGRES_CONNECTION_STRING environment variable is required')
    process.exit(1)
  }
  if (!SQLITE_DB_PATH) {
    console.error('SQLITE_DB_PATH environment variable is required (path to your .sqlite file)')
    process.exit(1)
  }

  const pool = new Pool({
    connectionString: POSTGRES_CONNECTION_STRING,
    max: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000
  })

  console.log('Connecting to PostgreSQL...')
  const pgClient = await pool.connect()
  console.log('Connected to PostgreSQL successfully')

  console.log('Connecting to SQLite database...')
  const sqlite = new Database(SQLITE_DB_PATH)
  
  if (SQLITE_KEY_PATH && existsSync(SQLITE_KEY_PATH)) {
    const key = readFileSync(SQLITE_KEY_PATH, 'utf8').trim()
    sqlite.pragma(`key="x'${key}'"`)
    console.log('Applied encryption key')
  }
  
  console.log('Connected to SQLite database')

  try {
    console.log('Creating schema in PostgreSQL...')

    await pgClient.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version    INTEGER PRIMARY KEY,
        name       TEXT NOT NULL,
        applied_at TEXT NOT NULL DEFAULT NOW()
      )
    `)

    await pgClient.query(`
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

    await pgClient.query(`
      CREATE TABLE IF NOT EXISTS items (
        id            SERIAL PRIMARY KEY,
        category      TEXT NOT NULL,
        name          TEXT NOT NULL,
        initial_stock INTEGER NOT NULL DEFAULT 0,
        UNIQUE (category, name)
      )
    `)

    await pgClient.query(`
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

    await pgClient.query(`
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

    await pgClient.query(`
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

    await pgClient.query(`CREATE INDEX IF NOT EXISTS idx_item_units_item_id ON item_units(item_id)`)
    await pgClient.query(`CREATE INDEX IF NOT EXISTS idx_item_units_project_id ON item_units(assigned_project_id)`)
    await pgClient.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_item_units_serial_id ON item_units(serial_id) WHERE serial_id IS NOT NULL`)
    await pgClient.query(`CREATE INDEX IF NOT EXISTS idx_transfers_item_id ON transfers(item_id)`)
    await pgClient.query(`CREATE INDEX IF NOT EXISTS idx_transfers_from_project ON transfers(from_project_id)`)
    await pgClient.query(`CREATE INDEX IF NOT EXISTS idx_transfers_to_project ON transfers(to_project_id)`)
    await pgClient.query(`CREATE INDEX IF NOT EXISTS idx_handovers_project_id ON handovers(project_id)`)

    console.log('Schema created successfully')
    console.log('Starting data migration...')

    console.log('Migrating projects...')
    const projects = sqlite.prepare('SELECT * FROM projects').all() as Record<string, unknown>[]
    for (const p of projects) {
      await pgClient.query(
        'INSERT INTO projects (id, name, location, updated_by, last_updated_date, status) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING',
        [p.id, p.name, p.location, p.updated_by, p.last_updated_date, p.status]
      )
    }
    console.log(`  ${projects.length} projects migrated`)

    console.log('Migrating items...')
    const items = sqlite.prepare('SELECT * FROM items').all() as Record<string, unknown>[]
    for (const i of items) {
      await pgClient.query(
        'INSERT INTO items (id, category, name, initial_stock) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING',
        [i.id, i.category, i.name, i.initial_stock]
      )
    }
    console.log(`  ${items.length} items migrated`)

    console.log('Migrating item units...')
    const units = sqlite.prepare('SELECT * FROM item_units').all() as Record<string, unknown>[]
    for (const u of units) {
      await pgClient.query(
        'INSERT INTO item_units (id, item_id, serial_id, assigned_project_id, audit_date, remarks, status, photo_evidence_ref) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT DO NOTHING',
        [u.id, u.item_id, u.serial_id, u.assigned_project_id, u.audit_date, u.remarks, u.status, u.photo_evidence_ref]
      )
    }
    console.log(`  ${units.length} item units migrated`)

    console.log('Migrating transfers...')
    const transfers = sqlite.prepare('SELECT * FROM transfers').all() as Record<string, unknown>[]
    for (const t of transfers) {
      await pgClient.query(
        'INSERT INTO transfers (id, date, item_id, serial_id, qty, from_project_id, to_project_id, transferred_by, authorized_by, notes, status) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) ON CONFLICT DO NOTHING',
        [t.id, t.date, t.item_id, t.serial_id, t.qty, t.from_project_id, t.to_project_id, t.transferred_by, t.authorized_by, t.notes, t.status]
      )
    }
    console.log(`  ${transfers.length} transfers migrated`)

    console.log('Migrating handovers...')
    const handovers = sqlite.prepare('SELECT * FROM handovers').all() as Record<string, unknown>[]
    for (const h of handovers) {
      await pgClient.query(
        'INSERT INTO handovers (id, project_id, handover_date, handed_over_by, received_by, notes, signature_ref) VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT DO NOTHING',
        [h.id, h.project_id, h.handover_date, h.handed_over_by, h.received_by, h.notes, h.signature_ref]
      )
    }
    console.log(`  ${handovers.length} handovers migrated`)

    console.log('Resetting PostgreSQL sequences...')
    const maxProjectId = sqlite.prepare('SELECT MAX(id) as max FROM projects').get() as { max: number | null }
    const maxItemId = sqlite.prepare('SELECT MAX(id) as max FROM items').get() as { max: number | null }
    const maxUnitId = sqlite.prepare('SELECT MAX(id) as max FROM item_units').get() as { max: number | null }
    const maxTransferId = sqlite.prepare('SELECT MAX(id) as max FROM transfers').get() as { max: number | null }
    const maxHandoverId = sqlite.prepare('SELECT MAX(id) as max FROM handovers').get() as { max: number | null }

    if (maxProjectId?.max) await pgClient.query(`SELECT setval('projects_id_seq', ${maxProjectId.max})`)
    if (maxItemId?.max) await pgClient.query(`SELECT setval('items_id_seq', ${maxItemId.max})`)
    if (maxUnitId?.max) await pgClient.query(`SELECT setval('item_units_id_seq', ${maxUnitId.max})`)
    if (maxTransferId?.max) await pgClient.query(`SELECT setval('transfers_id_seq', ${maxTransferId.max})`)
    if (maxHandoverId?.max) await pgClient.query(`SELECT setval('handovers_id_seq', ${maxHandoverId.max})`)

    await pgClient.query(
      "INSERT INTO schema_migrations (version, name) VALUES (1, 'initial schema') ON CONFLICT DO NOTHING"
    )

    console.log('Data migration completed successfully!')
  } catch (error) {
    console.error('Migration failed:', error)
    process.exit(1)
  } finally {
    sqlite.close()
    pgClient.release()
    await pool.end()
  }
}

main()
