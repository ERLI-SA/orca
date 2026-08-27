import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  root: resolve('src/renderer'),
  // Why: pairing URLs may live under a reverse-proxy path prefix like
  // /orca/web-index.html, so built assets must resolve relative to the page.
  base: './',
  plugins: [react(), tailwindcss()],
  define: {
    ORCA_FEATURE_WALL_ENABLED: 'true',
    // Why mirrored from electron.vite.config.ts: `orca serve` builds this bundle
    // from the same renderer sources, and a capability disabled in the desktop
    // app must not reappear in its web client.
    ORCA_DISABLED_CAPABILITIES: JSON.stringify(
      (process.env.ORCA_DISABLED_CAPABILITIES ?? '')
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean)
        .join(',')
    )
  },
  resolve: {
    alias: {
      '@renderer': resolve('src/renderer/src'),
      '@': resolve('src/renderer/src')
    }
  },
  build: {
    outDir: resolve('out/web'),
    emptyOutDir: true,
    rollupOptions: {
      input: resolve('src/renderer/web-index.html')
    }
  },
  worker: {
    format: 'es'
  }
})
