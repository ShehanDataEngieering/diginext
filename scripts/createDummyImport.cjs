/**
 * createDummyImport.cjs
 *
 * Generates a dummy inventory Excel file in the exact format the app's
 * import parser expects. Run it from the project root:
 *
 *   node scripts/createDummyImport.cjs
 *
 * Output: dummy-import.xlsx  (in the project root directory)
 *
 * The hidden _diginext_meta sheet uses projectId=9999 which won't match
 * any real project, so the importer will CREATE a new project called
 * "Test Import - Stockholm" automatically. If you want it to match an
 * existing project instead, change PROJECT_ID to that project's real id
 * (you can find it in the app's Projects list or the SQLite DB).
 *
 * The sheet layout matches what exportProjectSheet.ts produces:
 *   Col A (index 0): blank margin
 *   Col B (index 1): Category       ← COL_CATEGORY in parser
 *   Col C (index 2): Item No
 *   Col D (index 3): Item Name      ← COL_ITEM_NAME in parser
 *   Col E (index 4): Quantity
 *   Col F (index 5): Serial Number  ← COL_SERIAL in parser
 *   Col G (index 6): Photo Evidence
 *   Col H (index 7): Audit Date     ← COL_AUDIT_DATE in parser  (dd/mm/yyyy)
 *   Col I (index 8): Remarks        ← COL_REMARKS in parser
 *
 * Rows 0-9 are the header block (skipped by the parser).
 * Data starts at row index 10 (row 11, 1-based).
 */

const XLSX = require('xlsx')
const path = require('path')

// ── Config ────────────────────────────────────────────────────────────────
// Use 9999 so it won't match any existing project → app creates a new one.
// Change to a real project id if you want to test updating an existing one.
const PROJECT_ID = 9999
const PROJECT_NAME = 'Test Import - Stockholm'
const EXPORTED_AT = new Date().toISOString()
const OUTPUT_FILE = path.join(__dirname, '..', 'dummy-import.xlsx')

// ── Data rows ─────────────────────────────────────────────────────────────
// Each row: [A, B(Category), C(ItemNo), D(ItemName), E(Qty), F(Serial), G(Photo), H(AuditDate), I(Remarks)]
// Leave B and D empty on continuation rows — the parser carries the last
// seen category/item name forward (mirroring merged cells in real exports).
const DATA_ROWS = [
  // Safety Related Items — Body Harness (3 units)
  ['', 'Safety Related Items', '1', 'Body Harness',  '3', 'BH-001', '', '09/06/2026', 'Inspected, good condition'],
  ['', '',                     '',  '',              '',  'BH-002', '', '09/06/2026', ''],
  ['', '',                     '',  '',              '',  'BH-003', '', '09/06/2026', 'Strap slightly worn'],

  // Safety Related Items — Safety Helmet (2 units)
  ['', '',                     '2', 'Safety Helmet', '2', 'SH-101', '', '09/06/2026', ''],
  ['', '',                     '',  '',              '',  'SH-102', '', '09/06/2026', 'New replacement'],

  // Termination Tools — Cable Crimper (2 units)
  ['', 'Termination Tools',    '1', 'Cable Crimper', '2', 'TC-001', '', '09/06/2026', ''],
  ['', '',                     '',  '',              '',  'TC-002', '', '',            'Needs calibration'],

  // Site Tools — Power Drill (1 unit)
  ['', 'Site Tools',           '1', 'Power Drill',   '1', 'PD-201', '', '01/06/2026', 'Battery replaced'],

  // Office Use Items — Clipboard (no serial — quantity only, will be skipped
  // by the serial-based reconciler but visible in the sheet for reference)
  ['', 'Office Use Items',     '1', 'Clipboard',     '3', '',       '', '09/06/2026', '3 units on site'],
]

// ── Build the worksheet ────────────────────────────────────────────────────
// 10 padding rows (indices 0-9) so data starts at index 10, matching
// FIRST_DATA_ROW_INDEX = 10 in parseImportedSheet.ts.
const PADDING = Array(10).fill(['', '', '', '', '', '', '', '', ''])
const allRows = [...PADDING, ...DATA_ROWS]

const ws = XLSX.utils.aoa_to_sheet(allRows)
const wb = XLSX.utils.book_new()
XLSX.utils.book_append_sheet(wb, ws, PROJECT_NAME)

// ── Hidden meta sheet ─────────────────────────────────────────────────────
// The parser (parseImportedSheet.ts) calls readExportMarker() which looks
// for a sheet named '_diginext_meta' with these key-value rows.
const metaRows = [
  ['projectId',   PROJECT_ID],
  ['projectName', PROJECT_NAME],
  ['exportedAt',  EXPORTED_AT],
]
const metaWs = XLSX.utils.aoa_to_sheet(metaRows)
XLSX.utils.book_append_sheet(wb, metaWs, '_diginext_meta')

// ── Write file ────────────────────────────────────────────────────────────
XLSX.writeFile(wb, OUTPUT_FILE)
console.log(`✅ Created: ${OUTPUT_FILE}`)
console.log(`   Project : ${PROJECT_NAME} (id=${PROJECT_ID} → will be created as new)`)
console.log(`   Items   : Body Harness, Safety Helmet, Cable Crimper, Power Drill, Clipboard`)
console.log(`   Units   : 9 serialised units + 1 quantity-only row`)
console.log()
console.log('To import: paste this path into the app import box:')
console.log(`   ${OUTPUT_FILE}`)
