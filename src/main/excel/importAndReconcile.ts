import type { DatabaseAdapter } from '../db/adapter'
import type { ImportSummary, ImportDetail } from '../../shared/ipc'
import { listItemUnits } from '../db/repositories/itemUnits'
import { createTransfer } from '../db/repositories/transfers'
import { parseImportedSheet } from './parseImportedSheet'

interface ProjectRow { id: number; name: string }

// Normalize a string for fuzzy project/serial matching: fold Unicode accents
// (ä→a, ö→o) and drop every non-alphanumeric character so cosmetic punctuation
// and spacing differences don't block a match.
function normalizeForMatch(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip combining diacritics
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '') // drop spaces, hyphens, slashes: "DN 11" == "DN-11"
}

// Project-name variant that also drops a leading "at" — on-site sheet filenames
// carry the preposition ("At North Copenhagen") that the canonical project name
// ("North Copenhagen") omits.
function normalizeProjectName(s: string): string {
  return normalizeForMatch(s).replace(/^at/, '')
}

async function resolveOrCreateProject(
  db: DatabaseAdapter,
  markerId: number,
  markerName: string
): Promise<{ projectId: number; projectName: string; projectCreated: boolean }> {
  // Try the embedded id first (only meaningful for app-exported sheets where
  // id > 0) — but only trust it when the stored project's name still matches
  // the marker. Ids can drift across DB migrations (e.g. sqlite→postgres), and
  // importing a sheet into the wrong project by a stale id would corrupt both
  // the intended and the unintended project. When the name disagrees, fall
  // through to name-based matching below.
  const byId = markerId > 0
    ? (await db.queryOne('SELECT id, name FROM projects WHERE id = ?', [markerId]) as ProjectRow | null)
    : null

  if (byId && normalizeForMatch(byId.name) === normalizeForMatch(markerName)) {
    return { projectId: byId.id, projectName: byId.name, projectCreated: false }
  }

  // Exact case-insensitive name match.
  const byName = await db.queryOne(
    'SELECT id, name FROM projects WHERE LOWER(name) = LOWER(?)', [markerName]
  ) as ProjectRow | null

  if (byName) return { projectId: byName.id, projectName: byName.name, projectCreated: false }

  // Fuzzy match: normalize both sides (strip accents, drop punctuation/spacing).
  const allProjects = (await db.query('SELECT id, name FROM projects', [])).rows as unknown as ProjectRow[]
  const normalTarget = normalizeForMatch(markerName)
  let fuzzy = allProjects.find((r) => normalizeForMatch(r.name) === normalTarget)

  // Fall back to ignoring a leading "At" ("At North Copenhagen" → "North Copenhagen").
  if (!fuzzy) {
    const projectTarget = normalizeProjectName(markerName)
    fuzzy = allProjects.find((r) => normalizeProjectName(r.name) === projectTarget)
  }

  if (fuzzy) return { projectId: fuzzy.id, projectName: fuzzy.name, projectCreated: false }

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
  // Exact case-insensitive category + name.
  const existing = await db.queryOne(
    'SELECT id, initial_stock FROM items WHERE LOWER(TRIM(category)) = LOWER(TRIM(?)) AND LOWER(TRIM(name)) = LOWER(TRIM(?))',
    [category, name]
  ) as { id: number; initial_stock: number } | null

  if (existing) return { itemId: existing.id, initialStock: existing.initial_stock, created: false }

  // Fall back to matching by item NAME alone. On-site sheets frequently misspell
  // or re-case the category ("Safety related itmes" vs "Safety Related Items"),
  // and keying strictly on category+name would spawn a duplicate item type for
  // every such typo. Item names are effectively unique, so a single normalized-
  // name match is the intended item — adopt it rather than duplicating it. Only
  // create a new item when the name genuinely doesn't exist yet (or is ambiguous).
  const nameKey = normalizeForMatch(name)
  const all = (await db.query('SELECT id, name, initial_stock FROM items', [])).rows as unknown as {
    id: number
    name: string
    initial_stock: number
  }[]
  const byName = all.filter((r) => normalizeForMatch(r.name) === nameKey)
  if (byName.length === 1) {
    return { itemId: byName[0].id, initialStock: byName[0].initial_stock, created: false }
  }

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
  await db.query('UPDATE items SET initial_stock = GREATEST(initial_stock, ?::int) WHERE id = ?', [count, itemId])
}

export async function importAndReconcile(
  db: DatabaseAdapter,
  filePath: string,
  // When set (the handover flow), the sheet MUST reconcile into this project;
  // a sheet that resolves to any other project is rejected. Omitted for the
  // general Projects-page import, where the file's own marker picks the target.
  expectedProjectId?: number,
  // Reconcile-ONLY mode (the handover flow): the import may only copy audit
  // date / remarks onto units ALREADY on this project (matched by serial). It
  // never adds, deletes, transfers, or creates anything — so an imperfect sheet
  // (wrong serial, wrong quantity, typo'd category, foreign serials) can't alter
  // inventory. Structural changes stay explicit: the handover's Action column,
  // or the Item Units / Projects pages.
  reconcileOnly = false
): Promise<ImportSummary | null> {
  const imported = parseImportedSheet(filePath)
  if (!imported) return null

  const { marker, itemBlocks } = imported

  const details: ImportDetail[] = []
  let unitsAdded     = 0
  let unitsUpdated   = 0
  let unitsRemoved   = 0
  let transfersCreated = 0
  let itemsCreated   = 0

  const touchedItemIds = new Set<number>()

  // Resolved inside the transaction so a newly-created project doesn't survive
  // as an orphan if the reconciliation body fails partway.
  let projectId = 0
  let projectName = ''
  let projectCreated = false

  await db.transaction(async (tx) => {
    const resolved = await resolveOrCreateProject(tx, marker.projectId, marker.projectName)
    projectId = resolved.projectId
    projectName = resolved.projectName
    projectCreated = resolved.projectCreated

    // Guard for the handover flow: the sheet must belong to the project being
    // closed out. A stale/mismatched marker (e.g. a Gävle-marked sheet dropped
    // into a North Copenhagen handover) would otherwise reconcile into — and
    // pull units toward — the wrong project. Throwing here rolls back the whole
    // transaction, including any project the resolver just created.
    if (expectedProjectId != null && projectId !== expectedProjectId) {
      const exp = (await tx.queryOne('SELECT name FROM projects WHERE id = ?', [expectedProjectId])) as
        | { name: string }
        | null
      throw new Error(
        `This sheet is for "${projectName}", but the handover is for "${exp?.name ?? 'a different project'}". ` +
          `Import the sheet that matches the project you're handing over.`
      )
    }

    const allUnits = await listItemUnits(tx)

    // ---- Reconcile-ONLY: annotate existing units, change nothing else -------
    if (reconcileOnly) {
      const bySerial = new Map<string, (typeof allUnits)[number]>()
      for (const u of allUnits) if (u.serialId) bySerial.set(normalizeForMatch(u.serialId), u)

      for (const block of itemBlocks) {
        for (const importedUnit of block.units) {
          if (importedUnit.serialId === null) continue // no-serial items: never touched
          const existing = bySerial.get(normalizeForMatch(importedUnit.serialId))
          // Only units already ON this project are annotated; a serial we don't
          // have, or one sitting on another project, is left completely alone.
          if (!existing || existing.assignedProjectId !== projectId) continue

          const setClauses: string[] = []
          const params: (string | number | null)[] = []
          if (importedUnit.auditDate) { setClauses.push('audit_date = ?'); params.push(importedUnit.auditDate) }
          if (importedUnit.remarks) { setClauses.push('remarks = ?'); params.push(importedUnit.remarks) }
          if (setClauses.length === 0) continue

          params.push(existing.id)
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
      return // skip the full add/transfer/delete reconciliation below
    }

    // Importing inventory onto a project means it's live again — a completed
    // site can't legitimately hold deployed units (the dashboard would heal
    // them to "available", contradicting the assignment). Reactivate it.
    await tx.query("UPDATE projects SET status = 'active' WHERE id = ? AND status = 'completed'", [projectId])

    const currentProjectUnits = allUnits.filter((u) => u.assignedProjectId === projectId)

    for (const block of itemBlocks) {
      const { itemId, created } = await resolveOrCreateItem(tx, block.category, block.itemName)
      if (created) itemsCreated++
      touchedItemIds.add(itemId)

      const serialisedInBlock = block.units.filter((u) => u.serialId !== null)
      const importedSerials = new Set(serialisedInBlock.map((u) => normalizeForMatch(u.serialId!)))

      for (const currentUnit of currentProjectUnits) {
        if (!currentUnit.serialId) continue
        if (currentUnit.itemId !== itemId) continue
        if (!importedSerials.has(normalizeForMatch(currentUnit.serialId))) {
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
        const serialKey = normalizeForMatch(importedUnit.serialId!)
        const existingUnit = allUnits.find(
          (u) => u.serialId && normalizeForMatch(u.serialId) === serialKey
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
          // A written-off unit must not be silently reactivated by an import —
          // leave it retired and flag it for manual review.
          if (existingUnit.status === 'Retired-Damaged') {
            details.push({
              type: 'removed',
              itemName: block.itemName,
              serialId: importedUnit.serialId,
              notes: 'In sheet but marked Retired/Damaged in system — skipped, review manually'
            })
            continue
          }

          const fromProjectRow = existingUnit.assignedProjectId
            ? (await tx.queryOne('SELECT name FROM projects WHERE id = ?', [existingUnit.assignedProjectId]) as { name: string } | null)
            : null

          // Set status too, not just the assignment — a unit deployed to a
          // project is In Use, regardless of its prior (e.g. Available) status.
          await tx.query(
            "UPDATE item_units SET assigned_project_id = ?, status = 'In Use' WHERE id = ?",
            [projectId, existingUnit.id]
          )

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
            status: 'Completed'
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
          let removed = 0
          for (const u of currentAnon) {
            if (removed >= Math.abs(delta)) break
            // Skip units referenced in handover_items — deleting them would
            // violate the FK constraint and corrupt the handover record.
            const ref = await tx.queryOne(
              'SELECT 1 FROM handover_items WHERE item_unit_id = ?', [u.id]
            )
            if (ref) continue
            await tx.query('DELETE FROM item_units WHERE id = ?', [u.id])
            removed++
          }
          unitsRemoved += removed
          const actualNew = currentQty - removed
          details.push({
            type: 'removed',
            itemName: block.itemName,
            serialId: null,
            notes: removed === Math.abs(delta)
              ? `Quantity decreased by ${removed} (${currentQty} → ${actualNew})`
              : `Quantity decreased by ${removed} of ${Math.abs(delta)} requested (${currentQty} → ${actualNew}; ${Math.abs(delta) - removed} unit(s) skipped — referenced in a handover)`
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
