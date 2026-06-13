import { Hono } from 'hono'
import { upgradeWebSocket } from '@hono/node-server'
import {
  InvalidationSocketLimitError,
  registerInvalidationSocket,
  unregisterInvalidationSocket,
} from '#/server/modules/invalidation-broker.ts'
import { safeEqualString } from '#/server/common/timing-safe.ts'
import type { ServerTerminalHost, ServerTerminalSocket } from '#/server/terminal/terminal-host.ts'

interface RealtimeRouteOptions {
  internalSecret: string
  terminalHost: ServerTerminalHost
}

// Cap each terminal WS message at 1 MiB. Real terminal input is
// a keystroke or a paste; 1 MiB covers the largest legitimate
// paste while preventing a hostile client from streaming an
// unbounded buffer through the worker.
const TERMINAL_WS_MESSAGE_LIMIT_BYTES = 1 * 1024 * 1024

// Server-authoritative realtime only. Native-host renderer effect intents stay
// on Electron IPC so the server does not become a broker for local shell APIs.
export function createRealtimeRoutes({ internalSecret, terminalHost }: RealtimeRouteOptions) {
  const app = new Hono()
  app.use('/invalidation', async (c, next) => {
    if (!safeEqualString(c.req.query('token') ?? '', internalSecret)) {
      return c.json({ ok: false, message: 'Unauthorized' }, 401)
    }
    await next()
  })
  app.use('/terminal', async (c, next) => {
    if (!safeEqualString(c.req.query('token') ?? '', internalSecret)) {
      return c.json({ ok: false, message: 'Unauthorized' }, 401)
    }
    if (!terminalHost.isValidClientId(c.req.query('clientId')))
      return c.json({ ok: false, message: 'Invalid client id' }, 400)
    if (!c.req.query('attachmentId')) return c.json({ ok: false, message: 'Missing attachment id' }, 400)
    await next()
  })
  app.get(
    '/invalidation',
    upgradeWebSocket(() => {
      return {
        onOpen(_event, ws) {
          try {
            registerInvalidationSocket(ws)
          } catch (err) {
            if (err instanceof InvalidationSocketLimitError) {
              try {
                ws.close(1013, 'subscriber limit reached')
              } catch {}
              return
            }
            throw err
          }
        },
        onClose(_event, ws) {
          unregisterInvalidationSocket(ws)
        },
        onError(_event, ws) {
          unregisterInvalidationSocket(ws)
        },
      }
    }),
  )
  app.get(
    '/terminal',
    upgradeWebSocket((c) => {
      const clientId = c.req.query('clientId') ?? ''
      const attachmentId = c.req.query('attachmentId') ?? ''
      return {
        onOpen(_event, ws) {
          terminalHost.registerSocket(clientId, attachmentId, ws as ServerTerminalSocket)
        },
        onMessage(event, ws) {
          if (typeof event.data === 'string') {
            if (event.data.length > TERMINAL_WS_MESSAGE_LIMIT_BYTES) {
              try {
                ws.close(1009, 'message too large')
              } catch {}
              return
            }
            terminalHost.handleRealtimeMessage(clientId, attachmentId, ws as ServerTerminalSocket, event.data)
          }
        },
        onClose(_event, ws) {
          terminalHost.unregisterSocket(clientId, attachmentId, ws as ServerTerminalSocket)
        },
        onError(_event, ws) {
          terminalHost.unregisterSocket(clientId, attachmentId, ws as ServerTerminalSocket)
        },
      }
    }),
  )
  return app
}
