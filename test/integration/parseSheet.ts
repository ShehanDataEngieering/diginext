/**
 * Unit test for parseImportedSheet — focuses on the layout-detection fix: a
 * hand-maintained project sheet (NO _diginext_meta marker) that carries a blank
 * left-margin column, so every field is shifted one column right. The old fixed-
 * column parser silently read zero rows from these; header detection fixes it.
 *
 * Builds workbooks in a temp dir (no committed binary fixtures). No DB needed.
 *
 * Run: npx tsx test/integration/parseSheet.ts
 */
import { tmpdir } from 'os'
import { join } from 'path'
import { utils, writeFile } from 'xlsx'
import { parseImportedSheet } from '../../src/main/excel/parseImportedSheet'

let passed = 0
let failed = 0
const failures: string[] = []
function check(label: string, cond: boolean, detail?: string): void {
  if (cond) { passed++; console.log(`  \x1b[32m✓\x1b[0m ${label}`) }
  else { failed++; failures.push(label + (detail ? ` — ${detail}` : '')); console.log(`  \x1b[31m✗ ${label}\x1b[0m${detail ? ` — ${detail}` : ''}`) }
}
function eq(label: string, actual: unknown, expected: unknown): void {
  check(label, actual === expected, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
}

// Header row + data rows, optionally with a leading blank margin column.
function buildSheetFile(name: string, leadingBlank: boolean): string {
  const pad = (cells: string[]): string[] => (leadingBlank ? ['', ...cells] : cells)
  const aoa: string[][] = []
  for (let i = 0; i < 9; i++) aoa.push(pad([])) // blank/banner/meta rows
  aoa.push(pad(['Category', 'Item No', 'Item Name', 'Quantity', 'Serial Number/s', 'Initial-Photo Evidence', 'Initial Audit Date', 'Remarks', 'Hand Over-Photo', 'Hand Over-Date', 'Remarks']))
  aoa.push(pad(['Safety', '1', 'Body Harness', '2', 'DN 11', '', '14/04/2026', '3M', '', '', '']))
  aoa.push(pad(['', '', '', '', 'DN 13', '', '14/04/2026', 'Honeywell', '', '', '']))
  aoa.push(pad(['Tools', '2', 'Cable Tester', '-', '', '', '', '', '', '', ''])) // qty-only, no serial
  aoa.push(pad(['Tools', '3', 'Tool Box', '1', 'DG/25/TB 01', '', '', 'Image', '', '', '']))

  const ws = utils.aoa_to_sheet(aoa)
  const wb = utils.book_new()
  utils.book_append_sheet(wb, ws, 'in')
  const path = join(tmpdir(), name)
  writeFile(wb, path)
  return path
}

function main(): void {
  console.log('parseImportedSheet — hand-maintained sheet WITH leading blank column (the bug)')
  const shiftedPath = buildSheetFile('Inventory - At Test Site (1) (2).xlsx', true)
  const shifted = parseImportedSheet(shiftedPath)
  check('parsed (not null)', shifted !== null)
  if (shifted) {
    eq('project name derived from filename, "At" kept', shifted.marker.projectName, 'At Test Site')
    eq('serialised units found', shifted.units.length, 3)
    const bh = shifted.itemBlocks.find((b) => b.itemName === 'Body Harness')
    eq('Body Harness block present', bh?.itemName, 'Body Harness')
    eq('Body Harness declared qty', bh?.declaredQty, 2)
    eq('Body Harness has 2 serials', bh?.units.length, 2)
    eq('first serial', bh?.units[0].serialId, 'DN 11')
    eq('audit date parsed to ISO', bh?.units[0].auditDate, '2026-04-14')
    eq('remarks captured', bh?.units[0].remarks, '3M')
    const tb = shifted.itemBlocks.find((b) => b.itemName === 'Tool Box')
    eq('Tool Box serial', tb?.units[0].serialId, 'DG/25/TB 01')
    const ct = shifted.itemBlocks.find((b) => b.itemName === 'Cable Tester')
    eq('Cable Tester block present (qty-only, no units)', ct?.units.length, 0)
  }

  console.log('\nparseImportedSheet — same data WITHOUT a leading blank column (older layout)')
  const flatPath = buildSheetFile('Inventory - At Test Site (3).xlsx', false)
  const flat = parseImportedSheet(flatPath)
  check('parsed (not null)', flat !== null)
  eq('serialised units found (layout-independent)', flat?.units.length, 3)

  console.log(`\n${'─'.repeat(60)}`)
  console.log(`\x1b[1m${passed} passed, ${failed} failed\x1b[0m`)
  if (failed > 0) { console.log('\nFailures:'); failures.forEach((f) => console.log(`  • ${f}`)); process.exit(1) }
  console.log('Sheet parsing verified.')
}

main()
