/** READ-ONLY. Confirms import activity and shows duplicate item types (same name, different case/category). */
import 'dotenv/config'
import { Client } from 'pg'

async function main(): Promise<void> {
  const client = new Client({ connectionString: process.env.POSTGRES_CONNECTION_STRING })
  await client.connect()

  const tCount = (await client.query(`SELECT COUNT(*)::int n FROM transfers`)).rows[0].n
  const imp = (await client.query(`SELECT COUNT(*)::int n FROM transfers WHERE transferred_by = 'Excel Import'`)).rows[0].n
  console.log(`Transfers: ${tCount} total, ${imp} from Excel Import`)
  const itemCount = (await client.query(`SELECT COUNT(*)::int n FROM items`)).rows[0].n
  console.log(`Item types: ${itemCount} (reset seeded 35)`)

  console.log('\nDuplicate item types (same name ignoring case/spacing):')
  const dups = (await client.query(`
    SELECT lower(regexp_replace(name, '\\s+', ' ', 'g')) AS key,
           array_agg(id ORDER BY id) AS ids,
           array_agg(name ORDER BY id) AS names,
           array_agg(category ORDER BY id) AS categories
    FROM items GROUP BY key HAVING COUNT(*) > 1 ORDER BY key
  `)).rows
  for (const d of dups) {
    console.log(`  "${d.key}":`)
    for (let i = 0; i < d.ids.length; i++) {
      const c = (await client.query(`SELECT COUNT(*)::int n FROM item_units WHERE item_id=$1`, [d.ids[i]])).rows[0].n
      console.log(`      id ${d.ids[i]}  name="${d.names[i]}"  cat="${d.categories[i]}"  units=${c}`)
    }
  }

  console.log('\nItem types with ZERO units (likely empty duplicates from import):')
  const empties = (await client.query(`
    SELECT i.id, i.name, i.category FROM items i
    LEFT JOIN item_units u ON u.item_id = i.id
    WHERE u.id IS NULL ORDER BY i.name
  `)).rows
  for (const e of empties) console.log(`  id ${e.id}  "${e.name}"  [${e.category}]`)

  await client.end()
}

main().catch((e) => { console.error(e); process.exit(1) })
