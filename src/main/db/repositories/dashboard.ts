import type { DatabaseAdapter } from '../adapter'
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
  status: string
  count: number
}

export async function getDashboardRollup(db: DatabaseAdapter): Promise<DashboardRollup> {
  const { rows: projectRows } = await db.query(
    "SELECT id, name FROM projects WHERE status = 'active' ORDER BY name"
  )
  const projects = projectRows as { id: number; name: string }[]

  const { rows: itemRows } = await db.query('SELECT * FROM items ORDER BY category, name')
  const items = itemRows as unknown as ItemRow[]

  // Group by status too, so we can tell apart deployed / available / retired
  // units that happen to share an item and project.
  const { rows: countRows } = await db.query(
    `SELECT item_id, assigned_project_id, status, COUNT(*)::int AS count
     FROM item_units
     GROUP BY item_id, assigned_project_id, status`
  )
  const counts = countRows as unknown as CountRow[]

  const activeProjectIds = new Set(projects.map((p) => p.id))

  // Pre-aggregate per item: deployed counts per active project, plus a single
  // "available" tally. A unit counts as available when it is NOT currently
  // deployed to an *active* project and is not retired — this includes units
  // sitting on a completed/archived project (gear that came back when the site
  // closed) as well as units explicitly returned to stock, so nothing gets
  // stranded in an invisible limbo after a handover or archive.
  const perProjectByItem = new Map<number, Record<number, number>>()
  const availableByItem = new Map<number, number>()
  const totalByItem = new Map<number, number>()
  const retiredByItem = new Map<number, number>()

  for (const { item_id, assigned_project_id, status, count } of counts) {
    totalByItem.set(item_id, (totalByItem.get(item_id) ?? 0) + count)

    if (status === 'Retired-Damaged') {
      // Written off — never deployed nor available. Counted on its own so the
      // baseline math can exclude it.
      retiredByItem.set(item_id, (retiredByItem.get(item_id) ?? 0) + count)
      continue
    }

    const onActiveProject = assigned_project_id !== null && activeProjectIds.has(assigned_project_id)

    if (onActiveProject) {
      const perProject = perProjectByItem.get(item_id) ?? {}
      perProject[assigned_project_id!] = (perProject[assigned_project_id!] ?? 0) + count
      perProjectByItem.set(item_id, perProject)
    } else {
      availableByItem.set(item_id, (availableByItem.get(item_id) ?? 0) + count)
    }
  }

  const rows: DashboardRow[] = items.map((item) => ({
    itemId: item.id,
    category: item.category,
    name: item.name,
    initialStock: item.initial_stock,
    countsByProjectId: perProjectByItem.get(item.id) ?? {},
    available: availableByItem.get(item.id) ?? 0,
    totalUnits: totalByItem.get(item.id) ?? 0,
    retired: retiredByItem.get(item.id) ?? 0
  }))

  return { projects, rows }
}
