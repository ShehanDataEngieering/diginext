/** READ-ONLY. Shows recent transfers and where the affected Body Harness units now sit. */
import 'dotenv/config'
import { Client } from 'pg'

async function main(): Promise<void> {
  const c = new Client({ connectionString: process.env.POSTGRES_CONNECTION_STRING })
  await c.connect()

  const t = await c.query(`
    SELECT t.date, t.serial_id, t.transferred_by, t.notes,
           fp.name AS from_project, tp.name AS to_project
    FROM transfers t
    LEFT JOIN projects fp ON fp.id = t.from_project_id
    LEFT JOIN projects tp ON tp.id = t.to_project_id
    ORDER BY t.id DESC LIMIT 20
  `)
  console.log(`Transfers (${t.rows.length} shown):`)
  for (const r of t.rows) {
    console.log(`  ${r.date}  ${r.serial_id ?? '(no serial)'}  ${r.from_project ?? '—'} → ${r.to_project ?? '—'}  by ${r.transferred_by}`)
  }

  const bh = await c.query(`
    SELECT u.serial_id, p.name AS project, u.status
    FROM item_units u JOIN items i ON i.id = u.item_id
    LEFT JOIN projects p ON p.id = u.assigned_project_id
    WHERE i.name = 'Body Harness'
    ORDER BY p.name, u.serial_id
  `)
  console.log(`\nBody Harness units now (${bh.rows.length}):`)
  for (const r of bh.rows) console.log(`  ${r.serial_id ?? '(no serial)'}  @ ${r.project ?? 'unassigned'}  (${r.status})`)

  const counts = await c.query(`
    SELECT p.name, p.status, COUNT(*)::int n
    FROM item_units u LEFT JOIN projects p ON p.id = u.assigned_project_id
    GROUP BY p.name, p.status ORDER BY p.name NULLS FIRST
  `)
  console.log('\nUnits per project:')
  for (const r of counts.rows) console.log(`  ${r.name ?? '(unassigned)'} [${r.status ?? '—'}]: ${r.n}`)

  const total = (await c.query(`SELECT COUNT(*)::int n FROM item_units`)).rows[0].n
  const tCount = (await c.query(`SELECT COUNT(*)::int n FROM transfers`)).rows[0].n
  const iCount = (await c.query(`SELECT COUNT(*)::int n FROM items`)).rows[0].n
  console.log(`\nTotals: ${total} units, ${iCount} items, ${tCount} transfers`)

  await c.end()
}

main().catch((e) => { console.error(e); process.exit(1) })
