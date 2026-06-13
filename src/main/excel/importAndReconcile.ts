import type { DatabaseAdapter } from '../db/adapter'
import type { ImportSummary, ImportDetail } from '../../shared/ipc'
import { listItemUnits } from '../db/repositories/itemUnits'
import { createTransfer } from '../db/repositories/transfers'
import { parseImportedSheet } from './parseImportedSheet'

interface ProjectRow { id: number; name: string }

async function resolveOrCreateProject(
  db: DatabaseAdapter,
  markerId: number,
  markerName: string
): Promise<{ projectId: number; projectName: string; projectCreated: boolean }> {
  let row =
    (await db.queryOne('SELECT id, name FROM projects WHERE id = ?', [markerId]) as ProjectRow | null) ??
    (await db.queryOne('SELECT id, name FROM projects WHERE LOWER(name) = LOWER(?)', [markerName]) as ProjectRow | null)

  if (row) return { projectId: row.id, projectName: row.name, projectCreated: false }

  const result = await db.query(
    "INSERT INTO projects (name, status) VALUES (?, 'active') RETURNING id",
    [markerName]
  )
  return { projectId: result.lastInsertRowid, projectName: markerName, projectCreated: true }
}

async function resolveOrCreateItem(
  db: DatabaseAdapter,
  category: string,
  name: string
): Promise<{ itemId: number; initialStock: number; created: boolean }> {
  const existing = await db.queryOne(
    'SELECT id, initial_stock FROM items WHERE LOWER(category) = LOWER(?) AND LOWER(name) = LOWER(?)',
    [category, name]
  ) as { id: number; initial_stock: number } | null

  if (existing) return { itemId: existing.id, initialStock: existing.initial_stock, created: false }

  const result = await db.query(
    'INSERT INTO items (category, name, initial_stock) VALUES (?, ?, 0) RETURNING id',
    [category, name]
  )
  return { itemId: result.lastInsertRowid, initialStock: 0, created: true }
}

async function syncInitialStock(db: DatabaseAdapter, itemId: number): Promise<void> {
  const row = await db.queryOne(
    'SELECT COUNT(*)::int as count FROM item_units WHERE item_id = ?',
    [itemId]
  )
  const count = Number(row?.count ?? 0)
  await db.query('UPDATE items SET initial_stock = MAX(initial_stock, ?::int) WHERE id = ?', [count, itemId])
}

export async function importAndReconcile(
  db: DatabaseAdapter,
  filePath: string
): Promise<ImportSummary | null> {
  const imported = parseImportedSheet(filePath)
  if (!imported) return null

  const { marker, itemBlocks } = imported

  const { projectId, projectName, projectCreated } = await resolveOrCreateProject(
    db,
    marker.projectId,
    marker.projectName
  )

  const allUnits = await listItemUnits(db)
  const currentProjectUnits = allUnits.filter((u) => u.assignedProjectId === projectId)

  const details: ImportDetail[] = []
  let unitsAdded     = 0
  let unitsUpdated   = 0
  let unitsRemoved   = 0
  let transfersCreated = 0
  let itemsCreated   = 0

  const touchedItemIds = new Set<number>()

  await db.transaction(async (tx) => {
    for (const block of itemBlocks) {
      const { itemId, created } = await resolveOrCreateItem(tx, block.category, block.itemName)
      if (created) itemsCreated++
      touchedItemIds.add(itemId)

      const serialisedInBlock = block.units.filter((u) => u.serialId !== null)
      const importedSerials = new Set(serialisedInBlock.map((u) => u.serialId!.toLowerCase()))

      for (const currentUnit of currentProjectUnits) {
        if (!currentUnit.serialId) continue
        if (currentUnit.itemId !== itemId) continue
        if (!importedSerials.has(currentUnit.serialId.toLowerCase())) {
          unitsRemoved++
          details.push({
            type: 'removed',
            itemName: block.itemName,
            serialId: currentUnit.serialId,
            notes: 'No longer in sheet — review manually'
          })
        }
      }

      for (const importedUnit of serialisedInBlock) {
        const serialKey = importedUnit.serialId!.toLowerCase()
        const existingUnit = allUnits.find(
          (u) => u.serialId && u.serialId.toLowerCase() === serialKey
        )

        if (!existingUnit) {
          await tx.query(
            `INSERT INTO item_units
               (item_id, serial_id, assigned_project_id, status, audit_date, remarks)
             VALUES (?, ?, ?, 'In Use', ?, ?)`,
            [itemId, importedUnit.serialId, projectId, importedUnit.auditDate, importedUnit.remarks]
          )

          unitsAdded++
          details.push({
            type: 'added',
            itemName: block.itemName,
            serialId: importedUnit.serialId,
            notes: 'New unit — created and assigned to this project'
          })
          continue
        }

        if (existingUnit.assignedProjectId !== projectId) {
          const fromProjectRow = existingUnit.assignedProjectId
            ? (await tx.queryOne('SELECT name FROM projects WHERE id = ?', [existingUnit.assignedProjectId]) as { name: string } | null)
            : null

          await tx.query('UPDATE item_units SET assigned_project_id = ? WHERE id = ?', [projectId, existingUnit.id])

          await createTransfer(tx, {
            date: new Date().toISOString().slice(0, 10),
            itemId: existingUnit.itemId,
            serialId: existingUnit.serialId,
            qty: 1,
            fromProjectId: existingUnit.assignedProjectId,
            toProjectId: projectId,
            transferredBy: 'Excel Import',
            authorizedBy: null,
            notes: `Transferred via ${marker.projectName} sheet import`,
            status: 'Recorded'
          })

          transfersCreated++
          details.push({
            type: 'transferred',
            itemName: block.itemName,
            serialId: importedUnit.serialId,
            fromProject: fromProjectRow?.name ?? 'Available',
            toProject: projectName,
            notes: 'Transferred to this project'
          })
          continue
        }

        const setClauses: string[] = []
        const params: (string | number | null)[] = []
        if (importedUnit.auditDate) { setClauses.push('audit_date = ?'); params.push(importedUnit.auditDate) }
        if (importedUnit.remarks)   { setClauses.push('remarks = ?');    params.push(importedUnit.remarks) }

        if (setClauses.length > 0) {
          params.push(existingUnit.id)
          await tx.query(`UPDATE item_units SET ${setClauses.join(', ')} WHERE id = ?`, params)
          unitsUpdated++
          details.push({
            type: 'added',
            itemName: block.itemName,
            serialId: importedUnit.serialId,
            notes: `Updated: ${setClauses.map((c) => c.split(' ')[0]).join(', ')}`
          })
        }
      }

      const hasSerials = serialisedInBlock.length > 0
      if (!hasSerials && block.declaredQty > 0) {
        const currentAnon = currentProjectUnits.filter(
          (u) => u.itemId === itemId && !u.serialId
        )
        const currentQty = currentAnon.length
        const targetQty  = block.declaredQty
        const delta      = targetQty - currentQty

        if (delta > 0) {
          for (let n = 0; n < delta; n++) {
            await tx.query(
              `INSERT INTO item_units
                 (item_id, serial_id, assigned_project_id, status)
               VALUES (?, NULL, ?, 'In Use')`,
              [itemId, projectId]
            )
          }
          unitsAdded += delta
          details.push({
            type: 'added',
            itemName: block.itemName,
            serialId: null,
            notes: `Quantity increased by ${delta} (${currentQty} → ${targetQty})`
          })
        } else if (delta < 0) {
          const toRemove = currentAnon.slice(0, Math.abs(delta))
          for (const u of toRemove) {
            await tx.query('DELETE FROM item_units WHERE id = ?', [u.id])
          }
          unitsRemoved += Math.abs(delta)
          details.push({
            type: 'removed',
            itemName: block.itemName,
            serialId: null,
            notes: `Quantity decreased by ${Math.abs(delta)} (${currentQty} → ${targetQty})`
          })
        }
      }

      await syncInitialStock(tx, itemId)
    }
  })

  return {
    projectId,
    projectName,
    importedAt: marker.exportedAt,
    projectCreated,
    itemsCreated,
    unitsAdded,
    unitsUpdated,
    unitsRemoved,
    transfersCreated,
    details
  }
}
