/** One-off: rename the Gävle project to use the correct umlaut spelling. */
import 'dotenv/config'
import { Client } from 'pg'

async function main(): Promise<void> {
  const client = new Client({ connectionString: process.env.POSTGRES_CONNECTION_STRING })
  await client.connect()

  const before = (await client.query(`SELECT id, name FROM projects WHERE name ILIKE 'GVX 03%'`)).rows
  console.log('Before:', before)

  const res = await client.query(
    `UPDATE projects SET name = 'GVX 03 - Gävle' WHERE name = 'GVX 03 - Gavle' RETURNING id, name`
  )
  console.log('Updated rows:', res.rows)

  const after = (await client.query(`SELECT id, name, status FROM projects ORDER BY id`)).rows
  console.log('All projects now:', after)

  await client.end()
}

main().catch((e) => { console.error(e); process.exit(1) })
