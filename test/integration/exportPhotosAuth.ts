/**
 * Integration test for the non-database surfaces:
 *   • Photo store  — upload → read (buffer + data URL) → delete, against the
 *                    real Supabase Storage `photos` bucket (self-cleaning).
 *   • Excel export — workbook generation + real photo embedding, verified by
 *                    re-reading the produced .xlsx, and round-tripped through
 *                    the importer's parser so export↔import stay compatible.
 *   • Auth         — the reject paths of verifySession (empty / invalid token).
 *                    The accept path needs a real signed-in token, so it can't
 *                    run headlessly; see the audit notes in the chat summary.
 *
 * Run: npx tsx test/integration/exportPhotosAuth.ts   (from the project root)
 */
import 'dotenv/config'
import { writeFileSync, unlinkSync, mkdtempSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import ExcelJS from 'exceljs'
import { read as xlsxRead } from 'xlsx'
import {
  buildProjectInventoryWorkbook,
  exportFileName,
  readExportMarker
} from '../../src/main/excel/exportProjectSheet'
import { parseImportedSheet } from '../../src/main/excel/parseImportedSheet'
import { importPhoto, readPhotoBuffer, readPhotoDataUrl, deleteManagedPhoto } from '../../src/main/photos/photoStore'
import { verifySession } from '../../src/main/auth/verifySession'
import type { Item, ItemUnitWithDetails, Project } from '../../src/shared/ipc'

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

// A real 1×1 PNG.
const PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

const project: Project = {
  id: 4242, name: 'Export Test Site', location: 'Nowhere',
  updatedBy: 'tester', lastUpdatedDate: '2026-06-18', status: 'active'
}
const items: Item[] = [{ id: 1, category: 'Safety', name: 'Harness', initialStock: 2 }]

function unit(over: Partial<ItemUnitWithDetails>): ItemUnitWithDetails {
  return {
    id: 1, itemId: 1, serialId: 'X-1', assignedProjectId: project.id, auditDate: '2026-06-01',
    remarks: null, status: 'In Use', photoEvidenceRef: null,
    itemCategory: 'Safety', itemName: 'Harness', projectName: project.name,
    ...over
  }
}

async function countImages(file: string): Promise<number> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(file)
  let n = 0
  wb.eachSheet((ws) => { n += ws.getImages().length })
  return n
}

async function main(): Promise<void> {
  const tmp = mkdtempSync(join(tmpdir(), 'diginext-export-'))
  const pngPath = join(tmp, 'pixel.png')
  writeFileSync(pngPath, Buffer.from(PNG_BASE64, 'base64'))

  const noPhotoXlsx = join(tmp, 'no-photo.xlsx')
  const withPhotoXlsx = join(tmp, 'with-photo.xlsx')
  let photoRef: string | null = null

  try {
    // =====================================================================
    console.log('Photo store — upload / read / delete round-trip (Supabase Storage)')
    // =====================================================================
    photoRef = await importPhoto(pngPath)
    check('importPhoto returns a reference', !!photoRef, `ref=${photoRef}`)

    const buf = await readPhotoBuffer(photoRef)
    check('readPhotoBuffer returns the image', buf !== null && buf.buffer.length > 0)
    eq('readPhotoBuffer reports png extension', buf?.extension, 'png')

    const dataUrl = await readPhotoDataUrl(photoRef)
    check('readPhotoDataUrl returns a PNG data URL', !!dataUrl && dataUrl.startsWith('data:image/png;base64,'),
      `got ${dataUrl?.slice(0, 32)}…`)

    // =====================================================================
    console.log('\nExcel export — workbook generation + photo embedding')
    // =====================================================================
    eq('exportFileName follows convention', exportFileName(project), 'Inventory - Export Test Site.xlsx')

    // Baseline: export with NO unit photo (still embeds the logo).
    const wbNoPhoto = await buildProjectInventoryWorkbook(project, items, [unit({ photoEvidenceRef: null })], [])
    await wbNoPhoto.xlsx.writeFile(noPhotoXlsx)
    const baseImages = await countImages(noPhotoXlsx)
    check('baseline workbook has the logo image', baseImages >= 1, `images=${baseImages}`)

    // Same export but the unit now carries the uploaded photo reference.
    const wbWithPhoto = await buildProjectInventoryWorkbook(
      project, items, [unit({ photoEvidenceRef: photoRef })], []
    )
    await wbWithPhoto.xlsx.writeFile(withPhotoXlsx)
    const withImages = await countImages(withPhotoXlsx)
    eq('unit photo is embedded (one extra image vs baseline)', withImages, baseImages + 1)

    // =====================================================================
    console.log('\nExcel export — re-readable + import-compatible')
    // =====================================================================
    const wb = xlsxRead(Buffer.from(await wbWithPhoto.xlsx.writeBuffer()), { type: 'buffer' })
    const marker = readExportMarker(wb)
    check('export embeds a readable marker', marker !== null)
    eq('marker carries the project id', marker?.projectId, project.id)
    eq('marker carries the project name', marker?.projectName, project.name)

    const parsed = parseImportedSheet(withPhotoXlsx)
    check('exported sheet parses back', parsed !== null)
    const serials = parsed?.itemBlocks.flatMap((b) => b.units.map((u) => u.serialId)) ?? []
    check('exported unit round-trips through the parser', serials.includes('X-1'),
      `parsed serials: ${JSON.stringify(serials)}`)

    // =====================================================================
    console.log('\nPhoto store — delete cleans up')
    // =====================================================================
    await deleteManagedPhoto(photoRef)
    const afterDelete = await readPhotoBuffer(photoRef)
    eq('deleted photo no longer downloads', afterDelete, null)
    photoRef = null // already cleaned

    // =====================================================================
    console.log('\nAuth — verifySession rejects bad input (accept path needs a live token)')
    // =====================================================================
    eq('empty token rejected', await verifySession(''), false)
    eq('invalid token rejected', await verifySession('not-a-real-jwt.deadbeef.xyz'), false)
  } finally {
    if (photoRef) { try { await deleteManagedPhoto(photoRef) } catch { /* best effort */ } }
    for (const f of [pngPath, noPhotoXlsx, withPhotoXlsx]) { try { unlinkSync(f) } catch { /* ignore */ } }
  }

  console.log(`\n${'─'.repeat(60)}`)
  console.log(`\x1b[1m${passed} passed, ${failed} failed\x1b[0m`)
  if (failed > 0) {
    console.log('\nFailures:')
    for (const f of failures) console.log(`  • ${f}`)
    process.exit(1)
  }
  console.log('Export / photo / auth surfaces verified.')
}

main().catch((err) => {
  console.error('\nTest run crashed:', err)
  process.exit(1)
})
