import type { DatabaseAdapter } from '../adapter'
import type { Project, ProjectInput, ProjectStatus } from '../../../shared/ipc'
import { moveUnits } from './itemUnits'

interface ProjectRow {
  id: number
  name: string
  location: string | null
  updated_by: string | null
  last_updated_date: string | null
  status: ProjectStatus
}

function toProject(row: ProjectRow): Project {
  return {
    id: Number(row.id),
    name: row.name,
    location: row.location,
    updatedBy: row.updated_by,
    lastUpdatedDate: row.last_updated_date,
    status: row.status
  }
}

export async function listProjects(db: DatabaseAdapter): Promise<Project[]> {
  const { rows } = await db.query('SELECT * FROM projects ORDER BY name')
  return (rows as unknown as ProjectRow[]).map(toProject)
}

export async function getProjectById(db: DatabaseAdapter, id: number): Promise<Project | null> {
  const row = await db.queryOne('SELECT * FROM projects WHERE id = ?', [id])
  return row ? toProject(row as unknown as ProjectRow) : null
}

export async function createProject(db: DatabaseAdapter, input: ProjectInput): Promise<Project> {
  const result = await db.query(
    `INSERT INTO projects (name, location, updated_by, last_updated_date, status)
     VALUES (?, ?, ?, ?, 'active') RETURNING *`,
    [input.name, input.location, input.updatedBy, input.lastUpdatedDate]
  )
  return toProject(result.rows[0] as unknown as ProjectRow)
}

export async function updateProject(db: DatabaseAdapter, id: number, input: ProjectInput): Promise<Project> {
  await db.query(
    `UPDATE projects SET name = ?, location = ?, updated_by = ?, last_updated_date = ?
     WHERE id = ?`,
    [input.name, input.location, input.updatedBy, input.lastUpdatedDate, id]
  )
  const row = await db.queryOne('SELECT * FROM projects WHERE id = ?', [id])
  if (!row) throw new Error(`Project ${id} not found`)
  return toProject(row as unknown as ProjectRow)
}

export async function setProjectStatus(db: DatabaseAdapter, id: number, status: ProjectStatus): Promise<Project> {
  if (status === 'completed') {
    // Archiving = closing the site, so its gear must come back to the available
    // pool — and unlike the old "just flip the flag" behaviour, that return is
    // now recorded in the transfer log (via moveUnits) instead of silently
    // healed by the dashboard. The whole thing is one transaction: units are
    // released and the project is marked completed together, or not at all.
    return db.transaction(async (tx) => {
      const { rows } = await tx.query(
        "SELECT id FROM item_units WHERE assigned_project_id = ? AND status <> 'Retired-Damaged'",
        [id]
      )
      const unitIds = (rows as { id: number }[]).map((r) => Number(r.id))
      if (unitIds.length > 0) {
        await moveUnits(tx, {
          unitIds,
          toProjectId: null,
          date: new Date().toISOString().slice(0, 10),
          transferredBy: null,
          authorizedBy: null,
          notes: 'Returned to stock on project archive'
        })
      }
      await tx.query('UPDATE projects SET status = ? WHERE id = ?', [status, id])
      const row = await tx.queryOne('SELECT * FROM projects WHERE id = ?', [id])
      if (!row) throw new Error(`Project ${id} not found`)
      return toProject(row as unknown as ProjectRow)
    })
  }

  await db.query('UPDATE projects SET status = ? WHERE id = ?', [status, id])
  const row = await db.queryOne('SELECT * FROM projects WHERE id = ?', [id])
  if (!row) throw new Error(`Project ${id} not found`)
  return toProject(row as unknown as ProjectRow)
}
