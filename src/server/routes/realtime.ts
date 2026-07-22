import { Hono, type Context, type Next } from 'hono'
import { upgradeWebSocket } from '@hono/node-server'
import {
  InvalidationSocketLimitError,
  registerInvalidationSocket,
  unregisterInvalidationSocket,
} from '#/server/modules/invalidation-broker.ts'
import {
  ClientIntentSocketLimitError,
  registerClientIntentSocket,
  unregisterClientIntentSocket,
} from '#/server/modules/client-intent-broker.ts'
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

// Cap each app realtime WS message. Terminal paste is currently the largest
// legitimate payload, but the limit belongs to the shared transport now that
// runtime capabilities are siblings.

// Server-authoritative realtime for data, plus a dedicated envelope-forwarding
// channel for client effect intents sourced from `g`-style CLI clients.
//
// `/ws/invalidation` and `/ws/app` remain data-plane — they push server-
// owned state changes (repo invalidations, runtime stream events) to
// subscribers. `/ws/client-intent` is a control-plane relay: the server
// receives a `ClientEffectIntent` over HTTP (e.g. from `g delta`), wraps it
// in a JSON envelope, and fans it out to subscribed clients. The server
// does not interpret intent semantics — it just forwards. Interpretation
// happens in the client's existing `useClientEffectIntentRouter`,
// which already handles the same intents coming from Electron IPC.
export function createRealtimeRoutes({ accessToken, appRealtimeHost }: RealtimeRouteOptions) {
  // The shared middleware accepts cookie, header, or `?t=` query, so
  // browser clients (cookie), embedded Electron clients (`?t=`),
  // and LAN CLI clients (any of the three) all work. The middleware
  // stashes an `userId` derived from the access token on the
  // Hono context; the WS upgrade reads it and threads it into the
  // host calls. See `identity.ts` for the model.
  const auth = createWebSocketAccessTokenMiddleware(accessToken)

  const app = new Hono()
  app.use('/invalidation', auth)
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
    '/invalidation',
    upgradeWebSocket((c) => {
      const userId = userIdFromContext(c)
      return {
        onOpen(_event, ws) {
          try {
            if (!userId) throw new Error('invalidation owner missing')
            registerInvalidationSocket(ws, userId)
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
  // Client-side subscribers opt in to receive client effect intents
  // forwarded by the server. The client opens this socket once at boot
  // and feeds incoming payloads into its existing intent router — the
  // same path Electron IPC intents travel through. No server-side
  // message handling beyond register/unregister; the server never
  // receives anything from this socket beyond the upgrade.
  app.get(
    '/client-intent',
    auth,
    upgradeWebSocket(() => {
      return {
        onOpen(_event, ws) {
          try {
            registerClientIntentSocket(ws)
          } catch (err) {
            if (err instanceof ClientIntentSocketLimitError) {
              try {
                ws.close(1013, 'subscriber limit reached')
              } catch {}
              return
            }
            throw err
          }
        },
        onClose(_event, ws) {
          unregisterClientIntentSocket(ws)
        },
        onError(_event, ws) {
          unregisterClientIntentSocket(ws)
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
        try {
          appRealtimeHost.registerSocket(clientId, userId, ws as ServerAppRealtimeSocket)
        } catch (err) {
          if (err instanceof AppRealtimeSocketLimitError) {
            try {
              ws.close(1013, 'subscriber limit reached')
            } catch {}
            return
          }
          throw err
        }
      },
      onMessage(event, ws) {
        if (typeof event.data !== 'string') {
          try {
            ws.close(1003, 'text messages required')
          } catch {}
          return
        }
        if (!isAppRealtimeWsMessageWithinLimit(event.data)) {
          try {
            ws.close(1009, 'message too large')
          } catch {}
          return
        }
        appRealtimeHost.handleRealtimeMessage(clientId, userId, ws as ServerAppRealtimeSocket, event.data)
      },
      onClose(_event, ws) {
        if (!userId) return
        appRealtimeHost.unregisterSocket(clientId, userId, ws as ServerAppRealtimeSocket)
      },
      onError(_event, ws) {
        if (!userId) return
        appRealtimeHost.unregisterSocket(clientId, userId, ws as ServerAppRealtimeSocket)
      },
    }
  })
  app.get('/app', appRealtimeUpgrade)
  return app
}
