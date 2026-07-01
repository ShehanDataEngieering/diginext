// Builds a handover report workbook matching the visual template of the
// project inventory export (same logo, title banner, colour bands, borders)
// but with handover-specific columns. Columns B-L mirror the inventory
// template exactly; M (Condition) and N (Action) extend it with dropdown
// validation so site leads can fill them in if the sheet is returned.
import ExcelJS from 'exceljs'
import { DIGINEXT_LOGO_BASE64 } from './diginextLogo'
import { readPhotoBuffer } from '../photos/photoStore'
import type { Handover, HandoverItem, PhotoLogEntry } from '../../shared/ipc'

// ---- Brand palette — identical to exportProjectSheet.ts -------------------
const TITLE_FILL  = 'FF1F3864'
const HEADER_FILL = 'FF2E5395'
const WHITE_FONT  = 'FFFFFFFF'
const DARK_FONT   = 'FF1F1F1F'

const CATEGORY_PALETTE: { fill: string; text: string }[] = [
  { fill: 'FFFFFF00', text: DARK_FONT },
  { fill: 'FF92D050', text: DARK_FONT },
  { fill: 'FFBDD7EE', text: DARK_FONT },
  { fill: 'FF7030A0', text: WHITE_FONT }
]

const CONDITIONS = ['Good', 'Damaged', 'Needs Repair', 'Lost']
const ACTIONS    = ['Return to stock', 'Retain at site', 'Retire / Dispose', 'Transfer to another project']

// ---- Column layout --------------------------------------------------------
// A = blank left margin (col 1), B-N = data (cols 2-14)
const COLUMN_B = 2

// Matches the inventory template exactly for cols B-L; extends with M and N.
const COLUMN_HEADERS = [
  'Category',                 // B
  'Item No',                  // C
  'Item Name',                // D
  'Quantity',                 // E
  'Serial Number/s',          // F
  'Initial-Photo Evidence',   // G
  'Initial Audit Date',       // H
  'Remarks',                  // I
  'Hand Over-Photo Evidence', // J
  'Hand Over-Date',           // K
  'Condition',                // L  (dropdown)
  'Action',                   // M  (dropdown)
  'Destination'               // N
]

const COLUMN_WIDTHS = [22, 9, 28, 10, 20, 24, 16, 26, 24, 16, 18, 30, 24]

// Named column indices (1-based, relative to the workbook column number)
const COL_CATEGORY   = COLUMN_B      // B
const COL_ITEM_NO    = COLUMN_B + 1  // C
const COL_ITEM_NAME  = COLUMN_B + 2  // D
const COL_QTY        = COLUMN_B + 3  // E
const COL_SERIAL     = COLUMN_B + 4  // F
const COL_INIT_PHOTO = COLUMN_B + 5  // G
const COL_AUDIT_DATE = COLUMN_B + 6  // H
const COL_REMARKS    = COLUMN_B + 7  // I
const COL_HO_PHOTO   = COLUMN_B + 8  // J
const COL_HO_DATE    = COLUMN_B + 9  // K
const COL_CONDITION  = COLUMN_B + 10 // L  ← dropdown
const COL_ACTION     = COLUMN_B + 11 // M  ← dropdown
const COL_DEST       = COLUMN_B + 12 // N
const LAST_DATA_COL  = COL_DEST

// Row layout — mirrors the project export exactly
const TITLE_ROW             = 2
const HEADER_BLOCK_FIRST_ROW = 6
const COLUMN_HEADER_ROW     = HEADER_BLOCK_FIRST_ROW + 4  // = 10
const FIRST_ITEM_ROW        = COLUMN_HEADER_ROW + 1       // = 11

// ---- Photo sizes — same as project export ---------------------------------
const IMG_ROW_HEIGHT     = 315
const IMG_DISPLAY_WIDTH  = 420
const IMG_DISPLAY_HEIGHT = 300
const IMG_PHOTO_COL_WIDTH = 62

// ---- Unit data fetched by the main-process handler ------------------------
export interface HandoverUnitData {
  photoRef: string | null
  auditDate: string | null
  remarks: string | null
}

// ---------------------------------------------------------------------------

export async function buildHandoverWorkbook(
  handover: Handover,
  unitDataMap: Map<number, HandoverUnitData>,
  projectPhotoLog: PhotoLogEntry[] = []
): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook()
  buildHandoverSheet(workbook, handover, unitDataMap)
  await buildHandoverPhotosSheet(workbook, handover, unitDataMap)
  await buildToolboxSheet(workbook, projectPhotoLog)
  return workbook
}

// ---------------------------------------------------------------------------
// Sheet 1 — Handover Report  (matches the inventory template visually)
// ---------------------------------------------------------------------------

function buildHandoverSheet(
  workbook: ExcelJS.Workbook,
  handover: Handover,
  unitDataMap: Map<number, HandoverUnitData>
): void {
  const sheet = workbook.addWorksheet('Handover Report', {
    views: [{
      state: 'frozen',
      // Freeze columns A (margin) + B (Category) + C (Item No) + D (Item Name).
      // Item Name MUST be inside the frozen region: if it's the first scrollable
      // column, Excel clips its left edge when scrolled, cutting item names
      // (e.g. "Body Harness" → "dy Harness") and the project-name value below.
      xSplit: 4,
      ySplit: COLUMN_HEADER_ROW,
      showGridLines: true
    }]
  })

  sheet.getColumn(1).width = 4
  COLUMN_WIDTHS.forEach((w, i) => { sheet.getColumn(i + 2).width = w })

  writeLogo(workbook, sheet)
  writeTitleBanner(sheet)
  writeHeaderBlock(sheet, handover)
  writeColumnHeaders(sheet)

  const { categoryBands, itemSpans, lastRow } =
    writeItemRows(sheet, handover, unitDataMap)

  applyCategoryBandStyling(sheet, categoryBands)
  applyItemSpanMerges(sheet, itemSpans)
  applyTableBorders(sheet, COLUMN_HEADER_ROW, lastRow)
}

// ---- Logo + title (identical placement to project export) -----------------

function writeLogo(workbook: ExcelJS.Workbook, sheet: ExcelJS.Worksheet): void {
  const LOGO_NATIVE_W = 454
  const LOGO_NATIVE_H = 111
  const DISPLAY_W = 170
  const DISPLAY_H = Math.round((DISPLAY_W / LOGO_NATIVE_W) * LOGO_NATIVE_H)
  const id = workbook.addImage({ base64: DIGINEXT_LOGO_BASE64, extension: 'png' })
  sheet.addImage(id, { tl: { col: 1, row: 1 }, ext: { width: DISPLAY_W, height: DISPLAY_H } })
}

const TITLE_FIRST_COL = COLUMN_B + 4
const TITLE_LAST_COL  = TITLE_FIRST_COL + 2

function writeTitleBanner(sheet: ExcelJS.Worksheet): void {
  sheet.mergeCells(TITLE_ROW, TITLE_FIRST_COL, TITLE_ROW + 2, TITLE_LAST_COL)
  const cell = sheet.getCell(TITLE_ROW, TITLE_FIRST_COL)
  cell.value = 'Handover Report'
  cell.font = { bold: true, size: 16, color: { argb: WHITE_FONT } }
  cell.alignment = { vertical: 'middle', horizontal: 'center' }
  fillRange(sheet, TITLE_ROW, TITLE_FIRST_COL, TITLE_ROW + 2, TITLE_LAST_COL, TITLE_FILL)
  sheet.getRow(TITLE_ROW).height = 20
  sheet.getRow(TITLE_ROW + 1).height = 20
  sheet.getRow(TITLE_ROW + 2).height = 20
}

// ---- Header block — same position, handover-specific fields ---------------

function writeHeaderBlock(sheet: ExcelJS.Worksheet, handover: Handover): void {
  const labelCol = COLUMN_B
  const valueCol = COLUMN_B + 2

  writeLabelValue(sheet, HEADER_BLOCK_FIRST_ROW,     labelCol, 'Project Name :',  valueCol, handover.projectName ?? '')
  writeLabelValue(sheet, HEADER_BLOCK_FIRST_ROW + 1, labelCol, 'Handed Over By:', valueCol, handover.handedOverBy ?? '')
  writeLabelValue(sheet, HEADER_BLOCK_FIRST_ROW + 2, labelCol, 'Received By:',    valueCol, handover.receivedBy ?? '')

  // "Handover Date:" sits to the right of the project name row — same
  // position as "Last Updated Date:" in the inventory template.
  const dateLabelCol = COLUMN_B + 4
  const dateValueCol = COLUMN_B + 5
  const lc = sheet.getCell(HEADER_BLOCK_FIRST_ROW, dateLabelCol)
  lc.value = 'Handover Date:'
  lc.font = { bold: true }
  sheet.getCell(HEADER_BLOCK_FIRST_ROW, dateValueCol).value = handover.handoverDate

  if (handover.notes) {
    const nc = sheet.getCell(HEADER_BLOCK_FIRST_ROW + 3, labelCol)
    nc.value = 'Notes:'
    nc.font = { bold: true }
    sheet.getCell(HEADER_BLOCK_FIRST_ROW + 3, valueCol).value = handover.notes
  }
}

function writeLabelValue(
  sheet: ExcelJS.Worksheet,
  row: number, labelCol: number, label: string,
  valueCol: number, value: string
): void {
  const lc = sheet.getCell(row, labelCol)
  lc.value = label
  lc.font = { bold: true }
  sheet.getCell(row, valueCol).value = value
}

// ---- Column headers -------------------------------------------------------

function writeColumnHeaders(sheet: ExcelJS.Worksheet): void {
  const row = sheet.getRow(COLUMN_HEADER_ROW)
  COLUMN_HEADERS.forEach((header, i) => {
    const cell = row.getCell(COLUMN_B + i)
    cell.value = header
    cell.font = { bold: true, color: { argb: WHITE_FONT } }
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } }
  })
  row.height = 32
}

// ExcelJS omits showDropDown from its DataValidation type, but the Excel XML
// attribute is inverted: showDropDown="1" = hidden, "0"/absent-but-set = shown.
// Without explicitly setting it to false, the dropdown arrow won't appear.
function setDropdown(sheet: ExcelJS.Worksheet, row: number, col: number, options: string[]): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(sheet.getCell(row, col) as any).dataValidation = {
    type: 'list',
    allowBlank: true,
    showDropDown: false,
    formulae: [`"${options.join(',')}"`]
  }
}

// ---- Item rows grouped by category + item ---------------------------------

interface CategoryBand { startRow: number; endRow: number; category: string; paletteIndex: number }
interface ItemSpan     { startRow: number; endRow: number }

function writeItemRows(
  sheet: ExcelJS.Worksheet,
  handover: Handover,
  unitDataMap: Map<number, HandoverUnitData>
): { categoryBands: CategoryBand[]; itemSpans: ItemSpan[]; lastRow: number } {
  // Group handover items by category → item name
  type GroupKey = string
  const grouped = new Map<GroupKey, { category: string; itemName: string; items: HandoverItem[] }>()
  for (const item of handover.items) {
    const key = `${item.itemCategory ?? ''}|||${item.itemName ?? ''}`
    if (!grouped.has(key)) {
      grouped.set(key, { category: item.itemCategory ?? '', itemName: item.itemName ?? '', items: [] })
    }
    grouped.get(key)!.items.push(item)
  }

  const categoryBands: CategoryBand[] = []
  const itemSpans: ItemSpan[] = []

  let nextRow = FIRST_ITEM_ROW
  let itemNo = 1
  let currentCategory: string | null = null
  let groupStartRow = nextRow
  let paletteIndex = -1

  const closeBand = (endRow: number) => {
    if (currentCategory !== null && endRow >= groupStartRow) {
      categoryBands.push({ startRow: groupStartRow, endRow, category: currentCategory, paletteIndex })
    }
  }

  for (const { category, itemName, items } of grouped.values()) {
    if (category !== currentCategory) {
      closeBand(nextRow - 1)
      currentCategory = category
      groupStartRow = nextRow
      paletteIndex += 1
    }

    const serialItems = items.filter((i) => i.serialId !== null)
    const anonItems   = items.filter((i) => i.serialId === null)
    const totalQty    = items.length

    const itemHeaderRow = nextRow
    // Item header: item no, item name, qty — category merges across rows
    const hRow = sheet.getRow(itemHeaderRow)
    hRow.getCell(COL_ITEM_NO).value   = itemNo
    hRow.getCell(COL_ITEM_NAME).value = itemName
    hRow.getCell(COL_QTY).value       = totalQty > 0 ? totalQty : '-'
    itemNo++
    nextRow++

    // One sub-row per serialised unit
    for (const item of serialItems) {
      const unitData = unitDataMap.get(item.itemUnitId)
      const dataRow = sheet.getRow(nextRow)
      dataRow.getCell(COL_SERIAL).value     = item.serialId ?? ''
      dataRow.getCell(COL_INIT_PHOTO).value = unitData?.photoRef ? 'See photos sheet' : ''
      dataRow.getCell(COL_AUDIT_DATE).value = unitData?.auditDate ?? ''
      dataRow.getCell(COL_REMARKS).value    = unitData?.remarks ?? ''
      dataRow.getCell(COL_HO_PHOTO).value   = unitData?.photoRef ? 'See photos sheet' : ''
      dataRow.getCell(COL_HO_DATE).value    = handover.handoverDate
      dataRow.getCell(COL_CONDITION).value  = item.condition ?? ''
      dataRow.getCell(COL_ACTION).value     = item.action ?? ''
      dataRow.getCell(COL_DEST).value       = item.transferProjectName ?? ''

      // Dropdown validation on Condition and Action.
      // showDropDown:false is required — the XML attribute is inverted:
      // true = hidden, false/absent causes ExcelJS to omit it which Excel
      // then treats as hidden. Force false via cast to bypass the missing type.
      setDropdown(sheet, nextRow, COL_CONDITION, CONDITIONS)
      setDropdown(sheet, nextRow, COL_ACTION, ACTIONS)
      nextRow++
    }

    // Anonymous units: each gets its own row with condition/action but no serial
    for (const item of anonItems) {
      const dataRow = sheet.getRow(nextRow)
      dataRow.getCell(COL_HO_DATE).value    = handover.handoverDate
      dataRow.getCell(COL_CONDITION).value  = item.condition ?? ''
      dataRow.getCell(COL_ACTION).value     = item.action ?? ''
      dataRow.getCell(COL_DEST).value       = item.transferProjectName ?? ''

      setDropdown(sheet, nextRow, COL_CONDITION, CONDITIONS)
      setDropdown(sheet, nextRow, COL_ACTION, ACTIONS)
      nextRow++
    }

    const itemEndRow = nextRow - 1
    if (itemEndRow > itemHeaderRow) {
      itemSpans.push({ startRow: itemHeaderRow, endRow: itemEndRow })
    }

    nextRow++ // blank separator row between item blocks, per the template
  }

  closeBand(nextRow - 2)

  return { categoryBands, itemSpans, lastRow: nextRow - 2 }
}

// ---- Styling helpers -------------------------------------------------------

function applyCategoryBandStyling(sheet: ExcelJS.Worksheet, bands: CategoryBand[]): void {
  for (const band of bands) {
    const palette = CATEGORY_PALETTE[band.paletteIndex % CATEGORY_PALETTE.length]
    if (band.endRow > band.startRow) {
      sheet.mergeCells(band.startRow, COL_CATEGORY, band.endRow, COL_CATEGORY)
    }
    const cell = sheet.getCell(band.startRow, COL_CATEGORY)
    cell.value = band.category
    cell.font  = { bold: true, color: { argb: palette.text } }
    cell.alignment = { vertical: 'middle', horizontal: 'center', textRotation: 90, wrapText: true }
    fillRange(sheet, band.startRow, COL_CATEGORY, band.endRow, COL_CATEGORY, palette.fill)
  }
}

function applyItemSpanMerges(sheet: ExcelJS.Worksheet, spans: ItemSpan[]): void {
  for (const span of spans) {
    for (const col of [COL_ITEM_NO, COL_ITEM_NAME, COL_QTY]) {
      sheet.mergeCells(span.startRow, col, span.endRow, col)
      sheet.getCell(span.startRow, col).alignment = {
        ...sheet.getCell(span.startRow, col).alignment,
        vertical: 'middle'
      }
    }
  }
}

function applyTableBorders(sheet: ExcelJS.Worksheet, firstRow: number, lastRow: number): void {
  const border: Partial<ExcelJS.Borders> = {
    top:    { style: 'thin', color: { argb: 'FF000000' } },
    left:   { style: 'thin', color: { argb: 'FF000000' } },
    bottom: { style: 'thin', color: { argb: 'FF000000' } },
    right:  { style: 'thin', color: { argb: 'FF000000' } }
  }
  for (let row = firstRow; row <= lastRow; row++) {
    for (let col = COLUMN_B; col <= LAST_DATA_COL; col++) {
      sheet.getCell(row, col).border = border
    }
  }
}

function fillRange(
  sheet: ExcelJS.Worksheet,
  startRow: number, startCol: number,
  endRow: number, endCol: number,
  argb: string
): void {
  for (let r = startRow; r <= endRow; r++) {
    for (let c = startCol; c <= endCol; c++) {
      sheet.getCell(r, c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb } }
    }
  }
}

// ---------------------------------------------------------------------------
// Sheet 2 — Item photos (same size constants as project export)
// ---------------------------------------------------------------------------

async function buildHandoverPhotosSheet(
  workbook: ExcelJS.Workbook,
  handover: Handover,
  unitDataMap: Map<number, HandoverUnitData>
): Promise<void> {
  const withPhotos = handover.items.filter((i) => unitDataMap.get(i.itemUnitId)?.photoRef)
  if (withPhotos.length === 0) return

  const sheet = workbook.addWorksheet('Item Photos')
  sheet.getColumn(1).width = IMG_PHOTO_COL_WIDTH
  sheet.getColumn(2).width = 18   // Serial
  sheet.getColumn(3).width = 28   // Item Name
  sheet.getColumn(4).width = 22   // Category
  sheet.getColumn(5).width = 18   // Condition
  sheet.getColumn(6).width = 30   // Action

  const HEADERS = ['Photo', 'Serial ID', 'Item Name', 'Category', 'Condition', 'Action']
  const hRow = sheet.getRow(1)
  hRow.height = 24
  HEADERS.forEach((h, i) => {
    const cell = hRow.getCell(i + 1)
    cell.value = h
    cell.font  = { bold: true, color: { argb: WHITE_FONT } }
    cell.alignment = { vertical: 'middle', horizontal: 'center' }
    cell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } }
  })

  for (let i = 0; i < withPhotos.length; i++) {
    const item    = withPhotos[i]
    const rowNum  = i + 2
    const row     = sheet.getRow(rowNum)
    row.height = IMG_ROW_HEIGHT

    row.getCell(2).value = item.serialId ?? '—'
    row.getCell(3).value = item.itemName ?? ''
    row.getCell(4).value = item.itemCategory ?? ''
    row.getCell(5).value = item.condition ?? ''
    row.getCell(6).value = item.action ?? ''
    for (let col = 2; col <= 6; col++) {
      row.getCell(col).alignment = { vertical: 'middle', wrapText: true }
    }

    const ref = unitDataMap.get(item.itemUnitId)?.photoRef
    if (ref) {
      const photo = await readPhotoBuffer(ref)
      if (photo) {
        const imgId = workbook.addImage({
          buffer: photo.buffer, extension: photo.extension
        } as unknown as Parameters<typeof workbook.addImage>[0])
        sheet.addImage(imgId, {
          tl: { col: 0, row: rowNum - 1 },
          ext: { width: IMG_DISPLAY_WIDTH, height: IMG_DISPLAY_HEIGHT }
        })
      }
    }
  }

  const border: Partial<ExcelJS.Borders> = {
    top: { style: 'thin', color: { argb: 'FF000000' } },
    left: { style: 'thin', color: { argb: 'FF000000' } },
    bottom: { style: 'thin', color: { argb: 'FF000000' } },
    right: { style: 'thin', color: { argb: 'FF000000' } }
  }
  for (let row = 1; row <= withPhotos.length + 1; row++) {
    for (let col = 1; col <= 6; col++) {
      sheet.getCell(row, col).border = border
    }
  }
}

// ---------------------------------------------------------------------------
// Sheet 3 — Toolbox / site photos (photo log)
// ---------------------------------------------------------------------------

async function buildToolboxSheet(
  workbook: ExcelJS.Workbook,
  entries: PhotoLogEntry[]
): Promise<void> {
  if (entries.length === 0) return

  const sheet = workbook.addWorksheet('Toolbox Photos')
  sheet.getColumn(1).width = IMG_PHOTO_COL_WIDTH
  sheet.getColumn(2).width = 40

  const hRow = sheet.getRow(1)
  hRow.height = 24
  ;['Photo', 'Label'].forEach((h, i) => {
    const cell = hRow.getCell(i + 1)
    cell.value = h
    cell.font  = { bold: true, color: { argb: WHITE_FONT } }
    cell.alignment = { vertical: 'middle', horizontal: 'center' }
    cell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } }
  })
  hRow.height = 24

  for (let i = 0; i < entries.length; i++) {
    const entry  = entries[i]
    const rowNum = i + 2
    const row    = sheet.getRow(rowNum)
    row.height = IMG_ROW_HEIGHT
    row.getCell(2).value     = entry.label
    row.getCell(2).alignment = { vertical: 'middle', wrapText: true }

    const photo = await readPhotoBuffer(entry.photoEvidenceRef)
    if (photo) {
      const imgId = workbook.addImage({
        buffer: photo.buffer, extension: photo.extension
      } as unknown as Parameters<typeof workbook.addImage>[0])
      sheet.addImage(imgId, {
        tl: { col: 0, row: rowNum - 1 },
        ext: { width: IMG_DISPLAY_WIDTH, height: IMG_DISPLAY_HEIGHT }
      })
    }
  }

  const border: Partial<ExcelJS.Borders> = {
    top: { style: 'thin', color: { argb: 'FF000000' } },
    left: { style: 'thin', color: { argb: 'FF000000' } },
    bottom: { style: 'thin', color: { argb: 'FF000000' } },
    right: { style: 'thin', color: { argb: 'FF000000' } }
  }
  for (let row = 1; row <= entries.length + 1; row++) {
    for (let col = 1; col <= 2; col++) {
      sheet.getCell(row, col).border = border
    }
  }
}

// ---------------------------------------------------------------------------

export function handoverExportFileName(handover: Handover): string {
  const safeName = (handover.projectName ?? 'Unknown').replace(/[\\/:*?"<>|]+/g, ' ').trim()
  return `Handover - ${safeName} - ${handover.handoverDate}.xlsx`
}
