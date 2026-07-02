/**
 * Integration test for the handover-import safety fixes:
 *  1. A sheet whose project doesn't match the handover's project is REJECTED
 *     (expectedProjectId guard) and changes nothing.
 *  2. A category typo/miscasing does NOT spawn a duplicate item type — the
 *     importer matches the item by name instead.
 *
 * Runs the REAL importAndReconcile against an isolated test schema, with a hard
 * current_schema() guard so it can never touch production.
 *
 * Run: npx tsx test/integration/importGuards.ts
 */
import 'dotenv/config'
import { tmpdir } from 'os'
import { join } from 'path'
import { utils, writeFile } from 'xlsx'
import { PostgresAdapter } from '../../src/main/db/postgresAdapter'
import { applySchema } from '../../src/main/db/schema'
import { createProject } from '../../src/main/db/repositories/projects'
import { createItem } from '../../src/main/db/repositories/items'
import { createItemUnit, getItemUnitById } from '../../src/main/db/repositories/itemUnits'
import { importAndReconcile } from '../../src/main/excel/importAndReconcile'

const TEST_SCHEMA = 'diginext_test_import'

let passed = 0
let failed = 0
const failures: string[] = []
function check(label: string, cond: boolean, detail?: string): void {
  if (cond) { passed++; console.log(`  \x1b[32m✓\x1b[0m ${label}`) }
  else { failed++; failures.push(label + (detail ? ` — ${detail}` : '')); console.log(`  \x1b[31m✗ ${label}\x1b[0m${detail ? ` — ${detail}` : ''}`) }
}
function eq(label: string, actual: unknown, expected: unknown): void {
  check(label, actual === expected, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
}
async function expectThrow(label: string, fn: () => Promise<unknown>): Promise<void> {
  try { await fn(); check(label, false, 'expected an error') } catch { check(label, true) }
}

// Builds a hand-maintained-style sheet (leading blank column A, header on row
// 10) with a single item block. Project is derived from the file name.
function buildSheet(fileName: string, category: string, itemName: string, serials: string[]): string {
  const aoa: string[][] = []
  for (let i = 0; i < 9; i++) aoa.push([''])
  aoa.push(['', 'Category', 'Item No', 'Item Name', 'Quantity', 'Serial Number/s', 'Initial-Photo Evidence', 'Initial Audit Date', 'Remarks'])
  aoa.push(['', category, '1', itemName, String(serials.length), serials[0] ?? '', '', '', ''])
  for (let i = 1; i < serials.length; i++) aoa.push(['', '', '', '', '', serials[i], '', '', ''])
  const ws = utils.aoa_to_sheet(aoa)
  const wb = utils.book_new()
  utils.book_append_sheet(wb, ws, 'in')
  const path = join(tmpdir(), fileName)
  writeFile(wb, path)
  return path
}

// A sheet with per-unit audit date + remarks and an optional no-serial block.
function buildRichSheet(
  fileName: string,
  serialRows: { serial: string; audit: string; remarks: string }[],
  noSerial?: { itemName: string; qty: number }
): string {
  const aoa: string[][] = []
  for (let i = 0; i < 9; i++) aoa.push([''])
  aoa.push(['', 'Category', 'Item No', 'Item Name', 'Quantity', 'Serial Number/s', 'Initial-Photo Evidence', 'Initial Audit Date', 'Remarks'])
  aoa.push(['', 'Safety Related Items', '1', 'Body Harness', String(serialRows.length), serialRows[0]?.serial ?? '', '', serialRows[0]?.audit ?? '', serialRows[0]?.remarks ?? ''])
  for (let i = 1; i < serialRows.length; i++) {
    aoa.push(['', '', '', '', '', serialRows[i].serial, '', serialRows[i].audit, serialRows[i].remarks])
  }
  if (noSerial) aoa.push(['', 'Safety Related Items', '2', noSerial.itemName, String(noSerial.qty), '', '', '', ''])
  const ws = utils.aoa_to_sheet(aoa)
  const wb = utils.book_new()
  utils.book_append_sheet(wb, ws, 'in')
  const path = join(tmpdir(), fileName)
  writeFile(wb, path)
  return path
}

async function count(db: PostgresAdapter, sql: string): Promise<number> {
  return Number((await db.queryOne(sql) as { n: number }).n)
}

async function main(): Promise<void> {
  const base = process.env.POSTGRES_CONNECTION_STRING
  if (!base) { console.error('POSTGRES_CONNECTION_STRING not set'); process.exit(2) }
  const url = new URL(base)
  url.searchParams.set('options', `-c search_path=${TEST_SCHEMA}`)
  const db = new PostgresAdapter(url.toString())

  try {
    await db.exec(`DROP SCHEMA IF EXISTS ${TEST_SCHEMA} CASCADE`)
    await db.exec(`CREATE SCHEMA ${TEST_SCHEMA}`)
    const guard = (await db.queryOne('SELECT current_schema() AS s')) as { s: string } | null
    if (guard?.s !== TEST_SCHEMA) { console.error(`ABORT: current_schema is ${guard?.s}`); await db.close(); process.exit(3) }
    await applySchema(db)

    const alpha = await createProject(db, { name: 'Alpha', location: null, updatedBy: null, lastUpdatedDate: null })
    const beta = await createProject(db, { name: 'Beta', location: null, updatedBy: null, lastUpdatedDate: null })
    await createItem(db, { category: 'Safety Related Items', name: 'Body Harness', initialStock: 5 })

    console.log('Guard 1 — a sheet for a DIFFERENT project is rejected')
    const itemsBefore = await count(db, 'SELECT COUNT(*)::int n FROM items')
    const unitsBefore = await count(db, 'SELECT COUNT(*)::int n FROM item_units')
    const betaFile = buildSheet('Inventory - Beta (1).xlsx', 'Safety Related Items', 'Body Harness', ['BH-01'])
    await expectThrow('import into Alpha rejects a Beta sheet', () => importAndReconcile(db, betaFile, alpha.id))
    eq('rejected import added no units', await count(db, 'SELECT COUNT(*)::int n FROM item_units'), unitsBefore)
    eq('rejected import created no items', await count(db, 'SELECT COUNT(*)::int n FROM items'), itemsBefore)

    console.log('\nGuard 2 — a category typo does NOT create a duplicate item')
    const typoFile = buildSheet('Inventory - Alpha (1).xlsx', 'Safety related itmes', 'Body Harness', ['BH-02'])
    const summary = await importAndReconcile(db, typoFile, alpha.id)
    check('import succeeded', summary !== null)
    eq('reported 0 new item types', summary?.itemsCreated, 0)
    eq('still exactly one item type', await count(db, 'SELECT COUNT(*)::int n FROM items'), itemsBefore)
    eq('the imported unit was added', await count(db, 'SELECT COUNT(*)::int n FROM item_units'), unitsBefore + 1)
    eq('unit landed on Alpha', await count(db, `SELECT COUNT(*)::int n FROM item_units WHERE assigned_project_id = ${alpha.id}`), 1)

    console.log('\nGuard 3 — reconcile-only import: annotate only, never add/delete/transfer')
    // Fixtures: a Body Harness on Alpha, one on Beta, and 3 no-serial Ear Muffs on Alpha.
    const bhItem = (await db.queryOne(`SELECT id FROM items WHERE name = 'Body Harness'`)) as { id: number }
    const earItem = await createItem(db, { category: 'Safety Related Items', name: 'Ear Muffs', initialStock: 3 })
    const onAlpha = await createItemUnit(db, { itemId: bhItem.id, serialId: 'RC-ALPHA', assignedProjectId: alpha.id, auditDate: null, remarks: null, status: 'In Use', photoEvidenceRef: null })
    await createItemUnit(db, { itemId: bhItem.id, serialId: 'RC-BETA', assignedProjectId: beta.id, auditDate: null, remarks: null, status: 'In Use', photoEvidenceRef: null })
    for (let i = 0; i < 3; i++) await createItemUnit(db, { itemId: earItem.id, serialId: null, assignedProjectId: alpha.id, auditDate: null, remarks: null, status: 'In Use', photoEvidenceRef: null })

    const unitsPre = await count(db, 'SELECT COUNT(*)::int n FROM item_units')
    const itemsPre = await count(db, 'SELECT COUNT(*)::int n FROM items')
    // Sheet claims: RC-ALPHA (audit+remarks), RC-BETA (on Beta), RC-NEW (unknown), and Ear Muffs qty 1 (< 3).
    const rcFile = buildRichSheet(
      'Inventory - Alpha (2).xlsx',
      [
        { serial: 'RC-ALPHA', audit: '14/04/2026', remarks: 'checked on site' },
        { serial: 'RC-BETA', audit: '14/04/2026', remarks: 'x' },
        { serial: 'RC-NEW', audit: '14/04/2026', remarks: 'y' }
      ],
      { itemName: 'Ear Muffs', qty: 1 }
    )
    const rc = await importAndReconcile(db, rcFile, alpha.id, true)
    eq('reconcile-only: 0 added', rc?.unitsAdded, 0)
    eq('reconcile-only: 0 transferred', rc?.transfersCreated, 0)
    eq('reconcile-only: 0 removed', rc?.unitsRemoved, 0)
    eq('reconcile-only: 0 new items', rc?.itemsCreated, 0)
    eq('reconcile-only: exactly 1 unit updated (the on-project one)', rc?.unitsUpdated, 1)
    eq('total unit count unchanged', await count(db, 'SELECT COUNT(*)::int n FROM item_units'), unitsPre)
    eq('item count unchanged', await count(db, 'SELECT COUNT(*)::int n FROM items'), itemsPre)
    const rcAlphaAfter = await getItemUnitById(db, onAlpha.id)
    eq('on-project unit audit date updated', rcAlphaAfter?.auditDate, '2026-04-14')
    check('on-project unit remarks updated', (rcAlphaAfter?.remarks ?? '').includes('checked on site'))
    eq('Beta unit NOT transferred to Alpha', await count(db, `SELECT COUNT(*)::int n FROM item_units WHERE serial_id = 'RC-BETA' AND assigned_project_id = ${beta.id}`), 1)
    eq('unknown serial NOT created', await count(db, `SELECT COUNT(*)::int n FROM item_units WHERE serial_id = 'RC-NEW'`), 0)
    eq('no-serial Ear Muffs NOT deleted (still 3)', await count(db, `SELECT COUNT(*)::int n FROM item_units WHERE item_id = ${earItem.id}`), 3)

    console.log(`\n${'─'.repeat(60)}`)
    console.log(`\x1b[1m${passed} passed, ${failed} failed\x1b[0m`)
  } finally {
    await db.exec(`DROP SCHEMA IF EXISTS ${TEST_SCHEMA} CASCADE`)
    await db.close?.()
  }
  if (failed > 0) { console.log('\nFailures:'); failures.forEach((f) => console.log(`  • ${f}`)); process.exit(1) }
  console.log('Import guards verified.')
}

main().catch((err) => { console.error('\nCrashed:', err); process.exit(1) })
