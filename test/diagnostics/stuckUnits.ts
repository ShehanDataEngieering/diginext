/**
 * READ-ONLY diagnostic. Finds non-retired units still assigned to a project
 * whose status is 'completed' — i.e. units that should have been released when
 * the project was archived, but weren't (pre-atomic-archive leftovers).
 *
 * Run: npx tsx test/diagnostics/stuckUnits.ts
 */
import 'dotenv/config'
import { Pool } from 'pg'

async function main(): Promise<void> {
  const connectionString = process.env.POSTGRES_CONNECTION_STRING
  if (!connectionString) throw new Error('POSTGRES_CONNECTION_STRING not set in .env')

  const pool = new Pool({ connectionString, connectionTimeoutMillis: 10000 })
  try {
    const { rows } = await pool.query(`
      SELECT iu.id, iu.serial_id, iu.status,
             p.id AS project_id, p.name AS project_name, p.status AS project_status,
             i.name AS item_name
      FROM item_units iu
      JOIN projects p ON p.id = iu.assigned_project_id
      LEFT JOIN items i ON i.id = iu.item_id
      WHERE p.status = 'completed'
        AND iu.status <> 'Retired-Damaged'
      ORDER BY p.name, i.name, iu.serial_id
    `)

    if (rows.length === 0) {
      console.log('\x1b[32m✓ No stuck units — every live unit is at an active project or Available.\x1b[0m')
    } else {
      console.log(`\x1b[31m✗ Found ${rows.length} unit(s) still assigned to a COMPLETED project:\x1b[0m\n`)
      for (const r of rows) {
        console.log(
          `  unit #${r.id}  [${r.item_name ?? '—'}]  serial=${r.serial_id ?? '—'}  status=${r.status}` +
            `  → project #${r.project_id} "${r.project_name}" (${r.project_status})`
        )
      }
      console.log(
        `\nThese would be RELEASED to Available (assigned_project_id = NULL, status = 'Available') by the cleanup step.`
      )
    }
  } finally {
    await pool.end()
  }
}

main().catch((err) => { console.error('Diagnostic failed:', err); process.exit(1) })
