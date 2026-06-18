/**
 * Integration test for every code path that mutates item-unit state:
 * create/edit, the atomic `moveUnits` (assign / transfer-out / return), the
 * close-out `createHandover`, project archive, the dashboard rollup, and the
 * DB-level guards (serial uniqueness, item-delete restriction).
 *
 * Runs the REAL repository code against the REAL database — but isolated in a
 * throwaway `diginext_test` schema that is created at the start and dropped at
 * the end, so it never reads or writes the production `public` tables. A hard
 * current_schema() guard aborts before any data is written if the isolation
 * isn't active.
 *
 * Run: npx tsx test/integration/unitFlows.ts   (from the project root)
 */
import 'dotenv/config'
import { PostgresAdapter } from '../../src/main/db/postgresAdapter'
import { applySchema } from '../../src/main/db/schema'
import { createItem, deleteItem } from '../../src/main/db/repositories/items'
import { createProject, setProjectStatus } from '../../src/main/db/repositories/projects'
import {
  createItemUnit,
  updateItemUnit,
  getItemUnitById,
  moveUnits
} from '../../src/main/db/repositories/itemUnits'
import { createHandover } from '../../src/main/db/repositories/handovers'
import { getDashboardRollup } from '../../src/main/db/repositories/dashboard'
import { HANDOVER_ACTIONS, type ItemUnitInput } from '../../src/shared/ipc'

const TEST_SCHEMA = 'diginext_test'

// ---------------------------------------------------------------------------
// Tiny assertion harness
// ---------------------------------------------------------------------------
let passed = 0
let failed = 0
const failures: string[] = []

function check(label: string, cond: boolean, detail?: string): void {
  if (cond) {
    passed++
    console.log(`  \x1b[32m✓\x1b[0m ${label}`)
  } else {
    failed++
    failures.push(label + (detail ? ` — ${detail}` : ''))
    console.log(`  \x1b[31m✗ ${label}\x1b[0m${detail ? ` — ${detail}` : ''}`)
  }
}

function eq(label: string, actual: unknown, expected: unknown): void {
  check(label, actual === expected, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
}

async function expectThrow(label: string, fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn()
    check(label, false, 'expected an error but none was thrown')
  } catch {
    check(label, true)
  }
}

// ---------------------------------------------------------------------------
// Test data helpers
// ---------------------------------------------------------------------------
const TODAY = '2026-06-18'

function unitInput(over: Partial<ItemUnitInput> & { itemId: number }): ItemUnitInput {
  return {
    serialId: null,
    assignedProjectId: null,
    auditDate: null,
    remarks: null,
    status: 'Available',
    photoEvidenceRef: null,
    ...over
  }
}

async function transferCount(db: PostgresAdapter, serialId: string): Promise<number> {
  const { rows } = await db.query('SELECT COUNT(*)::int AS c FROM transfers WHERE serial_id = ?', [serialId])
  return Number((rows[0] as { c: number }).c)
}

async function main(): Promise<void> {
  const base = process.env.POSTGRES_CONNECTION_STRING
  if (!base) {
    console.error('POSTGRES_CONNECTION_STRING is not set (.env). Aborting.')
    process.exit(2)
  }

  // Point every pooled connection at the throwaway schema via the libpq
  // `options` startup parameter, preserving any existing query params (sslmode…).
  const url = new URL(base)
  url.searchParams.set('options', `-c search_path=${TEST_SCHEMA}`)
  const db = new PostgresAdapter(url.toString())

  try {
    // Fresh isolated schema.
    await db.exec(`DROP SCHEMA IF EXISTS ${TEST_SCHEMA} CASCADE`)
    await db.exec(`CREATE SCHEMA ${TEST_SCHEMA}`)

    // HARD SAFETY GUARD — never proceed unless we are demonstrably scoped to the
    // test schema. If pooling stripped the search_path option this catches it
    // before a single row is written to production.
    const guard = await db.queryOne('SELECT current_schema() AS s')
    const schema = (guard as { s: string } | null)?.s
    if (schema !== TEST_SCHEMA) {
      console.error(
        `\n\x1b[31mABORTED:\x1b[0m current_schema() is "${schema}", not "${TEST_SCHEMA}". ` +
          `The connection did not honor the search_path option (likely a transaction-mode pooler), ` +
          `so the test cannot guarantee isolation from production. No data was written.\n`
      )
      await db.close()
      process.exit(3)
    }
    console.log(`\nIsolated in schema "${schema}". Applying schema…\n`)
    await applySchema(db)

    // -----------------------------------------------------------------------
    // Fixtures
    // -----------------------------------------------------------------------
    const item = await createItem(db, { category: 'Safety', name: 'Harness', initialStock: 10 })
    const p1 = await createProject(db, { name: 'Site Alpha', location: null, updatedBy: null, lastUpdatedDate: null })
    const p2 = await createProject(db, { name: 'Site Beta', location: null, updatedBy: null, lastUpdatedDate: null })

    // =======================================================================
    console.log('createItemUnit — status/assignment persisted as given')
    // =======================================================================
    const uAvail = await createItemUnit(db, unitInput({ itemId: item.id, serialId: 'S-AVAIL', status: 'Available' }))
    eq('new unassigned unit is Available', uAvail.status, 'Available')
    eq('new unassigned unit has no project', uAvail.assignedProjectId, null)

    const uOnP1 = await createItemUnit(
      db,
      unitInput({ itemId: item.id, serialId: 'S-ONP1', assignedProjectId: p1.id, status: 'In Use' })
    )
    eq('new assigned unit is In Use', uOnP1.status, 'In Use')
    eq('new assigned unit points at project', uOnP1.assignedProjectId, p1.id)

    // =======================================================================
    console.log('\nupdateItemUnit — edit persists assignment + status + remarks')
    // =======================================================================
    await updateItemUnit(db, uAvail.id, unitInput({
      itemId: item.id, serialId: 'S-AVAIL', assignedProjectId: p1.id, status: 'In Use', remarks: 'edited'
    }))
    const editedBack = await getItemUnitById(db, uAvail.id)
    eq('edit set project', editedBack?.assignedProjectId, p1.id)
    eq('edit set status', editedBack?.status, 'In Use')
    eq('edit set remarks', editedBack?.remarks, 'edited')
    // put it back to Available/unassigned for later tests
    await updateItemUnit(db, uAvail.id, unitInput({ itemId: item.id, serialId: 'S-AVAIL', status: 'Available' }))

    // =======================================================================
    console.log('\nmoveUnits — assign Available unit to a project')
    // =======================================================================
    const r1 = await moveUnits(db, {
      unitIds: [uAvail.id], toProjectId: p1.id, date: TODAY, transferredBy: null, authorizedBy: null, notes: null
    })
    eq('movedCount = 1', r1.movedCount, 1)
    const afterAssign = await getItemUnitById(db, uAvail.id)
    eq('assigned to p1', afterAssign?.assignedProjectId, p1.id)
    eq('status In Use', afterAssign?.status, 'In Use')
    eq('one transfer row recorded', await transferCount(db, 'S-AVAIL'), 1)

    // =======================================================================
    console.log('\nmoveUnits — transfer between projects derives status + logs')
    // =======================================================================
    await moveUnits(db, {
      unitIds: [uAvail.id], toProjectId: p2.id, date: TODAY, transferredBy: 'alice', authorizedBy: 'bob', notes: 'reloc'
    })
    const afterXfer = await getItemUnitById(db, uAvail.id)
    eq('moved to p2', afterXfer?.assignedProjectId, p2.id)
    eq('still In Use', afterXfer?.status, 'In Use')
    eq('second transfer row recorded', await transferCount(db, 'S-AVAIL'), 2)

    // =======================================================================
    console.log('\nmoveUnits — return to pool flips status to Available')
    // =======================================================================
    await moveUnits(db, {
      unitIds: [uAvail.id], toProjectId: null, date: TODAY, transferredBy: null, authorizedBy: null, notes: null
    })
    const afterReturn = await getItemUnitById(db, uAvail.id)
    eq('unassigned', afterReturn?.assignedProjectId, null)
    eq('status Available', afterReturn?.status, 'Available')

    // =======================================================================
    console.log('\nmoveUnits — retired units are skipped, never moved')
    // =======================================================================
    const uRetired = await createItemUnit(db, unitInput({ itemId: item.id, serialId: 'S-RET', status: 'Retired-Damaged' }))
    const rRet = await moveUnits(db, {
      unitIds: [uRetired.id], toProjectId: p1.id, date: TODAY, transferredBy: null, authorizedBy: null, notes: null
    })
    eq('skippedRetired = 1', rRet.skippedRetired, 1)
    eq('movedCount = 0', rRet.movedCount, 0)
    const retAfter = await getItemUnitById(db, uRetired.id)
    eq('retired unit stays unassigned', retAfter?.assignedProjectId, null)
    eq('retired unit stays retired', retAfter?.status, 'Retired-Damaged')
    eq('no transfer row for retired unit', await transferCount(db, 'S-RET'), 0)

    // =======================================================================
    console.log('\nmoveUnits — same-destination move is a no-op (no self-transfer)')
    // =======================================================================
    await moveUnits(db, { unitIds: [uOnP1.id], toProjectId: p1.id, date: TODAY, transferredBy: null, authorizedBy: null, notes: null })
    eq('no transfer row for same-destination move', await transferCount(db, 'S-ONP1'), 0)

    // =======================================================================
    console.log('\nmoveUnits — atomic: a bad id rolls back the whole batch')
    // =======================================================================
    const uAtomic = await createItemUnit(db, unitInput({ itemId: item.id, serialId: 'S-ATOM', status: 'Available' }))
    await expectThrow('batch with nonexistent unit throws', () =>
      moveUnits(db, {
        unitIds: [uAtomic.id, 999999], toProjectId: p1.id, date: TODAY, transferredBy: null, authorizedBy: null, notes: null
      })
    )
    const atomicAfter = await getItemUnitById(db, uAtomic.id)
    eq('good unit NOT moved (rolled back)', atomicAfter?.assignedProjectId, null)
    eq('good unit still Available (rolled back)', atomicAfter?.status, 'Available')
    eq('no transfer row committed (rolled back)', await transferCount(db, 'S-ATOM'), 0)

    // =======================================================================
    console.log('\ncreateHandover — full close-out (return / retire / transfer) is atomic')
    // =======================================================================
    const hp = await createProject(db, { name: 'Site Gamma', location: null, updatedBy: null, lastUpdatedDate: null })
    const hReturn = await createItemUnit(db, unitInput({ itemId: item.id, serialId: 'H-RETURN', assignedProjectId: hp.id, status: 'In Use' }))
    const hRetire = await createItemUnit(db, unitInput({ itemId: item.id, serialId: 'H-RETIRE', assignedProjectId: hp.id, status: 'In Use', remarks: 'orig' }))
    const hXfer = await createItemUnit(db, unitInput({ itemId: item.id, serialId: 'H-XFER', assignedProjectId: hp.id, status: 'In Use' }))

    const handover = await createHandover(db, {
      projectId: hp.id, handoverDate: TODAY, handedOverBy: 'lead', receivedBy: 'mgr', notes: null, signatureRef: null,
      items: [
        { itemUnitId: hReturn.id, condition: 'Good', action: HANDOVER_ACTIONS.return, transferProjectId: null },
        { itemUnitId: hRetire.id, condition: 'Damaged', action: HANDOVER_ACTIONS.retire, transferProjectId: null },
        { itemUnitId: hXfer.id, condition: 'Good', action: HANDOVER_ACTIONS.transfer, transferProjectId: p1.id }
      ]
    })
    eq('handover has 3 item rows', handover.items.length, 3)

    const rb = await getItemUnitById(db, hReturn.id)
    eq('returned unit unassigned', rb?.assignedProjectId, null)
    eq('returned unit Available', rb?.status, 'Available')

    const rt = await getItemUnitById(db, hRetire.id)
    eq('retired unit status', rt?.status, 'Retired-Damaged')
    check('damaged condition appended to remarks', (rt?.remarks ?? '').includes('Damaged'), `remarks="${rt?.remarks}"`)

    const xf = await getItemUnitById(db, hXfer.id)
    eq('transferred unit moved to p1', xf?.assignedProjectId, p1.id)
    eq('transferred unit In Use', xf?.status, 'In Use')
    eq('handover transfer logged', await transferCount(db, 'H-XFER'), 1)

    const hpAfter = await db.queryOne('SELECT status FROM projects WHERE id = ?', [hp.id])
    eq('project marked completed', (hpAfter as { status: string }).status, 'completed')

    // good-condition return should NOT touch remarks
    eq('good-condition return leaves remarks null', rb?.remarks, null)

    // =======================================================================
    console.log('\ncreateHandover — atomic: a transfer with no destination rolls everything back')
    // =======================================================================
    const bp = await createProject(db, { name: 'Site Delta', location: null, updatedBy: null, lastUpdatedDate: null })
    const bUnit = await createItemUnit(db, unitInput({ itemId: item.id, serialId: 'B-UNIT', assignedProjectId: bp.id, status: 'In Use' }))
    await expectThrow('handover with destination-less transfer throws', () =>
      createHandover(db, {
        projectId: bp.id, handoverDate: TODAY, handedOverBy: null, receivedBy: null, notes: null, signatureRef: null,
        items: [{ itemUnitId: bUnit.id, condition: null, action: HANDOVER_ACTIONS.transfer, transferProjectId: null }]
      })
    )
    const bUnitAfter = await getItemUnitById(db, bUnit.id)
    eq('unit unchanged after failed handover', bUnitAfter?.assignedProjectId, bp.id)
    const bpAfter = await db.queryOne('SELECT status FROM projects WHERE id = ?', [bp.id])
    eq('project NOT completed after failed handover', (bpAfter as { status: string }).status, 'active')
    const { rows: hoRows } = await db.query('SELECT COUNT(*)::int AS c FROM handovers WHERE project_id = ?', [bp.id])
    eq('no handover row committed', Number((hoRows[0] as { c: number }).c), 0)

    // =======================================================================
    console.log('\nDashboard rollup — available excludes retired & heals completed-project units')
    // =======================================================================
    // Dedicated item to count precisely.
    const di = await createItem(db, { category: 'Test', name: 'Widget', initialStock: 10 })
    const dActive = await createProject(db, { name: 'Dash Active', location: null, updatedBy: null, lastUpdatedDate: null })
    const dDone = await createProject(db, { name: 'Dash Done', location: null, updatedBy: null, lastUpdatedDate: null })
    // 3 on active project
    for (let i = 0; i < 3; i++) await createItemUnit(db, unitInput({ itemId: di.id, serialId: `D-A${i}`, assignedProjectId: dActive.id, status: 'In Use' }))
    // 2 on a project we will complete (orphaned-but-healed)
    for (let i = 0; i < 2; i++) await createItemUnit(db, unitInput({ itemId: di.id, serialId: `D-C${i}`, assignedProjectId: dDone.id, status: 'In Use' }))
    // 1 retired
    await createItemUnit(db, unitInput({ itemId: di.id, serialId: 'D-RET', status: 'Retired-Damaged' }))
    // 4 unassigned
    for (let i = 0; i < 4; i++) await createItemUnit(db, unitInput({ itemId: di.id, serialId: `D-U${i}`, status: 'Available' }))
    await setProjectStatus(db, dDone.id, 'completed')

    const rollup = await getDashboardRollup(db)
    const drow = rollup.rows.find((r) => r.itemId === di.id)!
    const deployed = Object.values(drow.countsByProjectId).reduce((s, n) => s + n, 0)
    eq('deployed counts only active project (3)', deployed, 3)
    eq('available = unassigned + completed-project (6)', drow.available, 6)
    eq('retired counted separately (1)', drow.retired, 1)
    eq('total units (10)', drow.totalUnits, 10)
    eq('derivedAvailable = stock − deployed − retired (6)', drow.initialStock - deployed - drow.retired, 6)
    check('completed project absent from active columns', !(dDone.id in drow.countsByProjectId))

    // =======================================================================
    console.log('\nDB guards — serial uniqueness & item-delete restriction')
    // =======================================================================
    await expectThrow('duplicate serial rejected', () =>
      createItemUnit(db, unitInput({ itemId: item.id, serialId: 'S-AVAIL', status: 'Available' }))
    )
    await expectThrow('deleting item with units rejected', () => deleteItem(db, item.id))
    const emptyItem = await createItem(db, { category: 'Test', name: 'Disposable', initialStock: 0 })
    await deleteItem(db, emptyItem.id)
    check('deleting item with no units succeeds', true)

    // =======================================================================
    console.log('\nProject archive — units stay assigned but rollup heals them to Available')
    // =======================================================================
    const arItem = await createItem(db, { category: 'Test', name: 'Archivable', initialStock: 1 })
    const arProj = await createProject(db, { name: 'Archive Me', location: null, updatedBy: null, lastUpdatedDate: null })
    const arUnit = await createItemUnit(db, unitInput({ itemId: arItem.id, serialId: 'AR-1', assignedProjectId: arProj.id, status: 'In Use' }))
    await setProjectStatus(db, arProj.id, 'completed')
    const arAfter = await getItemUnitById(db, arUnit.id)
    eq('archive does NOT move the unit (still assigned)', arAfter?.assignedProjectId, arProj.id)
    const arRollup = await getDashboardRollup(db)
    const arRow = arRollup.rows.find((r) => r.itemId === arItem.id)!
    eq('rollup heals archived-project unit to available', arRow.available, 1)
  } finally {
    // Tear down the isolated schema no matter what.
    try {
      await db.exec(`DROP SCHEMA IF EXISTS ${TEST_SCHEMA} CASCADE`)
      console.log(`\nDropped schema "${TEST_SCHEMA}".`)
    } catch (e) {
      console.error('Cleanup failed:', e)
    }
    await db.close()
  }

  // ----------------------------------------------------------------------
  console.log(`\n${'─'.repeat(60)}`)
  console.log(`\x1b[1m${passed} passed, ${failed} failed\x1b[0m`)
  if (failed > 0) {
    console.log('\nFailures:')
    for (const f of failures) console.log(`  • ${f}`)
    process.exit(1)
  }
  console.log('All unit-flow paths verified.')
}

main().catch((err) => {
  console.error('\nTest run crashed:', err)
  process.exit(1)
})
