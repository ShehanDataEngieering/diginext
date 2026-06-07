import { app } from 'electron'
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'fs'
import { basename, join } from 'path'

const BACKUP_DIR_NAME = 'backups'
const MAX_AUTO_BACKUPS = 30

function backupDir(): string {
  return join(app.getPath('userData'), BACKUP_DIR_NAME)
}

function timestampedName(prefix: string): string {
  // Colons aren't valid in Windows filenames, so swap them (and the dot in
  // milliseconds) for dashes: 2026-06-08T10-15-30-000Z.
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  return `${prefix}-${stamp}.sqlite`
}

export interface BackupInfo {
  name: string
  path: string
  createdAt: string
}

// Copies the (still-encrypted — it's a raw file copy) database into backups/
// with a timestamped name, then prunes down to the most recent
// MAX_AUTO_BACKUPS. Cheap insurance against accidental corruption or deletion
// that runs automatically; no user action required.
//
// `label` distinguishes automatic ("auto") backups, which get pruned, from
// manual ("manual") ones triggered via the future "Backup now" UI action,
// which are kept indefinitely (the user explicitly chose to keep them).
export function backupDatabase(sourcePath: string, label: 'auto' | 'manual' = 'auto'): BackupInfo | null {
  if (!existsSync(sourcePath)) return null // nothing to back up yet (first run)

  const dir = backupDir()
  mkdirSync(dir, { recursive: true })

  const name = timestampedName(label === 'auto' ? 'auto' : 'manual')
  const destination = join(dir, name)
  copyFileSync(sourcePath, destination)

  if (label === 'auto') {
    pruneOldBackups(dir, 'auto-')
  }

  return { name, path: destination, createdAt: new Date().toISOString() }
}

function pruneOldBackups(dir: string, prefix: string): void {
  const candidates = readdirSync(dir)
    .filter((name) => name.startsWith(prefix) && name.endsWith('.sqlite'))
    .map((name) => {
      const path = join(dir, name)
      return { name, path, mtimeMs: statSync(path).mtimeMs }
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs)

  for (const stale of candidates.slice(MAX_AUTO_BACKUPS)) {
    unlinkSync(stale.path)
  }
}

export function listBackups(): BackupInfo[] {
  const dir = backupDir()
  if (!existsSync(dir)) return []

  return readdirSync(dir)
    .filter((name) => name.endsWith('.sqlite'))
    .map((name) => {
      const path = join(dir, name)
      const { mtimeMs } = statSync(path)
      return { name, path, createdAt: new Date(mtimeMs).toISOString() }
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

// Overwrites the live database file with a backup's contents. The caller MUST
// close the active DB connection first (closeDb()) — SQLite/SQLCipher hold an
// open file handle, and overwriting it from under that handle would corrupt
// the database — and reopen (or prompt an app restart) afterwards.
export function restoreDatabase(backupPath: string, destinationPath: string): void {
  if (!existsSync(backupPath)) {
    throw new Error(`Backup file not found: ${basename(backupPath)}`)
  }
  copyFileSync(backupPath, destinationPath)
}
