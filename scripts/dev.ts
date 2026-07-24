#!/usr/bin/env bun
import { watch } from 'node:fs'
import path from 'node:path'
import electron from 'electron'
import { omit } from 'es-toolkit'
import { reserveAvailablePort } from '#/system/port-allocation.ts'
import { prepareNodePtyDarwinRuntime } from '#/system/node-pty-runtime.ts'

const repoRoot = path.resolve(import.meta.dirname, '..')
prepareNodePtyDarwinRuntime({ packageRoot: path.join(repoRoot, 'node_modules/node-pty') })
const webDevHost = process.env.GOBLIN_WEB_DEV_HOST?.trim() || '127.0.0.1'
const webDevPort = parsePort(process.env.GOBLIN_WEB_DEV_PORT) ?? 5173
const webDevUrl = `http://${webDevHost}:${webDevPort}/`
const embeddedServerPort = await chooseEmbeddedServerPort(webDevHost)
const viteArgs = [localBin('vite'), '--host', webDevHost, '--port', String(webDevPort), '--strictPort']
const electronCommand = createElectronCommand()
const watchedPaths = ['src/main', 'src/preload', 'src/server', 'src/shared', 'src/system', 'vite.config.ts'].map(
  (target) => path.join(repoRoot, target),
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
  env: {
    ...process.env,
    GOBLIN_SERVER_HOST: webDevHost,
    GOBLIN_SERVER_PORT: String(embeddedServerPort),
  },
})

log(`starting Vite dev server at ${webDevUrl}`)
log(`proxying client /api and /ws to embedded server at http://${webDevHost}:${embeddedServerPort}/`)

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
  // stub, so every `import { app } from 'electron'` in the native host
  // fails with "does not provide an export named 'app'". Strip the flag
  // here so the Electron process starts as a real native host; the
  // embedded server child process still re-applies it via
  // embedded-server-lifecycle.ts to spawn Node for the worker entry.
  const electronEnv = omit(process.env, ['ELECTRON_RUN_AS_NODE'])
  const proc = Bun.spawn(electronCommand, {
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

function createElectronCommand(): string[] {
  const executable: unknown = electron
  if (typeof executable !== 'string') throw new Error('Electron executable path is unavailable')
  const command = [executable, '.']
  const userDataDir = process.env.GOBLIN_ELECTRON_USER_DATA_DIR?.trim()
  if (userDataDir) command.push(`--user-data-dir=${userDataDir}`)
  const remoteDebuggingPortInput = process.env.AGENT_BROWSER_CDP_PORT?.trim()
  if (remoteDebuggingPortInput) {
    const remoteDebuggingPort = parsePort(remoteDebuggingPortInput)
    if (remoteDebuggingPort === null) throw new Error('AGENT_BROWSER_CDP_PORT must be a valid TCP port')
    command.push(`--remote-debugging-port=${remoteDebuggingPort}`)
  }
  return command
}

async function restartElectron(): Promise<void> {
  if (!electronProc || restartPending) return
  restartPending = true
  log('main/preload/server/shared config changed; restarting Electron')
  // The native host converts SIGTERM into app.quit(), so `exited` resolves
  // only after its embedded server and PTY worker have stopped.
  electronProc.kill('SIGTERM')
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
