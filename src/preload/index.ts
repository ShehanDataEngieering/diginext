import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import {
  BackupInfo,
  DashboardRollup,
  IPC_CHANNELS,
  Item,
  ItemInput,
  ItemUnitFilter,
  ItemUnitInput,
  ItemUnitWithDetails,
  Project,
  ProjectInput,
  ProjectStatus
} from '../shared/ipc'

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
  },
  projects: {
    list: (): Promise<Project[]> => ipcRenderer.invoke(IPC_CHANNELS.projectsList),
    create: (input: ProjectInput): Promise<Project> =>
      ipcRenderer.invoke(IPC_CHANNELS.projectsCreate, input),
    update: (id: number, input: ProjectInput): Promise<Project> =>
      ipcRenderer.invoke(IPC_CHANNELS.projectsUpdate, id, input),
    // No delete — see projects repository: archiving (status -> 'completed')
    // is the only supported lifecycle transition besides editing.
    setStatus: (id: number, status: ProjectStatus): Promise<Project> =>
      ipcRenderer.invoke(IPC_CHANNELS.projectsSetStatus, id, status)
  },
  items: {
    list: (): Promise<Item[]> => ipcRenderer.invoke(IPC_CHANNELS.itemsList),
    create: (input: ItemInput): Promise<Item> => ipcRenderer.invoke(IPC_CHANNELS.itemsCreate, input),
    update: (id: number, input: ItemInput): Promise<Item> =>
      ipcRenderer.invoke(IPC_CHANNELS.itemsUpdate, id, input),
    delete: (id: number): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.itemsDelete, id)
  },
  itemUnits: {
    list: (filter?: ItemUnitFilter): Promise<ItemUnitWithDetails[]> =>
      ipcRenderer.invoke(IPC_CHANNELS.itemUnitsList, filter),
    create: (input: ItemUnitInput): Promise<ItemUnitWithDetails> =>
      ipcRenderer.invoke(IPC_CHANNELS.itemUnitsCreate, input),
    update: (id: number, input: ItemUnitInput): Promise<ItemUnitWithDetails> =>
      ipcRenderer.invoke(IPC_CHANNELS.itemUnitsUpdate, id, input),
    delete: (id: number): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.itemUnitsDelete, id)
  },
  dashboard: {
    rollup: (): Promise<DashboardRollup> => ipcRenderer.invoke(IPC_CHANNELS.dashboardRollup)
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
