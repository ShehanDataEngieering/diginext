import type { DatabaseAdapter } from './adapter'

// The full Postgres schema, extracted from connection.ts so it can be applied
// without pulling in Electron (`app`) — used both at app startup and by the
// integration tests, which run the repositories against a disposable database.
// Every statement is idempotent (CREATE/ALTER ... IF NOT EXISTS).
export async function applySchema(db: DatabaseAdapter): Promise<void> {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    INTEGER PRIMARY KEY,
      name       TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT NOW()
    )
  `)

  await db.exec(`
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

  await db.exec(`
    CREATE TABLE IF NOT EXISTS items (
      id            SERIAL PRIMARY KEY,
      category      TEXT NOT NULL,
      name          TEXT NOT NULL,
      initial_stock INTEGER NOT NULL DEFAULT 0,
      UNIQUE (category, name)
    )
  `)

  await db.exec(`
    CREATE TABLE IF NOT EXISTS item_units (
      id                  SERIAL PRIMARY KEY,
      item_id             INTEGER NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
      serial_id           TEXT,
      assigned_project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
      audit_date          TEXT,
      remarks             TEXT,
      status              TEXT NOT NULL DEFAULT 'Available'
                            CHECK (status IN ('In Use', 'Available', 'Retired-Damaged')),
      photo_evidence_ref  TEXT,
      retired_from_project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL
    )
  `)

  // Records which project a unit was deployed to when it was retired/damaged,
  // so the loss stays traceable to a site even though the unit is unassigned
  // once written off. Added separately for databases created before the column
  // existed (CREATE TABLE above is a no-op for them).
  await db.exec(`
    ALTER TABLE item_units
    ADD COLUMN IF NOT EXISTS retired_from_project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL
  `)

  // A unit's photo gallery. `item_units.photo_evidence_ref` stays as the "cover"
  // (first photo) so existing consumers — Excel export, handover sheet, the
  // dashboard/table thumbnails — keep working unchanged; this table holds the
  // full set, cover included, ordered by sort_order.
  await db.exec(`
    CREATE TABLE IF NOT EXISTS item_unit_photos (
      id           SERIAL PRIMARY KEY,
      item_unit_id INTEGER NOT NULL REFERENCES item_units(id) ON DELETE CASCADE,
      photo_ref    TEXT NOT NULL,
      sort_order   INTEGER NOT NULL DEFAULT 0,
      created_at   TEXT NOT NULL DEFAULT NOW()
    )
  `)
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_item_unit_photos_unit ON item_unit_photos(item_unit_id)`)

  // One-time backfill: seed the gallery from the pre-existing single cover photo
  // for any unit that has a cover but no gallery rows yet. Idempotent — the NOT
  // EXISTS guard makes re-runs a no-op.
  await db.exec(`
    INSERT INTO item_unit_photos (item_unit_id, photo_ref, sort_order)
    SELECT u.id, u.photo_evidence_ref, 0
    FROM item_units u
    WHERE u.photo_evidence_ref IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM item_unit_photos p WHERE p.item_unit_id = u.id)
  `)

  await db.exec(`
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

  await db.exec(`
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

  await db.exec(`
    CREATE TABLE IF NOT EXISTS handover_items (
      id                  SERIAL PRIMARY KEY,
      handover_id         INTEGER NOT NULL REFERENCES handovers(id) ON DELETE CASCADE,
      item_unit_id        INTEGER NOT NULL REFERENCES item_units(id) ON DELETE RESTRICT,
      condition           TEXT,
      action              TEXT,
      transfer_project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL
    )
  `)

  // handover_items predates this column on databases created before it was
  // added — CREATE TABLE IF NOT EXISTS above is a no-op for those, so add it
  // here too.
  await db.exec(`
    ALTER TABLE handover_items
    ADD COLUMN IF NOT EXISTS transfer_project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL
  `)

  await db.exec(`
    CREATE TABLE IF NOT EXISTS photo_log (
      id                 SERIAL PRIMARY KEY,
      label              TEXT NOT NULL,
      photo_evidence_ref TEXT NOT NULL,
      project_id         INTEGER REFERENCES projects(id) ON DELETE SET NULL,
      created_at         TEXT NOT NULL DEFAULT NOW()
    )
  `)

  // photo_log predates this column on databases created before it was added.
  await db.exec(`
    ALTER TABLE photo_log
    ADD COLUMN IF NOT EXISTS project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL
  `)
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_photo_log_project_id ON photo_log(project_id)`)

  await db.exec(`CREATE INDEX IF NOT EXISTS idx_item_units_item_id ON item_units(item_id)`)
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_item_units_project_id ON item_units(assigned_project_id)`)
  await db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_item_units_serial_id ON item_units(serial_id) WHERE serial_id IS NOT NULL`)
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_transfers_item_id ON transfers(item_id)`)
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_transfers_from_project ON transfers(from_project_id)`)
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_transfers_to_project ON transfers(to_project_id)`)
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_handovers_project_id ON handovers(project_id)`)
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_handover_items_handover_id ON handover_items(handover_id)`)
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_handover_items_item_unit_id ON handover_items(item_unit_id)`)
}
