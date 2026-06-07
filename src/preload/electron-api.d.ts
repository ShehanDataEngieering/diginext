import { ElectronAPI } from '@electron-toolkit/preload'
import type { BackupInfo } from '../shared/ipc'

interface Api {
  auth: {
    verifySession: (token: string) => Promise<boolean>
  }
  db: {
    backupNow: () => Promise<BackupInfo | null>
    listBackups: () => Promise<BackupInfo[]>
    restoreBackup: (backupPath: string) => Promise<void>
  }
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: Api
  }
}
