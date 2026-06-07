// Registers IPC handlers for the CRUD data layer (projects, items, item
// units, dashboard rollup). Kept separate from main/index.ts so that file
// stays focused on app lifecycle/window management.
import { dialog, ipcMain } from 'electron'
import { writeFile } from 'xlsx'
import type Database from 'better-sqlite3-multiple-ciphers'
import { IPC_CHANNELS } from '../../shared/ipc'
import type {
  ExportProjectResult,
  ItemInput,
  ItemUnitFilter,
  ItemUnitInput,
  ProjectInput,
  ProjectStatus
} from '../../shared/ipc'
import {
  createProject,
  getProjectById,
  listProjects,
  setProjectStatus,
  updateProject
} from '../db/repositories/projects'
import { createItem, deleteItem, listItems, updateItem } from '../db/repositories/items'
import {
  createItemUnit,
  deleteItemUnit,
  listItemUnits,
  updateItemUnit
} from '../db/repositories/itemUnits'
import { getDashboardRollup } from '../db/repositories/dashboard'
import { buildProjectInventoryWorkbook, suggestedExportFileName } from '../excel/exportProjectSheet'

// SQLite's raw foreign-key violation message ("FOREIGN KEY constraint failed")
// means nothing to a user. Translate the one case we expect to actually
// surface in the UI — deleting an item type that still has units — into
// guidance they can act on; let anything else through as-is for now.
function toUserMessage(error: unknown, context: 'delete-item'): string {
  const message = error instanceof Error ? error.message : String(error)
  if (context === 'delete-item' && message.includes('FOREIGN KEY constraint failed')) {
    return 'This item type still has units recorded against it. Remove or reassign those units first.'
  }
  return message
}

export function registerDataHandlers(db: Database.Database): void {
  // --- Projects -------------------------------------------------------------
  ipcMain.handle(IPC_CHANNELS.projectsList, () => listProjects(db))
  ipcMain.handle(IPC_CHANNELS.projectsCreate, (_event, input: ProjectInput) => createProject(db, input))
  ipcMain.handle(IPC_CHANNELS.projectsUpdate, (_event, id: number, input: ProjectInput) =>
    updateProject(db, id, input)
  )
  ipcMain.handle(IPC_CHANNELS.projectsSetStatus, (_event, id: number, status: ProjectStatus) =>
    setProjectStatus(db, id, status)
  )

  // --- Items -----------------------------------------------------------------
  ipcMain.handle(IPC_CHANNELS.itemsList, () => listItems(db))
  ipcMain.handle(IPC_CHANNELS.itemsCreate, (_event, input: ItemInput) => createItem(db, input))
  ipcMain.handle(IPC_CHANNELS.itemsUpdate, (_event, id: number, input: ItemInput) =>
    updateItem(db, id, input)
  )
  ipcMain.handle(IPC_CHANNELS.itemsDelete, (_event, id: number) => {
    try {
      deleteItem(db, id)
    } catch (error) {
      throw new Error(toUserMessage(error, 'delete-item'))
    }
  })

  // --- Item units -------------------------------------------------------------
  ipcMain.handle(IPC_CHANNELS.itemUnitsList, (_event, filter?: ItemUnitFilter) =>
    listItemUnits(db, filter)
  )
  ipcMain.handle(IPC_CHANNELS.itemUnitsCreate, (_event, input: ItemUnitInput) =>
    createItemUnit(db, input)
  )
  ipcMain.handle(IPC_CHANNELS.itemUnitsUpdate, (_event, id: number, input: ItemUnitInput) =>
    updateItemUnit(db, id, input)
  )
  ipcMain.handle(IPC_CHANNELS.itemUnitsDelete, (_event, id: number) => deleteItemUnit(db, id))

  // --- Dashboard --------------------------------------------------------------
  ipcMain.handle(IPC_CHANNELS.dashboardRollup, () => getDashboardRollup(db))

  // --- Excel export -----------------------------------------------------------
  // "Export inventory sheet for [Project]" (plan's Excel Export section). The
  // save-location picker has to run in the main process (it's a native OS
  // dialog), so the whole build-then-write sequence lives here rather than
  // being split across an IPC round trip per step.
  ipcMain.handle(IPC_CHANNELS.excelExportProject, async (_event, projectId: number): Promise<ExportProjectResult> => {
    const project = getProjectById(db, projectId)
    if (!project) throw new Error(`Project ${projectId} not found`)

    const items = listItems(db)
    const units = listItemUnits(db, { projectId })

    const workbook = buildProjectInventoryWorkbook(project, items, units)

    // Deliberately *not* passing the owning BrowserWindow here: attaching the
    // native save dialog as a modal sheet of the parent window is the usual
    // Electron pattern, but under WSLg's GTK/X11 passthrough that transient-
    // for attachment can deadlock the dialog's message loop against the
    // renderer's — the symptom being the whole window freezing solid after
    // "Save" is clicked. An unattached dialog behaves like a normal top-level
    // window and avoids that grab/focus interaction entirely.
    const result = await dialog.showSaveDialog({
      title: `Export inventory — ${project.name}`,
      defaultPath: suggestedExportFileName(project),
      filters: [{ name: 'Excel Workbook', extensions: ['xlsx'] }]
    })

    if (result.canceled || !result.filePath) {
      return { canceled: true }
    }

    writeFile(workbook, result.filePath)
    return { canceled: false, filePath: result.filePath }
  })
}
