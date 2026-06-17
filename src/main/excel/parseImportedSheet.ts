import { basename } from 'path'
import { readFile, utils, type WorkBook } from 'xlsx'
import { readExportMarker, type ExportMarker } from './exportProjectSheet'

export interface ImportedUnit {
  category: string
  itemName: string
  // Null for quantity-only items (no individual serial tracking).
  serialId: string | null
  auditDate: string | null
  remarks: string | null
}

/**
 * One item block parsed from the sheet — groups all the units (rows) that
 * belong to the same category + item name, plus the declared total quantity
 * from column E. The quantity is used to reconcile anonymous (non-serialised)
 * units: if the sheet says 5 but the DB has 3, we create 2 more.
 */
export interface ImportedItemBlock {
  category: string
  itemName: string
  // The value in the Quantity column on the item's header row (the row where
  // category and item name first appear). 0 if the cell was blank/non-numeric.
  declaredQty: number
  units: ImportedUnit[]
}

export interface ImportedProjectSheet {
  marker: ExportMarker
  // All parsed units flattened (for backward-compat with existing callers).
  units: ImportedUnit[]
  // Grouped by item block — used for quantity-diff reconciliation.
  itemBlocks: ImportedItemBlock[]
}

const FIRST_DATA_ROW_INDEX = 10

// Column indices for app-exported sheets (have _diginext_meta)
const COL_CATEGORY   = 1  // B
const COL_ITEM_NAME  = 3  // D
const COL_QTY        = 4  // E
const COL_SERIAL     = 5  // F
const COL_AUDIT_DATE = 7  // H
const COL_REMARKS    = 8  // I

// Column indices for original hand-maintained project sheets (no _diginext_meta)
// Layout: A=Category, B=ItemNo, C=ItemName, D=Qty, E=Serial, F=Photo, G=AuditDate, H=Remarks
const ORIG_COL_CATEGORY   = 0
const ORIG_COL_ITEM_NO    = 1
const ORIG_COL_ITEM_NAME  = 2
const ORIG_COL_QTY        = 3
const ORIG_COL_SERIAL     = 4
const ORIG_COL_AUDIT_DATE = 6
const ORIG_COL_REMARKS    = 7

function parseSheetDate(value: string): string | null {
  if (!value) return null
  // dd/mm/yyyy (the format the export writes)
  const dmy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value.trim())
  if (dmy) {
    const [, day, month, year] = dmy
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
  }
  // yyyy-mm-dd (ISO, safe to return as-is)
  if (/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) return value.trim()
  return null
}

function cell(row: string[], index: number): string {
  return (row[index] ?? '').toString().trim()
}

function nullableCell(row: string[], index: number): string | null {
  const value = cell(row, index)
  return value === '' || value === '-' ? null : value
}

export function parseImportedSheet(filePath: string): ImportedProjectSheet | null {
  const workbook: WorkBook = readFile(filePath)
  const marker = readExportMarker(workbook)

  const visibleSheets = workbook.SheetNames.filter((name) => !name.startsWith('_'))
  if (visibleSheets.length === 0) return null

  const sheetName = visibleSheets[0]
  const sheet = workbook.Sheets[sheetName]
  if (!sheet) return null

  // Force the read range to start at A1. The export leaves column A (a blank
  // left margin) and row 1 empty, so the sheet's stored `!ref` starts at B2 —
  // which would make `sheet_to_json` index column B as 0 and drop row 1,
  // shifting every fixed column/row constant below by one and silently parsing
  // nothing. Pinning the origin to A1 keeps `COL_*` / `*_ROW_INDEX` stable
  // whether or not leading rows/columns happen to be empty.
  const fullRange = utils.decode_range(sheet['!ref'] ?? 'A1')
  fullRange.s.c = 0
  fullRange.s.r = 0
  const rows = utils.sheet_to_json<string[]>(sheet, {
    header: 1,
    raw: false,
    defval: '',
    range: utils.encode_range(fullRange)
  })

  // If no app metadata sheet, this is an original hand-maintained project sheet.
  // Parse it with the original column layout and derive the project name.
  if (!marker) {
    return parseOriginalSheet(filePath, rows)
  }

  // --- App-exported sheet (has _diginext_meta) ---
  const allUnits: ImportedUnit[] = []
  const itemBlocks: ImportedItemBlock[] = []

  let currentCategory: string | null = null
  let currentItemName: string | null = null
  let currentBlock: ImportedItemBlock | null = null

  for (let i = FIRST_DATA_ROW_INDEX; i < rows.length; i++) {
    const row = rows[i]
    if (!row || row.length === 0) continue

    const category  = cell(row, COL_CATEGORY)
    const itemName  = cell(row, COL_ITEM_NAME)
    const qtyRaw    = cell(row, COL_QTY)
    const serialId  = nullableCell(row, COL_SERIAL)
    const auditDate = parseSheetDate(cell(row, COL_AUDIT_DATE))
    const remarks   = nullableCell(row, COL_REMARKS)

    const newCategory = category !== '' ? category : currentCategory
    const newItemName = itemName  !== '' ? itemName  : currentItemName

    if (newCategory !== currentCategory || newItemName !== currentItemName) {
      currentCategory = newCategory
      currentItemName = newItemName
      const qty = parseInt(qtyRaw, 10)
      currentBlock = {
        category: currentCategory ?? '',
        itemName: currentItemName ?? '',
        declaredQty: isNaN(qty) ? 0 : qty,
        units: []
      }
      itemBlocks.push(currentBlock)
    }

    if (!currentCategory || !currentItemName || !currentBlock) continue
    if (!serialId && !auditDate && !remarks) continue

    const unit: ImportedUnit = { category: currentCategory, itemName: currentItemName, serialId, auditDate, remarks }
    currentBlock.units.push(unit)
    allUnits.push(unit)
  }

  return { marker, units: allUnits, itemBlocks }
}

/**
 * Parses an original hand-maintained project sheet (no _diginext_meta).
 * Column layout: A=Category, B=ItemNo, C=ItemName, D=Qty, E=Serial, F=Photo, G=AuditDate, H=Remarks
 * Project name is derived from the file name (strip "Inventory - " prefix and trailing copy suffixes).
 */
function parseOriginalSheet(filePath: string, rows: string[][]): ImportedProjectSheet | null {
  // Derive project name from the filename, e.g.:
  //   "Inventory - At North Copenhagen (1) (2).xlsx" → "At North Copenhagen"
  const fileName = basename(filePath, '.xlsx')
  const withoutPrefix = fileName.replace(/^Inventory\s*-\s*/i, '')
  const projectName = withoutPrefix.replace(/(\s*\(\d+\))+$/, '').trim() || withoutPrefix.trim()

  if (!projectName) return null

  const syntheticMarker: ExportMarker = {
    projectId: 0,
    projectName,
    exportedAt: new Date().toISOString()
  }

  const allUnits: ImportedUnit[] = []
  const itemBlocks: ImportedItemBlock[] = []

  let currentCategory: string | null = null
  let currentItemName: string | null = null
  let currentBlock: ImportedItemBlock | null = null

  for (let i = FIRST_DATA_ROW_INDEX; i < rows.length; i++) {
    const row = rows[i]
    if (!row || row.length === 0) continue

    const itemNo   = cell(row, ORIG_COL_ITEM_NO)
    const category = cell(row, ORIG_COL_CATEGORY)
    const itemName = cell(row, ORIG_COL_ITEM_NAME)
    const qtyRaw   = cell(row, ORIG_COL_QTY)
    const serialId = nullableCell(row, ORIG_COL_SERIAL)
    const auditDate = parseSheetDate(cell(row, ORIG_COL_AUDIT_DATE))
    const remarks  = nullableCell(row, ORIG_COL_REMARKS)

    // A row with a numeric item number starts a new item block.
    if (/^\d+$/.test(itemNo)) {
      currentCategory = category !== '' ? category : currentCategory
      currentItemName = itemName !== '' ? itemName : null

      if (currentCategory && currentItemName) {
        const qty = parseInt(qtyRaw, 10)
        currentBlock = {
          category: currentCategory,
          itemName: currentItemName,
          declaredQty: isNaN(qty) ? 0 : qty,
          units: []
        }
        itemBlocks.push(currentBlock)
      }
    }

    if (!currentCategory || !currentItemName || !currentBlock) continue
    if (!serialId && !auditDate && !remarks) continue

    const unit: ImportedUnit = { category: currentCategory, itemName: currentItemName, serialId, auditDate, remarks }
    currentBlock.units.push(unit)
    allUnits.push(unit)
  }

  return { marker: syntheticMarker, units: allUnits, itemBlocks }
}
