import { ElectronAPI } from '@electron-toolkit/preload'

interface Api {
  auth: {
    verifySession: (token: string) => Promise<boolean>
  }
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: Api
  }
}
