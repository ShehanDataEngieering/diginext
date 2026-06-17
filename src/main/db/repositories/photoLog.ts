import type { DatabaseAdapter } from '../adapter'
import type { PhotoLogEntry, PhotoLogEntryInput } from '../../../shared/ipc'

interface PhotoLogRow {
  id: number
  label: string
  photo_evidence_ref: string
  project_id: number | null
  project_name: string | null
  created_at: string
}

function toPhotoLogEntry(row: PhotoLogRow): PhotoLogEntry {
  return {
    id: Number(row.id),
    label: row.label,
    photoEvidenceRef: row.photo_evidence_ref,
    projectId: row.project_id ? Number(row.project_id) : null,
    projectName: row.project_name,
    createdAt: row.created_at
  }
}

const SELECT_PHOTO_LOG = `
  SELECT pl.*, p.name AS project_name
  FROM photo_log pl
  LEFT JOIN projects p ON p.id = pl.project_id
`

export async function listPhotoLog(db: DatabaseAdapter): Promise<PhotoLogEntry[]> {
  const { rows } = await db.query(`${SELECT_PHOTO_LOG} ORDER BY pl.created_at DESC, pl.id DESC`)
  return (rows as unknown as PhotoLogRow[]).map(toPhotoLogEntry)
}

export async function createPhotoLogEntry(
  db: DatabaseAdapter,
  input: PhotoLogEntryInput
): Promise<PhotoLogEntry> {
  const result = await db.query(
    'INSERT INTO photo_log (label, photo_evidence_ref, project_id) VALUES (?, ?, ?) RETURNING id',
    [input.label, input.photoEvidenceRef, input.projectId]
  )
  const id = Number((result.rows[0] as unknown as { id: number }).id)
  const created = await getPhotoLogEntryById(db, id)
  if (!created) throw new Error('Failed to create photo log entry')
  return created
}

export async function getPhotoLogEntryById(db: DatabaseAdapter, id: number): Promise<PhotoLogEntry | null> {
  const { rows } = await db.query(`${SELECT_PHOTO_LOG} WHERE pl.id = ?`, [id])
  const row = rows[0] as unknown as PhotoLogRow | undefined
  return row ? toPhotoLogEntry(row) : null
}

export async function deletePhotoLogEntry(db: DatabaseAdapter, id: number): Promise<void> {
  await db.query('DELETE FROM photo_log WHERE id = ?', [id])
}

// Re-tags an existing photo-log entry to a different project (or to no
// project when passed null). Used by the per-project Toolbox Photos page to
// pull a photo in from the shared log — a move rather than a copy, since the
// underlying photo file is owned by a single entry and deleted with it.
export async function setPhotoLogProject(
  db: DatabaseAdapter,
  id: number,
  projectId: number | null
): Promise<PhotoLogEntry> {
  await db.query('UPDATE photo_log SET project_id = ? WHERE id = ?', [projectId, id])
  const updated = await getPhotoLogEntryById(db, id)
  if (!updated) throw new Error('Photo log entry not found')
  return updated
}
