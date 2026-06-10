import { config } from 'dotenv'
import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { IPC_CHANNELS } from '../shared/ipc'
import { verifySession } from './auth/verifySession'
import { closeDb, initDb } from './db/connection'
import { maybeSeedFromMasterInventory } from './db/maybeSeed'
import { registerDataHandlers } from './ipc/dataHandlers'

if (is.dev) {
  config()
} else {
  config({ path: join(process.resourcesPath, '.env') })
}

if (process.platform === 'linux') {
  app.commandLine.appendSwitch('no-sandbox')
  app.commandLine.appendSwitch('disable-gpu')
  app.commandLine.appendSwitch('disable-gpu-compositing')
  app.commandLine.appendSwitch('disable-software-rasterizer')
  app.commandLine.appendSwitch('disable-dev-shm-usage')
  app.disableHardwareAcceleration()
}

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

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

app.whenReady().then(async () => {
  electronApp.setAppUserModelId('com.diginext.inventory')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  try {
    ipcMain.handle(IPC_CHANNELS.authVerifySession, (_event, token: string) => verifySession(token))

    const db = await initDb()

    await maybeSeedFromMasterInventory(db)

    registerDataHandlers(db)

    ipcMain.handle(IPC_CHANNELS.dbBackupNow, () => null)
    ipcMain.handle(IPC_CHANNELS.dbListBackups, () => [])
    ipcMain.handle(IPC_CHANNELS.dbRestoreBackup, () => {
      throw new Error('Backup restore not supported for Supabase — use Supabase dashboard')
    })

    createWindow()
  } catch (error) {
    const { dialog } = await import('electron')
    dialog.showErrorBox('Startup Error', `Failed to initialize: ${error instanceof Error ? error.message : String(error)}`)
    app.quit()
  }

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  closeDb()
})
