// Single source of truth for IPC channel names, imported by both the main
// process (registers handlers) and the preload (invokes them) so the two
// sides can't drift out of sync.
export const IPC_CHANNELS = {
  authVerifySession: 'auth:verify-session',
  dbBackupNow: 'db:backup-now',
  dbListBackups: 'db:list-backups',
  dbRestoreBackup: 'db:restore-backup',

  projectsList: 'projects:list',
  projectsCreate: 'projects:create',
  projectsUpdate: 'projects:update',
  projectsSetStatus: 'projects:set-status',

  itemsList: 'items:list',
  itemsCreate: 'items:create',
  itemsUpdate: 'items:update',
  itemsDelete: 'items:delete',

  itemUnitsList: 'item-units:list',
  itemUnitsCreate: 'item-units:create',
  itemUnitsUpdate: 'item-units:update',
  itemUnitsDelete: 'item-units:delete',

  dashboardRollup: 'dashboard:rollup',

  excelExportProject: 'excel:export-project',

  photosImport: 'photos:import',
  photosRead: 'photos:read'
} as const

// Shared shape for backup metadata sent across the IPC boundary — kept here
// (rather than importing from src/main/db/backup.ts) so the renderer doesn't
// need to depend on main-process-only modules just for a type.
export interface BackupInfo {
  name: string
  path: string
  createdAt: string
}

// ----------------------------------------------------------------------------
// Domain types shared between main (repositories) and renderer (UI). All in
// camelCase regardless of the snake_case DB columns — the repositories do
// that translation, so the IPC boundary and the UI never see SQL column names.
// ----------------------------------------------------------------------------

export type ProjectStatus = 'active' | 'completed'

export interface Project {
  id: number
  name: string
  location: string | null
  updatedBy: string | null
  lastUpdatedDate: string | null
  status: ProjectStatus
}

export interface ProjectInput {
  name: string
  location: string | null
  updatedBy: string | null
  lastUpdatedDate: string | null
}

export interface Item {
  id: number
  category: string
  name: string
  initialStock: number
}

export interface ItemInput {
  category: string
  name: string
  initialStock: number
}

export type UnitStatus = 'In Use' | 'Available' | 'Retired-Damaged'

export interface ItemUnit {
  id: number
  itemId: number
  serialId: string | null
  assignedProjectId: number | null
  auditDate: string | null
  remarks: string | null
  status: UnitStatus
  photoEvidenceRef: string | null
}

export interface ItemUnitInput {
  itemId: number
  serialId: string | null
  assignedProjectId: number | null
  auditDate: string | null
  remarks: string | null
  status: UnitStatus
  photoEvidenceRef: string | null
}

// A unit joined with its item and (if assigned) project names — what the
// Item Units table actually wants to show, without N+1 lookups in the UI.
export interface ItemUnitWithDetails extends ItemUnit {
  itemCategory: string
  itemName: string
  projectName: string | null
}

export interface ItemUnitFilter {
  itemId?: number
  projectId?: number | null // null = filter to unassigned/available units
}

// One row of the live "Main Inventory" rollup: an item type plus how many of
// its units currently sit in each project vs. unassigned ("available").
// `countsByProjectId` only contains entries for projects that actually hold
// at least one unit of this item — the renderer fills gaps with 0 when it
// pivots this into the per-project columns shown in `projects`.
export interface DashboardRow {
  itemId: number
  category: string
  name: string
  initialStock: number
  countsByProjectId: Record<number, number>
  available: number
  totalUnits: number
}

export interface DashboardRollup {
  projects: Pick<Project, 'id' | 'name'>[]
  rows: DashboardRow[]
}

// Result of "Export inventory sheet for [Project]" (see plan's Excel Export
// section). Always written straight to a fixed, user-visible folder rather
// than via a save-as picker — see the IPC handler for why — so this is just
// "where did it land", not a cancelable interaction.
export interface ExportProjectResult {
  filePath: string
}

// Result of attaching a photo to an item unit — `reference` is what gets
// stored in `item_units.photo_evidence_ref` and handed back to
// `photos:read` later to display it. Opaque to the renderer; it shouldn't
// assume anything about its shape beyond "pass it back to look the photo up".
export interface PhotoImportResult {
  reference: string
}
