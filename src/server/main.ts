import { serve } from '@hono/node-server'
import { WebSocketServer } from 'ws'
import { createApp } from '#/server/app-factory.ts'
import { serverLogger } from '#/server/logger.ts'
import { closeAllServerTerminalSessions } from '#/server/modules/terminal.ts'

const DEFAULT_HOST = '127.0.0.1'
const DEFAULT_PORT = 32100

function parsePort(value: string | undefined): number {
  const port = Number(value)
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : DEFAULT_PORT
}

export interface BootstrappedServer {
  hostname: string
  port: number
  stop(): void
}

export function bootstrapServer(): BootstrappedServer {
  const startedAt = Date.now()
  const hostname = process.env.GOBLIN_SERVER_HOST?.trim() || DEFAULT_HOST
  const port = parsePort(process.env.GOBLIN_SERVER_PORT)
  const app = createApp({
    version: process.env.npm_package_version?.trim() || '0.1.0',
    startedAt,
    internalSecret: process.env.GOBLIN_SERVER_INTERNAL_SECRET?.trim() || '',
  })
  const websocket = new WebSocketServer({ noServer: true })
  const server = serve({
    hostname,
    port,
    fetch: app.fetch,
    websocket: { server: websocket },
  })
  const shutdown = () => {
    try {
      closeAllServerTerminalSessions()
      websocket.close()
      server.close()
    } catch {}
  }
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, shutdown)
  }
  serverLogger.info({ hostname, port }, 'listening')
  return {
    hostname,
    port,
    stop: shutdown,
  }
}

if (import.meta.main) bootstrapServer()
