// Single source of truth for IPC channel names, imported by both the main
// process (registers handlers) and the preload (invokes them) so the two
// sides can't drift out of sync.
export const IPC_CHANNELS = {
  authVerifySession: 'auth:verify-session',
  dbBackupNow: 'db:backup-now',
  dbListBackups: 'db:list-backups',
  dbRestoreBackup: 'db:restore-backup'
} as const

// Shared shape for backup metadata sent across the IPC boundary — kept here
// (rather than importing from src/main/db/backup.ts) so the renderer doesn't
// need to depend on main-process-only modules just for a type.
export interface BackupInfo {
  name: string
  path: string
  createdAt: string
}
