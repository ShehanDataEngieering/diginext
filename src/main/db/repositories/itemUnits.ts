// Data access for `item_units` — the source of truth for "how many of item X
// are at project Y" (see plan). Reads are joined with items/projects so the
// renderer's table can show names directly without extra round-trips.
import type Database from 'better-sqlite3-multiple-ciphers'
import type { ItemUnit, ItemUnitFilter, ItemUnitInput, ItemUnitWithDetails, UnitStatus } from '../../../shared/ipc'

interface ItemUnitRow {
  id: number
  item_id: number
  serial_id: string | null
  assigned_project_id: number | null
  audit_date: string | null
  remarks: string | null
  status: UnitStatus
  photo_evidence_ref: string | null
}

interface ItemUnitWithDetailsRow extends ItemUnitRow {
  item_category: string
  item_name: string
  project_name: string | null
}

function toItemUnit(row: ItemUnitRow): ItemUnit {
  return {
    id: row.id,
    itemId: row.item_id,
    serialId: row.serial_id,
    assignedProjectId: row.assigned_project_id,
    auditDate: row.audit_date,
    remarks: row.remarks,
    status: row.status,
    photoEvidenceRef: row.photo_evidence_ref
  }
}

function toItemUnitWithDetails(row: ItemUnitWithDetailsRow): ItemUnitWithDetails {
  return {
    ...toItemUnit(row),
    itemCategory: row.item_category,
    itemName: row.item_name,
    projectName: row.project_name
  }
}

const SELECT_WITH_DETAILS = `
  SELECT
    u.*,
    i.category AS item_category,
    i.name AS item_name,
    p.name AS project_name
  FROM item_units u
  JOIN items i ON i.id = u.item_id
  LEFT JOIN projects p ON p.id = u.assigned_project_id
`

export function listItemUnits(db: Database.Database, filter?: ItemUnitFilter): ItemUnitWithDetails[] {
  const clauses: string[] = []
  const params: (number | null)[] = []

  if (filter?.itemId !== undefined) {
    clauses.push('u.item_id = ?')
    params.push(filter.itemId)
  }
  if (filter?.projectId !== undefined) {
    if (filter.projectId === null) {
      clauses.push('u.assigned_project_id IS NULL')
    } else {
      clauses.push('u.assigned_project_id = ?')
      params.push(filter.projectId)
    }
  }

  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : ''
  const rows = db
    .prepare(`${SELECT_WITH_DETAILS} ${where} ORDER BY i.category, i.name, u.serial_id`)
    .all(...params) as ItemUnitWithDetailsRow[]
  return rows.map(toItemUnitWithDetails)
}

export function createItemUnit(db: Database.Database, input: ItemUnitInput): ItemUnitWithDetails {
  const result = db
    .prepare(
      `INSERT INTO item_units (item_id, serial_id, assigned_project_id, audit_date, remarks, status, photo_evidence_ref)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.itemId,
      input.serialId,
      input.assignedProjectId,
      input.auditDate,
      input.remarks,
      input.status,
      input.photoEvidenceRef
    )

  const row = db
    .prepare(`${SELECT_WITH_DETAILS} WHERE u.id = ?`)
    .get(result.lastInsertRowid) as ItemUnitWithDetailsRow
  return toItemUnitWithDetails(row)
}

export function updateItemUnit(
  db: Database.Database,
  id: number,
  input: ItemUnitInput
): ItemUnitWithDetails {
  db.prepare(
    `UPDATE item_units
     SET item_id = ?, serial_id = ?, assigned_project_id = ?, audit_date = ?,
         remarks = ?, status = ?, photo_evidence_ref = ?
     WHERE id = ?`
  ).run(
    input.itemId,
    input.serialId,
    input.assignedProjectId,
    input.auditDate,
    input.remarks,
    input.status,
    input.photoEvidenceRef,
    id
  )

  const row = db.prepare(`${SELECT_WITH_DETAILS} WHERE u.id = ?`).get(id) as
    | ItemUnitWithDetailsRow
    | undefined
  if (!row) throw new Error(`Item unit ${id} not found`)
  return toItemUnitWithDetails(row)
}

export function deleteItemUnit(db: Database.Database, id: number): void {
  db.prepare('DELETE FROM item_units WHERE id = ?').run(id)
}
