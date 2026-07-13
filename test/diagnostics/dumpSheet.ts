/** READ-ONLY. Dumps sheet names, the export marker (if any), and the first N rows of a workbook. */
import { readFile, utils } from 'xlsx'
import { readExportMarker } from '../../src/main/excel/exportProjectSheet'

const path = process.argv[2]
const maxRows = Number(process.argv[3] ?? 30)
if (!path) throw new Error('Pass a workbook path.')

const wb = readFile(path)
console.log('Sheets:', wb.SheetNames)
console.log('Export marker:', readExportMarker(wb) ?? '(none — hand-maintained / no _diginext_meta)')
for (const name of wb.SheetNames) {
  if (name.startsWith('_')) continue
  const sheet = wb.Sheets[name]
  const range = utils.decode_range(sheet['!ref'] ?? 'A1')
  range.s.c = 0; range.s.r = 0
  const rows = utils.sheet_to_json<string[]>(sheet, { header: 1, raw: false, defval: '', range: utils.encode_range(range) })
  console.log(`\n--- Sheet "${name}" (${rows.length} rows, ref ${sheet['!ref']}) ---`)
  rows.slice(0, maxRows).forEach((r, i) => {
    const cells = r.map((c) => (c ?? '').toString()).map((c) => (c.length > 20 ? c.slice(0, 20) + '…' : c))
    console.log(`  r${String(i).padStart(2)}: ${JSON.stringify(cells)}`)
  })
}
