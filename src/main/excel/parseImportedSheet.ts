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
 * from the Quantity column. The quantity is used to reconcile anonymous
 * (non-serialised) units: if the sheet says 5 but the DB has 3, we create 2.
 */
export interface ImportedItemBlock {
  category: string
  itemName: string
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
  return index >= 0 ? (row[index] ?? '').toString().trim() : ''
}

function nullableCell(row: string[], index: number): string | null {
  const value = cell(row, index)
  return value === '' || value === '-' ? null : value
}

interface Columns {
  category: number
  itemName: number
  qty: number
  serial: number
  auditDate: number
  remarks: number
}

/**
 * Locates the header row and the column index of each field by its label text,
 * rather than assuming fixed positions. Project sheets vary: app exports and the
 * current hand-maintained workbooks carry a blank left-margin column (shifting
 * everything one column right), and older sheets don't — fixed column constants
 * silently mis-parsed one or the other. Matching on the header labels handles
 * every layout, and pins the data start to the row *after* the header.
 */
function detectColumns(rows: string[][]): { headerRow: number; cols: Columns } | null {
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i].map((c) => (c ?? '').toString().trim().toLowerCase())
    const itemName = r.findIndex((c) => c === 'item name')
    const serial = r.findIndex((c) => c.startsWith('serial'))
    if (itemName < 0 || serial < 0) continue
    return {
      headerRow: i,
      cols: {
        category: r.findIndex((c) => c.startsWith('category')),
        itemName,
        qty: r.findIndex((c) => c.startsWith('quantity') || c === 'qty'),
        serial,
        auditDate: r.findIndex((c) => c.includes('audit')),
        // The first "Remarks" at/after the serial column is the initial remarks;
        // a later "Remarks" (the hand-over remarks) is intentionally ignored.
        remarks: r.findIndex((c, idx) => c === 'remarks' && idx > serial)
      }
    }
  }
  return null
}

// "Inventory - At North Copenhagen (1) (2).xlsx" → "At North Copenhagen"
function deriveProjectNameFromFile(filePath: string): string {
  const fileName = basename(filePath, '.xlsx')
  const withoutPrefix = fileName.replace(/^Inventory\s*-\s*/i, '')
  return withoutPrefix.replace(/(\s*\(\d+\))+$/, '').trim() || withoutPrefix.trim()
}

export function parseImportedSheet(filePath: string): ImportedProjectSheet | null {
  const workbook: WorkBook = readFile(filePath)
  const marker = readExportMarker(workbook)

  const visibleSheets = workbook.SheetNames.filter((name) => !name.startsWith('_'))
  if (visibleSheets.length === 0) return null
  const sheet = workbook.Sheets[visibleSheets[0]]
  if (!sheet) return null

  // Force the read range to start at A1. The export leaves column A (a blank
  // left margin) and row 1 empty, so the sheet's stored `!ref` starts at B2 —
  // which would make `sheet_to_json` index column B as 0 and drop row 1.
  // Pinning the origin to A1 keeps every column index stable.
  const fullRange = utils.decode_range(sheet['!ref'] ?? 'A1')
  fullRange.s.c = 0
  fullRange.s.r = 0
  const rows = utils.sheet_to_json<string[]>(sheet, {
    header: 1,
    raw: false,
    defval: '',
    range: utils.encode_range(fullRange)
  })

  const detected = detectColumns(rows)
  if (!detected) return null
  const { headerRow, cols } = detected

  // Trust the embedded marker for app-exported sheets; otherwise synthesize one
  // from the filename for hand-maintained sheets (projectId 0 → name matching).
  const resolvedMarker: ExportMarker = marker ?? {
    projectId: 0,
    projectName: deriveProjectNameFromFile(filePath),
    exportedAt: new Date().toISOString()
  }
  if (!resolvedMarker.projectName) return null

  const allUnits: ImportedUnit[] = []
  const itemBlocks: ImportedItemBlock[] = []

  let currentCategory: string | null = null
  let currentItemName: string | null = null
  let currentBlock: ImportedItemBlock | null = null

  for (let i = headerRow + 1; i < rows.length; i++) {
    const row = rows[i]
    if (!row || row.length === 0) continue

    const category = cell(row, cols.category)
    const itemName = cell(row, cols.itemName)
    const serialId = nullableCell(row, cols.serial)
    const auditDate = parseSheetDate(cell(row, cols.auditDate))
    const remarks = nullableCell(row, cols.remarks)

    const newCategory = category !== '' ? category : currentCategory
    const newItemName = itemName !== '' ? itemName : currentItemName

    if (newCategory !== currentCategory || newItemName !== currentItemName) {
      currentCategory = newCategory
      currentItemName = newItemName
      const qty = parseInt(cell(row, cols.qty), 10)
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

  return { marker: resolvedMarker, units: allUnits, itemBlocks }
}
