// One-time seed trigger, run at startup. Imports the existing
// "Master_Inventory final.xlsx" into a brand-new database so the app starts
// with real data instead of empty tables — see Milestone 4 in the plan.
//
// Deliberately NOT a UI feature: this is meant to run exactly once, against
// a workbook path you point at via SEED_XLSX_PATH in .env. It's gated on the
// `items` table being empty, so once real data exists (whether from this seed
// or from normal use) it never runs again — re-running it would duplicate
// everything, since seedFromMasterInventory always inserts fresh rows.
import { existsSync } from 'fs'
import { readFile } from 'xlsx'
import type Database from 'better-sqlite3-multiple-ciphers'
import { parseMasterInventory } from '../excel/parseMasterInventory'
import { seedFromMasterInventory } from './seed'

export function maybeSeedFromMasterInventory(db: Database.Database): void {
  const path = process.env.SEED_XLSX_PATH
  if (!path) return

  const { count } = db.prepare('SELECT COUNT(*) AS count FROM items').get() as { count: number }
  if (count > 0) return // already has data — never overwrite or duplicate

  if (!existsSync(path)) {
    console.warn(
      `[seed] SEED_XLSX_PATH is set to "${path}" but that file doesn't exist — skipping seed.`
    )
    return
  }

  console.log(`[seed] Database is empty — importing seed data from "${path}"…`)
  const workbook = readFile(path)
  const data = parseMasterInventory(workbook)
  const summary = seedFromMasterInventory(db, data)

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
