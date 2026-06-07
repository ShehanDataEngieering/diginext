// Data access for the `items` table (the catalog of item *types* — see
// item_units for individually tracked physical units).
import type Database from 'better-sqlite3-multiple-ciphers'
import type { Item, ItemInput } from '../../../shared/ipc'

interface ItemRow {
  id: number
  category: string
  name: string
  initial_stock: number
}

function toItem(row: ItemRow): Item {
  return { id: row.id, category: row.category, name: row.name, initialStock: row.initial_stock }
}

export function listItems(db: Database.Database): Item[] {
  const rows = db.prepare('SELECT * FROM items ORDER BY category, name').all() as ItemRow[]
  return rows.map(toItem)
}

export function createItem(db: Database.Database, input: ItemInput): Item {
  const result = db
    .prepare('INSERT INTO items (category, name, initial_stock) VALUES (?, ?, ?)')
    .run(input.category, input.name, input.initialStock)

  const row = db.prepare('SELECT * FROM items WHERE id = ?').get(result.lastInsertRowid) as ItemRow
  return toItem(row)
}

export function updateItem(db: Database.Database, id: number, input: ItemInput): Item {
  db.prepare('UPDATE items SET category = ?, name = ?, initial_stock = ? WHERE id = ?').run(
    input.category,
    input.name,
    input.initialStock,
    id
  )

  const row = db.prepare('SELECT * FROM items WHERE id = ?').get(id) as ItemRow | undefined
  if (!row) throw new Error(`Item ${id} not found`)
  return toItem(row)
}

// Deleting an item type only makes sense when no physical units of it exist
// (item_units.item_id is ON DELETE RESTRICT) — SQLite will throw a foreign
// key constraint error here, which the IPC layer surfaces to the renderer as
// a clear "remove its units first" message rather than silently cascading
// and losing unit history.
export function deleteItem(db: Database.Database, id: number): void {
  db.prepare('DELETE FROM items WHERE id = ?').run(id)
}
