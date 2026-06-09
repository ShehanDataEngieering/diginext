// Registers IPC handlers for the CRUD data layer (projects, items, item
// units, dashboard rollup). Kept separate from main/index.ts so that file
// stays focused on app lifecycle/window management.
import { app, ipcMain } from 'electron'
import { mkdirSync } from 'fs'
import { join } from 'path'
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
import { buildProjectInventoryWorkbook, exportFileName } from '../excel/exportProjectSheet'

// Exports land here rather than behind a save-as picker — see the handler
// below for why (native dialogs deadlock the whole app under this WSLg
// setup). `Documents` is a stable, user-visible spot they'd find anyway —
// easy to locate in Explorer and to attach straight to an email.
const EXPORT_DIR_NAME = 'Diginext Inventory Exports'

function exportDirectory(): string {
  return join(app.getPath('documents'), EXPORT_DIR_NAME)
}

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
  // "Export inventory sheet for [Project]" (plan's Excel Export section).
  //
  // This was originally built around `dialog.showSaveDialog` (the standard
  // Electron "Save As" pattern) — but that froze the whole app solid the
  // moment the dialog appeared, even unattached to the main window. That's a
  // known class of issue with Electron's native (GTK) dialogs deadlocking
  // against the renderer's event loop under WSLg's X11/Wayland passthrough,
  // which is the only environment available for running this Windows-bound
  // app during development. Rather than chase a picker that may never behave
  // here (and would be one more thing to verify post-packaging on real
  // Windows), we sidestep native dialogs entirely: write straight to a fixed,
  // predictable, user-visible folder and report the exact path back — the
  // recipient just needs *a* file to attach to an email, not to choose where
  // it lives.
  ipcMain.handle(
    IPC_CHANNELS.excelExportProject,
    async (_event, projectId: number): Promise<ExportProjectResult> => {
      const project = getProjectById(db, projectId)
      if (!project) throw new Error(`Project ${projectId} not found`)

      const items = listItems(db)
      const units = listItemUnits(db, { projectId })
      // Async because building the workbook now embeds the branded logo image
      // and applies cell styling via `exceljs` (see exportProjectSheet.ts for
      // why that module — not the `xlsx` package used elsewhere — owns this
      // write path).
      const workbook = await buildProjectInventoryWorkbook(project, items, units)

      const dir = exportDirectory()
      mkdirSync(dir, { recursive: true })
      const filePath = join(dir, exportFileName(project))
      await workbook.xlsx.writeFile(filePath)

      return { filePath }
    }
  )
}
