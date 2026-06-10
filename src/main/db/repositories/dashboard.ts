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
  count: number
}

export async function getDashboardRollup(db: DatabaseAdapter): Promise<DashboardRollup> {
  const { rows: projectRows } = await db.query(
    "SELECT id, name FROM projects WHERE status = 'active' ORDER BY name"
  )
  const projects = projectRows as { id: number; name: string }[]

  const { rows: itemRows } = await db.query('SELECT * FROM items ORDER BY category, name')
  const items = itemRows as unknown as ItemRow[]

  const { rows: countRows } = await db.query(
    `SELECT item_id, assigned_project_id, COUNT(*) AS count
     FROM item_units
     GROUP BY item_id, assigned_project_id`
  )
  const counts = countRows as unknown as CountRow[]

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
