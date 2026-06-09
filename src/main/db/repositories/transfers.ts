import type Database from 'better-sqlite3-multiple-ciphers'
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

export function createTransfer(db: Database.Database, input: TransferInput): Transfer {
  const result = db
    .prepare(
      `INSERT INTO transfers (date, item_id, serial_id, qty, from_project_id, to_project_id, transferred_by, authorized_by, notes, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
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
    )

  const row = db.prepare('SELECT * FROM transfers WHERE id = ?').get(result.lastInsertRowid) as TransferRow
  return toTransfer(row)
}

export function listTransfers(db: Database.Database): Transfer[] {
  const rows = db.prepare('SELECT * FROM transfers ORDER BY date DESC, id DESC').all() as TransferRow[]
  return rows.map(toTransfer)
}

export function getTransfersByProject(db: Database.Database, projectId: number): Transfer[] {
  const rows = db
    .prepare(
      'SELECT * FROM transfers WHERE from_project_id = ? OR to_project_id = ? ORDER BY date DESC, id DESC'
    )
    .all(projectId, projectId) as TransferRow[]
  return rows.map(toTransfer)
}
