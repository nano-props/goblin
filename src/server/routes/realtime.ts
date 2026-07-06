import { Hono } from 'hono'
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
import { createAccessTokenMiddleware } from '#/server/common/auth.ts'
import { userIdFromContext } from '#/server/common/identity.ts'
import { errorJson } from '#/server/common/responses.ts'
import { isTerminalWsMessageWithinLimit } from '#/shared/terminal-validators.ts'
import type { ServerRealtimeHost, ServerTerminalSocket } from '#/server/terminal/terminal-host.ts'

interface RealtimeRouteOptions {
  accessToken: string
  terminalHost: ServerRealtimeHost
}

// Cap each terminal WS message. Real terminal input is a keystroke
// or a paste; the cap covers the largest legitimate paste while
// preventing a hostile client from streaming an unbounded buffer
// through the worker. Sourced from `shared/terminal-validators.ts` so the
// per-write cap (MAX_TERMINAL_WRITE_CHARS) and the per-message cap
// stay aligned as a single invariant — see the export site for the
// reasoning.

// Server-authoritative realtime for data, plus a dedicated envelope-forwarding
// channel for client effect intents sourced from `g`-style CLI clients.
//
// `/ws/invalidation` and `/ws/terminal` remain data-plane — they push server-
// owned state changes (repo invalidations, terminal stream events) to
// subscribers. `/ws/client-intent` is a control-plane relay: the server
// receives a `ClientEffectIntent` over HTTP (e.g. from `g delta`), wraps it
// in a JSON envelope, and fans it out to subscribed clients. The server
// does not interpret intent semantics — it just forwards. Interpretation
// happens in the client's existing `useClientEffectIntentRouter`,
// which already handles the same intents coming from Electron IPC.
export function createRealtimeRoutes({ accessToken, terminalHost }: RealtimeRouteOptions) {
  // The shared middleware accepts cookie, header, or `?t=` query, so
  // browser clients (cookie), embedded Electron clients (`?t=`),
  // and LAN CLI clients (any of the three) all work. The middleware
  // stashes an `userId` derived from the access token on the
  // Hono context; the WS upgrade reads it and threads it into the
  // host calls. See `identity.ts` for the model.
  const auth = createAccessTokenMiddleware(accessToken)

  const app = new Hono()
  app.use('/invalidation', auth)
  app.use('/terminal', auth, async (c, next) => {
    if (!c.req.query('clientId')) {
      return errorJson(c, 'BAD_REQUEST', 'Missing client id')
    }
    if (!terminalHost.isValidClientId(c.req.query('clientId'))) {
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
  app.get(
    '/terminal',
    upgradeWebSocket((c) => {
      const clientId = c.req.query('clientId') ?? ''
      const userId = userIdFromContext(c) ?? ''
      return {
        onOpen(_event, ws) {
          if (!userId) {
            // Belt-and-suspenders: the pre-upgrade validator above
            // should have caught this. Close before we hand the
            // socket to the broker so it never enters a half-registered
            // state.
            try {
              ws.close(1008, 'unauthorized')
            } catch {}
            return
          }
          terminalHost.registerSocket(clientId, userId, ws as ServerTerminalSocket)
        },
        onMessage(event, ws) {
          if (typeof event.data === 'string') {
            if (!isTerminalWsMessageWithinLimit(event.data)) {
              try {
                ws.close(1009, 'message too large')
              } catch {}
              return
            }
            terminalHost.handleRealtimeMessage(clientId, userId, ws as ServerTerminalSocket, event.data)
          }
        },
        onClose(_event, ws) {
          if (!userId) return
          terminalHost.unregisterSocket(clientId, userId, ws as ServerTerminalSocket)
        },
        onError(_event, ws) {
          if (!userId) return
          terminalHost.unregisterSocket(clientId, userId, ws as ServerTerminalSocket)
        },
      }
    }),
  )
  return app
}
