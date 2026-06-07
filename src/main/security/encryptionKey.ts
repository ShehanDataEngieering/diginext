import { app, safeStorage } from 'electron'
import { randomBytes } from 'crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'

const KEY_FILE_NAME = 'db.key'
// Distinct name/extension so it's unmistakable in a directory listing or a
// backup that this file is NOT protected by the OS — see the dev fallback
// in getOrCreateEncryptionKey() below.
const INSECURE_DEV_KEY_FILE_NAME = 'db.key.insecure-dev-only'

function keyFilePath(): string {
  return join(app.getPath('userData'), KEY_FILE_NAME)
}

function insecureDevKeyFilePath(): string {
  return join(app.getPath('userData'), INSECURE_DEV_KEY_FILE_NAME)
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
    // Packaged builds only ship for Windows, where DPAPI-backed safeStorage
    // is always available — hitting this branch there would mean something
    // is genuinely broken, so refuse to start rather than fall back silently.
    if (app.isPackaged) {
      throw new Error(
        'OS-level secret storage (Electron safeStorage) is unavailable on this machine, ' +
          'so the database key cannot be stored securely. Refusing to start.'
      )
    }

    // Dev-only fallback: Linux dev environments (e.g. WSL) typically don't run
    // a desktop keyring (gnome-keyring/kwallet via libsecret), so
    // isEncryptionAvailable() returns false there even though the eventual
    // packaged app runs on Windows with real DPAPI. Rather than blocking all
    // local development on installing/configuring a keyring daemon, fall back
    // to a plainly-named, unencrypted key file — clearly worse, but scoped to
    // `!app.isPackaged` so it can never reach a shipped build, and isolated to
    // its own file (never written/read as if it were the real db.key).
    console.warn(
      '[encryptionKey] safeStorage unavailable — using an UNENCRYPTED dev-only key file ' +
        `(${INSECURE_DEV_KEY_FILE_NAME}). This path is disabled in packaged builds.`
    )
    const devPath = insecureDevKeyFilePath()
    if (existsSync(devPath)) {
      return readFileSync(devPath, 'utf8').trim()
    }
    const devKey = randomBytes(32).toString('hex')
    mkdirSync(dirname(devPath), { recursive: true })
    writeFileSync(devPath, devKey, 'utf8')
    return devKey
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
