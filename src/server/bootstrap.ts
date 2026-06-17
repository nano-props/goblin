import type { Socket } from 'node:net'
import { serve, type ServerType } from '@hono/node-server'
import { WebSocketServer } from 'ws'
import { serverLogger } from '#/server/logger.ts'
import { disconnectAllInvalidationSockets } from '#/server/modules/invalidation-broker.ts'
import { createServerRuntime } from '#/server/runtime.ts'
import { readOrCreateAccessToken } from '#/shared/access-token-file.ts'

const DEFAULT_HOST = '127.0.0.1'
const DEFAULT_PORT = 32100
const SHUTDOWN_SOCKET_GRACE_MS = 150
const SHUTDOWN_TIMEOUT_MS = 1_000

function parsePort(value: string | undefined): number {
  const port = Number(value)
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : DEFAULT_PORT
}

export interface BootstrappedServer {
  hostname: string
  port: number
  stop(): Promise<void>
}

export interface BootstrapServerOptions {
  /** Path to the bundled PTY worker entry. Enables subprocess PTY isolation. */
  ptyWorkerEntry?: string
  exit?: (code: number) => void
}

/**
 * Resolve the access token for the server. The `GOBLIN_SERVER_ACCESS_TOKEN`
 * env var wins when set (CI / tests / an explicit override), otherwise we
 * read (or create) the file in the server's data dir. This is the same
 * file the Electron main reads, so the two processes see the same value.
 */
async function resolveAccessToken(): Promise<string> {
  const override = process.env.GOBLIN_SERVER_ACCESS_TOKEN?.trim()
  if (override) return override
  return await readOrCreateAccessToken()
}

export async function bootstrapServer(options: BootstrapServerOptions = {}): Promise<BootstrappedServer> {
  const startedAt = Date.now()
  const hostname = process.env.GOBLIN_SERVER_HOST?.trim() || DEFAULT_HOST
  const port = parsePort(process.env.GOBLIN_SERVER_PORT)
  const accessToken = await resolveAccessToken()
  const runtime = createServerRuntime({
    version: process.env.npm_package_version?.trim() || '0.1.0',
    startedAt,
    accessToken,
    ptyWorkerEntry: options.ptyWorkerEntry,
    serverHost: hostname,
    serverPort: port,
  })
  const websocket = new WebSocketServer({ noServer: true })
  const server = serve({
    hostname,
    port,
    fetch: runtime.app.fetch,
    websocket: { server: websocket },
  })
  const sockets = new Set<Socket>()
  const exit = options.exit ?? ((code: number) => process.exit(code))
  let shutdownPromise: Promise<void> | null = null

  server.on('connection', (socket: Socket) => {
    sockets.add(socket)
    socket.once('close', () => {
      sockets.delete(socket)
    })
  })

  const shutdown = async () => {
    if (shutdownPromise) return await shutdownPromise
    shutdownPromise = (async () => {
      try {
        runtime.shutdown()
      } catch {}
      try {
        disconnectAllInvalidationSockets()
      } catch {}
      closeWebSocketClients(websocket)
      let forceClosed = false
      const forceClose = () => {
        if (forceClosed) return
        forceClosed = true
        terminateWebSocketClients(websocket)
        destroySockets(sockets)
      }
      const forceCloseTimer = setTimeout(forceClose, SHUTDOWN_SOCKET_GRACE_MS)
      try {
        await Promise.race([closeServerResources(server, websocket), waitForTimeout(SHUTDOWN_TIMEOUT_MS)])
      } finally {
        clearTimeout(forceCloseTimer)
        forceClose()
      }
    })()
    return await shutdownPromise
  }
  const shutdownAndExit = async () => {
    try {
      await shutdown()
    } finally {
      exit(0)
    }
  }
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      void shutdownAndExit()
    })
  }
  serverLogger.info({ hostname, port }, 'listening')
  return {
    hostname,
    port,
    // `stop()` is a graceful shutdown primitive only. Entry points and signal
    // handlers retain ownership of process exit so embedded callers can reuse
    // the server runtime without inheriting an unconditional exit(0).
    stop: shutdown,
  }
}

async function closeServerResources(server: ServerType, websocket: WebSocketServer): Promise<void> {
  await Promise.all([closeHttpServer(server), closeWebSocketServer(websocket)])
}

async function closeHttpServer(server: ServerType): Promise<void> {
  await new Promise<void>((resolve) => {
    try {
      server.close(() => resolve())
    } catch {
      resolve()
    }
  })
}

async function closeWebSocketServer(websocket: WebSocketServer): Promise<void> {
  await new Promise<void>((resolve) => {
    try {
      websocket.close(() => resolve())
    } catch {
      resolve()
    }
  })
}

function closeWebSocketClients(websocket: WebSocketServer): void {
  for (const client of Array.from(websocket.clients)) {
    try {
      client.close(1001, 'server shutting down')
    } catch {}
  }
}

function terminateWebSocketClients(websocket: WebSocketServer): void {
  for (const client of Array.from(websocket.clients)) {
    try {
      client.terminate()
    } catch {}
  }
}

function destroySockets(sockets: Iterable<Socket>): void {
  for (const socket of sockets) {
    try {
      socket.destroy()
    } catch {}
  }
}

async function waitForTimeout(delayMs: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, delayMs)
  })
}
