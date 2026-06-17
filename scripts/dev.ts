#!/usr/bin/env bun
import { watch } from 'node:fs'
import path from 'node:path'
import { reserveAvailablePort } from '#/system/port-allocation.ts'

const repoRoot = path.resolve(import.meta.dirname, '..')
const webDevHost = process.env.GOBLIN_WEB_DEV_HOST?.trim() || '127.0.0.1'
const webDevPort = parsePort(process.env.GOBLIN_WEB_DEV_PORT) ?? 5173
const webDevUrl = `http://${webDevHost}:${webDevPort}/`
const embeddedServerPort = await chooseEmbeddedServerPort(webDevHost)
const viteArgs = [localBin('vite'), '--host', webDevHost, '--port', String(webDevPort), '--strictPort']
const electronArgs = [localBin('electron'), '.']
const watchedPaths = ['src/main', 'src/preload', 'src/server', 'src/shared', 'vite.config.ts'].map((target) =>
  path.join(repoRoot, target),
)

let shuttingDown = false
let viteExited = false
let electronProc: Bun.Subprocess | null = null
let restartPending = false
let restartTimer: ReturnType<typeof setTimeout> | null = null
let watchers: ReturnType<typeof watch>[] = []

const viteProc = Bun.spawn(viteArgs, {
  cwd: repoRoot,
  stdin: 'inherit',
  stdout: 'inherit',
  stderr: 'inherit',
  // In dev the Vite-served renderer (different origin from the
  // embedded server) can't share cookies. Set this so the server
  // inlines the access token in the HTML bootstrap; the renderer
  // then attaches it as the `x-goblin-access-token` header on
  // every fetch. See `#/server/app-factory.ts:shouldInlineAccessTokenInBootstrap`.
  env: {
    ...process.env,
    GOBLIN_SERVER_HOST: webDevHost,
    GOBLIN_SERVER_PORT: String(embeddedServerPort),
    GOBLIN_DEV_BOOTSTRAP_INCLUDES_TOKEN: '1',
  },
})

log(`starting Vite dev server at ${webDevUrl}`)
log(`proxying renderer /api and /ws to embedded server at http://${webDevHost}:${embeddedServerPort}/`)

void viteProc.exited.then((code) => {
  viteExited = true
  if (!shuttingDown) void shutdown(code)
})

await waitForDevServer()
log('web dev server ready; launching Electron')
electronProc = launchElectron()

watchers = watchedPaths.map((target) =>
  watch(target, { recursive: true }, () => {
    if (shuttingDown) return
    if (restartTimer) clearTimeout(restartTimer)
    restartTimer = setTimeout(() => {
      restartTimer = null
      void restartElectron()
    }, 120)
  }),
)

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void shutdown(0)
  })
}

process.on('exit', () => {
  for (const watcher of watchers) watcher.close()
  if (!viteExited) viteProc.kill()
  electronProc?.kill()
})

function localBin(name: string): string {
  return path.join(repoRoot, 'node_modules', '.bin', `${name}${process.platform === 'win32' ? '.cmd' : ''}`)
}

function log(message: string): void {
  console.log(`[dev] ${message}`)
}

function parsePort(value: string | undefined): number | null {
  if (!value) return null
  const port = Number(value)
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : null
}

async function chooseEmbeddedServerPort(host: string): Promise<number> {
  const preferredPort = parsePort(process.env.GOBLIN_SERVER_PORT) ?? 32100
  return await reserveAvailablePort(host, preferredPort, 'Failed to allocate dev embedded server port')
}

async function waitForDevServer(): Promise<void> {
  while (!viteExited) {
    try {
      const response = await fetch(webDevUrl)
      if (response.ok) return
    } catch {}
    await Bun.sleep(150)
  }
  throw new Error('Vite dev server exited before becoming ready')
}

function launchElectron(): Bun.Subprocess {
  // ELECTRON_RUN_AS_NODE=1 in the shell environment makes the spawned
  // electron process run as a plain Node.js child — the `electron` module
  // is then resolved from npm and is just the binary-path downloader
  // stub, so every `import { app } from 'electron'` in the main process
  // fails with "does not provide an export named 'app'". Strip the flag
  // here so the Electron process starts as a real main process; the
  // embedded server child process still re-applies it via server-manager.ts
  // to spawn Node for the worker entry.
  const { ELECTRON_RUN_AS_NODE: _ignored, ...electronEnv } = process.env
  const proc = Bun.spawn(electronArgs, {
    cwd: repoRoot,
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
    env: {
      ...electronEnv,
      GOBLIN_WEB_DEV_URL: webDevUrl,
      GOBLIN_SERVER_HOST: webDevHost,
      GOBLIN_SERVER_PORT: String(embeddedServerPort),
    },
  })
  void proc.exited.then((code) => {
    if (shuttingDown) return
    if (electronProc !== proc) return
    if (restartPending) {
      restartPending = false
      electronProc = launchElectron()
      return
    }
    void shutdown(code)
  })
  return proc
}

async function restartElectron(): Promise<void> {
  if (!electronProc || restartPending) return
  restartPending = true
  log('main/preload/server/shared config changed; restarting Electron')
  electronProc.kill()
}

async function shutdown(code: number): Promise<never> {
  if (shuttingDown) process.exit(code)
  shuttingDown = true
  if (restartTimer) clearTimeout(restartTimer)
  for (const watcher of watchers) watcher.close()
  electronProc?.kill()
  if (!viteExited) viteProc.kill()
  const pending = [viteProc.exited]
  if (electronProc) pending.push(electronProc.exited)
  await Promise.allSettled(pending)
  process.exit(code)
}
