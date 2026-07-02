import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import {
  AppUser,
  BackupInfo,
  CreateUserInput,
  DashboardRollup,
  ExportProjectResult,
  Handover,
  HandoverInput,
  ImportSummary,
  IPC_CHANNELS,
  Item,
  ItemInput,
  ItemUnitFilter,
  ItemUnitInput,
  ItemUnitWithDetails,
  MoveUnitsInput,
  MoveUnitsResult,
  PhotoImportResult,
  PhotoLogEntry,
  PhotoLogEntryInput,
  Project,
  ProjectInput,
  ProjectStatus,
  Transfer
} from '../shared/ipc'

// Extended by later milestones with typed IPC calls (item/project CRUD, Excel
// export/import) — keeps the renderer free of direct Node/Electron access.
const api = {
  auth: {
    verifySession: (token: string): Promise<boolean> =>
      ipcRenderer.invoke(IPC_CHANNELS.authVerifySession, token)
  },
  users: {
    list: (token: string): Promise<AppUser[]> => ipcRenderer.invoke(IPC_CHANNELS.usersList, token),
    create: (token: string, input: CreateUserInput): Promise<AppUser> =>
      ipcRenderer.invoke(IPC_CHANNELS.usersCreate, token, input),
    delete: (token: string, id: string): Promise<void> =>
      ipcRenderer.invoke(IPC_CHANNELS.usersDelete, token, id),
    setPassword: (token: string, id: string, password: string): Promise<AppUser> =>
      ipcRenderer.invoke(IPC_CHANNELS.usersSetPassword, token, id, password),
    setDisabled: (token: string, id: string, disabled: boolean): Promise<AppUser> =>
      ipcRenderer.invoke(IPC_CHANNELS.usersSetDisabled, token, id, disabled)
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
    delete: (id: number): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.itemUnitsDelete, id),
    // Atomic batch move (assign / transfer-out / return-to-pool) — updates each
    // unit's assignment + status and writes transfer-log rows in one transaction.
    move: (input: MoveUnitsInput): Promise<MoveUnitsResult> =>
      ipcRenderer.invoke(IPC_CHANNELS.itemUnitsMove, input)
  },
  dashboard: {
    rollup: (): Promise<DashboardRollup> => ipcRenderer.invoke(IPC_CHANNELS.dashboardRollup)
  },
  excel: {
    exportProject: (projectId: number, blank?: boolean): Promise<ExportProjectResult> =>
      ipcRenderer.invoke(IPC_CHANNELS.excelExportProject, projectId, blank),
    importProject: (
      filePath: string,
      expectedProjectId?: number,
      reconcileOnly?: boolean
    ): Promise<ImportSummary | null> =>
      ipcRenderer.invoke(IPC_CHANNELS.excelImportProject, filePath, expectedProjectId, reconcileOnly),
    exportHandover: (handoverId: number): Promise<ExportProjectResult> =>
      ipcRenderer.invoke(IPC_CHANNELS.excelExportHandover, handoverId)
  },
  dialog: {
    openFile: (): Promise<string | null> => ipcRenderer.invoke(IPC_CHANNELS.dialogOpenFile)
  },
  transfers: {
    list: (): Promise<Transfer[]> => ipcRenderer.invoke(IPC_CHANNELS.transfersList),
    byProject: (projectId: number): Promise<Transfer[]> =>
      ipcRenderer.invoke(IPC_CHANNELS.transfersByProject, projectId)
  },
  handovers: {
    list: (): Promise<Handover[]> => ipcRenderer.invoke(IPC_CHANNELS.handoversList),
    byProject: (projectId: number): Promise<Handover[]> =>
      ipcRenderer.invoke(IPC_CHANNELS.handoversByProject, projectId),
    create: (input: HandoverInput): Promise<Handover> =>
      ipcRenderer.invoke(IPC_CHANNELS.handoversCreate, input)
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
  },
  photoLog: {
    list: (): Promise<PhotoLogEntry[]> => ipcRenderer.invoke(IPC_CHANNELS.photoLogList),
    create: (input: PhotoLogEntryInput): Promise<PhotoLogEntry> =>
      ipcRenderer.invoke(IPC_CHANNELS.photoLogCreate, input),
    delete: (id: number): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.photoLogDelete, id),
    setProject: (id: number, projectId: number | null): Promise<PhotoLogEntry> =>
      ipcRenderer.invoke(IPC_CHANNELS.photoLogSetProject, id, projectId)
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
