import type { DatabaseAdapter } from '../adapter'
import type {
  ItemUnit,
  ItemUnitFilter,
  ItemUnitInput,
  ItemUnitWithDetails,
  MoveUnitsInput,
  MoveUnitsResult,
  UnitStatus
} from '../../../shared/ipc'

interface ItemUnitRow {
  id: number
  item_id: number
  serial_id: string | null
  assigned_project_id: number | null
  audit_date: string | null
  remarks: string | null
  status: UnitStatus
  photo_evidence_ref: string | null
  retired_from_project_id: number | null
}

interface ItemUnitWithDetailsRow extends ItemUnitRow {
  item_category: string
  item_name: string
  project_name: string | null
  retired_from_project_name: string | null
}

function toItemUnit(row: ItemUnitRow, photoRefs: string[]): ItemUnit {
  return {
    id: Number(row.id),
    itemId: Number(row.item_id),
    serialId: row.serial_id,
    assignedProjectId: row.assigned_project_id ? Number(row.assigned_project_id) : null,
    auditDate: row.audit_date,
    remarks: row.remarks,
    status: row.status,
    photoEvidenceRef: row.photo_evidence_ref,
    photoRefs,
    retiredFromProjectId: row.retired_from_project_id ? Number(row.retired_from_project_id) : null
  }
}

function toItemUnitWithDetails(row: ItemUnitWithDetailsRow, photoRefs: string[]): ItemUnitWithDetails {
  return {
    ...toItemUnit(row, photoRefs),
    itemCategory: row.item_category,
    itemName: row.item_name,
    projectName: row.project_name,
    retiredFromProjectName: row.retired_from_project_name
  }
}

// Loads the photo gallery (cover first, then by sort order) for a set of units
// in a single query, grouped by unit id. Returns an empty map for no ids so
// callers don't need to special-case it.
async function loadPhotoRefs(db: DatabaseAdapter, unitIds: number[]): Promise<Map<number, string[]>> {
  const map = new Map<number, string[]>()
  if (unitIds.length === 0) return map
  const placeholders = unitIds.map(() => '?').join(', ')
  const { rows } = await db.query(
    `SELECT item_unit_id, photo_ref FROM item_unit_photos
     WHERE item_unit_id IN (${placeholders})
     ORDER BY sort_order, id`,
    unitIds
  )
  for (const r of rows as unknown as { item_unit_id: number; photo_ref: string }[]) {
    const key = Number(r.item_unit_id)
    const arr = map.get(key) ?? []
    arr.push(r.photo_ref)
    map.set(key, arr)
  }
  return map
}

// Replaces a unit's gallery with exactly `refs` (in the given order). Runs
// inside the caller's transaction so the swap is atomic with the unit write.
async function syncPhotoGallery(db: DatabaseAdapter, unitId: number, refs: string[]): Promise<void> {
  await db.query('DELETE FROM item_unit_photos WHERE item_unit_id = ?', [unitId])
  for (let i = 0; i < refs.length; i++) {
    await db.query(
      'INSERT INTO item_unit_photos (item_unit_id, photo_ref, sort_order) VALUES (?, ?, ?)',
      [unitId, refs[i], i]
    )
  }
}

const SELECT_WITH_DETAILS = `
  SELECT
    u.*,
    i.category AS item_category,
    i.name AS item_name,
    p.name AS project_name,
    rp.name AS retired_from_project_name
  FROM item_units u
  JOIN items i ON i.id = u.item_id
  LEFT JOIN projects p ON p.id = u.assigned_project_id
  LEFT JOIN projects rp ON rp.id = u.retired_from_project_id
`

export async function getItemUnitById(db: DatabaseAdapter, id: number): Promise<ItemUnitWithDetails | null> {
  const row = await db.queryOne(`${SELECT_WITH_DETAILS} WHERE u.id = ?`, [id])
  if (!row) return null
  const typed = row as unknown as ItemUnitWithDetailsRow
  const photos = await loadPhotoRefs(db, [Number(typed.id)])
  return toItemUnitWithDetails(typed, photos.get(Number(typed.id)) ?? [])
}

export async function listItemUnits(db: DatabaseAdapter, filter?: ItemUnitFilter): Promise<ItemUnitWithDetails[]> {
  const clauses: string[] = []
  const params: (number | string | null)[] = []

  if (filter?.itemId !== undefined) {
    clauses.push('u.item_id = ?')
    params.push(filter.itemId)
  }
  if (filter?.projectId !== undefined) {
    if (filter.projectId === null) {
      clauses.push('u.assigned_project_id IS NULL')
    } else {
      clauses.push('u.assigned_project_id = ?')
      params.push(filter.projectId)
    }
  }
  if (filter?.status !== undefined) {
    clauses.push('u.status = ?')
    params.push(filter.status)
  }

  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : ''
  const { rows } = await db.query(
    `${SELECT_WITH_DETAILS} ${where} ORDER BY i.category, i.name, u.serial_id`,
    params
  )
  const typedRows = rows as unknown as ItemUnitWithDetailsRow[]
  const photos = await loadPhotoRefs(db, typedRows.map((r) => Number(r.id)))
  return typedRows.map((r) => toItemUnitWithDetails(r, photos.get(Number(r.id)) ?? []))
}

// Keeps an item's initial_stock equal to its actual number of tracked units, so
// the dashboard's stock/available figures always reflect reality. Called after
// any add/delete/move-between-items. (Retiring a unit doesn't change the count —
// the dashboard nets retired out separately.)
export async function syncInitialStock(db: DatabaseAdapter, itemId: number): Promise<void> {
  await db.query(
    'UPDATE items SET initial_stock = (SELECT COUNT(*) FROM item_units WHERE item_id = ?) WHERE id = ?',
    [itemId, itemId]
  )
}

export async function createItemUnit(db: DatabaseAdapter, input: ItemUnitInput): Promise<ItemUnitWithDetails> {
  return db.transaction(async (tx) => {
    // A retired unit holds no live assignment; the project it was on is recorded
    // as retired_from so the write-off stays traceable to a site.
    const retiring = input.status === 'Retired-Damaged'
    const assignedProjectId = retiring ? null : input.assignedProjectId
    const retiredFromProjectId = retiring ? input.assignedProjectId : null

    // With a gallery supplied, the cover is its first photo; otherwise fall back
    // to the single photoEvidenceRef (non-UI callers that don't build a gallery).
    const gallery = input.photoRefs
    const cover = gallery !== undefined ? (gallery[0] ?? null) : input.photoEvidenceRef

    const result = await tx.query(
      `INSERT INTO item_units (item_id, serial_id, assigned_project_id, audit_date, remarks, status, photo_evidence_ref, retired_from_project_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
      [
        input.itemId,
        input.serialId,
        assignedProjectId,
        input.auditDate,
        input.remarks,
        input.status,
        cover,
        retiredFromProjectId
      ]
    )
    const newId = Number(result.lastInsertRowid)
    // Seed the gallery from the supplied set, or from the lone cover so an
    // import-created unit still reads back a one-photo gallery.
    if (gallery !== undefined) await syncPhotoGallery(tx, newId, gallery)
    else if (cover) await syncPhotoGallery(tx, newId, [cover])

    await syncInitialStock(tx, input.itemId)
    const row = await tx.queryOne(`${SELECT_WITH_DETAILS} WHERE u.id = ?`, [newId])
    const photos = await loadPhotoRefs(tx, [newId])
    return toItemUnitWithDetails(row as unknown as ItemUnitWithDetailsRow, photos.get(newId) ?? [])
  })
}

export async function updateItemUnit(
  db: DatabaseAdapter,
  id: number,
  input: ItemUnitInput
): Promise<ItemUnitWithDetails> {
  return db.transaction(async (tx) => {
    // Remember the current item so, if the edit reassigns the unit to a different
    // item type, both items' stock counts can be resynced.
    const before = (await tx.queryOne('SELECT item_id FROM item_units WHERE id = ?', [id])) as
      | { item_id: number }
      | null

    // When a unit is (or stays) retired, it carries no live assignment and we
    // remember the project that caused the write-off. The source is, in order:
    // the project on the form, the existing retired_from (so a re-save of an
    // already-retired unit doesn't lose it), then the unit's current assignment.
    const retiring = input.status === 'Retired-Damaged'
    let assignedProjectId = input.assignedProjectId
    let retiredFromProjectId: number | null = null
    if (retiring) {
      const existing = (await tx.queryOne(
        'SELECT assigned_project_id, retired_from_project_id FROM item_units WHERE id = ?',
        [id]
      )) as unknown as { assigned_project_id: number | null; retired_from_project_id: number | null } | null
      assignedProjectId = null
      retiredFromProjectId =
        input.assignedProjectId ??
        (existing?.retired_from_project_id ? Number(existing.retired_from_project_id) : null) ??
        (existing?.assigned_project_id ? Number(existing.assigned_project_id) : null)
    }

    // A supplied gallery replaces the unit's photos and dictates the cover; when
    // omitted, leave the gallery untouched and keep the given cover as-is.
    const gallery = input.photoRefs
    const cover = gallery !== undefined ? (gallery[0] ?? null) : input.photoEvidenceRef

    await tx.query(
      `UPDATE item_units
       SET item_id = ?, serial_id = ?, assigned_project_id = ?, audit_date = ?,
           remarks = ?, status = ?, photo_evidence_ref = ?, retired_from_project_id = ?
       WHERE id = ?`,
      [
        input.itemId,
        input.serialId,
        assignedProjectId,
        input.auditDate,
        input.remarks,
        input.status,
        cover,
        retiredFromProjectId,
        id
      ]
    )
    if (gallery !== undefined) await syncPhotoGallery(tx, id, gallery)

    await syncInitialStock(tx, input.itemId)
    if (before && Number(before.item_id) !== input.itemId) await syncInitialStock(tx, Number(before.item_id))

    const row = await tx.queryOne(`${SELECT_WITH_DETAILS} WHERE u.id = ?`, [id])
    if (!row) throw new Error(`Item unit ${id} not found`)
    const photos = await loadPhotoRefs(tx, [id])
    return toItemUnitWithDetails(row as unknown as ItemUnitWithDetailsRow, photos.get(id) ?? [])
  })
}

export async function deleteItemUnit(db: DatabaseAdapter, id: number): Promise<void> {
  const row = (await db.queryOne('SELECT item_id FROM item_units WHERE id = ?', [id])) as
    | { item_id: number }
    | null
  await db.query('DELETE FROM item_units WHERE id = ?', [id])
  if (row) await syncInitialStock(db, Number(row.item_id))
}

interface MoveSnapshotRow {
  item_id: number
  serial_id: string | null
  assigned_project_id: number | null
  status: UnitStatus
}

/**
 * Atomically relocates a batch of units to one destination (a project, or null
 * = the available pool). For each unit: re-derives status from the destination
 * (In Use on a project, Available off it), updates the assignment, and writes a
 * transfer-log row capturing where it came from. The whole batch runs in a
 * single transaction, so a failure on unit N rolls back units 1..N-1 too —
 * nothing is left half-moved or missing its audit trail.
 *
 * Retired/written-off units are never moved (skipped, counted separately), and
 * a unit already at the destination is a no-op (no spurious self-transfer row).
 */
export async function moveUnits(db: DatabaseAdapter, input: MoveUnitsInput): Promise<MoveUnitsResult> {
  return db.transaction(async (tx) => {
    let movedCount = 0
    let skippedRetired = 0

    for (const unitId of input.unitIds) {
      const unit = (await tx.queryOne(
        'SELECT item_id, serial_id, assigned_project_id, status FROM item_units WHERE id = ?',
        [unitId]
      )) as unknown as MoveSnapshotRow | null
      if (!unit) throw new Error(`Item unit ${unitId} not found`)

      if (unit.status === 'Retired-Damaged') {
        skippedRetired++
        continue
      }

      const fromProjectId = unit.assigned_project_id ? Number(unit.assigned_project_id) : null
      if (fromProjectId === input.toProjectId) continue // already there — nothing to record

      const newStatus: UnitStatus = input.toProjectId === null ? 'Available' : 'In Use'
      await tx.query('UPDATE item_units SET assigned_project_id = ?, status = ? WHERE id = ?', [
        input.toProjectId,
        newStatus,
        unitId
      ])
      await tx.query(
        `INSERT INTO transfers (date, item_id, serial_id, qty, from_project_id, to_project_id, transferred_by, authorized_by, notes, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          input.date,
          unit.item_id,
          unit.serial_id,
          1,
          fromProjectId,
          input.toProjectId,
          input.transferredBy,
          input.authorizedBy,
          input.notes,
          'Completed'
        ]
      )
      movedCount++
    }

    return { movedCount, skippedRetired }
  })
}
