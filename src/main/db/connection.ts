import { app } from 'electron'
import Database from 'better-sqlite3-multiple-ciphers'
import { join } from 'path'
import { getOrCreateEncryptionKey } from '../security/encryptionKey'
import { migrations } from './migrations'

const DB_FILE_NAME = 'inventory.sqlite'

export function dbPath(): string {
  return join(app.getPath('userData'), DB_FILE_NAME)
}

let db: Database.Database | null = null

// Opens (or returns the cached handle to) the encrypted database, applying
// any migrations that haven't run yet. Call this lazily — not at import time —
// so it only touches disk/safeStorage once Electron is ready.
export function getDb(): Database.Database {
  if (db) return db

  const instance = new Database(dbPath())

  // SQLCipher requires the key to be set as the very first operation on a
  // fresh connection, before any table access — including the migration
  // check below. The x'...' form tells SQLCipher to use these 64 hex chars
  // as the raw 256-bit key directly, skipping PBKDF2 passphrase derivation
  // (appropriate since getOrCreateEncryptionKey already returns a
  // high-entropy random key rather than a user-chosen password).
  instance.pragma(`key="x'${getOrCreateEncryptionKey()}'"`)

  instance.pragma('journal_mode = WAL')
  instance.pragma('foreign_keys = ON')

  runMigrations(instance)

  db = instance
  return db
}

function runMigrations(instance: Database.Database): void {
  instance.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    INTEGER PRIMARY KEY,
      name       TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `)

  const applied = new Set(
    instance
      .prepare('SELECT version FROM schema_migrations')
      .all()
      .map((row) => (row as { version: number }).version)
  )

  const pending = migrations
    .filter((migration) => !applied.has(migration.version))
    .sort((a, b) => a.version - b.version)

  for (const migration of pending) {
    const applyMigration = instance.transaction(() => {
      migration.up(instance)
      instance
        .prepare('INSERT INTO schema_migrations (version, name) VALUES (?, ?)')
        .run(migration.version, migration.name)
    })
    applyMigration()
  }
}

// Closes the connection so the file can be safely copied/replaced (used by
// restoreDatabase) or on app shutdown. Safe to call even if never opened.
export function closeDb(): void {
  db?.close()
  db = null
}
