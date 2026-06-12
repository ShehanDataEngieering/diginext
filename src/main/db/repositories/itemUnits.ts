import type { DatabaseAdapter } from '../adapter'
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
    id: Number(row.id),
    itemId: Number(row.item_id),
    serialId: row.serial_id,
    assignedProjectId: row.assigned_project_id ? Number(row.assigned_project_id) : null,
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

export async function getItemUnitById(db: DatabaseAdapter, id: number): Promise<ItemUnitWithDetails | null> {
  const row = await db.queryOne(`${SELECT_WITH_DETAILS} WHERE u.id = ?`, [id])
  return row ? toItemUnitWithDetails(row as unknown as ItemUnitWithDetailsRow) : null
}

export async function listItemUnits(db: DatabaseAdapter, filter?: ItemUnitFilter): Promise<ItemUnitWithDetails[]> {
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
  const { rows } = await db.query(
    `${SELECT_WITH_DETAILS} ${where} ORDER BY i.category, i.name, u.serial_id`,
    params
  )
  return (rows as unknown as ItemUnitWithDetailsRow[]).map(toItemUnitWithDetails)
}

export async function createItemUnit(db: DatabaseAdapter, input: ItemUnitInput): Promise<ItemUnitWithDetails> {
  const result = await db.query(
    `INSERT INTO item_units (item_id, serial_id, assigned_project_id, audit_date, remarks, status, photo_evidence_ref)
     VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    [
      input.itemId,
      input.serialId,
      input.assignedProjectId,
      input.auditDate,
      input.remarks,
      input.status,
      input.photoEvidenceRef
    ]
  )
  const row = await db.queryOne(
    `${SELECT_WITH_DETAILS} WHERE u.id = ?`,
    [result.lastInsertRowid]
  )
  return toItemUnitWithDetails(row as unknown as ItemUnitWithDetailsRow)
}

export async function updateItemUnit(
  db: DatabaseAdapter,
  id: number,
  input: ItemUnitInput
): Promise<ItemUnitWithDetails> {
  await db.query(
    `UPDATE item_units
     SET item_id = ?, serial_id = ?, assigned_project_id = ?, audit_date = ?,
         remarks = ?, status = ?, photo_evidence_ref = ?
     WHERE id = ?`,
    [
      input.itemId,
      input.serialId,
      input.assignedProjectId,
      input.auditDate,
      input.remarks,
      input.status,
      input.photoEvidenceRef,
      id
    ]
  )
  const row = await db.queryOne(`${SELECT_WITH_DETAILS} WHERE u.id = ?`, [id])
  if (!row) throw new Error(`Item unit ${id} not found`)
  return toItemUnitWithDetails(row as unknown as ItemUnitWithDetailsRow)
}

export async function deleteItemUnit(db: DatabaseAdapter, id: number): Promise<void> {
  await db.query('DELETE FROM item_units WHERE id = ?', [id])
}
