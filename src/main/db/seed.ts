// Inserts the parsed Master Inventory workbook into a freshly-migrated,
// empty database. Pure w.r.t. its inputs (workbook already parsed elsewhere)
// so it's straightforward to test against fixtures later.
import type Database from 'better-sqlite3-multiple-ciphers'
import type { ParsedMasterInventory } from '../excel/parseMasterInventory'

export interface SeedSummary {
  projects: number
  items: number
  units: number
  // Serial IDs that appeared more than once in the source data — kept on
  // the first unit encountered, stripped (and noted in remarks) on the rest
  // so the partial-unique index on item_units.serial_id never collides.
  duplicateSerialsResolved: string[]
}

export function seedFromMasterInventory(
  db: Database.Database,
  data: ParsedMasterInventory
): SeedSummary {
  const summary: SeedSummary = { projects: 0, items: 0, units: 0, duplicateSerialsResolved: [] }

  const runSeed = db.transaction(() => {
    const insertProject = db.prepare(
      `INSERT INTO projects (name, location, updated_by, last_updated_date, status)
       VALUES (?, ?, ?, ?, 'active')`
    )
    const projectIdByName = new Map<string, number>()
    for (const project of data.projects) {
      const result = insertProject.run(
        project.name,
        project.location,
        project.updatedBy,
        project.lastUpdatedDate
      )
      projectIdByName.set(project.name, Number(result.lastInsertRowid))
      summary.projects++
    }

    const insertItem = db.prepare(
      `INSERT INTO items (category, name, initial_stock) VALUES (?, ?, ?)`
    )
    // Keyed by the workbook's "No"/"Item No" — only used to join units to
    // their item type below; our schema identifies items by category+name.
    const itemIdByItemNo = new Map<string, number>()
    for (const item of data.items) {
      const result = insertItem.run(item.category, item.name, item.initialStock)
      itemIdByItemNo.set(item.itemNo, Number(result.lastInsertRowid))
      summary.items++
    }

    const insertUnit = db.prepare(
      `INSERT INTO item_units (item_id, serial_id, assigned_project_id, audit_date, remarks, status)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    // The source data has at least one duplicate ("043", used for both a Body
    // Harness and a Lanyard at GVX 03 - Gavle — almost certainly a
    // transcription typo). Our schema treats serial_id as globally unique
    // (it identifies a single physical item), so colliding seed rows would
    // abort the whole import. Rather than halt over what's most likely a
    // data-entry mistake, keep the first occurrence's serial and move the
    // later one into remarks, flagged for the user to reconcile by hand.
    const seenSerials = new Set<string>()
    for (const unit of data.units) {
      const itemId = itemIdByItemNo.get(unit.itemNo)
      if (itemId === undefined) {
        throw new Error(
          `Seed data references item No. ${unit.itemNo}, which wasn't found in Main Inventory`
        )
      }
      const projectId = unit.projectName ? (projectIdByName.get(unit.projectName) ?? null) : null

      let serialId = unit.serialId
      let remarks = unit.remarks
      if (serialId !== null) {
        if (seenSerials.has(serialId)) {
          summary.duplicateSerialsResolved.push(serialId)
          const note = `[seed: duplicate serial "${serialId}" — needs reconciliation]`
          remarks = remarks ? `${remarks} ${note}` : note
          serialId = null
        } else {
          seenSerials.add(serialId)
        }
      }

      insertUnit.run(itemId, serialId, projectId, unit.auditDate, remarks, unit.status)
      summary.units++
    }
  })

  runSeed()
  return summary
}
