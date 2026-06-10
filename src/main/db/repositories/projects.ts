import type { DatabaseAdapter } from '../adapter'
import type { Project, ProjectInput, ProjectStatus } from '../../../shared/ipc'

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
    id: row.id,
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
  await db.query('UPDATE projects SET status = ? WHERE id = ?', [status, id])
  const row = await db.queryOne('SELECT * FROM projects WHERE id = ?', [id])
  if (!row) throw new Error(`Project ${id} not found`)
  return toProject(row as unknown as ProjectRow)
}
