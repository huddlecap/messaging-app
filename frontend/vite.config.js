import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    watch: {
      // The project lives on /mnt/c, a 9p (drvfs) mount, which delivers no
      // inotify events — Vite would never notice edits and would keep serving
      // its stale in-memory copy (even to a hard reload). Polling instead.
      usePolling: true,
    },
    proxy: {
      '/api': 'http://localhost:3000',
      '/ws': {
        target: 'ws://localhost:3000',
        ws: true,
      },
    },
  },
})
