import { contextBridge } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

// Filled in by later milestones with typed IPC calls (auth, db CRUD,
// Excel export/import) — keeps the renderer free of Node/Electron access.
const api = {}

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
