import { spawn, type ChildProcessByStdio } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import type { Readable } from 'node:stream'
import path from 'node:path'
import { app } from 'electron'
import { failNativeHostForUnexpectedServerExit } from '#/main/embedded-server-fatal-exit.ts'
import { readOrCreateAccessToken } from '#/shared/access-token-file.ts'
import { serverNodeLog } from '#/node/logger.ts'
import { reserveAvailablePort } from '#/system/port-allocation.ts'

const DEFAULT_HOST = '127.0.0.1'
const DEFAULT_PORT = 32100
const HEALTH_PATH = '/api/health'
const SERVER_READY_TIMEOUT_MS = 8_000
const SERVER_STOP_TIMEOUT_MS = 5_000
const SERVER_STDERR_TAIL_MAX_CHARS = 8_000

interface EmbeddedServerRuntime {
  host: string
  port: number
  url: string
  /**
   * Held in native-host memory so the IPC client
   * (`#/shared/embedded-server-client.ts`) can attach the header
   * when the native host calls into the embedded server's HTTP
   * API (e.g. settings, session). Not exposed to the client.
   */
  accessToken: string
}

type ServerChildProcess = ChildProcessByStdio<null, Readable, Readable>

export type EmbeddedServerStopReason = 'app-quit' | 'access-token-rotation' | 'startup-failure'

interface EmbeddedServerProcessRecord {
  proc: ServerChildProcess
  phase: 'starting' | 'ready'
  expectedStopReason: EmbeddedServerStopReason | null
  startupError: Error | null
  stderrTail: string
}

let activeServer: EmbeddedServerProcessRecord | null = null
let runtime: EmbeddedServerRuntime | null = null
let startPromise: Promise<EmbeddedServerRuntime | null> | null = null
let startGeneration = 0

function embeddedServerEnabled(): boolean {
  if (typeof app.getAppPath !== 'function') return false
  const raw = process.env.GOBLIN_ENABLE_EMBEDDED_SERVER?.trim()?.toLowerCase()
  if (raw === '0' || raw === 'false') return false
  if (raw === '1' || raw === 'true') return true
  return true
}

function serverEntryPath(): string {
  return path.join(serverRuntimeRoot(), app.isPackaged ? 'main.js' : 'main.ts')
}

function serverRuntimeRoot(): string {
  return resolveEmbeddedServerRuntimeRoot(app.getAppPath(), app.isPackaged)
}

export function resolveEmbeddedServerRuntimeRoot(appPath: string, isPackaged: boolean): string {
  if (!isPackaged) return path.join(appPath, 'src/server/entrypoints')
  if (path.extname(appPath) !== '.asar') {
    throw new Error(`Packaged app path must be an ASAR archive: ${appPath}`)
  }
  return path.join(`${appPath}.unpacked`, 'dist/server')
}

function serverWorkingDirectory(): string {
  const appPath = app.getAppPath()
  return app.isPackaged && path.extname(appPath) === '.asar' ? path.dirname(appPath) : appPath
}

function serverCommand(): { bin: string; args: string[]; env: NodeJS.ProcessEnv } {
  const entry = serverEntryPath()
  if (!existsSync(entry)) throw new Error(`Embedded server entry not found: ${entry}`)
  return {
    bin: process.execPath,
    args: [entry],
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      // The server owns user workspace paths, not application resources.
      // Disable Electron's transparent .asar interpretation for this process
      // and every server worker it spawns.
      ELECTRON_NO_ASAR: '1',
    },
  }
}

function parseServerPort(value: string | undefined): number {
  const port = Number(value)
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : DEFAULT_PORT
}

async function reserveEmbeddedServerPort(host: string, preferredPort: number): Promise<number> {
  return await reserveAvailablePort(host, preferredPort, 'Failed to allocate embedded server port')
}

async function waitForServer(url: string, timeoutMs: number, record: EmbeddedServerProcessRecord): Promise<void> {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    if (activeServer !== record) {
      throw record.startupError ?? new Error('Embedded server exited before becoming ready')
    }
    try {
      const response = await fetch(`${url}${HEALTH_PATH}`)
      if (response.ok && activeServer === record) return
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 150))
  }
  throw new Error('Timed out waiting for embedded server')
}

function pipeProcessLogs(proc: ServerChildProcess, onStderr: (chunk: string) => void): void {
  proc.stdout.setEncoding('utf8')
  proc.stderr.setEncoding('utf8')
  // These `console.*` writes forward the child process's own stdout/stderr
  // line-for-line to the native host's stdio. They are not our logs —
  // they go to the operator's terminal unchanged, with the child's
  // original format and level. Routing them through pino would (a) wrap
  // raw server output in JSON, losing the child's own format, and (b)
  // subject them to pino's level filter, which can drop server output
  // below the configured level. Keep as raw console.
  proc.stdout.on('data', (chunk) => {
    const output = chunk.trim()
    if (output) console.log(`[server] ${output}`)
  })
  proc.stderr.on('data', (chunk) => {
    const raw = String(chunk)
    onStderr(raw)
    const output = raw.trim()
    if (output) console.error(`[server] ${output}`)
  })
}

function appendStderrTail(current: string, chunk: string): string {
  const combined = `${current}${chunk}`
  return combined.length <= SERVER_STDERR_TAIL_MAX_CHARS
    ? combined
    : combined.slice(combined.length - SERVER_STDERR_TAIL_MAX_CHARS)
}

function readLanEnabledFromSettings(): boolean {
  try {
    const file = path.join(app.getPath('userData'), 'user-settings.json')
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
  const generation = (startGeneration += 1)
  let record: EmbeddedServerProcessRecord | null = null
  const pending = (async (): Promise<EmbeddedServerRuntime | null> => {
    let host = process.env.GOBLIN_SERVER_HOST?.trim()
    if (!host) {
      host = readLanEnabledFromSettings() ? '0.0.0.0' : DEFAULT_HOST
    }
    const preferredPort = parseServerPort(process.env.GOBLIN_SERVER_PORT)
    const port = await reserveEmbeddedServerPort(host, preferredPort)
    if (generation !== startGeneration) return null
    const accessToken = await readOrCreateAccessToken(app.getPath('userData'))
    if (generation !== startGeneration) return null
    const accessHost = host === '0.0.0.0' ? '127.0.0.1' : host
    const url = `http://${accessHost}:${port}`
    const command = serverCommand()
    const proc = spawn(command.bin, command.args, {
      cwd: serverWorkingDirectory(),
      env: {
        ...command.env,
        GOBLIN_SERVER_HOST: host,
        GOBLIN_SERVER_PORT: String(port),
        // The server child process reads this and uses it as the
        // shared auth secret for cookie / header / `?t=` middleware.
        // The client does NOT see this env var — it gets the
        // token via the http-only `goblin_access_token` cookie planted by `plantEmbedAuthCookie` (see `#/main/cookie-bootstrap.ts`)
        // backed by the `runtime.accessToken` field above.
        GOBLIN_SERVER_ACCESS_TOKEN: accessToken,
        GOBLIN_SERVER_DATA_DIR: app.getPath('userData'),
        GOBLIN_COMMAND_BIN_DIR: path.join(serverWorkingDirectory(), 'terminal-bin'),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const spawnedRecord: EmbeddedServerProcessRecord = {
      proc,
      phase: 'starting',
      expectedStopReason: null,
      startupError: null,
      stderrTail: '',
    }
    record = spawnedRecord
    activeServer = spawnedRecord
    pipeProcessLogs(proc, (chunk) => {
      spawnedRecord.stderrTail = appendStderrTail(spawnedRecord.stderrTail, chunk)
    })
    proc.once('exit', (code, signal) => {
      if (activeServer === spawnedRecord) {
        activeServer = null
        runtime = null
      }
      if (spawnedRecord.expectedStopReason) {
        serverNodeLog.info(
          { pid: proc.pid, code, signal, reason: spawnedRecord.expectedStopReason },
          'embedded server stopped',
        )
        return
      }
      if (spawnedRecord.phase === 'starting') {
        const exitDetail = signal ? `signal ${signal}` : `exit code ${code ?? 'unknown'}`
        spawnedRecord.startupError = new Error(`Embedded server exited before becoming ready (${exitDetail})`)
        serverNodeLog.error(
          { pid: proc.pid, code, signal, stderrTail: spawnedRecord.stderrTail.trim() || undefined },
          'embedded server exited before becoming ready',
        )
        return
      }
      failNativeHostForUnexpectedServerExit({ pid: proc.pid, code, signal, stderrTail: spawnedRecord.stderrTail })
    })
    proc.once('error', (error) => {
      serverNodeLog.error({ err: error }, 'process failed')
      if (spawnedRecord.phase === 'starting' && activeServer === spawnedRecord) {
        spawnedRecord.startupError = error instanceof Error ? error : new Error(String(error))
        activeServer = null
        runtime = null
      }
    })
    try {
      await waitForServer(url, SERVER_READY_TIMEOUT_MS, spawnedRecord)
      if (generation !== startGeneration || activeServer !== spawnedRecord) return null
      spawnedRecord.phase = 'ready'
      runtime = { host, port, url, accessToken }
      serverNodeLog.info({ url }, 'ready')
      return runtime
    } catch (error) {
      if (generation !== startGeneration) return null
      if (record && activeServer === record) await stopEmbeddedServer('startup-failure')
      throw error
    }
  })()
  startPromise = pending
  try {
    return await pending
  } finally {
    if (startPromise === pending) startPromise = null
  }
}

export function getEmbeddedServerRuntime(): EmbeddedServerRuntime | null {
  return runtime
}

export async function stopEmbeddedServer(reason: EmbeddedServerStopReason): Promise<void> {
  startGeneration += 1
  const record = activeServer
  if (record) record.expectedStopReason = reason
  activeServer = null
  runtime = null
  startPromise = null
  if (!record) return
  const { proc } = record
  await new Promise<void>((resolve, reject) => {
    let settled = false
    const settle = () => {
      if (settled) return
      settled = true
      resolve()
    }
    let forceExitTimer: ReturnType<typeof setTimeout> | null = null
    const timer = setTimeout(() => {
      try {
        proc.kill('SIGKILL')
        forceExitTimer = setTimeout(() => {
          if (settled) return
          settled = true
          reject(new Error('Embedded server did not exit after SIGKILL'))
        }, 1_000)
      } catch (error) {
        if (settled) return
        settled = true
        reject(error)
      }
    }, SERVER_STOP_TIMEOUT_MS)
    proc.once('exit', () => {
      clearTimeout(timer)
      if (forceExitTimer) clearTimeout(forceExitTimer)
      settle()
    })
    try {
      proc.kill('SIGTERM')
    } catch (error) {
      clearTimeout(timer)
      if (forceExitTimer) clearTimeout(forceExitTimer)
      if (settled) return
      settled = true
      reject(error)
    }
  })
}

export { DEFAULT_PORT as DEFAULT_EMBEDDED_SERVER_PORT, parseServerPort, reserveEmbeddedServerPort }
