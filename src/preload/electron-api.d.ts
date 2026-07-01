import { ElectronAPI } from '@electron-toolkit/preload'
import type {
  AppUser,
  BackupInfo,
  CreateUserInput,
  DashboardRollup,
  ExportProjectResult,
  Handover,
  HandoverInput,
  ImportSummary,
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

interface Api {
  auth: {
    verifySession: (token: string) => Promise<boolean>
  }
  users: {
    list: (token: string) => Promise<AppUser[]>
    create: (token: string, input: CreateUserInput) => Promise<AppUser>
    delete: (token: string, id: string) => Promise<void>
    setPassword: (token: string, id: string, password: string) => Promise<AppUser>
    setDisabled: (token: string, id: string, disabled: boolean) => Promise<AppUser>
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
    move: (input: MoveUnitsInput) => Promise<MoveUnitsResult>
  }
  dashboard: {
    rollup: () => Promise<DashboardRollup>
  }
  excel: {
    exportProject: (projectId: number, blank?: boolean) => Promise<ExportProjectResult>
    importProject: (filePath: string, expectedProjectId?: number) => Promise<ImportSummary | null>
    exportHandover: (handoverId: number) => Promise<ExportProjectResult>
  }
  dialog: {
    openFile: () => Promise<string | null>
  }
  transfers: {
    list: () => Promise<Transfer[]>
    byProject: (projectId: number) => Promise<Transfer[]>
  }
  handovers: {
    list: () => Promise<Handover[]>
    byProject: (projectId: number) => Promise<Handover[]>
    create: (input: HandoverInput) => Promise<Handover>
  }
  photos: {
    pathForFile: (file: File) => string
    import: (sourcePath: string) => Promise<PhotoImportResult>
    read: (reference: string) => Promise<string | null>
  }
  photoLog: {
    list: () => Promise<PhotoLogEntry[]>
    create: (input: PhotoLogEntryInput) => Promise<PhotoLogEntry>
    delete: (id: number) => Promise<void>
    setProject: (id: number, projectId: number | null) => Promise<PhotoLogEntry>
  }
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: Api
  }
}
