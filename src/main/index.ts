import { config } from 'dotenv'
import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { IPC_CHANNELS, type CreateUserInput } from '../shared/ipc'
import { verifySession, isAdmin } from './auth/verifySession'
import { listUsers, createUser, deleteUser } from './auth/userManagement'
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
    icon: join(__dirname, '../../resources/icon.png'),
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
    ipcMain.handle(IPC_CHANNELS.authIsAdmin, (_event, token: string) => isAdmin(token))

    // User management is admin-only and enforced HERE in the main process — the
    // renderer passing the right channel name isn't enough; every call must
    // carry the caller's access token, which we re-verify against ADMIN_EMAILS
    // before touching the Supabase Admin API. A non-admin (or a forged renderer
    // call) is rejected regardless of what the UI shows.
    const requireAdmin = async (token: string): Promise<void> => {
      if (!(await isAdmin(token))) throw new Error('Not authorized — admin access required.')
    }
    ipcMain.handle(IPC_CHANNELS.usersList, async (_event, token: string) => {
      await requireAdmin(token)
      return listUsers()
    })
    ipcMain.handle(IPC_CHANNELS.usersCreate, async (_event, token: string, input: CreateUserInput) => {
      await requireAdmin(token)
      return createUser(input.email, input.password)
    })
    ipcMain.handle(IPC_CHANNELS.usersDelete, async (_event, token: string, id: string) => {
      await requireAdmin(token)
      return deleteUser(id)
    })

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
