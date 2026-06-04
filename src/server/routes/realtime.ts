import { Hono } from 'hono'
import { upgradeWebSocket } from '@hono/node-server'
import { registerInvalidationSocket, unregisterInvalidationSocket } from '#/server/modules/invalidation-broker.ts'
import type { ServerTerminalHost, ServerTerminalSocket } from '#/server/terminal/terminal-host.ts'

interface RealtimeRouteOptions {
  internalSecret: string
  terminalHost: ServerTerminalHost
}

export function createRealtimeRoutes({ internalSecret, terminalHost }: RealtimeRouteOptions) {
  const app = new Hono()
  app.use('/invalidation', async (c, next) => {
    if (c.req.query('token') !== internalSecret) return c.json({ ok: false, message: 'Unauthorized' }, 401)
    await next()
  })
  app.use('/terminal', async (c, next) => {
    if (c.req.query('token') !== internalSecret) return c.json({ ok: false, message: 'Unauthorized' }, 401)
    if (!terminalHost.isValidClientId(c.req.query('clientId'))) return c.json({ ok: false, message: 'Invalid client id' }, 400)
    if (!c.req.query('attachmentId')) return c.json({ ok: false, message: 'Missing attachment id' }, 400)
    await next()
  })
  app.get(
    '/invalidation',
    upgradeWebSocket(() => {
      return {
        onOpen(_event, ws) {
          registerInvalidationSocket(ws)
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
