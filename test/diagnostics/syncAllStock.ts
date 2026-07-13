/** One-time: set every item's initial_stock to its actual unit count (track-actual model). */
import 'dotenv/config'
import { Client } from 'pg'

async function main(): Promise<void> {
  const c = new Client({ connectionString: process.env.POSTGRES_CONNECTION_STRING })
  await c.connect()

  const drift = await c.query(`
    SELECT i.name, i.initial_stock AS declared, COUNT(u.id)::int AS actual
    FROM items i LEFT JOIN item_units u ON u.item_id = i.id
    GROUP BY i.id, i.name, i.initial_stock
    HAVING i.initial_stock <> COUNT(u.id)
    ORDER BY i.name
  `)
  console.log(`Items whose initial_stock differs from their unit count: ${drift.rows.length}`)
  for (const r of drift.rows) console.log(`  ${r.name}: declared ${r.declared} → actual ${r.actual}`)

  const res = await c.query(`
    UPDATE items SET initial_stock = sub.n
    FROM (SELECT i.id, COUNT(u.id)::int AS n FROM items i LEFT JOIN item_units u ON u.item_id = i.id GROUP BY i.id) sub
    WHERE items.id = sub.id AND items.initial_stock <> sub.n
  `)
  console.log(`\n✓ Synced ${res.rowCount ?? 0} item(s) to their actual unit count.`)
  await c.end()
}

main().catch((e) => { console.error(e); process.exit(1) })
