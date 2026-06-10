import type { DatabaseAdapter } from '../adapter'

export interface Migration {
  version: number
  name: string
  up: (db: DatabaseAdapter) => Promise<void>
}

export const migrations: Migration[] = [
  {
    version: 1,
    name: 'initial schema',
    up: async (db) => {
      await db.exec(`
        CREATE TABLE IF NOT EXISTS projects (
          id                INTEGER PRIMARY KEY AUTOINCREMENT,
          name              TEXT NOT NULL UNIQUE,
          location          TEXT,
          updated_by        TEXT,
          last_updated_date TEXT,
          status            TEXT NOT NULL DEFAULT 'active'
                              CHECK (status IN ('active', 'completed'))
        );

        CREATE TABLE IF NOT EXISTS items (
          id            INTEGER PRIMARY KEY AUTOINCREMENT,
          category      TEXT NOT NULL,
          name          TEXT NOT NULL,
          initial_stock INTEGER NOT NULL DEFAULT 0,
          UNIQUE (category, name)
        );

        CREATE TABLE IF NOT EXISTS item_units (
          id                  INTEGER PRIMARY KEY AUTOINCREMENT,
          item_id             INTEGER NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
          serial_id           TEXT,
          assigned_project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
          audit_date          TEXT,
          remarks             TEXT,
          status              TEXT NOT NULL DEFAULT 'Available'
                                CHECK (status IN ('In Use', 'Available', 'Retired-Damaged')),
          photo_evidence_ref  TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_item_units_item_id ON item_units(item_id);
        CREATE INDEX IF NOT EXISTS idx_item_units_project_id ON item_units(assigned_project_id);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_item_units_serial_id ON item_units(serial_id)
          WHERE serial_id IS NOT NULL;

        CREATE TABLE IF NOT EXISTS transfers (
          id              INTEGER PRIMARY KEY AUTOINCREMENT,
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
        );
        CREATE INDEX IF NOT EXISTS idx_transfers_item_id ON transfers(item_id);
        CREATE INDEX IF NOT EXISTS idx_transfers_from_project ON transfers(from_project_id);
        CREATE INDEX IF NOT EXISTS idx_transfers_to_project ON transfers(to_project_id);

        CREATE TABLE IF NOT EXISTS handovers (
          id             INTEGER PRIMARY KEY AUTOINCREMENT,
          project_id     INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          handover_date  TEXT NOT NULL,
          handed_over_by TEXT,
          received_by    TEXT,
          notes          TEXT,
          signature_ref  TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_handovers_project_id ON handovers(project_id);
      `)
    }
  }
]
