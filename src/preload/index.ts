import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import {
  BackupInfo,
  DashboardRollup,
  ExportProjectResult,
  ImportSummary,
  IPC_CHANNELS,
  Item,
  ItemInput,
  ItemUnitFilter,
  ItemUnitInput,
  ItemUnitWithDetails,
  PhotoImportResult,
  Project,
  ProjectInput,
  ProjectStatus,
  Transfer
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
  },
  excel: {
    exportProject: (projectId: number): Promise<ExportProjectResult> =>
      ipcRenderer.invoke(IPC_CHANNELS.excelExportProject, projectId),
    importProject: (filePath: string): Promise<ImportSummary | null> =>
      ipcRenderer.invoke(IPC_CHANNELS.excelImportProject, filePath)
  },
  transfers: {
    list: (): Promise<Transfer[]> => ipcRenderer.invoke(IPC_CHANNELS.transfersList),
    byProject: (projectId: number): Promise<Transfer[]> =>
      ipcRenderer.invoke(IPC_CHANNELS.transfersByProject, projectId)
  },
  photos: {
    // Resolves a dropped `File` to its absolute filesystem path. Post-Electron
    // 13, `File.path` was removed for security — `webUtils.getPathForFile` is
    // the sanctioned replacement, and (like the rest of this object) only
    // callable from the isolated preload/main-world bridge, not the renderer
    // directly. This is the *only* file-attachment route in the app — file
    // pickers go through the same native dialog machinery that froze the
    // Excel export under WSLg, so uploads are drag-and-drop only.
    pathForFile: (file: File): string => webUtils.getPathForFile(file),
    // Copies the dropped file into the app's managed photo store and returns
    // the reference to save on the unit (`photo_evidence_ref`).
    import: (sourcePath: string): Promise<PhotoImportResult> =>
      ipcRenderer.invoke(IPC_CHANNELS.photosImport, sourcePath),
    // Reads a managed photo back as a `data:` URL for inline <img> display —
    // resolves to null for refs that aren't photos we manage (including the
    // old free-text values some seeded units carry).
    read: (reference: string): Promise<string | null> =>
      ipcRenderer.invoke(IPC_CHANNELS.photosRead, reference)
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
