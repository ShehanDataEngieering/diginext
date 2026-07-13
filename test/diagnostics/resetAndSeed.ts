/**
 * DESTRUCTIVE. Backs up every table to a JSON file OUTSIDE the repo, then (in
 * one transaction) truncates the inventory + history tables and re-seeds from
 * the given Master Inventory workbook. Restores the clean pre-handover state.
 *
 * Run: npx tsx test/diagnostics/resetAndSeed.ts "<path-to-xlsx>"
 */
import 'dotenv/config'
import { writeFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { readFile } from 'xlsx'
import { PostgresAdapter } from '../../src/main/db/postgresAdapter'
import { parseMasterInventory } from '../../src/main/excel/parseMasterInventory'
import { seedFromMasterInventory } from '../../src/main/db/seed'

const TABLES = ['projects', 'items', 'item_units', 'transfers', 'handovers', 'handover_items', 'photo_log']

async function main(): Promise<void> {
  const xlsxPath = process.argv[2]
  if (!xlsxPath) throw new Error('Pass the workbook path as the first argument.')
  const connectionString = process.env.POSTGRES_CONNECTION_STRING
  if (!connectionString) throw new Error('POSTGRES_CONNECTION_STRING not set in .env')

  const parsed = parseMasterInventory(readFile(xlsxPath))
  console.log(`Parsed master: ${parsed.projects.length} projects, ${parsed.items.length} items, ${parsed.units.length} units.`)

  const db = new PostgresAdapter(connectionString)

  const backup: Record<string, unknown[]> = {}
  for (const table of TABLES) backup[table] = (await db.query(`SELECT * FROM ${table} ORDER BY id`)).rows
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const backupPath = join(homedir(), 'Documents', `diginext-db-backup-${stamp}.json`)
  writeFileSync(backupPath, JSON.stringify(backup, null, 2), 'utf8')
  const totalRows = Object.values(backup).reduce((n, r) => n + r.length, 0)
  console.log(`Backed up ${totalRows} rows → ${backupPath}`)

  const summary = await db.transaction(async (tx) => {
    await tx.exec(`TRUNCATE ${TABLES.join(', ')} RESTART IDENTITY CASCADE`)
    return seedFromMasterInventory(tx, parsed)
  })
  console.log(`\n✓ Re-seeded ${summary.projects} projects, ${summary.items} items, ${summary.units} units.`)

  console.log('\nPost-reset counts:')
  for (const table of TABLES) {
    const r = await db.queryOne(`SELECT COUNT(*)::int AS n FROM ${table}`)
    console.log(`  ${table.padEnd(16)} ${(r as { n: number }).n}`)
  }
  const proj = await db.query(`SELECT name, status FROM projects ORDER BY id`)
  console.log('\nProjects:')
  for (const r of proj.rows) console.log(`  ${r.name} (${r.status})`)
  await db.close?.()
}

main().catch((err) => { console.error('\nReset failed:', err); process.exit(1) })
