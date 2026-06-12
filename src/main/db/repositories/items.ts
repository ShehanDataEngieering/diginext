import type { DatabaseAdapter } from '../adapter'
import type { Item, ItemInput } from '../../../shared/ipc'

interface ItemRow {
  id: number
  category: string
  name: string
  initial_stock: number
}

function toItem(row: ItemRow): Item {
  return { id: Number(row.id), category: row.category, name: row.name, initialStock: Number(row.initial_stock) }
}

export async function listItems(db: DatabaseAdapter): Promise<Item[]> {
  const { rows } = await db.query('SELECT * FROM items ORDER BY category, name')
  return (rows as unknown as ItemRow[]).map(toItem)
}

export async function createItem(db: DatabaseAdapter, input: ItemInput): Promise<Item> {
  const result = await db.query(
    'INSERT INTO items (category, name, initial_stock) VALUES (?, ?, ?) RETURNING *',
    [input.category, input.name, input.initialStock]
  )
  return toItem(result.rows[0] as unknown as ItemRow)
}

export async function updateItem(db: DatabaseAdapter, id: number, input: ItemInput): Promise<Item> {
  await db.query(
    'UPDATE items SET category = ?, name = ?, initial_stock = ? WHERE id = ?',
    [input.category, input.name, input.initialStock, id]
  )
  const row = await db.queryOne('SELECT * FROM items WHERE id = ?', [id])
  if (!row) throw new Error(`Item ${id} not found`)
  return toItem(row as unknown as ItemRow)
}

export async function deleteItem(db: DatabaseAdapter, id: number): Promise<void> {
  await db.query('DELETE FROM items WHERE id = ?', [id])
}
