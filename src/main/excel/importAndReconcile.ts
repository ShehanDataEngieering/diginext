import type Database from 'better-sqlite3-multiple-ciphers'
import type { ImportSummary, ImportDetail } from '../../shared/ipc'
import { listItemUnits } from '../db/repositories/itemUnits'
import { createTransfer } from '../db/repositories/transfers'
import { parseImportedSheet, type ImportedUnit } from './parseImportedSheet'

export function importAndReconcile(
  db: Database.Database,
  filePath: string
): ImportSummary | null {
  const imported = parseImportedSheet(filePath)
  if (!imported) return null

  const { marker, units: importedUnits } = imported
  const projectId = marker.projectId

  const project = db.prepare('SELECT name FROM projects WHERE id = ?').get(projectId) as
    | { name: string }
    | undefined
  if (!project) return null

  const allUnits = listItemUnits(db)
  const currentProjectUnits = allUnits.filter((u) => u.assignedProjectId === projectId)

  const importedBySerial = new Map<string, ImportedUnit>()
  const importedAnonymous: ImportedUnit[] = []

  for (const unit of importedUnits) {
    if (unit.serialId) {
      importedBySerial.set(unit.serialId.toLowerCase(), unit)
    } else {
      importedAnonymous.push(unit)
    }
  }

  const details: ImportDetail[] = []
  let unitsAdded = 0
  let unitsRemoved = 0
  let transfersCreated = 0

  const runReconciliation = db.transaction(() => {
    for (const currentUnit of currentProjectUnits) {
      if (!currentUnit.serialId) continue

      const key = currentUnit.serialId.toLowerCase()
      if (!importedBySerial.has(key)) {
        unitsRemoved++
        details.push({
          type: 'removed',
          itemName: currentUnit.itemName,
          serialId: currentUnit.serialId,
          notes: 'Unit no longer at this project'
        })
      }
    }

    for (const [serialKey, importedUnit] of importedBySerial) {
      const existingUnit = allUnits.find(
        (u) => u.serialId && u.serialId.toLowerCase() === serialKey
      )

      if (!existingUnit) {
        unitsAdded++
        details.push({
          type: 'added',
          itemName: importedUnit.itemName,
          serialId: importedUnit.serialId,
          notes: 'New unit found in import'
        })
        continue
      }

      if (existingUnit.assignedProjectId !== projectId) {
        const fromProject = existingUnit.assignedProjectId
          ? (db.prepare('SELECT name FROM projects WHERE id = ?').get(existingUnit.assignedProjectId) as
              | { name: string }
              | undefined)
          : null

        db.prepare('UPDATE item_units SET assigned_project_id = ? WHERE id = ?').run(
          projectId,
          existingUnit.id
        )

        createTransfer(db, {
          date: new Date().toISOString().slice(0, 10),
          itemId: existingUnit.itemId,
          serialId: existingUnit.serialId,
          qty: 1,
          fromProjectId: fromProject ? existingUnit.assignedProjectId : null,
          toProjectId: projectId,
          transferredBy: 'Excel Import',
          authorizedBy: null,
          notes: `Imported from ${marker.projectName} sheet`,
          status: 'Recorded'
        })

        transfersCreated++
        details.push({
          type: 'transferred',
          itemName: importedUnit.itemName,
          serialId: importedUnit.serialId,
          fromProject: fromProject?.name ?? 'Available',
          toProject: project.name,
          notes: 'Unit transferred to this project'
        })
      } else {
        if (importedUnit.auditDate || importedUnit.remarks) {
          db.prepare(
            'UPDATE item_units SET audit_date = COALESCE(?, audit_date), remarks = COALESCE(?, remarks) WHERE id = ?'
          ).run(importedUnit.auditDate, importedUnit.remarks, existingUnit.id)
        }
      }
    }
  })

  runReconciliation()

  return {
    projectId,
    projectName: project.name,
    importedAt: marker.exportedAt,
    unitsAdded,
    unitsRemoved,
    transfersCreated,
    details
  }
}
