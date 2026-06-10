import { existsSync } from 'fs'
import { readFile } from 'xlsx'
import type { DatabaseAdapter } from './adapter'
import { parseMasterInventory } from '../excel/parseMasterInventory'
import { seedFromMasterInventory } from './seed'

export async function maybeSeedFromMasterInventory(db: DatabaseAdapter): Promise<void> {
  const path = process.env.SEED_XLSX_PATH
  if (!path) return

  const row = await db.queryOne('SELECT COUNT(*) AS count FROM items')
  const count = (row?.count as number) ?? 0
  if (count > 0) return

  if (!existsSync(path)) {
    console.warn(
      `[seed] SEED_XLSX_PATH is set to "${path}" but that file doesn't exist — skipping seed.`
    )
    return
  }

  console.log(`[seed] Database is empty — importing seed data from "${path}"…`)
  const workbook = readFile(path)
  const data = parseMasterInventory(workbook)
  const summary = await seedFromMasterInventory(db, data)

  console.log(
    `[seed] Imported ${summary.projects} projects, ${summary.items} items, ${summary.units} item units.`
  )
  if (summary.duplicateSerialsResolved.length > 0) {
    console.warn(
      '[seed] Found duplicate serial IDs in the source workbook (kept the first occurrence, ' +
        `flagged the rest in remarks for manual review): ${summary.duplicateSerialsResolved.join(', ')}`
    )
  }
}
