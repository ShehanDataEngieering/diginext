import { config } from 'dotenv'
import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { IPC_CHANNELS } from '../shared/ipc'
import { verifySession } from './auth/verifySession'
import { backupDatabase, listBackups, restoreDatabase } from './db/backup'
import { closeDb, dbPath, getDb } from './db/connection'

// Loads CLERK_SECRET_KEY (and any other main-process secrets) from .env before
// anything that depends on them — must run before verifySession is imported
// for real use, so this sits at the very top of the entry point.
config()

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      // better-sqlite3-multiple-ciphers and other native modules used by the
      // data layer need Node integration in the preload; sandboxing the
      // renderer process would block that.
      sandbox: false
    }
  })

  // Defer showing the window until the page has rendered, to avoid a blank flash on launch.
  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.diginext.inventory')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  ipcMain.handle(IPC_CHANNELS.authVerifySession, (_event, token: string) => verifySession(token))

  // Snapshot whatever DB exists *before* opening it — if migrations or the
  // app itself are about to do something destructive, last night's good copy
  // is already safely tucked away in backups/. Then open (creating + migrating
  // on first run) so the rest of the app has a ready connection via getDb().
  backupDatabase(dbPath(), 'auto')
  getDb()

  ipcMain.handle(IPC_CHANNELS.dbBackupNow, () => backupDatabase(dbPath(), 'manual'))
  ipcMain.handle(IPC_CHANNELS.dbListBackups, () => listBackups())
  ipcMain.handle(IPC_CHANNELS.dbRestoreBackup, (_event, backupPath: string) => {
    // Restoring overwrites the live file, which only SQLite/SQLCipher should
    // hold open — close our connection first, swap the file, then reopen so
    // the rest of the app keeps working against the restored data without
    // requiring a full app restart.
    closeDb()
    restoreDatabase(backupPath, dbPath())
    getDb()
  })

  createWindow()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// Release the SQLCipher file handle cleanly so WAL files get checkpointed
// and merged back into the main database file before the process exits.
app.on('before-quit', () => {
  closeDb()
})
