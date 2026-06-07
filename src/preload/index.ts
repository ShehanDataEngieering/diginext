import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import { IPC_CHANNELS } from '../shared/ipc'

// Extended by later milestones with typed IPC calls (db CRUD, Excel
// export/import) — keeps the renderer free of direct Node/Electron access.
const api = {
  auth: {
    // Sends the Clerk session JWT to the main process for verification.
    // Returns true only if the main process independently confirms the
    // session is valid — the renderer's own Clerk state is not trusted.
    verifySession: (token: string): Promise<boolean> =>
      ipcRenderer.invoke(IPC_CHANNELS.authVerifySession, token)
  }
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
