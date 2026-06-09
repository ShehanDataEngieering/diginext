import type Database from 'better-sqlite3-multiple-ciphers'
import type { ImportSummary, ImportDetail } from '../../shared/ipc'
import { listItemUnits } from '../db/repositories/itemUnits'
import { createTransfer } from '../db/repositories/transfers'
import { parseImportedSheet, type ImportedUnit } from './parseImportedSheet'

interface ProjectRow {
  id: number
  name: string
}

interface ItemRow {
  id: number
}

/**
 * Resolves which project this import targets.
 *
 * Priority:
 *   1. Exact match on projectId from the hidden meta sheet (most reliable —
 *      the file was exported from this exact project).
 *   2. Name match — handles re-seeded DBs or manually created projects.
 *   3. Neither found → create a new active project from the marker data.
 */
function resolveOrCreateProject(
  db: Database.Database,
  markerId: number,
  markerName: string
): { projectId: number; projectName: string; projectCreated: boolean } {
  // 1. Match by ID
  let row = db
    .prepare('SELECT id, name FROM projects WHERE id = ?')
    .get(markerId) as ProjectRow | undefined

  // 2. Fallback: match by name (case-insensitive)
  if (!row) {
    row = db
      .prepare('SELECT id, name FROM projects WHERE LOWER(name) = LOWER(?)')
      .get(markerName) as ProjectRow | undefined
  }

  if (row) return { projectId: row.id, projectName: row.name, projectCreated: false }

  // 3. Create new project
  const result = db
    .prepare("INSERT INTO projects (name, status) VALUES (?, 'active')")
    .run(markerName)

  return {
    projectId: result.lastInsertRowid as number,
    projectName: markerName,
    projectCreated: true
  }
}

/**
 * Finds an item by category + name (case-insensitive).
 * Creates it if it doesn't exist — initial_stock starts at 0; the import
 * units being inserted immediately after will form the real count.
 */
function resolveOrCreateItem(
  db: Database.Database,
  category: string,
  name: string
): { itemId: number; created: boolean } {
  const existing = db
    .prepare(
      'SELECT id FROM items WHERE LOWER(category) = LOWER(?) AND LOWER(name) = LOWER(?)'
    )
    .get(category, name) as ItemRow | undefined

  if (existing) return { itemId: existing.id, created: false }

  const result = db
    .prepare('INSERT INTO items (category, name, initial_stock) VALUES (?, ?, 0)')
    .run(category, name)

  return { itemId: result.lastInsertRowid as number, created: true }
}

/**
 * Main reconciliation entry point.
 *
 * Reads the filled-in export sheet at `filePath`, identifies its project via
 * the hidden `_diginext_meta` marker, then applies these rules per unit:
 *
 *   New serial (never in DB)           → create item type if needed, create unit
 *   Serial at a different project      → transfer it here, log in transfers table
 *   Serial already at this project     → update audit date + remarks if provided
 *   Serial was here, missing in sheet  → flag as removed (NOT auto-deleted)
 *
 * Everything runs in a single transaction — the DB is never left half-imported.
 */
export function importAndReconcile(
  db: Database.Database,
  filePath: string
): ImportSummary | null {
  const imported = parseImportedSheet(filePath)
  if (!imported) return null

  const { marker, units: importedUnits } = imported

  // Resolve (or create) the project this sheet belongs to
  const { projectId, projectName, projectCreated } = resolveOrCreateProject(
    db,
    marker.projectId,
    marker.projectName
  )

  // Snapshot all units before we touch anything — used for both the
  // transfer lookups and the "missing from sheet" pass.
  const allUnits = listItemUnits(db)
  const currentProjectUnits = allUnits.filter((u) => u.assignedProjectId === projectId)

  // Index imported sheet by lower-cased serial for O(1) lookups.
  // Quantity-only rows (no serial) are skipped for now — reconciling
  // anonymous units requires a qty-diff pass deferred to a later milestone.
  const importedBySerial = new Map<string, ImportedUnit>()
  for (const unit of importedUnits) {
    if (unit.serialId) {
      importedBySerial.set(unit.serialId.toLowerCase(), unit)
    }
  }

  const details: ImportDetail[] = []
  let unitsAdded = 0
  let unitsUpdated = 0
  let unitsRemoved = 0
  let transfersCreated = 0
  let itemsCreated = 0

  const runReconciliation = db.transaction(() => {
    // ── Pass 1: units currently at this project but absent from sheet ──────
    // Flag them for manual review; do NOT delete or reassign automatically.
    for (const currentUnit of currentProjectUnits) {
      if (!currentUnit.serialId) continue
      if (!importedBySerial.has(currentUnit.serialId.toLowerCase())) {
        unitsRemoved++
        details.push({
          type: 'removed',
          itemName: currentUnit.itemName,
          serialId: currentUnit.serialId,
          notes: 'No longer in sheet — review manually'
        })
      }
    }

    // ── Pass 2: every serialised unit in the import sheet ──────────────────
    for (const [serialKey, importedUnit] of importedBySerial) {
      const existingUnit = allUnits.find(
        (u) => u.serialId && u.serialId.toLowerCase() === serialKey
      )

      // A ── New serial, not in DB at all → create item + unit ────────────
      if (!existingUnit) {
        const { itemId, created } = resolveOrCreateItem(
          db,
          importedUnit.category,
          importedUnit.itemName
        )
        if (created) itemsCreated++

        db.prepare(
          `INSERT INTO item_units
             (item_id, serial_id, assigned_project_id, status, audit_date, remarks)
           VALUES (?, ?, ?, 'In Use', ?, ?)`
        ).run(
          itemId,
          importedUnit.serialId,
          projectId,
          importedUnit.auditDate,
          importedUnit.remarks
        )

        unitsAdded++
        details.push({
          type: 'added',
          itemName: importedUnit.itemName,
          serialId: importedUnit.serialId,
          notes: 'New unit — created and assigned to this project'
        })
        continue
      }

      // B ── Serial exists but at a different project → transfer ──────────
      if (existingUnit.assignedProjectId !== projectId) {
        const fromProjectRow = existingUnit.assignedProjectId
          ? (db
              .prepare('SELECT name FROM projects WHERE id = ?')
              .get(existingUnit.assignedProjectId) as { name: string } | undefined)
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
          itemName: importedUnit.itemName,
          serialId: importedUnit.serialId,
          fromProject: fromProjectRow?.name ?? 'Available',
          toProject: projectName,
          notes: 'Transferred to this project'
        })
        continue
      }

      // C ── Serial already at this project → update audit info ───────────
      // Only overwrite a field when the sheet provides a non-empty value,
      // so a blank cell never wipes data the site lead left intact.
      const setClauses: string[] = []
      const params: (string | number | null)[] = []

      if (importedUnit.auditDate) {
        setClauses.push('audit_date = ?')
        params.push(importedUnit.auditDate)
      }
      if (importedUnit.remarks) {
        setClauses.push('remarks = ?')
        params.push(importedUnit.remarks)
      }

      if (setClauses.length > 0) {
        params.push(existingUnit.id)
        db.prepare(`UPDATE item_units SET ${setClauses.join(', ')} WHERE id = ?`).run(...params)

        unitsUpdated++
        details.push({
          type: 'added', // 'added' renders with a neutral style in the UI
          itemName: importedUnit.itemName,
          serialId: importedUnit.serialId,
          notes: `Updated: ${setClauses.map((c) => c.split(' ')[0]).join(', ')}`
        })
      }
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
