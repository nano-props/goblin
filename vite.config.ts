import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwind from '@tailwindcss/vite'
import path from 'node:path'
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const pkg = JSON.parse(readFileSync(path.resolve(import.meta.dirname, 'package.json'), 'utf8')) as {
  version: string
}

// Best-effort short commit hash. Failing silently (no git, shallow clone,
// build server without git) yields an empty string; the settings panel
// hides the field in that case rather than showing a broken build tag.
function commitHash(): string {
  try {
    return execSync('git rev-parse --short HEAD', { cwd: import.meta.dirname })
      .toString()
      .trim()
  } catch {
    return ''
  }
}

export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwind()],
  root: path.resolve(import.meta.dirname, 'src/renderer'),
  base: './',
  // Inject app version + commit hash at build time so the renderer can
  // show them (e.g. in the settings overlay) without an IPC round-trip.
  // JSON.stringify so the values land as string literals, not bare text.
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_INFO__: JSON.stringify({ commit: commitHash() }),
  },
  resolve: {
    alias: {
      '#': path.resolve(import.meta.dirname, 'src'),
    },
  },
  build: {
    outDir: path.resolve(import.meta.dirname, 'dist/renderer'),
    emptyOutDir: true,
    sourcemap: mode === 'production' ? false : 'inline',
    rollupOptions: {
      input: {
        index: path.resolve(import.meta.dirname, 'src/renderer/index.html'),
      },
    },
  },
}))
