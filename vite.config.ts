import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwind from '@tailwindcss/vite'
import { execaSync } from 'execa'
import path from 'node:path'
import { readFileSync } from 'node:fs'

const pkg = JSON.parse(readFileSync(path.resolve(import.meta.dirname, 'package.json'), 'utf8')) as {
  version: string
}
const embeddedServerHost = process.env.GOBLIN_SERVER_HOST?.trim() || '127.0.0.1'
const embeddedServerPort = process.env.GOBLIN_SERVER_PORT?.trim() || '32100'
const embeddedServerTarget = `http://${embeddedServerHost}:${embeddedServerPort}`

// Best-effort short commit hash. Failing silently (no git, shallow clone,
// build server without git) yields an empty string; the settings panel
// hides the field in that case rather than showing a broken build tag.
function commitHash(): string {
  try {
    return execaSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: import.meta.dirname }).stdout.trim()
  } catch {
    return ''
  }
}

export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwind()],
  root: path.resolve(import.meta.dirname, 'src/web'),
  // Production keeps relative asset URLs so the embedded server can serve
  // the renderer bundle correctly regardless of its mounted origin. Dev
  // keeps absolute URLs for the Vite dev server.
  base: mode === 'production' ? './' : '/',
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
  server:
    mode === 'production'
      ? undefined
      : {
          proxy: {
            '/api': {
              target: embeddedServerTarget,
              changeOrigin: false,
            },
            '/ws': {
              target: embeddedServerTarget,
              changeOrigin: false,
              ws: true,
            },
          },
        },
  build: {
    outDir: path.resolve(import.meta.dirname, 'dist/web'),
    emptyOutDir: true,
    sourcemap: mode === 'production' ? false : 'inline',
    chunkSizeWarningLimit: 2048,
    rollupOptions: {
      input: {
        index: path.resolve(import.meta.dirname, 'src/web/index.html'),
      },
    },
  },
}))
