// Builds a per-project inventory workbook for "Export inventory sheet for
// [Project]" (see plan's Excel Export section). Pure functions — no DB or
// Electron access — mirroring parseMasterInventory.ts's approach so this
// stays easy to test and so the row-block shape it writes can be reused
// (read this time, not written) by the future import/reconciliation milestone.
//
// Layout reference: `Inventory - At North Copenhagen (1).xlsx`'s "in" sheet,
// inspected directly while designing this module. That sheet's column order
// (0-indexed, matching the arrays below) is:
//   0 Category | 1 Item No | 2 Item Name | 3 Quantity | 4 Serial Number/s |
//   5 Initial-Photo Evidence | 6 Initial Audit Date | 7 Remarks |
//   8 Hand Over-Photo Evidence | 9 Hand Over-Date | 10 Remarks
// Item blocks: one row per item type (category shown only on the first row of
// each category group, via a merged cell), followed by one row per serialized
// unit of that item (blank category/item-no/name/qty cells, serial + photo +
// audit + remarks filled in). Items with no serialized units stop at the
// item-type row.
import { utils, type WorkBook } from 'xlsx'
import type { Item, ItemUnitWithDetails, Project } from '../../shared/ipc'

// Name of the visible data sheet — kept generic ("in") rather than
// project-specific so re-imports don't need to guess the sheet name; matches
// the convention already used by the reference template.
export const EXPORT_DATA_SHEET = 'in'

// A second, hidden sheet carrying a machine-readable marker — see the plan's
// "embed a hidden marker (e.g. a cell with the project ID + export
// timestamp) so re-imports can be matched to the right project unambiguously".
// A dedicated sheet (rather than a stray cell tucked into the visible one) is
// robust against the recipient reformatting/relocating visible cells, and is
// trivial to read back with `readExportMarker` below.
export const EXPORT_META_SHEET = '_diginext_meta'

const EXPORT_FORMAT_TAG = 'diginext-project-inventory-v1'

const COLUMN_HEADERS = [
  'Category',
  'Item No',
  'Item Name',
  'Quantity',
  'Serial Number/s',
  'Initial-Photo Evidence',
  'Initial Audit Date',
  'Remarks',
  'Hand Over-Photo Evidence',
  'Hand Over-Date',
  'Remarks'
]

export interface ExportMarker {
  projectId: number
  projectName: string
  exportedAt: string // ISO 8601 timestamp
}

type SheetCell = string | number
type MergeRange = { s: { r: number; c: number }; e: { r: number; c: number } }

/**
 * Assembles the workbook for one project: a header block (name/location/
 * updated-by/date), the column-header row, then one row-block per item type
 * (its current total at this project plus a row per serialized unit), and a
 * hidden metadata sheet carrying the re-import marker.
 *
 * `units` may contain units for other projects too (callers can pass the
 * full list from a single `listItemUnits` call); only units actually
 * assigned to `project.id` are included here.
 */
export function buildProjectInventoryWorkbook(
  project: Project,
  items: Item[],
  units: ItemUnitWithDetails[]
): WorkBook {
  const unitsByItemId = groupUnitsByItem(units, project.id)
  const { rows, merges } = buildDataRows(project, items, unitsByItemId)

  // The reference templates leave column A blank — everything (title, header
  // block, table) starts at column B, giving the sheet a left margin. Shift
  // our content over to match that familiar look rather than hugging the
  // edge of the sheet.
  const offsetRows = rows.map((row) => ['', ...row])
  const offsetMerges = merges.map((merge) => ({
    s: { r: merge.s.r, c: merge.s.c + 1 },
    e: { r: merge.e.r, c: merge.e.c + 1 }
  }))

  const sheet = utils.aoa_to_sheet(offsetRows)
  sheet['!merges'] = offsetMerges
  sheet['!cols'] = [{ wch: 4 }, ...COLUMN_WIDTHS.map((wch) => ({ wch }))]

  const workbook = utils.book_new()
  utils.book_append_sheet(workbook, sheet, EXPORT_DATA_SHEET)
  appendMetaSheet(workbook, {
    projectId: project.id,
    projectName: project.name,
    exportedAt: new Date().toISOString()
  })

  return workbook
}

const COLUMN_WIDTHS = [22, 9, 28, 10, 20, 24, 16, 26, 24, 16, 26]

function groupUnitsByItem(
  units: ItemUnitWithDetails[],
  projectId: number
): Map<number, ItemUnitWithDetails[]> {
  const map = new Map<number, ItemUnitWithDetails[]>()
  for (const unit of units) {
    if (unit.assignedProjectId !== projectId) continue
    const list = map.get(unit.itemId)
    if (list) list.push(unit)
    else map.set(unit.itemId, [unit])
  }
  return map
}

function buildDataRows(
  project: Project,
  items: Item[],
  unitsByItemId: Map<number, ItemUnitWithDetails[]>
): { rows: SheetCell[][]; merges: MergeRange[] } {
  const rows: SheetCell[][] = []
  const merges: MergeRange[] = []

  // --- Title + header block, mirroring the reference template's row spacing -
  rows.push([])
  rows.push(['', '', '', '', 'Project Inventory'])
  rows.push([])
  merges.push({ s: { r: 1, c: 4 }, e: { r: 2, c: 6 } })
  rows.push([])
  rows.push([
    'Project Name :',
    '',
    project.name,
    '',
    // Reference templates label this "Last Updated Date:" and show the
    // project's own tracked last-updated date (the field site leads already
    // expect to see and revise) — not "when did the app generate this file",
    // which would be a different, less useful piece of information to them.
    // Fall back to today only for projects that have never recorded one.
    'Last Updated Date:',
    project.lastUpdatedDate ?? new Date().toISOString().slice(0, 10)
  ])
  rows.push(['Project Location:', '', project.location ?? ''])
  rows.push(['Updated by:', '', project.updatedBy ?? ''])
  rows.push([])

  // --- Column headers --------------------------------------------------------
  rows.push([...COLUMN_HEADERS])

  // --- Item blocks, grouped by category (catalog order; categories merge
  // their cell down the full group, like the reference) ----------------------
  let itemNo = 1
  let groupCategory: string | null = null
  let groupStartRow = rows.length

  const closeCategoryGroup = (): void => {
    if (groupCategory !== null && rows.length - 1 > groupStartRow) {
      merges.push({ s: { r: groupStartRow, c: 0 }, e: { r: rows.length - 1, c: 0 } })
    }
  }

  for (const item of items) {
    if (item.category !== groupCategory) {
      closeCategoryGroup()
      groupCategory = item.category
      groupStartRow = rows.length
    }

    const itemUnits = unitsByItemId.get(item.id) ?? []
    const serializedUnits = itemUnits.filter((unit) => unit.serialId !== null && unit.serialId !== '')

    const itemRowIndex = rows.length
    rows.push([
      rows.length === groupStartRow ? item.category : '',
      itemNo,
      item.name,
      // The reference templates write a literal "-" for "none of this here"
      // rather than leaving the cell blank — matches what site leads expect
      // to see for items they don't have (vs. "0", which would read as "we
      // had some and used them all").
      itemUnits.length > 0 ? itemUnits.length : '-'
    ])
    itemNo += 1

    for (const unit of serializedUnits) {
      rows.push([
        '',
        '',
        '',
        '',
        unit.serialId ?? '',
        unit.photoEvidenceRef ?? '',
        unit.auditDate ?? '',
        unit.remarks ?? ''
      ])
    }

    // Span "Item No"/"Item Name"/"Quantity" down across this item's unit rows
    // too — the reference template merges these the same way it merges Category.
    if (rows.length - 1 > itemRowIndex) {
      merges.push({ s: { r: itemRowIndex, c: 1 }, e: { r: rows.length - 1, c: 1 } })
      merges.push({ s: { r: itemRowIndex, c: 2 }, e: { r: rows.length - 1, c: 2 } })
      merges.push({ s: { r: itemRowIndex, c: 3 }, e: { r: rows.length - 1, c: 3 } })
    }

    rows.push([]) // blank separator row between item blocks, per the reference
  }
  closeCategoryGroup()

  return { rows, merges }
}

function appendMetaSheet(workbook: WorkBook, marker: ExportMarker): void {
  const rows: SheetCell[][] = [
    ['key', 'value'],
    ['format', EXPORT_FORMAT_TAG],
    ['projectId', marker.projectId],
    ['projectName', marker.projectName],
    ['exportedAt', marker.exportedAt]
  ]
  const sheet = utils.aoa_to_sheet(rows)
  utils.book_append_sheet(workbook, sheet, EXPORT_META_SHEET)

  // Mark the sheet hidden so it doesn't confuse whoever opens the file to
  // fill it in — it's a machine-readable marker for the re-import step, not
  // part of the form. `Workbook.Sheets[i].Hidden = 1` is SheetJS's documented
  // way to flag a sheet hidden when writing with the community `xlsx` build.
  const sheetIndex = workbook.SheetNames.indexOf(EXPORT_META_SHEET)
  workbook.Workbook = workbook.Workbook ?? {}
  workbook.Workbook.Sheets = workbook.Workbook.Sheets ?? []
  workbook.Workbook.Sheets[sheetIndex] = { Hidden: 1 }
}

/**
 * Reads the hidden marker back out of a workbook, if present — the
 * re-import milestone uses this to identify which project a returned
 * spreadsheet belongs to without trusting filenames or the editable header
 * block. Returns null for files that aren't ours (e.g. the original
 * hand-authored templates) so the importer can fall back to other matching.
 */
export function readExportMarker(workbook: WorkBook): ExportMarker | null {
  const sheet = workbook.Sheets[EXPORT_META_SHEET]
  if (!sheet) return null

  const rows = utils.sheet_to_json<SheetCell[]>(sheet, { header: 1, raw: false, defval: '' })
  const values = new Map(rows.slice(1).map((row) => [String(row[0]), String(row[1] ?? '')]))

  if (values.get('format') !== EXPORT_FORMAT_TAG) return null

  const projectId = Number.parseInt(values.get('projectId') ?? '', 10)
  if (!Number.isFinite(projectId)) return null

  return {
    projectId,
    projectName: values.get('projectName') ?? '',
    exportedAt: values.get('exportedAt') ?? ''
  }
}

/**
 * Output filename — keeps the recipient's familiar "Inventory - <Project>"
 * naming, with a date stamp so re-exporting the same project on a later day
 * produces a new file rather than silently overwriting the one already sent
 * out (we write straight to a fixed folder rather than via a save-as picker —
 * see the IPC handler for why).
 */
export function exportFileName(project: Project, date: Date = new Date()): string {
  const safeName = project.name.replace(/[\\/:*?"<>|]+/g, ' ').trim()
  const stamp = date.toISOString().slice(0, 10)
  return `Inventory - ${safeName} - ${stamp}.xlsx`
}
