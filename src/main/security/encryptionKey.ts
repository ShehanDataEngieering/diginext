import { app, safeStorage } from 'electron'
import { randomBytes } from 'crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'

const KEY_FILE_NAME = 'db.key'

function keyFilePath(): string {
  return join(app.getPath('userData'), KEY_FILE_NAME)
}

// The database is encrypted with a random 256-bit key, generated once on
// first launch and reused after that (losing it makes the DB unreadable, so
// it must persist). The key itself is encrypted at rest via Electron's
// safeStorage — backed by Windows DPAPI / macOS Keychain / Linux Secret
// Service — so the key file alone is useless on another machine or user
// account; only safeStorage can decrypt it back to the raw passphrase.
//
// Returns a 64-character hex string (32 bytes), passed to SQLCipher as a
// raw key (see src/main/db/connection.ts) rather than a passphrase, which
// skips SQLCipher's PBKDF2 derivation step — appropriate here since we
// already have a high-entropy random key, not a user-chosen password.
export function getOrCreateEncryptionKey(): string {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error(
      'OS-level secret storage (Electron safeStorage) is unavailable on this machine, ' +
        'so the database key cannot be stored securely. Refusing to start.'
    )
  }

  const filePath = keyFilePath()
  if (existsSync(filePath)) {
    return safeStorage.decryptString(readFileSync(filePath))
  }

  const key = randomBytes(32).toString('hex')
  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, safeStorage.encryptString(key))
  return key
}
