// Single source of truth for IPC channel names, imported by both the main
// process (registers handlers) and the preload (invokes them) so the two
// sides can't drift out of sync.
export const IPC_CHANNELS = {
  authVerifySession: 'auth:verify-session',
  authIsAdmin: 'auth:is-admin',

  usersList: 'users:list',
  usersCreate: 'users:create',
  usersDelete: 'users:delete',
  usersSetPassword: 'users:set-password',
  usersSetDisabled: 'users:set-disabled',
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
  itemUnitsMove: 'item-units:move',

  dashboardRollup: 'dashboard:rollup',

  excelExportProject: 'excel:export-project',
  excelImportProject: 'excel:import-project',
  excelExportHandover: 'excel:export-handover',

  dialogOpenFile: 'dialog:open-file',

  photosImport: 'photos:import',
  photosRead: 'photos:read',

  transfersList: 'transfers:list',
  transfersByProject: 'transfers:by-project',

  handoversList: 'handovers:list',
  handoversByProject: 'handovers:by-project',
  handoversCreate: 'handovers:create',

  photoLogList: 'photo-log:list',
  photoLogCreate: 'photo-log:create',
  photoLogDelete: 'photo-log:delete',
  photoLogSetProject: 'photo-log:set-project'
} as const

// A user account managed through the Settings → User Management screen. These
// are real Supabase Auth users; the app authorizes anyone with a valid session,
// and any signed-in user can create / disable / remove them (the last remaining
// account is protected from deletion). `isAdmin` reflects whether the user's
// email is in ADMIN_EMAILS — informational only now that the gate is removed.
export interface AppUser {
  id: string
  email: string
  createdAt: string
  lastSignInAt: string | null
  isAdmin: boolean
  // Suspended via GoTrue ban — the account exists but cannot sign in until
  // re-enabled. A reversible alternative to deletion.
  disabled: boolean
}

export interface CreateUserInput {
  email: string
  password: string
}

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
  // The project a unit was deployed to when it was retired/damaged. Null unless
  // status is 'Retired-Damaged' (and may be null for older write-offs that
  // predate the column). Lets the loss stay traceable to a site.
  retiredFromProjectId: number | null
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

// Moves a set of units to a single destination (a project, or null = back to
// the available pool) in ONE transaction: each unit's assignment + status is
// updated and a matching transfer-log row is written, all-or-nothing. Backs
// the "assign units", "bulk transfer out", and single-unit transfer flows so a
// mid-batch failure can't leave units half-moved with no audit record.
export interface MoveUnitsInput {
  unitIds: number[]
  toProjectId: number | null
  date: string
  transferredBy: string | null
  authorizedBy: string | null
  notes: string | null
}

export interface MoveUnitsResult {
  // Units actually moved (excludes retired units and no-op same-destination moves).
  movedCount: number
  // Retired/written-off units in the batch — silently left in place, never moved.
  skippedRetired: number
}

// A unit joined with its item and (if assigned) project names — what the
// Item Units table actually wants to show, without N+1 lookups in the UI.
export interface ItemUnitWithDetails extends ItemUnit {
  itemCategory: string
  itemName: string
  projectName: string | null
  retiredFromProjectName: string | null
}

export interface ItemUnitFilter {
  itemId?: number
  projectId?: number | null // null = filter to unassigned/available units
  status?: UnitStatus
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
  // Units written off (status 'Retired-Damaged'). Tracked separately so the
  // "Available = stock − deployed" baseline can exclude gear that can never be
  // deployed again, rather than letting it masquerade as latent stock.
  retired: number
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

export interface Transfer {
  id: number
  date: string
  itemId: number
  serialId: string | null
  qty: number
  fromProjectId: number | null
  toProjectId: number | null
  transferredBy: string | null
  authorizedBy: string | null
  notes: string | null
  status: string
}

export interface TransferInput {
  date: string
  itemId: number
  serialId: string | null
  qty: number
  fromProjectId: number | null
  toProjectId: number | null
  transferredBy: string | null
  authorizedBy: string | null
  notes: string | null
  status?: string
}

export interface ImportSummary {
  projectId: number
  projectName: string
  importedAt: string
  // True when the project did not exist and was created by this import.
  projectCreated: boolean
  // How many new item types (category + name pairs) were created.
  itemsCreated: number
  // Units that were new and did not exist anywhere in the DB.
  unitsAdded: number
  // Units that were already at this project and had their audit/remarks updated.
  unitsUpdated: number
  // Units previously at this project that are no longer in the sheet (flagged only, not deleted).
  unitsRemoved: number
  // Units that existed under a different project and were transferred here.
  transfersCreated: number
  details: ImportDetail[]
}

export interface ImportDetail {
  type: 'added' | 'removed' | 'transferred'
  itemName: string
  serialId: string | null
  fromProject?: string
  toProject?: string
  notes?: string
}

// Per-unit follow-up action chosen during a project close-out handover. These
// string values are persisted in handover_items.action AND drive the unit
// mutations applied atomically inside createHandover — so both the renderer
// (which builds the dropdown) and the repository (which acts on them) MUST use
// these exact constants. Don't hardcode the strings on either side.
export const HANDOVER_ACTIONS = {
  return: 'Return to stock',
  retire: 'Retire / Dispose',
  transfer: 'Transfer to another project'
} as const

export type HandoverAction = (typeof HANDOVER_ACTIONS)[keyof typeof HANDOVER_ACTIONS]

export interface HandoverItem {
  id: number
  handoverId: number
  itemUnitId: number
  serialId: string | null
  itemName: string | null
  itemCategory: string | null
  condition: string | null
  action: string | null
  transferProjectId: number | null
  transferProjectName: string | null
}

export interface HandoverItemInput {
  itemUnitId: number
  condition: string | null
  action: string | null
  transferProjectId: number | null
}

export interface Handover {
  id: number
  projectId: number
  projectName: string | null
  handoverDate: string
  handedOverBy: string | null
  receivedBy: string | null
  notes: string | null
  signatureRef: string | null
  items: HandoverItem[]
}

export interface HandoverInput {
  projectId: number
  handoverDate: string
  handedOverBy: string | null
  receivedBy: string | null
  notes: string | null
  signatureRef: string | null
  items: HandoverItemInput[]
}

// A standalone photo entry not tied to a specific item unit — general
// documentation photos (e.g. tool kits, handover evidence) with a free-text
// label.
export interface PhotoLogEntry {
  id: number
  label: string
  photoEvidenceRef: string
  projectId: number | null
  projectName: string | null
  createdAt: string
}

export interface PhotoLogEntryInput {
  label: string
  photoEvidenceRef: string
  projectId: number | null
}
