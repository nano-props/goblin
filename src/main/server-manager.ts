import { spawn, type ChildProcessByStdio } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import type { Readable } from 'node:stream'
import path from 'node:path'
import { app } from 'electron'
import { reserveAvailablePort } from '#/system/port-allocation.ts'

const DEFAULT_HOST = '127.0.0.1'
const DEFAULT_PORT = 32100
const HEALTH_PATH = '/api/health'
const SERVER_READY_TIMEOUT_MS = 8_000
const SERVER_STOP_TIMEOUT_MS = 5_000

interface EmbeddedServerRuntime {
  host: string
  port: number
  url: string
  secret: string
  clientId: string
}

type ServerChildProcess = ChildProcessByStdio<null, Readable, Readable>

let serverProcess: ServerChildProcess | null = null
let runtime: EmbeddedServerRuntime | null = null
let startPromise: Promise<EmbeddedServerRuntime | null> | null = null

function embeddedServerEnabled(): boolean {
  if (typeof app.getAppPath !== 'function') return false
  const raw = process.env.GOBLIN_ENABLE_LOCAL_SERVER?.trim()?.toLowerCase()
  if (raw === '0' || raw === 'false') return false
  if (raw === '1' || raw === 'true') return true
  return true
}

function serverEntryPath(): string {
  return app.isPackaged
    ? path.join(app.getAppPath(), 'dist/server/main.js')
    : path.join(app.getAppPath(), 'src/server/entrypoints/main.ts')
}

function serverWorkingDirectory(): string {
  const appPath = app.getAppPath()
  return app.isPackaged && path.extname(appPath) === '.asar' ? path.dirname(appPath) : appPath
}

function serverCommand(): { bin: string; args: string[]; env: NodeJS.ProcessEnv } {
  const entry = serverEntryPath()
  if (app.isPackaged || existsSync(path.join(app.getAppPath(), 'dist/server/main.js'))) {
    return {
      bin: process.execPath,
      args: [entry],
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
      },
    }
  }
  return {
    bin: process.execPath,
    args: [entry],
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
    },
  }
}

function parseServerPort(value: string | undefined): number {
  const port = Number(value)
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : DEFAULT_PORT
}

async function reserveEmbeddedServerPort(host: string, preferredPort: number): Promise<number> {
  return await reserveAvailablePort(host, preferredPort, 'Failed to allocate local server port')
}

async function waitForServer(url: string, timeoutMs: number): Promise<void> {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    if (!serverProcess) throw new Error('Embedded server exited before becoming ready')
    try {
      const response = await fetch(`${url}${HEALTH_PATH}`)
      if (response.ok) return
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 150))
  }
  throw new Error('Timed out waiting for embedded server')
}

function deriveServerClientId(secret: string): string {
  return `client_${createHash('sha256').update(secret).digest('hex').slice(0, 32)}`
}

function pipeProcessLogs(proc: ServerChildProcess): void {
  proc.stdout.setEncoding('utf8')
  proc.stderr.setEncoding('utf8')
  proc.stdout.on('data', (chunk) => {
    const output = chunk.trim()
    if (output) console.log(`[server] ${output}`)
  })
  proc.stderr.on('data', (chunk) => {
    const output = chunk.trim()
    if (output) console.error(`[server] ${output}`)
  })
}

function readLanEnabledFromSettings(): boolean {
  try {
    const file = path.join(app.getPath('userData'), 'server-settings.json')
    const raw = readFileSync(file, 'utf-8')
    const parsed = JSON.parse(raw)
    return parsed.lanEnabled === true
  } catch {
    return false
  }
}

export async function startEmbeddedServer(): Promise<EmbeddedServerRuntime | null> {
  if (runtime) return runtime
  if (startPromise) return await startPromise
  if (!embeddedServerEnabled()) return null
  startPromise = (async () => {
    let host = process.env.GOBLIN_SERVER_HOST?.trim()
    if (!host) {
      host = readLanEnabledFromSettings() ? '0.0.0.0' : DEFAULT_HOST
    }
    const preferredPort = parseServerPort(process.env.GOBLIN_SERVER_PORT)
    const port = await reserveEmbeddedServerPort(host, preferredPort)
    const secret = randomBytes(32).toString('hex')
    const clientId = deriveServerClientId(secret)
    const url = `http://${host}:${port}`
    const command = serverCommand()
    const proc = spawn(command.bin, command.args, {
      cwd: serverWorkingDirectory(),
      env: {
        ...command.env,
        GOBLIN_SERVER_HOST: host,
        GOBLIN_SERVER_PORT: String(port),
        GOBLIN_SERVER_INTERNAL_SECRET: secret,
        GOBLIN_SERVER_DATA_DIR: app.getPath('userData'),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    serverProcess = proc
    pipeProcessLogs(proc)
    proc.once('exit', () => {
      if (serverProcess === proc) serverProcess = null
      runtime = null
    })
    proc.once('error', (error) => {
      console.error('[server] process failed', error)
    })
    try {
      await waitForServer(url, SERVER_READY_TIMEOUT_MS)
      runtime = { host, port, url, secret, clientId }
      console.log(`[server] ready at ${url}`)
      return runtime
    } catch (error) {
      await stopEmbeddedServer()
      throw error
    } finally {
      startPromise = null
    }
  })()
  return await startPromise
}

export function getEmbeddedServerRuntime(): EmbeddedServerRuntime | null {
  return runtime
}

export async function stopEmbeddedServer(): Promise<void> {
  const proc = serverProcess
  serverProcess = null
  runtime = null
  startPromise = null
  if (!proc) return
  await new Promise<void>((resolve) => {
    let settled = false
    const settle = () => {
      if (settled) return
      settled = true
      resolve()
    }
    const timer = setTimeout(() => {
      try {
        proc.kill('SIGKILL')
      } catch {}
      settle()
    }, SERVER_STOP_TIMEOUT_MS)
    proc.once('exit', () => {
      clearTimeout(timer)
      settle()
    })
    try {
      proc.kill('SIGTERM')
    } catch {
      clearTimeout(timer)
      settle()
    }
  })
}

export { DEFAULT_PORT as DEFAULT_EMBEDDED_SERVER_PORT, parseServerPort, reserveEmbeddedServerPort }
