// Computes the live "Main Inventory" rollup — per item, how many units sit in
// each active project vs. unassigned ("available") — directly from
// `item_units`. This is the normalized replacement for the spreadsheet's
// manually-maintained per-project allocation columns (see plan): the numbers
// can never drift out of sync with reality because they're derived, not typed in.
import type Database from 'better-sqlite3-multiple-ciphers'
import type { DashboardRollup, DashboardRow } from '../../../shared/ipc'

interface ItemRow {
  id: number
  category: string
  name: string
  initial_stock: number
}

interface CountRow {
  item_id: number
  assigned_project_id: number | null
  count: number
}

export function getDashboardRollup(db: Database.Database): DashboardRollup {
  // Only active projects get their own column — completed projects'
  // historical units still count toward an item's total, just not broken
  // out individually (mirrors how the old spreadsheet retired project sheets).
  const projects = db
    .prepare("SELECT id, name FROM projects WHERE status = 'active' ORDER BY name")
    .all() as { id: number; name: string }[]

  const items = db.prepare('SELECT * FROM items ORDER BY category, name').all() as ItemRow[]

  const counts = db
    .prepare(
      `SELECT item_id, assigned_project_id, COUNT(*) AS count
       FROM item_units
       GROUP BY item_id, assigned_project_id`
    )
    .all() as CountRow[]

  // itemId -> (projectId-or-null -> count), built once so each item's row
  // below is just map lookups rather than N additional queries.
  const countsByItem = new Map<number, Map<number | null, number>>()
  for (const { item_id, assigned_project_id, count } of counts) {
    let perProject = countsByItem.get(item_id)
    if (!perProject) {
      perProject = new Map()
      countsByItem.set(item_id, perProject)
    }
    perProject.set(assigned_project_id, count)
  }

  const activeProjectIds = new Set(projects.map((p) => p.id))

  const rows: DashboardRow[] = items.map((item) => {
    const perProject = countsByItem.get(item.id)
    const countsByProjectId: Record<number, number> = {}
    let totalUnits = 0
    let available = 0

    if (perProject) {
      for (const [projectId, count] of perProject) {
        totalUnits += count
        if (projectId === null) available += count
        else if (activeProjectIds.has(projectId)) countsByProjectId[projectId] = count
        // Units still tagged to a now-completed project count toward the
        // total (the physical item still exists somewhere) but don't get
        // their own column — see the projects query comment above.
      }
    }

    return {
      itemId: item.id,
      category: item.category,
      name: item.name,
      initialStock: item.initial_stock,
      countsByProjectId,
      available,
      totalUnits
    }
  })

  return { projects, rows }
}
