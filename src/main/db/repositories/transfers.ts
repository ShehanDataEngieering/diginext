import type { DatabaseAdapter } from '../adapter'
import type { Transfer, TransferInput } from '../../../shared/ipc'

interface TransferRow {
  id: number
  date: string
  item_id: number
  serial_id: string | null
  qty: number
  from_project_id: number | null
  to_project_id: number | null
  transferred_by: string | null
  authorized_by: string | null
  notes: string | null
  status: string
}

function toTransfer(row: TransferRow): Transfer {
  return {
    id: row.id,
    date: row.date,
    itemId: row.item_id,
    serialId: row.serial_id,
    qty: row.qty,
    fromProjectId: row.from_project_id,
    toProjectId: row.to_project_id,
    transferredBy: row.transferred_by,
    authorizedBy: row.authorized_by,
    notes: row.notes,
    status: row.status
  }
}

export async function createTransfer(db: DatabaseAdapter, input: TransferInput): Promise<Transfer> {
  const result = await db.query(
    `INSERT INTO transfers (date, item_id, serial_id, qty, from_project_id, to_project_id, transferred_by, authorized_by, notes, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
    [
      input.date,
      input.itemId,
      input.serialId,
      input.qty,
      input.fromProjectId,
      input.toProjectId,
      input.transferredBy,
      input.authorizedBy,
      input.notes,
      input.status ?? 'Recorded'
    ]
  )
  return toTransfer(result.rows[0] as unknown as TransferRow)
}

export async function listTransfers(db: DatabaseAdapter): Promise<Transfer[]> {
  const { rows } = await db.query('SELECT * FROM transfers ORDER BY date DESC, id DESC')
  return (rows as unknown as TransferRow[]).map(toTransfer)
}

export async function getTransfersByProject(db: DatabaseAdapter, projectId: number): Promise<Transfer[]> {
  const { rows } = await db.query(
    'SELECT * FROM transfers WHERE from_project_id = ? OR to_project_id = ? ORDER BY date DESC, id DESC',
    [projectId, projectId]
  )
  return (rows as unknown as TransferRow[]).map(toTransfer)
}
