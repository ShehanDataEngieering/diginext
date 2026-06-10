import type { DatabaseAdapter } from './adapter'
import type { ParsedMasterInventory } from '../excel/parseMasterInventory'

export interface SeedSummary {
  projects: number
  items: number
  units: number
  duplicateSerialsResolved: string[]
}

export async function seedFromMasterInventory(
  db: DatabaseAdapter,
  data: ParsedMasterInventory
): Promise<SeedSummary> {
  const summary: SeedSummary = { projects: 0, items: 0, units: 0, duplicateSerialsResolved: [] }

  await db.transaction(async (tx) => {
    const projectIdByName = new Map<string, number>()
    for (const project of data.projects) {
      const result = await tx.query(
        `INSERT INTO projects (name, location, updated_by, last_updated_date, status)
         VALUES (?, ?, ?, ?, 'active') RETURNING id`,
        [project.name, project.location, project.updatedBy, project.lastUpdatedDate]
      )
      projectIdByName.set(project.name, result.lastInsertRowid)
      summary.projects++
    }

    const itemIdByItemNo = new Map<string, number>()
    for (const item of data.items) {
      const result = await tx.query(
        `INSERT INTO items (category, name, initial_stock) VALUES (?, ?, ?) RETURNING id`,
        [item.category, item.name, item.initialStock]
      )
      itemIdByItemNo.set(item.itemNo, result.lastInsertRowid)
      summary.items++
    }

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

      await tx.query(
        `INSERT INTO item_units (item_id, serial_id, assigned_project_id, audit_date, remarks, status)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [itemId, serialId, projectId, unit.auditDate, remarks, unit.status]
      )
      summary.units++
    }
  })

  return summary
}
