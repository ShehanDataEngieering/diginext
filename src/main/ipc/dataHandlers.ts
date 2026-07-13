import { app, dialog, ipcMain } from 'electron'
import { existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import ExcelJS from 'exceljs'
import { IPC_CHANNELS } from '../../shared/ipc'
import type {
  DatabaseAdapter
} from '../db/adapter'
import type {
  ExportProjectResult,
  HandoverInput,
  ItemInput,
  ItemUnitFilter,
  ItemUnitInput,
  MoveUnitsInput,
  PhotoImportResult,
  PhotoLogEntryInput,
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
  moveUnits,
  updateItemUnit
} from '../db/repositories/itemUnits'
import { getDashboardRollup } from '../db/repositories/dashboard'
import { listTransfers, getTransfersByProject } from '../db/repositories/transfers'
import { listHandovers, getHandoversByProject, createHandover, getHandoverById } from '../db/repositories/handovers'
import {
  listPhotoLog,
  createPhotoLogEntry,
  deletePhotoLogEntry,
  getPhotoLogEntryById,
  setPhotoLogProject
} from '../db/repositories/photoLog'
import { buildProjectInventoryWorkbook, exportFileName } from '../excel/exportProjectSheet'
import { buildHandoverWorkbook, handoverExportFileName, type HandoverUnitData } from '../excel/exportHandoverSheet'
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
    // Delete the storage objects for photos that were removed from the gallery
    // (present before, absent after). The cover is part of photoRefs, so this
    // covers it too.
    if (previous) {
      const kept = new Set(updated.photoRefs)
      for (const ref of previous.photoRefs) {
        if (!kept.has(ref)) await deleteManagedPhoto(ref)
      }
    }
    return updated
  })
  ipcMain.handle(IPC_CHANNELS.itemUnitsDelete, async (_event, id: number) => {
    const existing = await getItemUnitById(db, id)
    await deleteItemUnit(db, id)
    if (existing) {
      // Clean up every gallery photo. Fall back to the cover for legacy units
      // that have a photoEvidenceRef but no gallery rows.
      const refs = new Set(existing.photoRefs)
      if (existing.photoEvidenceRef) refs.add(existing.photoEvidenceRef)
      for (const ref of refs) await deleteManagedPhoto(ref)
    }
  })
  ipcMain.handle(IPC_CHANNELS.itemUnitsMove, (_event, input: MoveUnitsInput) => moveUnits(db, input))

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
    async (_event, projectId: number, blank = false): Promise<ExportProjectResult> => {
      const project = await getProjectById(db, projectId)
      if (!project) throw new Error(`Project ${projectId} not found`)

      const items = await listItems(db)
      const units = await listItemUnits(db, { projectId })
      const photoLog = (await listPhotoLog(db)).filter((e) => e.projectId === projectId)

      const dir = exportDirectory()
      mkdirSync(dir, { recursive: true })

      // The filled sheet appends a dated snapshot to a stable per-project file;
      // the blank marking template is a standalone one-off with its own name.
      const baseName = blank
        ? exportFileName(project).replace(/\.xlsx$/, ' - blank template.xlsx')
        : exportFileName(project)

      // Writes the workbook to `target`. When appendToExisting is set and the
      // file is already there, it's read back first so re-exports accumulate a
      // new dated sheet in the same workbook (filled sheet only).
      const writeExport = async (target: string, appendToExisting: boolean): Promise<void> => {
        let existingWorkbook: ExcelJS.Workbook | undefined
        if (appendToExisting && existsSync(target)) {
          existingWorkbook = new ExcelJS.Workbook()
          await existingWorkbook.xlsx.readFile(target)
        }
        const workbook = await buildProjectInventoryWorkbook(project, items, units, photoLog, existingWorkbook, blank)
        await workbook.xlsx.writeFile(target)
      }

      const filePath = join(dir, baseName)
      try {
        await writeExport(filePath, !blank)
        return { filePath }
      } catch (err) {
        // The standard file is open in Excel → Windows locks it (EBUSY), so we
        // can neither read it to append nor overwrite it. Write a fresh
        // timestamped copy instead so the export still succeeds.
        if ((err as NodeJS.ErrnoException).code !== 'EBUSY') throw err
        const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')
        const altPath = join(dir, baseName.replace(/\.xlsx$/, ` (${stamp}).xlsx`))
        await writeExport(altPath, false)
        return { filePath: altPath }
      }
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.excelImportProject,
    (_event, filePath: string, expectedProjectId?: number, reconcileOnly?: boolean) => {
      return importAndReconcile(db, filePath, expectedProjectId, reconcileOnly)
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.excelExportHandover,
    async (_event, handoverId: number): Promise<ExportProjectResult> => {
      const handover = await getHandoverById(db, handoverId)
      if (!handover) throw new Error(`Handover ${handoverId} not found`)

      const units = handover.projectId
        ? await listItemUnits(db, { projectId: handover.projectId })
        : []
      const unitPhotoMap = new Map<number, HandoverUnitData>()
      for (const u of units) {
        unitPhotoMap.set(u.id, {
          photoRef: u.photoEvidenceRef ?? null,
          auditDate: u.auditDate ?? null,
          remarks: u.remarks ?? null
        })
      }

      const photoLog = handover.projectId
        ? (await listPhotoLog(db)).filter((e) => e.projectId === handover.projectId)
        : []

      const dir = exportDirectory()
      mkdirSync(dir, { recursive: true })

      const workbook = await buildHandoverWorkbook(handover, unitPhotoMap, photoLog)
      const filePath = join(dir, handoverExportFileName(handover))
      try {
        await workbook.xlsx.writeFile(filePath)
        return { filePath }
      } catch (err) {
        // File open in Excel → locked (EBUSY). Write a timestamped copy instead.
        if ((err as NodeJS.ErrnoException).code !== 'EBUSY') throw err
        const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')
        const altPath = join(dir, handoverExportFileName(handover).replace(/\.xlsx$/, ` (${stamp}).xlsx`))
        await workbook.xlsx.writeFile(altPath)
        return { filePath: altPath }
      }
    }
  )

  ipcMain.handle(IPC_CHANNELS.dialogOpenFile, async (): Promise<string | null> => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: 'Select inventory sheet',
      filters: [{ name: 'Excel files', extensions: ['xlsx', 'xls'] }],
      properties: ['openFile']
    })
    return canceled || filePaths.length === 0 ? null : filePaths[0]
  })

  ipcMain.handle(IPC_CHANNELS.transfersList, () => listTransfers(db))
  ipcMain.handle(IPC_CHANNELS.transfersByProject, (_event, projectId: number) =>
    getTransfersByProject(db, projectId)
  )

  ipcMain.handle(IPC_CHANNELS.handoversList, () => listHandovers(db))
  ipcMain.handle(IPC_CHANNELS.handoversByProject, (_event, projectId: number) =>
    getHandoversByProject(db, projectId)
  )
  ipcMain.handle(IPC_CHANNELS.handoversCreate, (_event, input: HandoverInput) =>
    createHandover(db, input)
  )

  ipcMain.handle(IPC_CHANNELS.photoLogList, () => listPhotoLog(db))
  ipcMain.handle(IPC_CHANNELS.photoLogCreate, (_event, input: PhotoLogEntryInput) =>
    createPhotoLogEntry(db, input)
  )
  ipcMain.handle(IPC_CHANNELS.photoLogDelete, async (_event, id: number) => {
    const existing = await getPhotoLogEntryById(db, id)
    await deletePhotoLogEntry(db, id)
    if (existing) await deleteManagedPhoto(existing.photoEvidenceRef)
  })
  ipcMain.handle(
    IPC_CHANNELS.photoLogSetProject,
    (_event, id: number, projectId: number | null) => setPhotoLogProject(db, id, projectId)
  )
}
