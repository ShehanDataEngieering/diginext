import { app, ipcMain } from 'electron'
import { mkdirSync } from 'fs'
import { join } from 'path'
import { IPC_CHANNELS } from '../../shared/ipc'
import type {
  DatabaseAdapter
} from '../db/adapter'
import type {
  ExportProjectResult,
  ItemInput,
  ItemUnitFilter,
  ItemUnitInput,
  PhotoImportResult,
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
  getItemUnitById,
  listItemUnits,
  updateItemUnit
} from '../db/repositories/itemUnits'
import { getDashboardRollup } from '../db/repositories/dashboard'
import { listTransfers, getTransfersByProject } from '../db/repositories/transfers'
import { buildProjectInventoryWorkbook, exportFileName } from '../excel/exportProjectSheet'
import { importAndReconcile } from '../excel/importAndReconcile'
import { deleteManagedPhoto, importPhoto, readPhotoDataUrl } from '../photos/photoStore'

const EXPORT_DIR_NAME = 'Diginext Inventory Exports'

function exportDirectory(): string {
  return join(app.getPath('documents'), EXPORT_DIR_NAME)
}

function toUserMessage(error: unknown, context: 'delete-item'): string {
  const message = error instanceof Error ? error.message : String(error)
  if (context === 'delete-item' && (message.includes('FOREIGN KEY constraint failed') || message.includes('violates foreign key constraint'))) {
    return 'This item type still has units recorded against it. Remove or reassign those units first.'
  }
  return message
}

export function registerDataHandlers(db: DatabaseAdapter): void {
  ipcMain.handle(IPC_CHANNELS.projectsList, () => listProjects(db))
  ipcMain.handle(IPC_CHANNELS.projectsCreate, (_event, input: ProjectInput) => createProject(db, input))
  ipcMain.handle(IPC_CHANNELS.projectsUpdate, (_event, id: number, input: ProjectInput) =>
    updateProject(db, id, input)
  )
  ipcMain.handle(IPC_CHANNELS.projectsSetStatus, (_event, id: number, status: ProjectStatus) =>
    setProjectStatus(db, id, status)
  )

  ipcMain.handle(IPC_CHANNELS.itemsList, () => listItems(db))
  ipcMain.handle(IPC_CHANNELS.itemsCreate, (_event, input: ItemInput) => createItem(db, input))
  ipcMain.handle(IPC_CHANNELS.itemsUpdate, (_event, id: number, input: ItemInput) =>
    updateItem(db, id, input)
  )
  ipcMain.handle(IPC_CHANNELS.itemsDelete, (_event, id: number) => {
    try {
      return deleteItem(db, id)
    } catch (error) {
      throw new Error(toUserMessage(error, 'delete-item'))
    }
  })

  ipcMain.handle(IPC_CHANNELS.itemUnitsList, (_event, filter?: ItemUnitFilter) =>
    listItemUnits(db, filter)
  )
  ipcMain.handle(IPC_CHANNELS.itemUnitsCreate, (_event, input: ItemUnitInput) =>
    createItemUnit(db, input)
  )
  ipcMain.handle(IPC_CHANNELS.itemUnitsUpdate, async (_event, id: number, input: ItemUnitInput) => {
    const previous = await getItemUnitById(db, id)
    const updated = await updateItemUnit(db, id, input)
    if (previous && previous.photoEvidenceRef !== updated.photoEvidenceRef) {
      await deleteManagedPhoto(previous.photoEvidenceRef)
    }
    return updated
  })
  ipcMain.handle(IPC_CHANNELS.itemUnitsDelete, async (_event, id: number) => {
    const existing = await getItemUnitById(db, id)
    await deleteItemUnit(db, id)
    if (existing) await deleteManagedPhoto(existing.photoEvidenceRef)
  })

  ipcMain.handle(IPC_CHANNELS.dashboardRollup, () => getDashboardRollup(db))

  ipcMain.handle(IPC_CHANNELS.photosImport, async (_event, sourcePath: string): Promise<PhotoImportResult> => {
    const reference = await importPhoto(sourcePath)
    return { reference }
  })
  ipcMain.handle(IPC_CHANNELS.photosRead, async (_event, reference: string): Promise<string | null> => {
    return readPhotoDataUrl(reference)
  })

  ipcMain.handle(
    IPC_CHANNELS.excelExportProject,
    async (_event, projectId: number): Promise<ExportProjectResult> => {
      const project = await getProjectById(db, projectId)
      if (!project) throw new Error(`Project ${projectId} not found`)

      const items = await listItems(db)
      const units = await listItemUnits(db, { projectId })
      const workbook = await buildProjectInventoryWorkbook(project, items, units)

      const dir = exportDirectory()
      mkdirSync(dir, { recursive: true })
      const filePath = join(dir, exportFileName(project))
      await workbook.xlsx.writeFile(filePath)

      return { filePath }
    }
  )

  ipcMain.handle(IPC_CHANNELS.excelImportProject, (_event, filePath: string) => {
    return importAndReconcile(db, filePath)
  })

  ipcMain.handle(IPC_CHANNELS.transfersList, () => listTransfers(db))
  ipcMain.handle(IPC_CHANNELS.transfersByProject, (_event, projectId: number) =>
    getTransfersByProject(db, projectId)
  )
}
