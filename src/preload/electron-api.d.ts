import { ElectronAPI } from '@electron-toolkit/preload'
import type {
  BackupInfo,
  DashboardRollup,
  Item,
  ItemInput,
  ItemUnitFilter,
  ItemUnitInput,
  ItemUnitWithDetails,
  Project,
  ProjectInput,
  ProjectStatus
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
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: Api
  }
}
