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

const COL_CATEGORY  = 1   // B — Category
const COL_ITEM_NAME = 3   // D — Item Name
const COL_QTY       = 4   // E — Quantity
const COL_SERIAL    = 5   // F — Serial Number/s
const COL_AUDIT_DATE = 7  // H — Initial Audit Date
const COL_REMARKS   = 8   // I — Remarks

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
  if (!marker) return null

  const visibleSheets = workbook.SheetNames.filter((name) => !name.startsWith('_'))
  if (visibleSheets.length === 0) return null

  const sheetName = visibleSheets[0]
  const sheet = workbook.Sheets[sheetName]
  if (!sheet) return null

  const rows = utils.sheet_to_json<string[]>(sheet, { header: 1, raw: false, defval: '' })

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

    // A new category or item name signals the start of a new item block.
    const newCategory = category !== '' ? category : currentCategory
    const newItemName = itemName  !== '' ? itemName  : currentItemName

    if (
      newCategory !== currentCategory ||
      newItemName !== currentItemName
    ) {
      currentCategory = newCategory
      currentItemName = newItemName

      // Start a fresh block; declaredQty comes from column E on this header row.
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

    // Skip completely empty data rows (no serial, no date, no remarks).
    if (!serialId && !auditDate && !remarks) continue

    const unit: ImportedUnit = {
      category: currentCategory,
      itemName: currentItemName,
      serialId,
      auditDate,
      remarks
    }

    currentBlock.units.push(unit)
    allUnits.push(unit)
  }

  return { marker, units: allUnits, itemBlocks }
}
