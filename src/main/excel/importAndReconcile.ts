import type Database from 'better-sqlite3-multiple-ciphers'
import type { ImportSummary, ImportDetail } from '../../shared/ipc'
import { listItemUnits } from '../db/repositories/itemUnits'
import { createTransfer } from '../db/repositories/transfers'
import { parseImportedSheet } from './parseImportedSheet'

interface ProjectRow { id: number; name: string }

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Resolve the target project: match by ID → match by name → create new.
 */
function resolveOrCreateProject(
  db: Database.Database,
  markerId: number,
  markerName: string
): { projectId: number; projectName: string; projectCreated: boolean } {
  let row =
    (db.prepare('SELECT id, name FROM projects WHERE id = ?').get(markerId) as ProjectRow | undefined) ??
    (db.prepare('SELECT id, name FROM projects WHERE LOWER(name) = LOWER(?)').get(markerName) as ProjectRow | undefined)

  if (row) return { projectId: row.id, projectName: row.name, projectCreated: false }

  const result = db.prepare("INSERT INTO projects (name, status) VALUES (?, 'active')").run(markerName)
  return { projectId: result.lastInsertRowid as number, projectName: markerName, projectCreated: true }
}

/**
 * Resolve the item type: match by category + name (case-insensitive) → create new.
 * Returns the item id, current initial_stock, and whether it was just created.
 */
function resolveOrCreateItem(
  db: Database.Database,
  category: string,
  name: string
): { itemId: number; initialStock: number; created: boolean } {
  const existing = db
    .prepare('SELECT id, initial_stock FROM items WHERE LOWER(category) = LOWER(?) AND LOWER(name) = LOWER(?)')
    .get(category, name) as { id: number; initial_stock: number } | undefined

  if (existing) return { itemId: existing.id, initialStock: existing.initial_stock, created: false }

  const result = db.prepare('INSERT INTO items (category, name, initial_stock) VALUES (?, ?, 0)').run(category, name)
  return { itemId: result.lastInsertRowid as number, initialStock: 0, created: true }
}

/**
 * After all inserts/deletes, recalculate initial_stock for an item as the
 * total number of units ever created for it (all projects + available).
 * initial_stock is "total ever purchased", so it only ever increases.
 */
function syncInitialStock(db: Database.Database, itemId: number): void {
  const { count } = db
    .prepare('SELECT COUNT(*) as count FROM item_units WHERE item_id = ?')
    .get(itemId) as { count: number }

  db.prepare('UPDATE items SET initial_stock = MAX(initial_stock, ?) WHERE id = ?').run(count, itemId)
}

// ---------------------------------------------------------------------------
// Main reconciliation function
// ---------------------------------------------------------------------------

/**
 * Reads the filled-in export sheet at `filePath`, identifies its project via
 * the hidden `_diginext_meta` marker, and automatically reconciles every change:
 *
 *   Serialised units
 *   ├─ New serial (never in DB)          → create item type if needed, create unit
 *   ├─ Serial at a different project     → transfer it here, log in transfers
 *   ├─ Serial already at this project    → update audit date + remarks
 *   └─ Serial was here, gone from sheet  → flag for manual review (not deleted)
 *
 *   Quantity-only units (no serial)
 *   ├─ Sheet qty > DB count              → create extra anonymous units
 *   └─ Sheet qty < DB count              → remove excess anonymous units
 *
 *   After all changes:
 *   └─ initial_stock on each touched item updated to reflect true total
 *
 * Everything runs in one transaction — the DB is never left half-imported.
 */
export function importAndReconcile(
  db: Database.Database,
  filePath: string
): ImportSummary | null {
  const imported = parseImportedSheet(filePath)
  if (!imported) return null

  const { marker, itemBlocks } = imported

  const { projectId, projectName, projectCreated } = resolveOrCreateProject(
    db,
    marker.projectId,
    marker.projectName
  )

  // Snapshot every unit before touching anything
  const allUnits = listItemUnits(db)
  const currentProjectUnits = allUnits.filter((u) => u.assignedProjectId === projectId)

  const details: ImportDetail[] = []
  let unitsAdded     = 0
  let unitsUpdated   = 0
  let unitsRemoved   = 0
  let transfersCreated = 0
  let itemsCreated   = 0

  // Track which item IDs we touched so we can sync initial_stock at the end
  const touchedItemIds = new Set<number>()

  const runReconciliation = db.transaction(() => {
    for (const block of itemBlocks) {
      const { itemId, created } = resolveOrCreateItem(db, block.category, block.itemName)
      if (created) itemsCreated++
      touchedItemIds.add(itemId)

      // ── Serialised units in this block ──────────────────────────────────
      const serialisedInBlock = block.units.filter((u) => u.serialId !== null)

      // Build a set of all serials declared in the sheet (lower-cased)
      const importedSerials = new Set(serialisedInBlock.map((u) => u.serialId!.toLowerCase()))

      // Pass A: serials currently at this project that are missing from sheet
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

      // Pass B: process each serial in the sheet
      for (const importedUnit of serialisedInBlock) {
        const serialKey = importedUnit.serialId!.toLowerCase()
        const existingUnit = allUnits.find(
          (u) => u.serialId && u.serialId.toLowerCase() === serialKey
        )

        // A: brand-new serial ──────────────────────────────────────────────
        if (!existingUnit) {
          db.prepare(
            `INSERT INTO item_units
               (item_id, serial_id, assigned_project_id, status, audit_date, remarks)
             VALUES (?, ?, ?, 'In Use', ?, ?)`
          ).run(itemId, importedUnit.serialId, projectId, importedUnit.auditDate, importedUnit.remarks)

          unitsAdded++
          details.push({
            type: 'added',
            itemName: block.itemName,
            serialId: importedUnit.serialId,
            notes: 'New unit — created and assigned to this project'
          })
          continue
        }

        // B: serial exists but at a different project → transfer ───────────
        if (existingUnit.assignedProjectId !== projectId) {
          const fromProjectRow = existingUnit.assignedProjectId
            ? (db.prepare('SELECT name FROM projects WHERE id = ?').get(existingUnit.assignedProjectId) as { name: string } | undefined)
            : null

          db.prepare('UPDATE item_units SET assigned_project_id = ? WHERE id = ?').run(projectId, existingUnit.id)

          createTransfer(db, {
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

        // C: already at this project → update audit info if provided ───────
        const setClauses: string[] = []
        const params: (string | number | null)[] = []
        if (importedUnit.auditDate) { setClauses.push('audit_date = ?'); params.push(importedUnit.auditDate) }
        if (importedUnit.remarks)   { setClauses.push('remarks = ?');    params.push(importedUnit.remarks) }

        if (setClauses.length > 0) {
          params.push(existingUnit.id)
          db.prepare(`UPDATE item_units SET ${setClauses.join(', ')} WHERE id = ?`).run(...params)
          unitsUpdated++
          details.push({
            type: 'added',
            itemName: block.itemName,
            serialId: importedUnit.serialId,
            notes: `Updated: ${setClauses.map((c) => c.split(' ')[0]).join(', ')}`
          })
        }
      }

      // ── Quantity-only units in this block ────────────────────────────────
      // Use declaredQty from the Quantity column (column E) as the
      // authoritative count for this item at this project. Serial-tracked
      // items are handled above; here we only act when the block has NO
      // serials at all (pure quantity items) OR when declaredQty > 0 and
      // there are no serialised rows.
      const hasSerials = serialisedInBlock.length > 0
      if (!hasSerials && block.declaredQty > 0) {
        // Count how many anonymous units are currently at this project
        const currentAnon = currentProjectUnits.filter(
          (u) => u.itemId === itemId && !u.serialId
        )
        const currentQty = currentAnon.length
        const targetQty  = block.declaredQty
        const delta      = targetQty - currentQty

        if (delta > 0) {
          // Create extra anonymous units to match the declared quantity
          for (let n = 0; n < delta; n++) {
            db.prepare(
              `INSERT INTO item_units
                 (item_id, serial_id, assigned_project_id, status)
               VALUES (?, NULL, ?, 'In Use')`
            ).run(itemId, projectId)
          }
          unitsAdded += delta
          details.push({
            type: 'added',
            itemName: block.itemName,
            serialId: null,
            notes: `Quantity increased by ${delta} (${currentQty} → ${targetQty})`
          })
        } else if (delta < 0) {
          // Remove excess anonymous units (oldest first by id)
          const toRemove = currentAnon.slice(0, Math.abs(delta))
          for (const u of toRemove) {
            db.prepare('DELETE FROM item_units WHERE id = ?').run(u.id)
          }
          unitsRemoved += Math.abs(delta)
          details.push({
            type: 'removed',
            itemName: block.itemName,
            serialId: null,
            notes: `Quantity decreased by ${Math.abs(delta)} (${currentQty} → ${targetQty})`
          })
        }
        // If delta === 0, nothing to do — count is already correct
      }

      // ── Sync initial_stock to reflect true total count ───────────────────
      syncInitialStock(db, itemId)
    }
  })

  runReconciliation()

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
