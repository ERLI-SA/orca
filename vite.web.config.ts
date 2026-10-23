import { markdownParserAliases } from './config/build-plugins/markdown-parser-exports'
import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { createPdfjsViewerAssetsPlugin } from './config/build-plugins/pdfjs-viewer-assets'
import { createViteCacheRetentionPlugin } from './config/build-plugins/vite-cache-retention'
import { resolveBuildSourceCommit } from './config/scripts/build-source-commit.mjs'

export default defineConfig({
  root: resolve('src/renderer'),
  cacheDir: resolve('.cache/vite/web'),
  // Why: pairing URLs may live under a reverse-proxy path prefix like
  // /orca/web-index.html, so built assets must resolve relative to the page.
  base: './',
  plugins: [
    react(),
    tailwindcss(),
    createPdfjsViewerAssetsPlugin(),
    createViteCacheRetentionPlugin()
  ],
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
    ),
    ORCA_BUILD_COMMIT: JSON.stringify(resolveBuildSourceCommit())
  },
  resolve: {
    alias: {
      ...markdownParserAliases,
      '@renderer': resolve('src/renderer/src'),
      '@': resolve('src/renderer/src')
    }
  },
  build: {
    outDir: resolve('out/web'),
    emptyOutDir: true,
    reportCompressedSize: false,
    rollupOptions: {
      input: resolve('src/renderer/web-index.html')
    }
  },
  worker: {
    format: 'es'
  }
})
