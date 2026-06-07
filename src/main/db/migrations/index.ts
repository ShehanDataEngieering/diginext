import type Database from 'better-sqlite3-multiple-ciphers'

export interface Migration {
  version: number
  name: string
  up: (db: Database.Database) => void
}

// Each migration runs exactly once (tracked in schema_migrations — see
// runMigrations in ../connection.ts), in ascending version order, inside its
// own transaction. Add new migrations by appending to this array; never edit
// or remove an already-released one — write a follow-up migration instead,
// or existing users' databases will fall out of sync with the code.
export const migrations: Migration[] = [
  {
    version: 1,
    name: 'initial schema',
    up: (db) => {
      db.exec(`
        -- Project sites/regions (e.g. "At North Copenhagen", "GVX 03 - Gävle").
        CREATE TABLE projects (
          id                INTEGER PRIMARY KEY AUTOINCREMENT,
          name              TEXT NOT NULL UNIQUE,
          location          TEXT,
          updated_by        TEXT,
          last_updated_date TEXT,
          status            TEXT NOT NULL DEFAULT 'active'
                              CHECK (status IN ('active', 'completed'))
        );

        -- Catalog of item *types* (mirrors the "Main Inventory" sheet) —
        -- per-unit tracking lives in item_units below.
        CREATE TABLE items (
          id            INTEGER PRIMARY KEY AUTOINCREMENT,
          category      TEXT NOT NULL,
          name          TEXT NOT NULL,
          initial_stock INTEGER NOT NULL DEFAULT 0,
          UNIQUE (category, name)
        );

        -- Individual physical units. serial_id is nullable because some item
        -- types (e.g. "Cable Tester") are tracked only by quantity, not by
        -- serial — those get anonymous rows here, one per unit on hand.
        -- assigned_project_id NULL means "Available" / unassigned.
        CREATE TABLE item_units (
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
        CREATE INDEX idx_item_units_item_id ON item_units(item_id);
        CREATE INDEX idx_item_units_project_id ON item_units(assigned_project_id);
        -- Serial IDs must be unique when present, but many rows have none —
        -- a partial index lets multiple NULLs coexist.
        CREATE UNIQUE INDEX idx_item_units_serial_id ON item_units(serial_id)
          WHERE serial_id IS NOT NULL;

        -- Movement history between projects — populated both by manual entry
        -- and automatically during Excel re-import reconciliation.
        CREATE TABLE transfers (
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
        CREATE INDEX idx_transfers_item_id ON transfers(item_id);
        CREATE INDEX idx_transfers_from_project ON transfers(from_project_id);
        CREATE INDEX idx_transfers_to_project ON transfers(to_project_id);

        -- Hand-over records, typically created when a project is archived.
        CREATE TABLE handovers (
          id             INTEGER PRIMARY KEY AUTOINCREMENT,
          project_id     INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          handover_date  TEXT NOT NULL,
          handed_over_by TEXT,
          received_by    TEXT,
          notes          TEXT,
          signature_ref  TEXT
        );
        CREATE INDEX idx_handovers_project_id ON handovers(project_id);
      `)
    }
  }
]
