// Registers IPC handlers for the CRUD data layer (projects, items, item
// units, dashboard rollup). Kept separate from main/index.ts so that file
// stays focused on app lifecycle/window management.
import { ipcMain } from 'electron'
import type Database from 'better-sqlite3-multiple-ciphers'
import { IPC_CHANNELS } from '../../shared/ipc'
import type { ItemInput, ItemUnitFilter, ItemUnitInput, ProjectInput, ProjectStatus } from '../../shared/ipc'
import { createProject, listProjects, setProjectStatus, updateProject } from '../db/repositories/projects'
import { createItem, deleteItem, listItems, updateItem } from '../db/repositories/items'
import {
  createItemUnit,
  deleteItemUnit,
  listItemUnits,
  updateItemUnit
} from '../db/repositories/itemUnits'
import { getDashboardRollup } from '../db/repositories/dashboard'

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
}
