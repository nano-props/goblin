import { Hono, type Context, type Next } from 'hono'
import { upgradeWebSocket } from '@hono/node-server'
import { serverNodeLog } from '#/node/logger.ts'
import {
  NotificationSocketLimitError,
  registerNotificationSocket,
  unregisterNotificationSocket,
  setNotificationClientIntentSubscription,
} from '#/server/realtime/notification-broker.ts'
import { isNotificationSubscription } from '#/shared/server-notification.ts'
import { createWebSocketAccessTokenMiddleware } from '#/server/common/auth.ts'
import { userIdFromContext } from '#/server/common/identity.ts'
import { errorJson } from '#/server/common/responses.ts'
import { isAppRealtimeWsMessageWithinLimit } from '#/shared/app-realtime-validators.ts'
import type { ServerAppRealtimeHost, ServerAppRealtimeSocket } from '#/server/realtime/app-realtime-host.ts'
import { AppRealtimeSocketLimitError } from '#/server/realtime/realtime-broker.ts'

interface RealtimeRouteOptions {
  accessToken: string
  appRealtimeHost: ServerAppRealtimeHost
}

type RealtimeSubscriberChannel = 'notifications' | 'app'

const realtimeRoutesLogger = serverNodeLog.child({ module: 'realtime-routes' })

// Runtime requests and streams use /ws/app; lightweight invalidations and
// browser navigation intents share /ws/notifications.
export function createRealtimeRoutes({ accessToken, appRealtimeHost }: RealtimeRouteOptions) {
  const warnedSubscriberLimits = new Set<RealtimeSubscriberChannel>()

  function warnSubscriberLimitOnce(channel: RealtimeSubscriberChannel, err: Error): void {
    if (warnedSubscriberLimits.has(channel)) return
    warnedSubscriberLimits.add(channel)
    realtimeRoutesLogger.warn({ channel, err }, 'realtime subscriber limit reached')
  }

  // Accepted tradeoff: WS upgrades do not validate Origin. They still require
  // the access token, and SameSite=Lax blocks normal cross-site cookie use;
  // the residual same-site risk is accepted for loopback/trusted-LAN use.
  // The shared middleware accepts cookie, header, or `?t=` query, so
  // browser clients (cookie), explicit token handoffs (`?t=`),
  // and LAN CLI clients (any of the three) all work. The middleware
  // stashes an `userId` derived from the access token on the
  // Hono context; the WS upgrade reads it and threads it into the
  // host calls. See `identity.ts` for the model.
  const auth = createWebSocketAccessTokenMiddleware(accessToken)

  const app = new Hono()
  app.use('/notifications', auth)
  const appRealtimeAuth = async (c: Context, next: Next) => {
    if (!c.req.query('clientId')) {
      return errorJson(c, 'BAD_REQUEST', 'Missing client id')
    }
    if (!appRealtimeHost.isValidClientId(c.req.query('clientId'))) {
      return errorJson(c, 'BAD_REQUEST', 'Invalid client id')
    }
    // Defense in depth: the auth middleware above always sets
    // `userId` on success, but refuse the upgrade if the value
    // ever goes missing — a single empty userId would silently
    // merge unrelated sessions in the manager.
    if (!userIdFromContext(c)) {
      return errorJson(c, 'INTERNAL', 'Owner id missing from auth context', 500)
    }
    await next()
  }
  app.use('/app', auth, appRealtimeAuth)

  app.get(
    '/notifications',
    upgradeWebSocket((c) => {
      const userId = userIdFromContext(c)
      return {
        onOpen(_event, ws) {
          try {
            if (!userId) throw new Error('notification owner missing')
            registerNotificationSocket(ws, userId)
          } catch (err) {
            if (err instanceof NotificationSocketLimitError) {
              try {
                ws.close(1013, 'subscriber limit reached')
              } catch {}
              warnSubscriberLimitOnce('notifications', err)
              return
            }
            throw err
          }
        },
        onMessage(event, ws) {
          // This channel accepts only a small subscription declaration, not RPC.
          if (typeof event.data !== 'string' || event.data.length > 128) {
            ws.close(1008, 'invalid notification subscription')
            return
          }
          let message: unknown
          try {
            message = JSON.parse(event.data)
          } catch {
            ws.close(1008, 'invalid notification subscription')
            return
          }
          if (!isNotificationSubscription(message)) {
            ws.close(1008, 'invalid notification subscription')
            return
          }
          setNotificationClientIntentSubscription(ws, message.enabled)
        },
        onClose(_event, ws) {
          unregisterNotificationSocket(ws)
        },
        onError(_event, ws) {
          unregisterNotificationSocket(ws)
        },
      }
    }),
  )
  const appRealtimeUpgrade = upgradeWebSocket((c) => {
    const clientId = c.req.query('clientId') ?? ''
    const userId = userIdFromContext(c) ?? ''
    return {
      onOpen(_event, ws) {
        if (!userId) {
          // Belt-and-suspenders: the pre-upgrade validator above should have
          // caught this. Close before broker registration so the socket never
          // enters a half-registered state.
          try {
            ws.close(1008, 'unauthorized')
          } catch {}
          return
        }
        const socket = requireServerAppRealtimeSocket(ws)
        try {
          appRealtimeHost.registerSocket(clientId, userId, socket)
        } catch (err) {
          if (err instanceof AppRealtimeSocketLimitError) {
            try {
              socket.close(1013, 'subscriber limit reached')
            } catch {}
            warnSubscriberLimitOnce('app', err)
            return
          }
          socket.terminate()
          throw err
        }
      },
      onMessage(event, ws) {
        const socket = requireServerAppRealtimeSocket(ws)
        if (typeof event.data !== 'string') {
          try {
            socket.close(1003, 'text messages required')
          } catch {}
          return
        }
        if (!isAppRealtimeWsMessageWithinLimit(event.data)) {
          try {
            socket.close(1009, 'message too large')
          } catch {}
          return
        }
        appRealtimeHost.handleRealtimeMessage(clientId, userId, socket, event.data)
      },
      onClose(_event, ws) {
        if (!userId) return
        const socket = requireServerAppRealtimeSocket(ws)
        appRealtimeHost.unregisterSocket(clientId, userId, socket)
      },
      onError(_event, ws) {
        if (!userId) return
        const socket = requireServerAppRealtimeSocket(ws)
        appRealtimeHost.unregisterSocket(clientId, userId, socket)
        socket.terminate()
      },
    }
  })
  app.get('/app', appRealtimeUpgrade)
  return app
}

function requireServerAppRealtimeSocket(ws: { raw?: unknown }): ServerAppRealtimeSocket {
  if (!ws.raw) throw new Error('@hono/node-server did not expose its raw WebSocket transport')
  return ws.raw as ServerAppRealtimeSocket
}
