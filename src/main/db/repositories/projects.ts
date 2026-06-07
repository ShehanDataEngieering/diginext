// Data access for the `projects` table. Translates between SQLite's
// snake_case columns and the camelCase shapes shared with the renderer
// (see src/shared/ipc.ts) — that boundary is intentional: nothing outside
// this file should know what the columns are actually called.
import type Database from 'better-sqlite3-multiple-ciphers'
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

export function listProjects(db: Database.Database): Project[] {
  const rows = db.prepare('SELECT * FROM projects ORDER BY name').all() as ProjectRow[]
  return rows.map(toProject)
}

// Single-record lookup — used by the Excel export handler (and, later, the
// import/reconciliation matcher) where the renderer only has a project ID,
// not the whole list already in hand.
export function getProjectById(db: Database.Database, id: number): Project | null {
  const row = db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as ProjectRow | undefined
  return row ? toProject(row) : null
}

export function createProject(db: Database.Database, input: ProjectInput): Project {
  const result = db
    .prepare(
      `INSERT INTO projects (name, location, updated_by, last_updated_date, status)
       VALUES (?, ?, ?, ?, 'active')`
    )
    .run(input.name, input.location, input.updatedBy, input.lastUpdatedDate)

  const row = db
    .prepare('SELECT * FROM projects WHERE id = ?')
    .get(result.lastInsertRowid) as ProjectRow
  return toProject(row)
}

export function updateProject(db: Database.Database, id: number, input: ProjectInput): Project {
  db.prepare(
    `UPDATE projects SET name = ?, location = ?, updated_by = ?, last_updated_date = ?
     WHERE id = ?`
  ).run(input.name, input.location, input.updatedBy, input.lastUpdatedDate, id)

  const row = db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as ProjectRow | undefined
  if (!row) throw new Error(`Project ${id} not found`)
  return toProject(row)
}

// Projects are archived (status -> 'completed'), never deleted — per the
// plan, archiving should prompt a hand-over flow (later milestone), and the
// historical record (which units were ever assigned here, transfers, etc.)
// needs to survive. The `assigned_project_id` FK is ON DELETE SET NULL
// specifically so a hard delete wouldn't even be destructive to units, but
// we still don't expose one: completed projects stay visible/filterable.
export function setProjectStatus(db: Database.Database, id: number, status: ProjectStatus): Project {
  db.prepare('UPDATE projects SET status = ? WHERE id = ?').run(status, id)
  const row = db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as ProjectRow | undefined
  if (!row) throw new Error(`Project ${id} not found`)
  return toProject(row)
}
