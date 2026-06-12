import { readFileSync } from 'fs'
import { extname, basename } from 'path'
import { randomBytes } from 'crypto'

const BUCKET_NAME = 'photos'

const MIME_BY_EXTENSION: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp'
}

let bucketReady = false

function getStorageConfig() {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env')
  return { url, key }
}

function storageHeaders(key: string): Record<string, string> {
  return {
    'Authorization': `Bearer ${key}`,
    'apikey': key
  }
}

async function ensureBucket(): Promise<void> {
  if (bucketReady) return
  const { url, key } = getStorageConfig()
  const headers = storageHeaders(key)

  const listRes = await fetch(`${url}/storage/v1/bucket`, { headers })
  if (!listRes.ok) throw new Error(`Failed to list buckets: ${listRes.status}`)
  const buckets = (await listRes.json()) as { name: string }[]

  if (!buckets.some((b) => b.name === BUCKET_NAME)) {
    const createRes = await fetch(`${url}/storage/v1/bucket`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: BUCKET_NAME, public: false })
    })
    if (!createRes.ok) {
      const err = await createRes.text()
      throw new Error(`Failed to create bucket: ${createRes.status} ${err}`)
    }
  }
  bucketReady = true
}

export async function importPhoto(sourcePath: string): Promise<string> {
  const ext = extname(sourcePath).toLowerCase()
  if (!(ext in MIME_BY_EXTENSION)) {
    throw new Error('Unsupported image type — use JPG, PNG, GIF, WEBP, or BMP.')
  }

  await ensureBucket()

  const reference = `photo-${Date.now()}-${randomBytes(4).toString('hex')}${ext}`
  const fileData = readFileSync(sourcePath)
  const contentType = MIME_BY_EXTENSION[ext]
  const { url, key } = getStorageConfig()

  const res = await fetch(`${url}/storage/v1/object/${BUCKET_NAME}/${reference}`, {
    method: 'POST',
    headers: {
      ...storageHeaders(key),
      'Content-Type': contentType,
      'x-upsert': 'false'
    },
    body: fileData
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Failed to upload photo: ${res.status} ${err}`)
  }
  return reference
}

export async function readPhotoDataUrl(reference: string): Promise<string | null> {
  if (!reference || reference !== basename(reference)) return null
  const ext = extname(reference).toLowerCase()
  if (!(ext in MIME_BY_EXTENSION)) return null

  try {
    await ensureBucket()
    const { url, key } = getStorageConfig()

    const res = await fetch(`${url}/storage/v1/object/${BUCKET_NAME}/${reference}`, {
      headers: storageHeaders(key)
    })
    if (!res.ok) return null

    const buffer = Buffer.from(await res.arrayBuffer())
    const mime = MIME_BY_EXTENSION[ext]
    return `data:${mime};base64,${buffer.toString('base64')}`
  } catch {
    return null
  }
}

export async function deleteManagedPhoto(reference: string | null | undefined): Promise<void> {
  if (!reference) return
  if (reference !== basename(reference)) return
  const ext = extname(reference).toLowerCase()
  if (!(ext in MIME_BY_EXTENSION)) return

  try {
    await ensureBucket()
    const { url, key } = getStorageConfig()

    await fetch(`${url}/storage/v1/object/${BUCKET_NAME}/${reference}`, {
      method: 'DELETE',
      headers: storageHeaders(key)
    })
  } catch {
    // Best-effort cleanup
  }
}
