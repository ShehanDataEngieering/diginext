import { readFile, utils, type WorkBook } from 'xlsx'
import { readExportMarker, type ExportMarker } from './exportProjectSheet'

export interface ImportedUnit {
  category: string
  itemName: string
  serialId: string | null
  auditDate: string | null
  remarks: string | null
}

export interface ImportedProjectSheet {
  marker: ExportMarker
  units: ImportedUnit[]
}

const FIRST_DATA_ROW_INDEX = 10

const COL_CATEGORY = 1
const COL_ITEM_NAME = 3
const COL_SERIAL = 5
const COL_AUDIT_DATE = 7
const COL_REMARKS = 8

function parseSheetDate(value: string): string | null {
  if (!value) return null
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value.trim())
  if (match) {
    const [, day, month, year] = match
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
  }
  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim())
  if (isoMatch) return value.trim()
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
  const units: ImportedUnit[] = []

  let currentCategory: string | null = null
  let currentItemName: string | null = null

  for (let i = FIRST_DATA_ROW_INDEX; i < rows.length; i++) {
    const row = rows[i]
    if (!row || row.length === 0) continue

    const category = cell(row, COL_CATEGORY)
    const itemName = cell(row, COL_ITEM_NAME)
    const serialId = nullableCell(row, COL_SERIAL)
    const auditDate = parseSheetDate(cell(row, COL_AUDIT_DATE))
    const remarks = nullableCell(row, COL_REMARKS)

    if (category) currentCategory = category
    if (itemName) currentItemName = itemName

    if (!currentCategory || !currentItemName) continue
    if (!serialId && !auditDate && !remarks) continue

    units.push({
      category: currentCategory,
      itemName: currentItemName,
      serialId,
      auditDate,
      remarks
    })
  }

  return { marker, units }
}
