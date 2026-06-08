// Manages the on-disk store for item-unit photos ("upload photos and see
// those photos of items"). Lives entirely in the main process — the renderer
// never touches the filesystem directly, only ever sees opaque references
// (filenames) and base64 data URLs handed back over IPC.
//
// Why copy files into a managed folder rather than just remembering the
// dropped path: the original path can move, get renamed, or live on removable
// media, and `photo_evidence_ref` already doubles as a free-text field from
// the old spreadsheet workflow (seeded data may hold arbitrary strings there
// that aren't files at all). Owning a private copy means the reference we
// store is something we can always resolve — or safely recognize we can't.
import { app } from 'electron'
import { copyFileSync, existsSync, mkdirSync, readFileSync, unlinkSync } from 'fs'
import { extname, join, basename } from 'path'
import { randomBytes } from 'crypto'

const PHOTOS_DIR_NAME = 'photos'

// Only these get copied in or read back as images — anything else either
// isn't a photo (e.g. a stray text reference from seeded data) or isn't a
// format Chromium can render inline via a data URL.
const MIME_BY_EXTENSION: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp'
}

function photosDirectory(): string {
  const dir = join(app.getPath('userData'), PHOTOS_DIR_NAME)
  mkdirSync(dir, { recursive: true })
  return dir
}

// References are stored bare (no directory components) and resolved inside
// `photosDirectory()` — reject anything that looks like it's trying to escape
// that folder (e.g. a hand-edited DB value containing "../"), and anything
// whose extension we don't recognize as an image we manage.
function resolveManagedPhotoPath(reference: string): string | null {
  if (!reference || reference !== basename(reference)) return null
  const ext = extname(reference).toLowerCase()
  if (!(ext in MIME_BY_EXTENSION)) return null
  return join(photosDirectory(), reference)
}

/**
 * Copies an image the user dropped onto the app into the managed photos
 * folder under a generated, collision-proof name, and returns the reference
 * to store in `item_units.photo_evidence_ref`.
 *
 * Throws on unsupported file types — surfaced to the user as a friendly
 * message by the IPC handler.
 */
export function importPhoto(sourcePath: string): string {
  const ext = extname(sourcePath).toLowerCase()
  if (!(ext in MIME_BY_EXTENSION)) {
    throw new Error('Unsupported image type — use JPG, PNG, GIF, WEBP, or BMP.')
  }

  const reference = `photo-${Date.now()}-${randomBytes(4).toString('hex')}${ext}`
  copyFileSync(sourcePath, join(photosDirectory(), reference))
  return reference
}

/**
 * Reads a managed photo back as a data URL for inline display
 * (`<img src="data:...">`) — sidesteps custom-protocol/CSP plumbing entirely,
 * which is plenty fast for the thumbnail/single-photo-viewer sizes this app
 * deals with. Returns null for anything that isn't a photo we recognize and
 * own (including the old free-text references), so the UI can fall back to a
 * placeholder without surfacing an error for perfectly normal data.
 */
export function readPhotoDataUrl(reference: string): string | null {
  const filePath = resolveManagedPhotoPath(reference)
  if (!filePath || !existsSync(filePath)) return null

  const mime = MIME_BY_EXTENSION[extname(filePath).toLowerCase()]
  const data = readFileSync(filePath)
  return `data:${mime};base64,${data.toString('base64')}`
}

/**
 * Best-effort cleanup when a unit's photo is replaced or cleared — never
 * throws, since a stray file left behind in the managed folder is harmless
 * and not worth surfacing as an error to the user.
 */
export function deleteManagedPhoto(reference: string | null | undefined): void {
  if (!reference) return
  const filePath = resolveManagedPhotoPath(reference)
  if (!filePath) return
  try {
    if (existsSync(filePath)) unlinkSync(filePath)
  } catch {
    // Ignored — see doc comment above.
  }
}
