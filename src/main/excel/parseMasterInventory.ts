// One-time-seed parser for the existing "Master_Inventory final.xlsx" workbook
// (see the project plan for its layout). Pure functions — no DB or Electron
// access — so they're easy to unit-test and reuse later for the Excel
// import/reconciliation milestone, which will face a similar row-block shape.
import { utils, type WorkBook } from 'xlsx'

export interface ParsedProject {
  // Canonical project name. Deliberately taken from the "Assigned Project"
  // values in the "Item ID Details" sheet (== the sheet/tab names) rather
  // than the friendlier "Project Name" field inside each project sheet
  // (e.g. "At North Copenhagen" vs "North Copenhagen") — the short form is
  // what every cross-reference in the workbook actually uses, so adopting it
  // as our key avoids a name-mapping table that could silently drift out of
  // sync with the source data.
  name: string
  location: string | null
  updatedBy: string | null
  lastUpdatedDate: string | null // ISO yyyy-mm-dd, or null if blank/unparseable
}

export interface ParsedItem {
  // The workbook's row number ("No" in Main Inventory / "Item No" in Item ID
  // Details) — used only to join units to their item type during seeding.
  // Not part of our schema (items are identified by category+name there).
  itemNo: string
  category: string
  name: string
  initialStock: number
}

export type UnitStatus = 'In Use' | 'Available' | 'Retired-Damaged'

export interface ParsedUnit {
  itemNo: string // joins to ParsedItem.itemNo
  projectName: string | null // null = "Not allocated to any project"
  serialId: string | null // null = "(no unique ID)" / "—"
  auditDate: string | null // ISO yyyy-mm-dd, or null
  remarks: string | null
  status: UnitStatus
}

export interface ParsedMasterInventory {
  projects: ParsedProject[]
  items: ParsedItem[]
  units: ParsedUnit[]
}

const MAIN_INVENTORY_SHEET = 'Main Inventory'
const ITEM_ID_DETAILS_SHEET = 'Item ID Details'
const NOT_ALLOCATED = 'Not allocated to any project'
const PLACEHOLDER_VALUES = new Set(['—', '(no unique ID)', ''])

type Row = string[]

function sheetRows(workbook: WorkBook, sheetName: string): Row[] {
  const sheet = workbook.Sheets[sheetName]
  if (!sheet) throw new Error(`Expected a "${sheetName}" sheet but it was not found in the workbook`)
  // header: 1 -> array-of-arrays; raw: false -> cells come through as the
  // same display strings a person reading the sheet would see (so dates like
  // "07/04/2026" arrive as text, not Excel serial numbers).
  return utils.sheet_to_json<Row>(sheet, { header: 1, raw: false, defval: '' })
}

function cell(row: Row, index: number): string {
  return (row[index] ?? '').toString().trim()
}

function nullableCell(row: Row, index: number): string | null {
  const value = cell(row, index)
  return PLACEHOLDER_VALUES.has(value) ? null : value
}

// The sheets use "DD/MM/YYYY"; normalize to ISO so dates sort/compare
// correctly once in SQLite. Returns null for blanks or anything that doesn't
// match — better to seed a missing date than guess wrong.
function parseSheetDate(value: string): string | null {
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value.trim())
  if (!match) return null
  const [, day, month, year] = match
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
}

function parseStatus(value: string): UnitStatus {
  if (value === 'In Use' || value === 'Available' || value === 'Retired-Damaged') return value
  // Any unrecognized status is more useful surfaced than silently coerced —
  // but a missing/blank cell is common for the zero-stock placeholder rows,
  // which the caller filters out before this is reached for real units.
  throw new Error(`Unrecognized unit status "${value}"`)
}

/** Parses the "Main Inventory" sheet's item-type rows (No/Category/Item Name/Initial Stock/...). */
export function parseItems(workbook: WorkBook): ParsedItem[] {
  const rows = sheetRows(workbook, MAIN_INVENTORY_SHEET)
  const items: ParsedItem[] = []

  for (const row of rows) {
    const itemNo = cell(row, 0)
    const category = cell(row, 1)
    const name = cell(row, 2)
    // Real item rows have a numeric "No"; everything else (title, blank
    // spacer rows, the "TOTALS" row, the "[+ ADD NEW ITEM]" helper text) does
    // not — that's a simpler and more robust filter than matching headings.
    if (!/^\d+$/.test(itemNo) || !category || !name) continue

    const initialStock = Number.parseInt(cell(row, 3), 10)
    items.push({
      itemNo,
      category,
      name,
      initialStock: Number.isFinite(initialStock) ? initialStock : 0
    })
  }

  return items
}

/** Parses the "Item ID Details" sheet's per-unit rows, skipping section headers, blank separators, and zero-stock placeholder rows. */
export function parseUnits(workbook: WorkBook): ParsedUnit[] {
  const rows = sheetRows(workbook, ITEM_ID_DETAILS_SHEET)
  const units: ParsedUnit[] = []

  for (const row of rows) {
    const sequence = cell(row, 0)
    const itemNo = cell(row, 1)
    // Real unit rows have a numeric running "#"; the zero-stock placeholder
    // rows use "—" there (and "—" everywhere else too — see PLACEHOLDER_VALUES),
    // section headers ("  Item 04  |  Body Harness  |  Total Allocated: 20")
    // only populate column A, and separator rows are entirely blank.
    if (!/^\d+$/.test(sequence) || !itemNo) continue

    const projectName = cell(row, 3)
    units.push({
      itemNo,
      projectName: projectName === NOT_ALLOCATED ? null : projectName || null,
      serialId: nullableCell(row, 4),
      auditDate: (() => {
        const raw = nullableCell(row, 5)
        return raw ? parseSheetDate(raw) : null
      })(),
      remarks: nullableCell(row, 6),
      status: parseStatus(cell(row, 7))
    })
  }

  return units
}

// The three project sheets share a small header block (rows 6-8, 1-indexed)
// with Project Name / Location / Updated by / Last Updated Date. We don't use
// the "Project Name" cell as our canonical name (see ParsedProject doc) but
// do want the rest of that metadata.
function parseProjectSheetMetadata(
  workbook: WorkBook,
  sheetName: string
): Pick<ParsedProject, 'location' | 'updatedBy' | 'lastUpdatedDate'> {
  const sheet = workbook.Sheets[sheetName]
  if (!sheet) return { location: null, updatedBy: null, lastUpdatedDate: null }

  const rows = utils.sheet_to_json<Row>(sheet, { header: 1, raw: false, defval: '' })
  let location: string | null = null
  let updatedBy: string | null = null
  let lastUpdatedDate: string | null = null

  for (const row of rows) {
    const label = cell(row, 1)
    if (label === 'Project Location:') location = cell(row, 3) || null
    else if (label === 'Updated by:') updatedBy = cell(row, 3) || null
    else if (label === 'Project Name :') {
      const dateLabel = cell(row, 6)
      if (dateLabel === 'Last Updated Date:') lastUpdatedDate = parseSheetDate(cell(row, 7))
    }
  }

  return { location, updatedBy, lastUpdatedDate }
}

/**
 * Derives the project list from the project names actually referenced in
 * "Item ID Details" (the source of truth for what a unit is assigned to),
 * then enriches each with location/updated-by/date by looking for a sheet
 * of the same name. A project with no matching sheet still seeds — just
 * with null metadata — rather than silently dropping units assigned to it.
 */
export function parseProjects(workbook: WorkBook, units: ParsedUnit[]): ParsedProject[] {
  const names = [...new Set(units.map((u) => u.projectName).filter((n): n is string => n !== null))]
  names.sort()

  return names.map((name) => ({
    name,
    ...parseProjectSheetMetadata(workbook, name)
  }))
}

export function parseMasterInventory(workbook: WorkBook): ParsedMasterInventory {
  const items = parseItems(workbook)
  const units = parseUnits(workbook)
  const projects = parseProjects(workbook, units)
  return { projects, items, units }
}
