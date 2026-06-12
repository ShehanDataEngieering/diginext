import type { DatabaseAdapter } from '../adapter'
import type { Handover, HandoverInput, HandoverItem } from '../../../shared/ipc'

interface HandoverRow {
  id: number
  project_id: number
  project_name: string | null
  handover_date: string
  handed_over_by: string | null
  received_by: string | null
  notes: string | null
  signature_ref: string | null
}

interface HandoverItemRow {
  id: number
  handover_id: number
  item_unit_id: number
  serial_id: string | null
  item_name: string | null
  item_category: string | null
  condition: string | null
  action: string | null
  transfer_project_id: number | null
  transfer_project_name: string | null
}

function toHandoverItem(row: HandoverItemRow): HandoverItem {
  return {
    id: Number(row.id),
    handoverId: Number(row.handover_id),
    itemUnitId: Number(row.item_unit_id),
    serialId: row.serial_id,
    itemName: row.item_name,
    itemCategory: row.item_category,
    condition: row.condition,
    action: row.action,
    transferProjectId: row.transfer_project_id ? Number(row.transfer_project_id) : null,
    transferProjectName: row.transfer_project_name
  }
}

function toHandover(row: HandoverRow, items: HandoverItem[]): Handover {
  return {
    id: Number(row.id),
    projectId: Number(row.project_id),
    projectName: row.project_name,
    handoverDate: row.handover_date,
    handedOverBy: row.handed_over_by,
    receivedBy: row.received_by,
    notes: row.notes,
    signatureRef: row.signature_ref,
    items
  }
}

const SELECT_HANDOVER = `
  SELECT h.*, p.name AS project_name
  FROM handovers h
  JOIN projects p ON p.id = h.project_id
`

const SELECT_HANDOVER_ITEMS = `
  SELECT hi.*, u.serial_id, i.name AS item_name, i.category AS item_category, tp.name AS transfer_project_name
  FROM handover_items hi
  JOIN item_units u ON u.id = hi.item_unit_id
  JOIN items i ON i.id = u.item_id
  LEFT JOIN projects tp ON tp.id = hi.transfer_project_id
  WHERE hi.handover_id = ?
`

async function getItemsForHandover(db: DatabaseAdapter, handoverId: number): Promise<HandoverItem[]> {
  const { rows } = await db.query(SELECT_HANDOVER_ITEMS, [handoverId])
  return (rows as unknown as HandoverItemRow[]).map(toHandoverItem)
}

export async function listHandovers(db: DatabaseAdapter): Promise<Handover[]> {
  const { rows } = await db.query(`${SELECT_HANDOVER} ORDER BY h.handover_date DESC, h.id DESC`)
  const handoverRows = rows as unknown as HandoverRow[]
  const handovers: Handover[] = []
  for (const row of handoverRows) {
    const items = await getItemsForHandover(db, row.id)
    handovers.push(toHandover(row, items))
  }
  return handovers
}

export async function getHandoversByProject(db: DatabaseAdapter, projectId: number): Promise<Handover[]> {
  const { rows } = await db.query(
    `${SELECT_HANDOVER} WHERE h.project_id = ? ORDER BY h.handover_date DESC, h.id DESC`,
    [projectId]
  )
  const handoverRows = rows as unknown as HandoverRow[]
  const handovers: Handover[] = []
  for (const row of handoverRows) {
    const items = await getItemsForHandover(db, row.id)
    handovers.push(toHandover(row, items))
  }
  return handovers
}

export async function getHandoverById(db: DatabaseAdapter, id: number): Promise<Handover | null> {
  const row = await db.queryOne(`${SELECT_HANDOVER} WHERE h.id = ?`, [id])
  if (!row) return null
  const items = await getItemsForHandover(db, id)
  return toHandover(row as unknown as HandoverRow, items)
}

export async function createHandover(db: DatabaseAdapter, input: HandoverInput): Promise<Handover> {
  const handoverId = await db.transaction(async (tx) => {
    const result = await tx.query(
      `INSERT INTO handovers (project_id, handover_date, handed_over_by, received_by, notes, signature_ref)
       VALUES (?, ?, ?, ?, ?, ?) RETURNING id`,
      [
        input.projectId,
        input.handoverDate,
        input.handedOverBy,
        input.receivedBy,
        input.notes,
        input.signatureRef
      ]
    )
    const id = Number(result.rows[0].id)

    for (const item of input.items) {
      await tx.query(
        `INSERT INTO handover_items (handover_id, item_unit_id, condition, action, transfer_project_id)
         VALUES (?, ?, ?, ?, ?)`,
        [id, item.itemUnitId, item.condition, item.action, item.transferProjectId]
      )
    }

    return id
  })

  const handover = await getHandoverById(db, handoverId)
  if (!handover) throw new Error(`Handover ${handoverId} not found after creation`)
  return handover
}
