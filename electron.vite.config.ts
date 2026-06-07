import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()]
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        // shadcn/ui's published component source imports via "@/..." — keep
        // that alias so we can drop their components in with no path edits.
        '@': resolve('src/renderer/src'),
        // Lets renderer pages import the IPC channel/domain types directly
        // from the same module the main process and preload use, so the
        // three layers can never silently drift out of sync.
        '@shared': resolve('src/shared')
      }
    },
    plugins: [react(), tailwindcss()]
  }
})
