import { ElectronAPI } from '@electron-toolkit/preload'
import type {
  BackupInfo,
  DashboardRollup,
  ExportProjectResult,
  ImportSummary,
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

interface Api {
  auth: {
    verifySession: (token: string) => Promise<boolean>
  }
  db: {
    backupNow: () => Promise<BackupInfo | null>
    listBackups: () => Promise<BackupInfo[]>
    restoreBackup: (backupPath: string) => Promise<void>
  }
  projects: {
    list: () => Promise<Project[]>
    create: (input: ProjectInput) => Promise<Project>
    update: (id: number, input: ProjectInput) => Promise<Project>
    setStatus: (id: number, status: ProjectStatus) => Promise<Project>
  }
  items: {
    list: () => Promise<Item[]>
    create: (input: ItemInput) => Promise<Item>
    update: (id: number, input: ItemInput) => Promise<Item>
    delete: (id: number) => Promise<void>
  }
  itemUnits: {
    list: (filter?: ItemUnitFilter) => Promise<ItemUnitWithDetails[]>
    create: (input: ItemUnitInput) => Promise<ItemUnitWithDetails>
    update: (id: number, input: ItemUnitInput) => Promise<ItemUnitWithDetails>
    delete: (id: number) => Promise<void>
  }
  dashboard: {
    rollup: () => Promise<DashboardRollup>
  }
  excel: {
    exportProject: (projectId: number) => Promise<ExportProjectResult>
    importProject: (filePath: string) => Promise<ImportSummary | null>
  }
  transfers: {
    list: () => Promise<Transfer[]>
    byProject: (projectId: number) => Promise<Transfer[]>
  }
  photos: {
    pathForFile: (file: File) => string
    import: (sourcePath: string) => Promise<PhotoImportResult>
    read: (reference: string) => Promise<string | null>
  }
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: Api
  }
}
