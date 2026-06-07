import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import { BackupInfo, IPC_CHANNELS } from '../shared/ipc'

// Extended by later milestones with typed IPC calls (item/project CRUD, Excel
// export/import) — keeps the renderer free of direct Node/Electron access.
const api = {
  auth: {
    // Sends the Clerk session JWT to the main process for verification.
    // Returns true only if the main process independently confirms the
    // session is valid — the renderer's own Clerk state is not trusted.
    verifySession: (token: string): Promise<boolean> =>
      ipcRenderer.invoke(IPC_CHANNELS.authVerifySession, token)
  },
  db: {
    // Triggers an on-demand backup (kept indefinitely, unlike the pruned
    // automatic ones taken at launch) — backs the future "Backup now" button.
    backupNow: (): Promise<BackupInfo | null> => ipcRenderer.invoke(IPC_CHANNELS.dbBackupNow),
    listBackups: (): Promise<BackupInfo[]> => ipcRenderer.invoke(IPC_CHANNELS.dbListBackups),
    // Overwrites the live database with the chosen backup's contents — the
    // future "Restore from backup" UI should confirm with the user first,
    // since this discards any changes made since that backup was taken.
    restoreBackup: (backupPath: string): Promise<void> =>
      ipcRenderer.invoke(IPC_CHANNELS.dbRestoreBackup, backupPath)
  }
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
