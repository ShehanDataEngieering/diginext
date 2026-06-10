import { Pool } from 'pg'
import type { DatabaseAdapter } from './adapter'

interface SqliteLike {
  prepare(sql: string): { all(): Record<string, unknown>[]; get(): unknown }
}

export async function migrateSqliteToPostgres(
  sqliteDb: SqliteLike,
  pgAdapter: DatabaseAdapter
): Promise<void> {
  console.log('[migration] Starting SQLite → PostgreSQL data migration...')

  const projects = sqliteDb.prepare('SELECT * FROM projects').all() as Record<string, unknown>[]
  for (const p of projects) {
    await pgAdapter.query(
      'INSERT INTO projects (id, name, location, updated_by, last_updated_date, status) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING',
      [p.id, p.name, p.location, p.updated_by, p.last_updated_date, p.status]
    )
  }
  console.log(`[migration]   ${projects.length} projects`)

  const items = sqliteDb.prepare('SELECT * FROM items').all() as Record<string, unknown>[]
  for (const i of items) {
    await pgAdapter.query(
      'INSERT INTO items (id, category, name, initial_stock) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING',
      [i.id, i.category, i.name, i.initial_stock]
    )
  }
  console.log(`[migration]   ${items.length} items`)

  const units = sqliteDb.prepare('SELECT * FROM item_units').all() as Record<string, unknown>[]
  for (const u of units) {
    await pgAdapter.query(
      'INSERT INTO item_units (id, item_id, serial_id, assigned_project_id, audit_date, remarks, status, photo_evidence_ref) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING',
      [u.id, u.item_id, u.serial_id, u.assigned_project_id, u.audit_date, u.remarks, u.status, u.photo_evidence_ref]
    )
  }
  console.log(`[migration]   ${units.length} item units`)

  const transfers = sqliteDb.prepare('SELECT * FROM transfers').all() as Record<string, unknown>[]
  for (const t of transfers) {
    await pgAdapter.query(
      'INSERT INTO transfers (id, date, item_id, serial_id, qty, from_project_id, to_project_id, transferred_by, authorized_by, notes, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING',
      [t.id, t.date, t.item_id, t.serial_id, t.qty, t.from_project_id, t.to_project_id, t.transferred_by, t.authorized_by, t.notes, t.status]
    )
  }
  console.log(`[migration]   ${transfers.length} transfers`)

  const handovers = sqliteDb.prepare('SELECT * FROM handovers').all() as Record<string, unknown>[]
  for (const h of handovers) {
    await pgAdapter.query(
      'INSERT INTO handovers (id, project_id, handover_date, handed_over_by, received_by, notes, signature_ref) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING',
      [h.id, h.project_id, h.handover_date, h.handed_over_by, h.received_by, h.notes, h.signature_ref]
    )
  }
  console.log(`[migration]   ${handovers.length} handovers`)

  const maxProjectId = sqliteDb.prepare('SELECT MAX(id) as max FROM projects').get() as { max: number | null } | undefined
  const maxItemId = sqliteDb.prepare('SELECT MAX(id) as max FROM items').get() as { max: number | null } | undefined
  const maxUnitId = sqliteDb.prepare('SELECT MAX(id) as max FROM item_units').get() as { max: number | null } | undefined
  const maxTransferId = sqliteDb.prepare('SELECT MAX(id) as max FROM transfers').get() as { max: number | null } | undefined
  const maxHandoverId = sqliteDb.prepare('SELECT MAX(id) as max FROM handovers').get() as { max: number | null } | undefined

  if (maxProjectId?.max) await pgAdapter.exec(`SELECT setval('projects_id_seq', ${maxProjectId.max})`)
  if (maxItemId?.max) await pgAdapter.exec(`SELECT setval('items_id_seq', ${maxItemId.max})`)
  if (maxUnitId?.max) await pgAdapter.exec(`SELECT setval('item_units_id_seq', ${maxUnitId.max})`)
  if (maxTransferId?.max) await pgAdapter.exec(`SELECT setval('transfers_id_seq', ${maxTransferId.max})`)
  if (maxHandoverId?.max) await pgAdapter.exec(`SELECT setval('handovers_id_seq', ${maxHandoverId.max})`)

  console.log('[migration] Data migration completed successfully!')
}
